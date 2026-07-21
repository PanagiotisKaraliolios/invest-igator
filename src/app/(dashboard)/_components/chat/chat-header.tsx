'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SheetTitle } from '@/components/ui/sheet';
import type { ModelSelector } from '@/server/ai/resolve-model';
import { ModelPicker } from './model-picker';
import type { SelectorOption } from './use-chat-selector';

/**
 * The drawer's top bar: title, model picker and a "new chat" button. Purely presentational — all
 * state and data arrive from the launcher via props. The close affordance is the `SheetContent`
 * built-in X (absolute, top-right); this bar reserves room for it with `pr-12` rather than
 * rendering a second, redundant close control.
 */
export function ChatHeader(props: {
	onNewChat: () => void;
	onSelectorChange: (value: ModelSelector) => void;
	options: SelectorOption[];
	selector: ModelSelector;
}) {
	return (
		<div className='flex items-center gap-2 border-b p-3 pr-12'>
			<SheetTitle className='mr-auto font-semibold text-sm'>AI assistant</SheetTitle>
			<ModelPicker onChange={props.onSelectorChange} options={props.options} value={props.selector} />
			<Button aria-label='New chat' onClick={props.onNewChat} size='icon' variant='ghost'>
				<Plus />
			</Button>
		</div>
	);
}
