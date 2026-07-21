'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ModelSelector } from '@/server/ai/resolve-model';
import type { SelectorOption } from './use-chat-selector';

/** `ModelSelector` isn't a primitive Base UI `Select` can key on directly — collapse it to a string. */
function keyOf(selector: ModelSelector): string {
	return selector.kind === 'platform' ? 'platform' : `byok:${selector.provider}`;
}

/**
 * Which model answers the next turn: the platform model, or one of the user's BYOK provider
 * keys. Purely presentational — `options` comes from `buildSelectorOptions` (fed by
 * `api.aiCredentials.list` in the drawer, Task 10); this component owns no data fetching.
 */
export function ModelPicker(props: {
	onChange: (value: ModelSelector) => void;
	options: SelectorOption[];
	value: ModelSelector;
}) {
	const { onChange, options, value } = props;
	const items: Record<string, string> = {};
	for (const option of options) items[keyOf(option.value)] = option.label;

	const activeKey = keyOf(value);

	return (
		<Select
			disabled={options.length === 0}
			items={items}
			onValueChange={(key) => {
				const match = options.find((option) => keyOf(option.value) === key);
				if (match) onChange(match.value);
			}}
			value={activeKey}
		>
			<SelectTrigger aria-label='Model' className='w-fit'>
				<SelectValue placeholder='No model available' />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={keyOf(option.value)} value={keyOf(option.value)}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
