'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { type Currency, formatCurrency, supportedCurrencies } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { api, type RouterOutputs } from '@/trpc/react';

type Goal = RouterOutputs['goals']['list'][number];

const schema = z.object({
	note: z.string().optional(),
	targetAmount: z.coerce.number().gt(0, 'Target amount must be greater than 0'),
	targetCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).default('USD'),
	targetDate: z.string().optional(),
	title: z.string().min(1, 'Title is required')
});

type GoalFormInput = z.input<typeof schema>;
type GoalFormValues = z.output<typeof schema>;

export default function GoalsView() {
	const utils = api.useUtils();
	const { data, isLoading, isFetching } = api.goals.list.useQuery();

	const createMutation = api.goals.create.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to create goal');
		},
		async onSuccess() {
			toast.success('Goal created');
			setCreateOpen(false);
			await utils.goals.list.invalidate();
		}
	});

	const removeMutation = api.goals.remove.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to delete goal');
		},
		async onSuccess() {
			toast.success('Goal deleted');
			await utils.goals.list.invalidate();
		}
	});

	const [createOpen, setCreateOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [editing, setEditing] = useState<Goal | null>(null);

	const form = useForm<GoalFormInput>({
		defaultValues: {
			note: '',
			targetAmount: undefined as unknown as number,
			targetCurrency: 'USD',
			targetDate: '',
			title: ''
		},
		resolver: zodResolver(schema)
	});

	const editForm = useForm<GoalFormInput>({
		defaultValues: {
			note: '',
			targetAmount: undefined as unknown as number,
			targetCurrency: 'USD',
			targetDate: '',
			title: ''
		},
		resolver: zodResolver(schema)
	});

	const updateMutation = api.goals.update.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to update goal');
		},
		async onSuccess() {
			toast.success('Goal updated');
			setEditOpen(false);
			setEditing(null);
			await utils.goals.list.invalidate();
		}
	});

	const loading = isLoading || isFetching;
	const goals: Goal[] = data ?? [];

	return (
		<div className='space-y-4'>
			<div className='flex items-center gap-2'>
				<Button data-testid='add-goal' onClick={() => setCreateOpen(true)} size='sm'>
					<Plus className='mr-2 h-4 w-4' /> Add Goal
				</Button>
			</div>

			{loading ? (
				<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
					{Array.from({ length: 3 }).map((_, i) => (
						<Card key={`goal-skel-${i}`}>
							<CardHeader>
								<Skeleton className='h-5 w-40' />
							</CardHeader>
							<CardContent>
								<div className='space-y-3'>
									<div className='flex items-center justify-between'>
										<Skeleton className='h-4 w-16' />
										<Skeleton className='h-4 w-24' />
									</div>
									<div className='flex items-center justify-between'>
										<Skeleton className='h-4 w-16' />
										<Skeleton className='h-4 w-24' />
									</div>
									<Skeleton className='h-4 w-full' />
								</div>
							</CardContent>
							<CardFooter className='justify-end'>
								<Skeleton className='h-8 w-24' />
							</CardFooter>
						</Card>
					))}
				</div>
			) : goals.length === 0 ? (
				<div className='rounded-md border p-6 text-center text-sm text-muted-foreground'>
					No goals yet. Click “Add Goal” to create your first goal.
				</div>
			) : (
				<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
					{goals.map((g) => (
						<Card key={g.id}>
							<CardHeader>
								<CardTitle className='text-base'>{g.title}</CardTitle>
							</CardHeader>
							<CardContent>
								<div className='space-y-1 text-sm'>
									<div className='flex items-center justify-between'>
										<span className='text-muted-foreground'>Target</span>
										<span className='font-mono tabular-nums'>
											{formatCurrency(g.targetAmount, g.targetCurrency as Currency)}
										</span>
									</div>
									<div className='flex items-center justify-between'>
										<span className='text-muted-foreground'>Date</span>
										<span className='font-mono tabular-nums'>
											{g.targetDate ? new Date(g.targetDate).toISOString().slice(0, 10) : '-'}
										</span>
									</div>
									{g.note ? <p className='pt-2 text-muted-foreground'>{g.note}</p> : null}
								</div>
							</CardContent>
							<CardFooter className='justify-end gap-2'>
								<Button
									onClick={() => {
										setEditing(g);
										const dateStr = g.targetDate
											? new Date(g.targetDate).toISOString().slice(0, 10)
											: '';
										editForm.reset({
											note: g.note ?? '',
											targetAmount: g.targetAmount as unknown as number,
											targetCurrency: (g.targetCurrency as Currency) ?? 'USD',
											targetDate: dateStr,
											title: g.title ?? ''
										});
										setEditOpen(true);
									}}
									size='sm'
									variant='ghost'
								>
									<Pencil className='mr-2 h-4 w-4' /> Edit
								</Button>
								<Button
									aria-label={`Delete ${g.title}`}
									onClick={() => removeMutation.mutate({ id: g.id })}
									size='sm'
									variant='ghost'
								>
									<Trash2 className='mr-2 h-4 w-4' /> Delete
								</Button>
							</CardFooter>
						</Card>
					))}
				</div>
			)}

			<Dialog
				onOpenChange={(open) => {
					setCreateOpen(open);
					if (!open) {
						form.reset({
							note: '',
							targetAmount: undefined as unknown as number,
							targetCurrency: 'USD',
							targetDate: '',
							title: ''
						});
						createMutation.reset();
					}
				}}
				open={createOpen}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create Goal</DialogTitle>
					</DialogHeader>

					<Form {...form}>
						<form
							className='space-y-4'
							onSubmit={form.handleSubmit((vals) => {
								const v = vals as unknown as GoalFormValues;
								createMutation.mutate({
									note: v.note?.trim() || undefined,
									targetAmount: v.targetAmount,
									targetCurrency: v.targetCurrency,
									targetDate: v.targetDate || undefined,
									title: v.title.trim()
								});
							})}
						>
							<FormField
								control={form.control}
								name='title'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Title</FormLabel>
										<FormControl>
											<Input
												onChange={field.onChange}
												placeholder='e.g., Emergency Fund'
												value={(field.value as string) ?? ''}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
								<FormField
									control={form.control}
									name='targetAmount'
									render={({ field }) => (
										<FormItem className='sm:col-span-2'>
											<FormLabel>Target Amount</FormLabel>
											<FormControl>
												<Input
													inputMode='decimal'
													onChange={(e) => field.onChange(e.target.value)}
													placeholder='10000'
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
									name='targetCurrency'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Currency</FormLabel>
											<Select onValueChange={field.onChange} value={field.value}>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder='Currency' />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{supportedCurrencies.map((c) => (
														<SelectItem key={c} value={c}>
															{c}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>

							<div className='grid grid-cols-1 gap-3'>
								<FormField
									control={form.control}
									name='targetDate'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Target Date</FormLabel>
											<Popover>
												<PopoverTrigger asChild>
													<FormControl>
														<Button
															className={cn(
																'justify-start text-left font-normal',
																!field.value && 'text-muted-foreground'
															)}
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
														endMonth={new Date(new Date().getFullYear() + 100, 11)}
														mode='single'
														onSelect={(d) => {
															if (!d) return;
															const iso = new Date(
																Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
															)
																.toISOString()
																.slice(0, 10);
															field.onChange(iso);
														}}
														selected={(() => {
															const v = field.value as string | undefined;
															if (!v) return undefined;
															const d = new Date(v);
															return isNaN(d.getTime()) ? undefined : d;
														})()}
													/>
												</PopoverContent>
											</Popover>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>

							<FormField
								control={form.control}
								name='note'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Note (optional)</FormLabel>
										<FormControl>
											<Textarea
												className='max-h-60'
												onChange={field.onChange}
												placeholder='Optional note'
												value={(field.value as string | undefined) ?? ''}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<DialogFooter className='pt-2'>
								<Button onClick={() => setCreateOpen(false)} type='button' variant='outline'>
									Cancel
								</Button>
								<Button
									data-testid='confirm-create-goal'
									disabled={createMutation.isPending}
									type='submit'
								>
									{createMutation.isPending ? 'Creating…' : 'Create Goal'}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>

			{/* Edit goal modal */}
			<Dialog
				onOpenChange={(open) => {
					setEditOpen(open);
					if (!open) {
						setEditing(null);
						updateMutation.reset();
					}
				}}
				open={editOpen}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Goal</DialogTitle>
					</DialogHeader>

					<Form {...editForm}>
						<form
							className='space-y-4'
							onSubmit={editForm.handleSubmit((vals) => {
								if (!editing) return;
								const v = vals as unknown as GoalFormValues;
								updateMutation.mutate({
									id: editing.id,
									note: v.note?.trim() || null,
									targetAmount: v.targetAmount,
									targetCurrency: v.targetCurrency,
									targetDate: v.targetDate || null,
									title: v.title.trim()
								});
							})}
						>
							<FormField
								control={editForm.control}
								name='title'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Title</FormLabel>
										<FormControl>
											<Input
												onChange={field.onChange}
												placeholder='e.g., Emergency Fund'
												value={(field.value as string) ?? ''}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
								<FormField
									control={editForm.control}
									name='targetAmount'
									render={({ field }) => (
										<FormItem className='sm:col-span-2'>
											<FormLabel>Target Amount</FormLabel>
											<FormControl>
												<Input
													inputMode='decimal'
													onChange={(e) => field.onChange(e.target.value)}
													placeholder='10000'
													type='number'
													value={(field.value as number | string | undefined) ?? ''}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={editForm.control}
									name='targetCurrency'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Currency</FormLabel>
											<Select onValueChange={field.onChange} value={field.value}>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder='Currency' />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{supportedCurrencies.map((c) => (
														<SelectItem key={c} value={c}>
															{c}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>

							<div className='grid grid-cols-1 gap-3'>
								<FormField
									control={editForm.control}
									name='targetDate'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Target Date</FormLabel>
											<Popover>
												<PopoverTrigger asChild>
													<FormControl>
														<Button
															className={cn(
																'justify-start text-left font-normal',
																!field.value && 'text-muted-foreground'
															)}
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
														endMonth={new Date(new Date().getFullYear() + 100, 11)}
														mode='single'
														onSelect={(d) => {
															if (!d) return;
															const iso = new Date(
																Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
															)
																.toISOString()
																.slice(0, 10);
															field.onChange(iso);
														}}
														selected={(() => {
															const v = field.value as string | undefined;
															if (!v) return undefined;
															const d = new Date(v);
															return isNaN(d.getTime()) ? undefined : d;
														})()}
													/>
												</PopoverContent>
											</Popover>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>

							<FormField
								control={editForm.control}
								name='note'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Note (optional)</FormLabel>
										<FormControl>
											<Textarea
												className='max-h-60'
												onChange={field.onChange}
												placeholder='Optional note'
												value={(field.value as string | undefined) ?? ''}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<DialogFooter className='pt-2'>
								<Button onClick={() => setEditOpen(false)} type='button' variant='outline'>
									Cancel
								</Button>
								<Button
									data-testid='confirm-update-goal'
									disabled={updateMutation.isPending}
									type='submit'
								>
									{updateMutation.isPending ? 'Saving…' : 'Save Changes'}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
