'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/trpc/react';

const editSymbolSchema = z.object({
	currency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']),
	description: z.string().optional(),
	displaySymbol: z.string().optional(),
	type: z.string().optional()
});

type EditSymbolFormData = z.infer<typeof editSymbolSchema>;

type SymbolData = {
	createdAt: Date;
	currency: string;
	description: string | null;
	displaySymbol: string | null;
	symbol: string;
	type: string | null;
	userCount: number;
};

interface EditSymbolModalProps {
	symbol: SymbolData;
	onClose: () => void;
}

export function EditSymbolModal({ symbol, onClose }: EditSymbolModalProps) {
	const utils = api.useUtils();

	const {
		register,
		handleSubmit,
		setValue,
		watch,
		formState: { errors, isSubmitting }
	} = useForm<EditSymbolFormData>({
		defaultValues: {
			currency: symbol.currency as any,
			description: symbol.description ?? '',
			displaySymbol: symbol.displaySymbol ?? '',
			type: symbol.type ?? ''
		},
		resolver: zodResolver(editSymbolSchema)
	});

	const currencyValue = watch('currency');

	const updateSymbol = api.financialData.updateSymbol.useMutation({
		onError: (error) => {
			toast.error('Failed to update symbol', {
				description: error.message
			});
		},
		onSuccess: (data) => {
			toast.success('Symbol updated', {
				description: `Updated ${data.count} watchlist items for ${symbol.symbol}`
			});
			void utils.financialData.getAllSymbols.invalidate();
			onClose();
		}
	});

	const onSubmit = async (data: EditSymbolFormData) => {
		await updateSymbol.mutateAsync({
			currency: data.currency,
			description: data.description || undefined,
			displaySymbol: data.displaySymbol || undefined,
			symbol: symbol.symbol,
			type: data.type || undefined
		});
	};

	return (
		<Dialog onOpenChange={onClose} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Symbol: {symbol.symbol}</DialogTitle>
					<DialogDescription>
						Update metadata for this symbol. Changes will apply to all {symbol.userCount} users who have
						this symbol in their watchlist.
					</DialogDescription>
				</DialogHeader>

				<form className='space-y-4' onSubmit={handleSubmit(onSubmit)}>
					<Field data-invalid={!!errors.displaySymbol}>
						<FieldLabel htmlFor='displaySymbol'>Display Name</FieldLabel>
						<Input
							{...register('displaySymbol')}
							aria-invalid={!!errors.displaySymbol}
							id='displaySymbol'
							placeholder='e.g., Apple Inc.'
						/>
						<FieldError errors={[errors.displaySymbol]} />
					</Field>

					<Field data-invalid={!!errors.description}>
						<FieldLabel htmlFor='description'>Description</FieldLabel>
						<Input
							{...register('description')}
							aria-invalid={!!errors.description}
							id='description'
							placeholder='e.g., Technology company'
						/>
						<FieldError errors={[errors.description]} />
					</Field>

					<Field data-invalid={!!errors.type}>
						<FieldLabel htmlFor='type'>Type</FieldLabel>
						<Input
							{...register('type')}
							aria-invalid={!!errors.type}
							id='type'
							placeholder='e.g., stock, etf, crypto'
						/>
						<FieldError errors={[errors.type]} />
					</Field>

					<Field data-invalid={!!errors.currency}>
						<FieldLabel htmlFor='currency'>Currency</FieldLabel>
						<Select onValueChange={(value) => setValue('currency', value as any)} value={currencyValue}>
							<SelectTrigger id='currency'>
								<SelectValue placeholder='Select currency' />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='USD'>USD</SelectItem>
								<SelectItem value='EUR'>EUR</SelectItem>
								<SelectItem value='GBP'>GBP</SelectItem>
								<SelectItem value='HKD'>HKD</SelectItem>
								<SelectItem value='CHF'>CHF</SelectItem>
								<SelectItem value='RUB'>RUB</SelectItem>
							</SelectContent>
						</Select>
						<FieldError errors={[errors.currency]} />
					</Field>

					<DialogFooter>
						<Button onClick={onClose} type='button' variant='outline'>
							Cancel
						</Button>
						<Button disabled={isSubmitting} type='submit'>
							{isSubmitting ? 'Saving...' : 'Save Changes'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
