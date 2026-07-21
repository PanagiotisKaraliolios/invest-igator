'use client';

import { formatDistanceToNow } from 'date-fns';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ChatSummary = { id: string; title: string; updatedAt: Date };

/**
 * Conversation history, rendered as the content of the header's history menu (a popover): a "New
 * chat" action, then the recent conversations with inline rename and delete. Purely presentational
 * — `chats` comes from `api.aiChat.list` and the mutations are wired by the drawer (Task 10).
 *
 * Sorts defensively (newest `updatedAt` first) rather than trusting caller order, so the
 * "newest first" contract holds even if a future caller forgets to sort server-side.
 */
export function ConversationList(props: {
	activeId: string | null;
	chats: ChatSummary[];
	onDelete: (id: string) => void;
	onNew: () => void;
	onRename: (id: string, title: string) => void;
	onSelect: (id: string) => void;
}) {
	const { activeId, chats, onDelete, onNew, onRename, onSelect } = props;
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState('');
	const [toDelete, setToDelete] = useState<string | null>(null);
	const skipNextBlurCommit = useRef(false);

	const sorted = [...chats].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
	const toDeleteChat = chats.find((c) => c.id === toDelete) ?? null;

	function startEdit(chat: ChatSummary) {
		setEditingId(chat.id);
		setDraft(chat.title);
	}

	function commitEdit(chat: ChatSummary) {
		const trimmed = draft.trim();
		if (trimmed.length > 0 && trimmed !== chat.title) onRename(chat.id, trimmed);
		setEditingId(null);
	}

	function cancelEdit() {
		skipNextBlurCommit.current = true;
		setEditingId(null);
	}

	return (
		<div className='flex max-h-[min(60vh,26rem)] flex-col p-1.5'>
			<Button className='w-full justify-start gap-2 font-medium' onClick={onNew} size='sm' variant='ghost'>
				<Plus className='size-4 text-primary' />
				New chat
			</Button>

			{sorted.length === 0 ? (
				<p className='px-2 py-6 text-center text-muted-foreground text-xs'>No conversations yet.</p>
			) : (
				<>
					<p className='px-2 pt-2.5 pb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider'>
						Recent
					</p>
					<div className='-mr-1 flex flex-col gap-0.5 overflow-y-auto pr-1'>
						{sorted.map((chat) => (
							<div
								className={cn(
									'group flex items-center gap-1 rounded-lg px-2 py-1.5',
									chat.id === activeId ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
								)}
								key={chat.id}
							>
								{editingId === chat.id ? (
									<Input
										autoFocus
										className='h-7 flex-1'
										onBlur={() => {
											if (skipNextBlurCommit.current) {
												skipNextBlurCommit.current = false;
												return;
											}
											commitEdit(chat);
										}}
										onChange={(e) => setDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												e.currentTarget.blur();
											} else if (e.key === 'Escape') {
												e.preventDefault();
												cancelEdit();
											}
										}}
										value={draft}
									/>
								) : (
									<button
										className='min-w-0 flex-1 text-left'
										onClick={() => onSelect(chat.id)}
										type='button'
									>
										<span className='block truncate text-sm'>{chat.title}</span>
										<span className='block truncate text-muted-foreground text-xs'>
											{formatDistanceToNow(chat.updatedAt, { addSuffix: true })}
										</span>
									</button>
								)}
								<div className='flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'>
									<Button
										aria-label={`Rename ${chat.title}`}
										onClick={() => startEdit(chat)}
										size='icon-xs'
										variant='ghost'
									>
										<Pencil className='size-3' />
									</Button>
									<Button
										aria-label={`Delete ${chat.title}`}
										onClick={() => setToDelete(chat.id)}
										size='icon-xs'
										variant='ghost'
									>
										<Trash2 className='size-3' />
									</Button>
								</div>
							</div>
						))}
					</div>
				</>
			)}

			<AlertDialog onOpenChange={(open) => !open && setToDelete(null)} open={toDelete !== null}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
						<AlertDialogDescription>
							{toDeleteChat ? `"${toDeleteChat.title}" ` : 'This conversation '}
							will be permanently deleted. This can't be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (toDelete) onDelete(toDelete);
								setToDelete(null);
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
