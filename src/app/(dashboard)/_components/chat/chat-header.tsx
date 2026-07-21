'use client';

import { History, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { ModelSelector } from '@/server/ai/resolve-model';
import { type ChatSummary, ConversationList } from './conversation-list';
import { ModelPicker } from './model-picker';
import type { SelectorOption } from './use-chat-selector';

/**
 * The drawer's top bar for the single-column layout: assistant mark, title, model picker and a
 * history menu (a popover holding "New chat" + past conversations with inline rename/delete). No
 * persistent sidebar — history lives entirely in this menu. The close affordance is the
 * `SheetContent` built-in X (absolute, top-right); this bar reserves room for it with `pr-12`.
 */
export function ChatHeader(props: {
	activeId: string | null;
	chats: ChatSummary[];
	onDeleteChat: (id: string) => void;
	onNewChat: () => void;
	onRenameChat: (id: string, title: string) => void;
	onSelectChat: (id: string) => void;
	onSelectorChange: (value: ModelSelector) => void;
	options: SelectorOption[];
	selector: ModelSelector;
}) {
	const [historyOpen, setHistoryOpen] = useState(false);

	return (
		<div className='flex items-center gap-2 border-b p-3 pr-12'>
			<span className='flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary'>
				<Sparkles className='size-3.5' />
			</span>
			<SheetTitle className='mr-auto font-semibold text-sm'>AI assistant</SheetTitle>

			<ModelPicker onChange={props.onSelectorChange} options={props.options} value={props.selector} />

			<Popover onOpenChange={setHistoryOpen} open={historyOpen}>
				<PopoverTrigger
					aria-label='Conversation history'
					className={cn(buttonVariants({ size: 'icon', variant: 'ghost' }))}
				>
					<History className='size-4' />
				</PopoverTrigger>
				<PopoverContent align='end' className='w-72 p-0'>
					<ConversationList
						activeId={props.activeId}
						chats={props.chats}
						onDelete={props.onDeleteChat}
						onNew={() => {
							props.onNewChat();
							setHistoryOpen(false);
						}}
						onRename={props.onRenameChat}
						onSelect={(id) => {
							props.onSelectChat(id);
							setHistoryOpen(false);
						}}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}
