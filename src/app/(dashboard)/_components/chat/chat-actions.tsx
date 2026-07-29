'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

type ChatActions = {
	/** Sends a normal user turn. Same function the composer uses. */
	sendMessage: (text: string) => void;
	/**
	 * True while a turn is already in flight (streaming or submitted — the same condition
	 * chat-drawer.tsx uses to drive the composer's Send/Stop swap). An artifact rendered WHILE
	 * the assistant is still streaming (e.g. the symbol picker, which appears before the prose
	 * introducing it has finished) must not be able to start a second concurrent turn for the
	 * same chat — `useChat`'s `sendMessage` has no in-flight guard of its own.
	 */
	busy: boolean;
};

const ChatActionsContext = createContext<ChatActions | null>(null);

/**
 * Gives chat artifacts a way to start a new user turn (e.g. the symbol picker sending the
 * ticker the user clicked). `renderArtifact` takes no callbacks, and threading one through
 * drawer -> thread -> message -> renderer would couple four components to one artifact's needs.
 */
export function ChatActionsProvider({
	busy,
	children,
	sendMessage
}: {
	busy: boolean;
	children: ReactNode;
	sendMessage: (text: string) => void;
}) {
	const value = useMemo(
		() => ({
			busy,
			// Belt-and-braces: even a caller that ignores `busy` can never start a second
			// concurrent turn through this context — duplicate assistant messages and a second
			// quota reservation for one user turn is not a recoverable state.
			sendMessage: (text: string) => {
				if (busy) return;
				sendMessage(text);
			}
		}),
		[busy, sendMessage]
	);
	return <ChatActionsContext.Provider value={value}>{children}</ChatActionsContext.Provider>;
}

/** `null` outside a chat (e.g. a standalone render), so artifacts degrade to non-interactive. */
export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
