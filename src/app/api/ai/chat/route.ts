import type { UIMessage } from 'ai';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/get-session';
import { streamChatTurn } from '@/server/ai/chat/gateway';
import { deriveTitle, ensureChat } from '@/server/ai/chat/persistence';
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
	// REQUIRED: the client generates the chat id (AI SDK v7) and sends it on every turn, so a NEW
	// conversation's 2nd turn reuses the same chat instead of spawning a second one.
	chatId: z.string().min(1),
	// A user turn is text only. Restricting `part.type` to 'text' (and bounding sizes) stops a
	// client from smuggling a fabricated `tool-*`/data part that would be persisted and later
	// re-rendered as a "real" artifact in its own history. `.passthrough()` on the part tolerates
	// extra AI-SDK fields (e.g. providerMetadata) without widening the accepted `type`.
	message: z
		.object({
			id: z.string().max(200),
			parts: z
				.array(z.object({ text: z.string().min(1).max(8000), type: z.literal('text') }).passthrough())
				.min(1)
				.max(16),
			role: z.literal('user')
		})
		.passthrough(),
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
	const { chatId, message, model } = parsed.data;
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

	// The client owns the chat id; the server upserts it (create-if-missing) so the first turn
	// persists a row and later turns reuse it. `ensureChat` is a no-op for an id that already
	// exists — including one owned by another user, which stays theirs (see persistence.ts).
	await ensureChat(chatId, userId, deriveTitle(firstText(message)));

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
		// Converting to a JSON 500 here suppresses Next's default uncaught-error logging, so log
		// explicitly — otherwise an unmapped failure becomes invisible in production.
		console.error('POST /api/ai/chat failed:', err);
		return json(500, { error: 'CHAT_FAILED' });
	}
}
