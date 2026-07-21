'use client';

import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import { Streamdown } from 'streamdown';

/**
 * Renders a single chat message's parts. Text parts render as markdown via `streamdown`; tool
 * parts are delegated to the caller's `renderToolPart` (Task 8 supplies the real registry).
 * Reasoning/other part types are omitted for MVP.
 */
export function Message(props: {
	message: UIMessage;
	renderToolPart: (toolName: string, part: unknown) => React.ReactNode;
}) {
	return (
		<div className='px-4 py-2'>
			{props.message.parts.map((part, i) => {
				if (part.type === 'text') return <Streamdown key={i}>{part.text}</Streamdown>;
				if (isToolUIPart(part)) return <div key={i}>{props.renderToolPart(getToolName(part), part)}</div>;
				return null; // reasoning/other: omitted for MVP
			})}
		</div>
	);
}
