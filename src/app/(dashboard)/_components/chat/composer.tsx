'use client';

import { Send, Square } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * Chat message composer. Owns its own input state — v7 `useChat` no longer manages one — and
 * hands the caller plain text on submit. Enter sends; Shift+Enter inserts a newline.
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
		<div className='flex items-end gap-2 border-t p-3'>
			<Textarea
				className='min-h-10 flex-1 resize-none'
				disabled={props.disabled}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						send();
					}
				}}
				placeholder='Ask about your portfolio…'
				value={text}
			/>
			{props.busy ? (
				<Button aria-label='Stop generating' onClick={props.onStop} size='icon' type='button' variant='outline'>
					<Square />
				</Button>
			) : (
				<Button aria-label='Send message' disabled={props.disabled} onClick={send} size='icon' type='button'>
					<Send />
				</Button>
			)}
		</div>
	);
}
