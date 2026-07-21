'use client';

import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import { Sparkles } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';

/**
 * Renders a single chat message, visually distinguishing the two roles: the user's turn is a
 * right-aligned rounded bubble (plain text — they typed it, so it is NOT run through markdown); the
 * assistant's turn is a left-aligned, full-width markdown block via `streamdown`, under a small
 * "AI assistant" label. Tool parts render full-width (the artifact registry supplies charts/tables
 * as cards). Reasoning/other part types are omitted for MVP.
 */
export function Message(props: {
	message: UIMessage;
	renderToolPart: (toolName: string, part: unknown) => React.ReactNode;
}) {
	const isUser = props.message.role === 'user';

	if (isUser) {
		return (
			<div className='flex flex-col items-end gap-2'>
				{props.message.parts.map((part, i) =>
					part.type === 'text' ? (
						<div
							className='max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground text-sm leading-relaxed'
							key={i}
						>
							{part.text}
						</div>
					) : null
				)}
			</div>
		);
	}

	return (
		<div className='flex flex-col gap-2'>
			<div className='flex items-center gap-1.5 text-muted-foreground text-xs'>
				<span className='flex size-4 items-center justify-center rounded bg-primary/15 text-primary'>
					<Sparkles className='size-2.5' />
				</span>
				<span className='font-medium'>AI assistant</span>
			</div>
			{props.message.parts.map((part, i) => {
				if (part.type === 'text') {
					return (
						<div
							className={cn(
								'text-sm leading-relaxed [&_a]:text-primary [&_a]:underline',
								'[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
								'[&_table]:my-2 [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1'
							)}
							key={i}
						>
							<Streamdown>{part.text}</Streamdown>
						</div>
					);
				}
				if (isToolUIPart(part)) {
					return <div key={i}>{props.renderToolPart(getToolName(part), part)}</div>;
				}
				return null; // reasoning/other: omitted for MVP
			})}
		</div>
	);
}
