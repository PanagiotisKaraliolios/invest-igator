'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ModelSelector } from '@/server/ai/resolve-model';
import type { SelectorOption } from './use-chat-selector';

/**
 * `ModelSelector` isn't a primitive Base UI `Select` can key on directly — collapse it to a
 * string. The model id is part of the key: without it, two models on the same provider would
 * collide onto one option and the picker could not tell them apart.
 *
 * Exported so `ChatLauncher`'s selector-repair effect can compare the held selector against
 * `options` using the SAME identity this component uses to render them — a second, parallel key
 * implementation there could drift from this one and repair against the wrong notion of "same".
 */
export function keyOf(selector: ModelSelector): string {
	if (selector.kind === 'platform') return 'platform';
	return selector.modelId === undefined
		? `byok:${selector.provider}`
		: `byok:${selector.provider}:${selector.modelId}`;
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
