'use client';

import type { ChatStatus, UIMessage } from 'ai';
import type { ModelSelector } from '@/server/ai/resolve-model';
import { api } from '@/trpc/react';
import { renderArtifact } from './artifacts/registry';
import { errorCopy } from './chat-errors';
import { ChatHeader } from './chat-header';
import { Composer } from './composer';
import { Disclosure } from './disclosure';
import { MessageThread } from './message-thread';
import type { SelectorOption } from './use-chat-selector';

/**
 * Best-effort extraction of the route's `{ error: 'CODE' }` from a transport error. On a non-2xx
 * the AI SDK throws `new Error(await response.text())`, so the JSON body IS the error message.
 * Anything we can't parse (network abort, non-JSON body) falls back to the generic code, which
 * `errorCopy` renders as a safe, non-empty sentence.
 */
function errorCode(error: Error | undefined): string | null {
	if (!error) return null;
	try {
		const parsed = JSON.parse(error.message) as { error?: unknown };
		if (typeof parsed.error === 'string') return parsed.error;
	} catch {
		// not JSON — fall through to the generic code
	}
	return 'CHAT_FAILED';
}

/**
 * Assembles the chat experience inside the launcher's `SheetContent` as a single column: the header
 * (assistant mark + title + model picker + history menu), the message thread (tool parts rendered
 * by the deterministic artifact registry), an error banner, the composer and the persistent AI
 * disclosure. Owns only its own tRPC calls (chat list + rename/delete mutations); everything else —
 * messages, status, selector, send/stop — is threaded down from the launcher.
 */
export function ChatDrawer(props: {
	activeId: string | null;
	error: Error | undefined;
	messages: UIMessage[];
	onNewChat: () => void;
	onSelectChat: (id: string) => void;
	onSelectorChange: (value: ModelSelector) => void;
	onSend: (text: string) => void;
	onStop: () => void;
	options: SelectorOption[];
	selector: ModelSelector;
	status: ChatStatus;
}) {
	const utils = api.useUtils();
	const chatsQuery = api.aiChat.list.useQuery();
	const rename = api.aiChat.rename.useMutation({ onSuccess: () => utils.aiChat.list.invalidate() });
	const remove = api.aiChat.delete.useMutation({ onSuccess: () => utils.aiChat.list.invalidate() });

	const busy = props.status === 'streaming' || props.status === 'submitted';
	const code = errorCode(props.error);
	// `AiChat.title` is nullable in the schema; give an untitled chat a stable label.
	const chats = (chatsQuery.data ?? []).map((c) => ({ ...c, title: c.title ?? 'New chat' }));

	return (
		<div className='flex h-full min-h-0 flex-col'>
			<ChatHeader
				activeId={props.activeId}
				chats={chats}
				onDeleteChat={(id) => {
					remove.mutate({ chatId: id });
					// Deleting the open conversation would leave the thread orphaned — start a fresh one.
					if (id === props.activeId) props.onNewChat();
				}}
				onNewChat={props.onNewChat}
				onRenameChat={(id, title) => rename.mutate({ chatId: id, title })}
				onSelectChat={props.onSelectChat}
				onSelectorChange={props.onSelectorChange}
				options={props.options}
				selector={props.selector}
			/>
			<MessageThread
				messages={props.messages}
				onExample={props.onSend}
				renderToolPart={(toolName, part) =>
					renderArtifact(toolName, part as { output?: unknown; state?: string })
				}
			/>
			{code ? (
				<p className='px-4 pt-2 text-center text-destructive text-sm' role='alert'>
					{errorCopy(code)}
				</p>
			) : null}
			<Composer busy={busy} disabled={props.options.length === 0} onSend={props.onSend} onStop={props.onStop} />
			<Disclosure />
		</div>
	);
}
