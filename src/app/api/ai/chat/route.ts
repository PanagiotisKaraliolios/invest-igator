import type { UIMessage } from 'ai';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/get-session';
import { streamChatTurn } from '@/server/ai/chat/gateway';
import { createChat, deriveTitle } from '@/server/ai/chat/persistence';
import { QuotaExceededError } from '@/server/ai/quota';
import { platformModel } from '@/server/ai/registry';
import { InvalidCredentialError } from '@/server/ai/resolve-model';
import { db } from '@/server/db';

/** Streaming turns (tool calls, provider round-trips) routinely exceed the default 15s. */
export const maxDuration = 60;

/**
 * Only the NEWEST user message is accepted from the client — `streamChatTurn` (Task 5) loads
 * prior history from the DB itself, scoped to the caller's own chat. Accepting a client-supplied
 * history here would let a caller inject arbitrary prior turns into the model's context.
 */
const bodySchema = z.object({
	chatId: z.string().optional(),
	message: z.object({ id: z.string(), parts: z.array(z.any()), role: z.literal('user') }).passthrough(),
	model: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('platform') }),
		z.object({
			kind: z.literal('byok'),
			provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE'])
		})
	])
});

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

/**
 * `platformModel()` throws (lazily, only when someone actually asks for it) if Azure isn't
 * configured — that throw is the only signal available, so this narrows it to a boolean the
 * route can branch on without caring WHY it's unconfigured.
 */
function platformConfigured(): boolean {
	try {
		platformModel();
		return true;
	} catch {
		return false;
	}
}

/** First `text` part's text, or `''` — the raw material `deriveTitle` turns into a chat title. */
function firstText(message: { parts: unknown[] }): string {
	const part = message.parts.find(
		(p): p is { type: 'text'; text: string } =>
			typeof p === 'object' && p !== null && (p as { type?: string }).type === 'text'
	);
	return part?.text ?? '';
}

export async function POST(req: Request): Promise<Response> {
	const session = await getServerSession();
	if (!session?.user) return json(401, { error: 'UNAUTHENTICATED' });

	const parsed = bodySchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return json(400, { error: 'BAD_REQUEST' });
	const { chatId: incomingChatId, message, model } = parsed.data;
	const userId = session.user.id;

	// Re-validate the client's selector against the user's OWN credentials — never trust the
	// client's claim that a given BYOK provider is theirs, or that the platform model exists.
	if (model.kind === 'platform' && !platformConfigured()) {
		return json(409, { error: 'NO_PLATFORM_MODEL' });
	}
	if (model.kind === 'byok') {
		const owned = await db.aiProviderCredential.findFirst({
			select: { id: true },
			where: { enabled: true, provider: model.provider, userId }
		});
		if (owned === null) return json(403, { error: 'NO_SUCH_CREDENTIAL' });
	}

	// Server owns chat identity: create on the first turn, derive a title from the message text.
	const chatId = incomingChatId ?? (await createChat(userId, deriveTitle(firstText(message)))).id;

	try {
		return await streamChatTurn({
			abortSignal: req.signal,
			chatId,
			incoming: message as UIMessage,
			selector: model,
			session
		});
	} catch (err) {
		// `streamChatTurn` reserves quota internally (awaited before it returns), so a
		// `QuotaExceededError` propagates OUT of the call above rather than being handled inside it.
		if (err instanceof QuotaExceededError) return json(429, { error: 'QUOTA_EXCEEDED' });
		if (err instanceof InvalidCredentialError) return json(402, { error: 'CREDENTIAL_REJECTED' });
		return json(500, { error: 'CHAT_FAILED' });
	}
}
