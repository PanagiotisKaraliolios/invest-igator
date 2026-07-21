'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { ModelSelector } from '@/server/ai/resolve-model';
import { api } from '@/trpc/react';
import { ChatDrawer } from './chat-drawer';
import { buildSelectorOptions } from './use-chat-selector';

/**
 * The chat feature's single client entry point and state owner: it holds the drawer open state,
 * the CLIENT-generated `chatId`, the model selector, and the `useChat` instance. Everything
 * visual lives in `ChatDrawer`; this component wires data and behaviour into it.
 *
 * Chat id ownership (AI SDK v7): the client generates the id so a NEW conversation's later turns
 * reuse the same chat. It is generated in an effect (never during SSR render) to avoid a
 * hydration mismatch, and the route upserts it with `ensureChat`.
 */
export function ChatLauncher({ platformConfigured }: { platformConfigured: boolean }) {
	const [open, setOpen] = useState(false);
	const [chatId, setChatId] = useState<string | undefined>(undefined);
	const [selector, setSelector] = useState<ModelSelector>({ kind: 'platform' });

	const utils = api.useUtils();

	// Only ENABLED credentials are usable (the route rejects a disabled provider). Fetched lazily
	// once the drawer is opened, and memoised on the raw query data so `options` stays referentially
	// stable across renders (the selector-repair effect below depends on it).
	const credsQuery = api.aiCredentials.list.useQuery(undefined, { enabled: open });
	const options = useMemo(
		() =>
			buildSelectorOptions(
				platformConfigured,
				(credsQuery.data ?? []).filter((c) => c.enabled)
			),
		[platformConfigured, credsQuery.data]
	);

	// Seed the client id once, after mount — doing it during render would differ between the SSR
	// pass and the first client render and trip React's hydration check.
	useEffect(() => {
		setChatId((prev) => prev ?? crypto.randomUUID());
	}, []);

	// If the platform model isn't actually configured, the default `{ kind: 'platform' }` selector
	// is unusable — fall back to the first available BYOK option once credentials load.
	useEffect(() => {
		if (selector.kind === 'platform' && !platformConfigured && options.length > 0) {
			setSelector(options[0]!.value);
		}
	}, [options, platformConfigured, selector]);

	// The transport is created once and kept stable; it reads the CURRENT selector through a ref so
	// switching models never has to recreate it (or the underlying chat).
	const selectorRef = useRef(selector);
	selectorRef.current = selector;
	const [transport] = useState(
		() =>
			new DefaultChatTransport<UIMessage>({
				api: '/api/ai/chat',
				// Send ONLY the newest message — the server loads prior turns from the DB itself.
				prepareSendMessagesRequest: ({ id, messages }) => ({
					body: { chatId: id, message: messages[messages.length - 1], model: selectorRef.current }
				})
			})
	);

	const { messages, sendMessage, status, stop, error, setMessages } = useChat({
		id: chatId,
		// A finished turn may have just created a brand-new chat — refresh the history rail.
		onFinish: () => {
			void utils.aiChat.list.invalidate();
		},
		transport
	});

	// Loading a past conversation: `useChat` recreates its internal Chat DURING the render that
	// changes `id` (resetting messages), and `setMessages` writes to whichever instance is current
	// at call time. Calling it inline right after `setChatId` would therefore populate the OLD
	// instance and lose the data. Stash the loaded messages and apply them in an effect that runs
	// AFTER the id-change render, when the fresh instance is in place.
	const pending = useRef<{ id: string; messages: UIMessage[] } | null>(null);
	useEffect(() => {
		if (pending.current && pending.current.id === chatId) {
			setMessages(pending.current.messages);
			pending.current = null;
		}
	}, [chatId, setMessages]);

	function startNewChat() {
		pending.current = null;
		setMessages([]);
		setChatId(crypto.randomUUID());
	}

	async function selectChat(id: string) {
		try {
			const loaded = await utils.aiChat.get.fetch({ chatId: id });
			pending.current = { id, messages: loaded.messages };
			setChatId(id);
		} catch {
			// The fetch failed (network, or the chat was deleted under us). Leave the current
			// conversation untouched — no half-switched state — and tell the user rather than
			// floating an unhandled rejection out of this void click handler.
			toast.error('Could not load that conversation. Please try again.');
		}
	}

	return (
		<>
			<Button
				aria-label='Open AI assistant'
				data-testid='chat-launcher'
				onClick={() => setOpen(true)}
				size='icon'
				variant='ghost'
			>
				<Sparkles />
			</Button>
			<Sheet onOpenChange={setOpen} open={open}>
				<SheetContent
					className='flex w-[clamp(400px,36vw,560px)] max-w-[96vw] flex-col gap-0 p-0 sm:max-w-[96vw]'
					side='right'
				>
					<ChatDrawer
						activeId={chatId ?? null}
						error={error}
						messages={messages}
						onNewChat={startNewChat}
						onSelectChat={selectChat}
						onSelectorChange={setSelector}
						onSend={(text) => {
							void sendMessage({ text });
						}}
						onStop={stop}
						options={options}
						selector={selector}
						status={status}
					/>
				</SheetContent>
			</Sheet>
		</>
	);
}
