'use client';

import type { UIMessage } from 'ai';
import { Sparkles } from 'lucide-react';
import { Message } from './message';

const EXAMPLE_PROMPTS = [
	'How is my portfolio doing?',
	'What are my biggest holdings?',
	'Show my recent transactions',
	'How are my goals tracking?'
];

/**
 * The scrollable conversation. When empty it shows a welcome with tappable example prompts (each
 * sends immediately via `onExample`); otherwise it is a single column of role-aware `Message`s.
 * `renderToolPart` is threaded through to each message for inline artifacts.
 */
export function MessageThread(props: {
	messages: UIMessage[];
	onExample: (text: string) => void;
	renderToolPart: (toolName: string, part: unknown) => React.ReactNode;
}) {
	if (props.messages.length === 0) {
		return (
			<div className='flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center'>
				<span className='flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary'>
					<Sparkles className='size-6' />
				</span>
				<div className='space-y-1'>
					<h2 className='font-semibold text-sm'>Ask about your portfolio</h2>
					<p className='mx-auto max-w-[16rem] text-muted-foreground text-xs leading-relaxed'>
						Holdings, performance, transactions, watchlist and goals — grounded in your own data.
					</p>
				</div>
				<div className='flex w-full max-w-xs flex-col gap-2'>
					{EXAMPLE_PROMPTS.map((prompt) => (
						<button
							className='rounded-xl border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/50'
							key={prompt}
							onClick={() => props.onExample(prompt)}
							type='button'
						>
							{prompt}
						</button>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className='flex-1 space-y-5 overflow-y-auto px-4 py-4'>
			{props.messages.map((m) => (
				<Message key={m.id} message={m} renderToolPart={props.renderToolPart} />
			))}
		</div>
	);
}
