'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { api, type RouterOutputs } from '@/trpc/react';

const schema = z.object({
	date: z.string().min(1),
	fee: z.string().optional(),
	note: z.string().optional(),
	price: z.coerce.number().gt(0),
	quantity: z.coerce.number().gt(0),
	side: z.enum(['BUY', 'SELL']),
	symbol: z.string().min(1)
});

export type TransactionFormInput = z.input<typeof schema>;
export type TransactionFormValues = z.output<typeof schema>;

export function TransactionForm(props: {
	defaultValues?: Partial<TransactionFormInput>;
	onCancel: () => void;
	onSubmit: (values: TransactionFormValues) => void | Promise<void>;
	pending?: boolean;
}) {
	const { defaultValues, onCancel, onSubmit, pending } = props;
	const form = useForm<TransactionFormInput>({
		defaultValues: {
			date: new Date().toISOString().slice(0, 10),
			side: 'BUY',
			...defaultValues
		},
		resolver: zodResolver(schema)
	});

	// Control suggestions visibility
	const [symbolOpen, setSymbolOpen] = useState(false);
	const [symbolConfirmed, setSymbolConfirmed] = useState<boolean>(!!defaultValues?.symbol);
	const suggestionsRef = useRef<SymbolSuggestionsHandle | null>(null);

	useEffect(() => {
		if (defaultValues) {
			for (const [k, v] of Object.entries(defaultValues)) {
				form.setValue(k as any, v as any);
			}
		}
	}, [defaultValues]);

	return (
		<Form {...form}>
			<form
				className='grid gap-4'
				onSubmit={form.handleSubmit(async (vals) => {
					if (!symbolConfirmed) {
						form.setError('symbol', { message: 'Please select a symbol from the list.' });
						return;
					}
					await onSubmit(vals as unknown as TransactionFormValues);
				})}
			>
				<FormField
					control={form.control}
					name='date'
					render={({ field }) => (
						<FormItem className='grid gap-2'>
							<FormLabel>Date</FormLabel>
							<Popover>
								<PopoverTrigger asChild>
									<FormControl>
										<Button
											className={cn(
												'justify-start text-left font-normal',
												!field.value && 'text-muted-foreground'
											)}
											id='date'
											type='button'
											variant='outline'
										>
											<CalendarIcon className='mr-2 size-4' />
											{field.value ? field.value : <span>Pick a date</span>}
										</Button>
									</FormControl>
								</PopoverTrigger>
								<PopoverContent align='start' className='w-auto p-0'>
									<Calendar
										captionLayout='dropdown'
										disabled={(date) => {
											const today = new Date();
											today.setHours(0, 0, 0, 0);
											const d = new Date(date);
											d.setHours(0, 0, 0, 0);
											return d.getTime() > today.getTime();
										}}
										mode='single'
										onSelect={(d) => {
											if (!d) return;
											const iso = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
												.toISOString()
												.slice(0, 10);
											field.onChange(iso);
										}}
										selected={(() => {
											const v = field.value;
											if (!v) return undefined;
											const d = new Date(v);
											if (Number.isNaN(d.getTime())) return undefined;
											return d;
										})()}
									/>
								</PopoverContent>
							</Popover>
							<FormMessage />
						</FormItem>
					)}
				/>

				<div className='grid grid-cols-2 gap-4'>
					<FormField
						control={form.control}
						name='symbol'
						render={({ field }) => (
							<FormItem className='grid gap-2'>
								<FormLabel>Symbol</FormLabel>
								<FormControl>
									<div className='relative space-y-2'>
										<Input
											onBlur={() => setTimeout(() => setSymbolOpen(false), 100)}
											onChange={(e) => {
												field.onChange(e.target.value);
												setSymbolOpen(true);
												setSymbolConfirmed(false);
											}}
											onFocus={() => setSymbolOpen(true)}
											onKeyDown={(e) => {
												if (!symbolOpen) return;
												switch (e.key) {
													case 'ArrowDown':
														e.preventDefault();
														suggestionsRef.current?.move(1);
														break;
													case 'ArrowUp':
														e.preventDefault();
														suggestionsRef.current?.move(-1);
														break;
													case 'Home':
														e.preventDefault();
														suggestionsRef.current?.home();
														break;
													case 'End':
														e.preventDefault();
														suggestionsRef.current?.end();
														break;
													case 'Enter':
														if (symbolOpen) {
															e.preventDefault();
															suggestionsRef.current?.select();
															setSymbolOpen(false);
															setSymbolConfirmed(true);
														}
														break;
													case 'Escape':
														e.preventDefault();
														setSymbolOpen(false);
														break;
													default:
														break;
												}
											}}
											placeholder='AAPL'
											value={(field.value as string) ?? ''}
										/>
										<SymbolSuggestions
											onSelect={(sym) => {
												field.onChange(sym);
												setSymbolOpen(false);
												setSymbolConfirmed(true);
											}}
											open={symbolOpen}
											query={String(field.value ?? '')}
											ref={suggestionsRef}
										/>
									</div>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name='side'
						render={({ field }) => (
							<FormItem className='grid gap-2'>
								<FormLabel>Side</FormLabel>
								<Select onValueChange={field.onChange} value={field.value}>
									<FormControl>
										<SelectTrigger id='side'>
											<SelectValue placeholder='Select side' />
										</SelectTrigger>
									</FormControl>
									<SelectContent>
										<SelectItem value='BUY'>BUY</SelectItem>
										<SelectItem value='SELL'>SELL</SelectItem>
									</SelectContent>
								</Select>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>

				<div className='grid grid-cols-3 gap-4'>
					<FormField
						control={form.control}
						name='quantity'
						render={({ field }) => (
							<FormItem className='grid gap-2'>
								<FormLabel>Quantity</FormLabel>
								<FormControl>
									<Input
										inputMode='decimal'
										onChange={(e) => field.onChange(e.target.value)}
										step='any'
										type='number'
										value={(field.value as number | string | undefined) ?? ''}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name='price'
						render={({ field }) => (
							<FormItem className='grid gap-2'>
								<FormLabel>Price</FormLabel>
								<FormControl>
									<Input
										inputMode='decimal'
										onChange={(e) => field.onChange(e.target.value)}
										step='any'
										type='number'
										value={(field.value as number | string | undefined) ?? ''}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name='fee'
						render={({ field }) => (
							<FormItem className='grid gap-2'>
								<FormLabel>Fee</FormLabel>
								<FormControl>
									<Input
										inputMode='decimal'
										onChange={field.onChange}
										placeholder='0'
										step='any'
										type='number'
										value={(field.value as string | number | undefined) ?? ''}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>

				<FormField
					control={form.control}
					name='note'
					render={({ field }) => (
						<FormItem className='grid gap-2'>
							<FormLabel>Note</FormLabel>
							<FormControl>
								<Input
									onChange={field.onChange}
									placeholder='Optional'
									value={(field.value as string | undefined) ?? ''}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<div className='flex justify-end gap-2 pt-2'>
					<Button onClick={onCancel} type='button' variant='outline'>
						Cancel
					</Button>
					<Button disabled={pending} type='submit'>
						Save
					</Button>
				</div>
			</form>
		</Form>
	);
}

type SymbolSuggestionsHandle = {
	move: (delta: number) => void;
	home: () => void;
	end: () => void;
	select: () => void;
};

const SymbolSuggestions = forwardRef<
	SymbolSuggestionsHandle,
	{
		open: boolean;
		query: string;
		onSelect: (symbol: string) => void;
	}
>(function SymbolSuggestionsInner({ open, query, onSelect }, ref) {
	const debounced = useDebounce(query, 500);
	const enabled = open && debounced.trim().length > 1;
	const search = api.watchlist.search.useQuery({ q: debounced }, { enabled });
	const results: NonNullable<RouterOutputs['watchlist']['search']['result']> = search.data?.result ?? [];
	const [index, setIndex] = useState<number>(-1);
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		// Reset highlight when query changes
		setIndex(-1);
	}, [debounced]);

	useImperativeHandle(
		ref,
		() => ({
			end() {
				if (!enabled || results.length === 0) return;
				setIndex(results.length - 1);
			},
			home() {
				if (!enabled || results.length === 0) return;
				setIndex(0);
			},
			move(delta: number) {
				if (!enabled || results.length === 0) return;
				setIndex((prev) => {
					const next = Math.max(0, Math.min(results.length - 1, prev + delta));
					return next;
				});
			},
			select() {
				if (!enabled) return;
				const chosen = results[index] ?? results[0];
				if (chosen) onSelect(chosen.symbol);
			}
		}),
		[enabled, results, index, onSelect]
	);

	useEffect(() => {
		if (!listRef.current) return;
		if (index < 0) return;
		const el = listRef.current.querySelector<HTMLButtonElement>(`[data-idx="${index}"]`);
		if (el) {
			const parent = listRef.current;
			const top = el.offsetTop;
			const bottom = top + el.offsetHeight;
			if (top < parent.scrollTop) parent.scrollTop = top;
			else if (bottom > parent.scrollTop + parent.clientHeight) parent.scrollTop = bottom - parent.clientHeight;
		}
	}, [index]);

	if (!enabled) return null;

	return (
		<div
			className='absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md'
			ref={listRef}
			role='listbox'
		>
			{search.isLoading && (
				<div className='space-y-2 p-1'>
					<Skeleton className='h-8 w-full' />
					<Skeleton className='h-8 w-full' />
					<Skeleton className='h-8 w-full' />
				</div>
			)}
			{!search.isLoading && results.length > 0 && (
				<div className='space-y-1'>
					{results.map((r, idx) => (
						<button
							aria-selected={index === idx}
							className={`flex w-full items-center justify-between rounded-sm px-2 py-1 text-left hover:bg-accent ${index === idx ? 'bg-accent' : ''}`}
							data-idx={idx}
							key={`${r.symbol}-${idx}`}
							onMouseDown={(e) => {
								e.preventDefault();
								onSelect(r.symbol);
							}}
							role='option'
							type='button'
						>
							<span className='font-medium'>{r.displaySymbol || r.symbol}</span>
							<span className='ml-2 text-xs text-muted-foreground'>{r.description}</span>
						</button>
					))}
				</div>
			)}
			{!search.isLoading && results.length === 0 && (
				<div className='px-2 py-1 text-sm text-muted-foreground'>No results</div>
			)}
		</div>
	);
});
