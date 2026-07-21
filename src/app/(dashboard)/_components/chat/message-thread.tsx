'use client';

import type { UIMessage } from 'ai';
import { Message } from './message';

/** Scrollable list of chat messages. `renderToolPart` is threaded through to each `Message`. */
export function MessageThread(props: {
	messages: UIMessage[];
	renderToolPart: (toolName: string, part: unknown) => React.ReactNode;
}) {
	return (
		<div className='flex-1 overflow-y-auto'>
			{props.messages.map((m) => (
				<Message key={m.id} message={m} renderToolPart={props.renderToolPart} />
			))}
		</div>
	);
}
