'use client';

import { Download } from 'lucide-react';
import type React from 'react';
import { Button } from '@/components/ui/button';
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxValue
} from '@/components/ui/combobox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

export type ModelSetFieldProps = {
	/** Distinguishes element ids between the add and edit dialogs. */
	idPrefix: string;
	canListModels: boolean;
	enabledModelIds: string[];
	defaultModelId: string;
	fetchedModels: string[];
	modelQuery: string;
	onModelQueryChange: (query: string) => void;
	onEnabledChange: (next: string[]) => void;
	onPrimaryChange: (model: string) => void;
	onFetch: () => void;
	fetching: boolean;
	fetchDisabled: boolean;
	error?: React.ReactNode;
};

/**
 * The model chooser shared by the add-key dialog and the edit-models dialog: a creatable
 * Combobox of enabled models plus, once more than one is enabled, a primary-model Select.
 *
 * The primary-repair rule (promote `next[0]` when the selection no longer contains the
 * current primary) stays with the CALLER — only the caller owns the form state that
 * `onPrimaryChange` writes into.
 */
export function ModelSetField({
	idPrefix,
	canListModels,
	enabledModelIds,
	defaultModelId,
	fetchedModels,
	modelQuery,
	onModelQueryChange,
	onEnabledChange,
	onPrimaryChange,
	onFetch,
	fetching,
	fetchDisabled,
	error
}: ModelSetFieldProps) {
	const modelInputId = `${idPrefix}-model`;
	const primaryId = `${idPrefix}-primary`;

	// The typed text becomes a selectable row when it is not already a known model, so a
	// custom/unlisted id can always be added without a separate free-text field. Checked
	// against BOTH `fetchedModels` and the currently enabled models — re-typing an
	// already-added custom id (one that was never in `fetchedModels`) would otherwise show
	// a duplicate row tagged "custom" alongside the real chip.
	const trimmedQuery = modelQuery.trim();
	const modelItems =
		trimmedQuery !== '' && !fetchedModels.includes(trimmedQuery) && !enabledModelIds.includes(trimmedQuery)
			? [...fetchedModels, trimmedQuery]
			: fetchedModels;

	return (
		<>
			<Field>
				<div className='flex items-center justify-between gap-2'>
					<FieldLabel htmlFor={modelInputId}>Models</FieldLabel>
					<Button
						disabled={fetchDisabled || fetching}
						onClick={onFetch}
						size='sm'
						type='button'
						variant='outline'
					>
						{fetching ? <Spinner /> : <Download className='size-4' />}
						Fetch models
					</Button>
				</div>

				<Combobox
					inputValue={modelQuery}
					items={modelItems}
					multiple
					onInputValueChange={onModelQueryChange}
					onValueChange={(next: string[]) => {
						onEnabledChange(next);
						onModelQueryChange('');
					}}
					value={enabledModelIds}
				>
					<ComboboxChips>
						<ComboboxValue>
							{(value: string[]) => (
								<>
									{value.map((model) => (
										<ComboboxChip aria-label={model} key={model}>
											{model}
										</ComboboxChip>
									))}
									<ComboboxChipsInput
										id={modelInputId}
										placeholder={value.length > 0 ? '' : 'gpt-5.4-mini'}
									/>
								</>
							)}
						</ComboboxValue>
					</ComboboxChips>
					<ComboboxContent>
						<ComboboxEmpty>Type a model id to add it.</ComboboxEmpty>
						<ComboboxList>
							{(item: string) => (
								<ComboboxItem key={item} value={item}>
									{item}
									{!fetchedModels.includes(item) ? (
										<span className='ml-auto text-muted-foreground text-xs'>custom</span>
									) : null}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>

				<p className='text-muted-foreground text-xs'>
					{canListModels
						? 'Fetch the list, or type any model id to add it. One key often serves several models.'
						: 'Azure lists deployments rather than models — type the model id. This is NOT the deployment name.'}
				</p>
				<p className='text-muted-foreground text-xs'>
					A model we have no published price for is recorded as an unknown-price call.
				</p>
				{error}
			</Field>

			{enabledModelIds.length > 1 ? (
				<Field>
					<FieldLabel htmlFor={primaryId}>Primary model</FieldLabel>
					<Select onValueChange={(value) => onPrimaryChange(value as string)} value={defaultModelId}>
						<SelectTrigger className='w-full' id={primaryId}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{enabledModelIds.map((model) => (
								<SelectItem key={model} value={model}>
									{model}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className='text-muted-foreground text-xs'>
						Used when a request does not name a model — and the one we verify on save.
					</p>
				</Field>
			) : null}
		</>
	);
}
