'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

type ChatActions = {
	/** Sends a normal user turn. Same function the composer uses. */
	sendMessage: (text: string) => void;
};

const ChatActionsContext = createContext<ChatActions | null>(null);

/**
 * Gives chat artifacts a way to start a new user turn (e.g. the symbol picker sending the
 * ticker the user clicked). `renderArtifact` takes no callbacks, and threading one through
 * drawer -> thread -> message -> renderer would couple four components to one artifact's needs.
 */
export function ChatActionsProvider({
	children,
	sendMessage
}: {
	children: ReactNode;
	sendMessage: (text: string) => void;
}) {
	const value = useMemo(() => ({ sendMessage }), [sendMessage]);
	return <ChatActionsContext.Provider value={value}>{children}</ChatActionsContext.Provider>;
}

/** `null` outside a chat (e.g. a standalone render), so artifacts degrade to non-interactive. */
export function useChatActions(): ChatActions | null {
	return useContext(ChatActionsContext);
}
