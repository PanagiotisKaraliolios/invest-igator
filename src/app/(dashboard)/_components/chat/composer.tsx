'use client';

import { Send, Square } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Chat message composer: a single rounded input with the send/stop control tucked inside on the
 * right. Owns its own text state — v7 `useChat` no longer manages one — and hands the caller plain
 * text on submit. Enter sends; Shift+Enter inserts a newline.
 */
export function Composer(props: {
	busy: boolean;
	disabled: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
}) {
	const [text, setText] = useState('');

	const send = () => {
		const trimmed = text.trim();
		if (trimmed.length === 0 || props.disabled) return;
		props.onSend(trimmed);
		setText('');
	};

	return (
		<div className='px-4 pt-2'>
			<div className='flex items-end gap-1.5 rounded-2xl border bg-card p-1.5 pl-3.5 transition-colors focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-primary/15'>
				<textarea
					aria-label='Message'
					className='max-h-32 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60'
					disabled={props.disabled}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							send();
						}
					}}
					placeholder='Ask about your portfolio…'
					rows={1}
					value={text}
				/>
				{props.busy ? (
					<Button
						aria-label='Stop generating'
						className='rounded-xl'
						onClick={props.onStop}
						size='icon'
						type='button'
						variant='secondary'
					>
						<Square className='size-4' />
					</Button>
				) : (
					<Button
						aria-label='Send message'
						className='rounded-xl'
						disabled={props.disabled || text.trim().length === 0}
						onClick={send}
						size='icon'
						type='button'
					>
						<Send className='size-4' />
					</Button>
				)}
			</div>
		</div>
	);
}
