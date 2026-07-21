'use client';

import { formatDistanceToNow } from 'date-fns';
import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
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
 * The chat drawer's history rail. Purely presentational: `chats` comes from
 * `api.aiChat.list` and `onRename`/`onDelete` are wired to `api.aiChat.rename`/`delete`
 * mutations by the drawer (Task 10) — this component owns no tRPC calls.
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
		<div className='flex h-full flex-col'>
			<div className='p-2'>
				<Button className='w-full justify-start gap-2' onClick={onNew} size='sm' variant='outline'>
					<MessageSquarePlus className='size-4' />
					New chat
				</Button>
			</div>

			{sorted.length === 0 ? (
				<p className='text-muted-foreground px-3 py-2 text-sm'>
					No conversations yet — start one to see it here.
				</p>
			) : (
				<div className='flex-1 space-y-0.5 overflow-y-auto px-2'>
					{sorted.map((chat) => (
						<div
							className={cn(
								'group flex items-center gap-1 rounded-md px-2 py-1.5',
								chat.id === activeId ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
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
									<span className='text-muted-foreground block truncate text-xs'>
										{formatDistanceToNow(chat.updatedAt, { addSuffix: true })}
									</span>
								</button>
							)}
							<div className='flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'>
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
