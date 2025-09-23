'use client';

import type { ColumnDef, SortingState, VisibilityState } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { CalendarIcon, ChevronDownIcon, DownloadIcon, Loader2, Search, Upload as UploadIcon } from 'lucide-react';
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { FileUpload } from '@/components/ui/file-upload';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, type RouterOutputs } from '@/trpc/react';
import type { TransactionRow } from './columns';
import { TransactionForm, type TransactionFormValues } from './transaction-form';

type DataTableProps<TData, TValue> = { columns: ColumnDef<TData, TValue>[] };

type ImportCsvResult = RouterOutputs['transactions']['importCsv'];
type DuplicateReview = ImportCsvResult['duplicates'][number];

export function DataTable<TData extends { id?: string }, TValue>({ columns }: DataTableProps<TData, TValue>) {
	const [sorting, setSorting] = useState<SortingState>([{ desc: true, id: 'date' }]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [rowSelection, setRowSelection] = useState({});
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);
	const [importFiles, setImportFiles] = useState<File[]>([]);
	const [importResult, setImportResult] = useState<ImportCsvResult | null>(null);
	const [duplicateSelections, setDuplicateSelections] = useState<Record<string, boolean>>({});
	const [duplicateReviewOpen, setDuplicateReviewOpen] = useState(false);

	// Filters and pagination state
	const [symbol, setSymbol] = useState('');
	const [side, setSide] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
	const [dateFrom, setDateFrom] = useState<string | undefined>(undefined);
	const [dateTo, setDateTo] = useState<string | undefined>(undefined);
	const [pageIndex, setPageIndex] = useState(0); // 0-based for TanStack
	const [pageSize, setPageSize] = useState(10);

	const utils = api.useUtils();
	const createMutation = api.transactions.create.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to add transaction');
		},
		async onSuccess() {
			toast.success('Transaction added');
			setCreateOpen(false);
			await utils.transactions.list.invalidate();
		}
	});
	const bulkDeleteMutation = api.transactions.bulkRemove.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to delete transactions');
		},
		async onSuccess(res) {
			toast.success(`Deleted ${res.deleted} transaction(s)`);
			setConfirmOpen(false);
			await utils.transactions.list.invalidate();
		}
	});
	const importMutation = api.transactions.importCsv.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to import transactions');
		},
		async onSuccess(res) {
			const duplicateMessage =
				res.duplicates.length > 0
					? `${res.duplicates.length} duplicate transaction${res.duplicates.length === 1 ? '' : 's'} need review.`
					: '';
			const baseMessage =
				res.errors.length > 0
					? `Imported ${res.imported} transaction${res.imported === 1 ? '' : 's'} with ${res.errors.length} error${
							res.errors.length === 1 ? '' : 's'
						}.`
					: `Imported ${res.imported} transaction${res.imported === 1 ? '' : 's'}.`;
			const message = [baseMessage, duplicateMessage].filter(Boolean).join(' ');
			toast.success(message || 'Import complete.');
			await utils.transactions.list.invalidate();
			if (res.errors.length > 0 || res.duplicates.length > 0) {
				setImportResult(res);
				if (res.duplicates.length > 0) {
					setDuplicateReviewOpen(true);
				}
			} else {
				setImportResult(null);
				setImportOpen(false);
				setImportFiles([]);
				setDuplicateSelections({});
				importDuplicatesMutation.reset();
			}
		}
	});
	const importDuplicatesMutation = api.transactions.importDuplicates.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to import duplicates');
		},
		async onSuccess(res) {
			if (res.created > 0) {
				toast.success(`Imported ${res.created} duplicate transaction${res.created === 1 ? '' : 's'}.`);
			}
			await utils.transactions.list.invalidate();
			let shouldClose = false;
			let hasRemaining = false;
			setImportResult((prev) => {
				if (!prev) return prev;
				const remaining = prev.duplicates.filter((dup) => !res.processedIds.includes(dup.id));
				hasRemaining = remaining.length > 0;
				const next: ImportCsvResult = {
					...prev,
					duplicates: remaining,
					imported: prev.imported + res.created
				};
				if (next.errors.length === 0 && next.duplicates.length === 0) {
					shouldClose = true;
					return null;
				}
				return next;
			});
			if (shouldClose) {
				setImportOpen(false);
				setImportFiles([]);
			}
			setDuplicateSelections({});
			if (shouldClose || !hasRemaining) {
				setDuplicateReviewOpen(false);
			}
		}
	});

	// When filters or sorting change, reset to first page
	useEffect(() => {
		setPageIndex(0);
	}, [symbol, side, dateFrom, dateTo, sorting]);

	const sortBy = useMemo(() => {
		const s = sorting[0];
		// allow only server-supported columns
		const allowed = new Set(['date', 'symbol', 'quantity', 'price']);
		return allowed.has(String(s?.id)) ? (s!.id as 'date' | 'symbol' | 'quantity' | 'price') : 'date';
	}, [sorting]);

	const sortDir = sorting[0]?.desc ? 'desc' : 'asc';

	const { data, isLoading, refetch, isFetching } = api.transactions.list.useQuery({
		dateFrom,
		dateTo,
		page: pageIndex + 1,
		pageSize,
		side: side === 'ALL' ? undefined : side,
		sortBy,
		sortDir,
		symbol: symbol || undefined
	});

	const showSkeletons = isLoading || (isFetching && (data?.items?.length ?? 0) === 0);
	const duplicates: DuplicateReview[] = [...(importResult?.duplicates ?? [])];
	const selectedDuplicates = useMemo(
		() => duplicates.filter((dup) => duplicateSelections[dup.id]),
		[duplicates, duplicateSelections]
	);
	const selectedDuplicateCount = selectedDuplicates.length;

	useEffect(() => {
		if (duplicates.length === 0) {
			setDuplicateSelections((prev) => (Object.keys(prev).length ? {} : prev));
			setDuplicateReviewOpen(false);
			return;
		}
		setDuplicateSelections((prev) => {
			const next: Record<string, boolean> = {};
			let changed = false;
			for (const dup of duplicates) {
				const prevValue = prev[dup.id] ?? false;
				next[dup.id] = prevValue;
				if (prev[dup.id] === undefined) changed = true;
			}
			if (!changed && Object.keys(prev).length !== duplicates.length) {
				const duplicateIds = new Set(duplicates.map((dup) => dup.id));
				for (const key of Object.keys(prev)) {
					if (!duplicateIds.has(key)) {
						changed = true;
						break;
					}
				}
			}
			return changed ? next : prev;
		});
	}, [duplicates]);

	const rows: TransactionRow[] = useMemo(
		() =>
			(data?.items ?? []).map((t: any) => ({
				...t,
				feeCurrency: t.feeCurrency ?? null,
				priceCurrency: t.priceCurrency ?? 'USD'
			})),
		[data]
	);

	const table = useReactTable({
		columns,
		data: rows as unknown as TData[],
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		manualSorting: true,
		onColumnVisibilityChange: setColumnVisibility,
		onPaginationChange: (updater) => {
			const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
			setPageIndex(next.pageIndex);
			setPageSize(next.pageSize);
		},
		onRowSelectionChange: setRowSelection,
		onSortingChange: setSorting,
		pageCount: data ? Math.ceil(data.total / data.pageSize) : -1,
		state: {
			columnVisibility,
			pagination: { pageIndex, pageSize },
			rowSelection,
			sorting
		}
	});

	// Numeric columns that should be right-aligned
	const numericColumns = useMemo(() => new Set(['quantity', 'price', 'total']), []);

	async function handleImport() {
		if (!importFiles[0]) {
			toast.error('Select a CSV file to import.');
			return;
		}
		try {
			const text = await importFiles[0].text();
			importMutation.mutate({ csv: text });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to read file';
			toast.error(message);
		}
	}

	function handleImportDuplicates() {
		if (selectedDuplicates.length === 0) return;
		importDuplicatesMutation.mutate({
			items: selectedDuplicates.map((dup) => ({
				date: dup.incoming.date,
				duplicateId: dup.id,
				fee: dup.incoming.fee,
				feeCurrency: dup.incoming.feeCurrency ?? undefined,
				note: dup.incoming.note ?? null,
				price: dup.incoming.price,
				priceCurrency: dup.incoming.priceCurrency,
				quantity: dup.incoming.quantity,
				side: dup.incoming.side,
				symbol: dup.incoming.symbol
			}))
		});
	}

	function updateDuplicateSelection(id: string, checked: boolean) {
		setDuplicateSelections((prev) => ({ ...prev, [id]: checked }));
	}

	function duplicateCheckboxId(id: string) {
		return `duplicate-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
	}

	return (
		<div className='space-y-4'>
			{/* Top row: primary action left, utilities right */}
			<div className='flex flex-wrap items-center gap-2'>
				<Button data-testid='add-transaction' onClick={() => setCreateOpen(true)} size='sm'>
					Add Transaction
				</Button>
				<Button onClick={() => setImportOpen(true)} size='sm' variant='outline'>
					<UploadIcon className='mr-2 size-4' /> Import
				</Button>
				<div className='ml-auto flex items-center gap-2'>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button className='w-auto' size='sm' variant='ghost'>
								Columns <ChevronDownIcon className='ml-2 size-4' />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end'>
							{table
								.getAllColumns()
								.filter((column) => column.getCanHide())
								.map((column) => {
									return (
										<DropdownMenuCheckboxItem
											checked={column.getIsVisible()}
											className='capitalize'
											key={column.id}
											onCheckedChange={(value) => column.toggleVisibility(!!value)}
										>
											{column.id}
										</DropdownMenuCheckboxItem>
									);
								})}
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						className='w-auto'
						disabled={table.getFilteredSelectedRowModel().rows.length === 0}
						onClick={() => setConfirmOpen(true)}
						size='sm'
						variant='destructive'
					>
						Delete Selected
					</Button>
				</div>
			</div>

			{/* Second row: filters and export */}
			<div className='flex flex-wrap items-center gap-2'>
				<div className='relative w-full sm:w-[220px] md:w-[260px]'>
					<Search className='pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						className='h-9 pl-8'
						data-testid='transactions-search'
						onChange={(e) => setSymbol(e.target.value)}
						placeholder='Search by symbol...'
						value={symbol}
					/>
				</div>

				<Select onValueChange={(v) => setSide(v as any)} value={side}>
					<SelectTrigger className='h-9 w-[150px]' data-testid='transactions-side-filter'>
						<SelectValue placeholder='All Sides' />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='ALL'>All Sides</SelectItem>
						<SelectItem value='BUY'>BUY</SelectItem>
						<SelectItem value='SELL'>SELL</SelectItem>
					</SelectContent>
				</Select>

				{/* Date range filter */}
				<Popover>
					<PopoverTrigger asChild>
						<Button className='h-9 gap-2' variant='outline'>
							<CalendarIcon className='size-4' />
							{dateFrom || dateTo ? `${dateFrom ?? '…'} → ${dateTo ?? '…'}` : 'Date range'}
						</Button>
					</PopoverTrigger>
					<PopoverContent align='start' className='w-auto p-0'>
						<Calendar
							autoFocus
							captionLayout='dropdown'
							disabled={(d) => d > new Date()}
							mode='range'
							onSelect={(range) => {
								const fmt = (d?: Date) => (d ? d.toISOString().slice(0, 10) : undefined);
								setDateFrom(fmt(range?.from));
								setDateTo(fmt(range?.to));
							}}
							selected={{
								from: dateFrom ? new Date(dateFrom) : undefined,
								to: dateTo ? new Date(dateTo) : undefined
							}}
						/>
						<div className='flex items-center justify-end gap-2 p-2'>
							<Button
								onClick={() => {
									setDateFrom(undefined);
									setDateTo(undefined);
								}}
								variant='ghost'
							>
								Clear
							</Button>
							<Button onClick={() => void refetch()} variant='secondary'>
								Apply
							</Button>
						</div>
					</PopoverContent>
				</Popover>

				{/* CSV export */}
				<CsvExportButton
					filters={{
						dateFrom,
						dateTo,
						side: side === 'ALL' ? undefined : side,
						sortBy,
						sortDir,
						symbol: symbol || undefined
					}}
				/>
			</div>

			<div className='rounded-md border overflow-x-auto'>
				<Table className=''>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow className='sticky top-0 z-2 bg-background' key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const isNumeric = numericColumns.has(header.column.id);
									return (
										<TableHead className={isNumeric ? 'text-right' : undefined} key={header.id}>
											{header.isPlaceholder
												? null
												: flexRender(header.column.columnDef.header, header.getContext())}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{showSkeletons ? (
							Array.from({ length: pageSize }).map((_, i) => (
								<TableRow key={`skeleton-row-${i}`}>
									{table.getVisibleLeafColumns().map((col, j) => {
										const widths = ['w-16', 'w-16', 'w-16', 'w-16', 'w-16'];
										const w = widths[j % widths.length];
										const isNumeric = numericColumns.has(col.id);
										return (
											<TableCell
												className={isNumeric ? 'text-right tabular-nums' : undefined}
												key={`skeleton-cell-${i}-${col.id}`}
											>
												<Skeleton className={`h-5 ${w} inline-block`} />
											</TableCell>
										);
									})}
								</TableRow>
							))
						) : table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									className='odd:bg-muted/30'
									data-state={row.getIsSelected() && 'selected'}
									key={row.id}
								>
									{row.getVisibleCells().map((cell) => {
										const isNumeric = numericColumns.has(cell.column.id);
										return (
											<TableCell
												className={isNumeric ? 'text-right tabular-nums' : undefined}
												key={cell.id}
											>
												{flexRender(cell.column.columnDef.cell, cell.getContext())}
											</TableCell>
										);
									})}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell className='h-24 text-center' colSpan={columns.length}>
									No results.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			<div className='flex flex-wrap items-center justify-end gap-2 py-4'>
				<div className='flex-1 text-sm text-muted-foreground'>
					{table.getFilteredSelectedRowModel().rows.length} of {table.getFilteredRowModel().rows.length}{' '}
					row(s) selected
				</div>
				<div className='flex items-center gap-2'>
					<Select onValueChange={(v) => table.setPageSize(Number(v))} value={String(pageSize)}>
						<SelectTrigger className='h-8 w-[110px]'>
							<SelectValue placeholder='Rows' />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='10'>10 / page</SelectItem>
							<SelectItem value='20'>20 / page</SelectItem>
							<SelectItem value='50'>50 / page</SelectItem>
							<SelectItem value='100'>100 / page</SelectItem>
						</SelectContent>
					</Select>
					<Button disabled={pageIndex === 0} onClick={() => table.previousPage()} size='sm' variant='outline'>
						Previous
					</Button>
					<Button
						disabled={data ? (pageIndex + 1) * pageSize >= data.total : true}
						onClick={() => table.nextPage()}
						size='sm'
						variant='outline'
					>
						Next
					</Button>
				</div>
			</div>

			{/* Confirm bulk delete */}
			<Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete selected transactions?</DialogTitle>
					</DialogHeader>
					<p className='text-sm text-muted-foreground'>
						This action cannot be undone. This will permanently delete the selected items.
					</p>
					<DialogFooter className='pt-4'>
						<Button onClick={() => setConfirmOpen(false)} variant='outline'>
							Cancel
						</Button>
						<Button
							data-testid='confirm-bulk-delete'
							disabled={bulkDeleteMutation.isPending}
							onClick={() => {
								const ids = table.getSelectedRowModel().rows.map((r) => String((r.original as any).id));
								if (ids.length > 0) bulkDeleteMutation.mutate({ ids });
							}}
							variant='destructive'
						>
							{bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Create transaction modal (form wired later) */}
			<Dialog onOpenChange={setCreateOpen} open={createOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Transaction</DialogTitle>
					</DialogHeader>
					<TransactionForm
						onCancel={() => setCreateOpen(false)}
						onSubmit={(vals: TransactionFormValues) => {
							createMutation.mutate({
								date: vals.date,
								fee: vals.fee ? Number(vals.fee) : undefined,
								feeCurrency: vals.feeCurrency,
								note: vals.note,
								price: vals.price,
								priceCurrency: vals.priceCurrency,
								quantity: vals.quantity,
								side: vals.side,
								symbol: vals.symbol
							});
						}}
						pending={createMutation.isPending}
					/>
				</DialogContent>
			</Dialog>

			{/* Import transactions modal */}
			<Dialog
				onOpenChange={(open) => {
					setImportOpen(open);
					if (!open) {
						setImportFiles([]);
						setImportResult(null);
						setDuplicateSelections({});
						setDuplicateReviewOpen(false);
						importMutation.reset();
						importDuplicatesMutation.reset();
					}
				}}
				open={importOpen}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Import Transactions</DialogTitle>
						<DialogDescription>
							<span>
								Upload a CSV file matching the exported format
								<br />
								(date, symbol, side, quantity, price, priceCurrency, fee, feeCurrency, note).
							</span>
						</DialogDescription>
					</DialogHeader>
					<FileUpload
						accept='.csv,text/csv'
						maxFiles={1}
						maxSize={5 * 1024 * 1024}
						onChange={(files) => {
							setImportFiles(files);
							setImportResult(null);
							setDuplicateSelections({});
							setDuplicateReviewOpen(false);
							importDuplicatesMutation.reset();
						}}
						value={importFiles}
					/>
					{importResult ? (
						<div className='mt-4 space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm'>
							<p className='font-medium'>
								Imported {importResult.imported} transaction{importResult.imported === 1 ? '' : 's'}.
							</p>
							{duplicates.length > 0 ? (
								<div className='flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200'>
									<div>
										<strong>{duplicates.length}</strong> potential duplicate transaction
										{duplicates.length === 1 ? '' : 's'} detected.
										<br />
										Review and choose if any should be added as separate entries.
									</div>
									<div className='flex flex-wrap items-center gap-2'>
										<Button
											onClick={() => setDuplicateReviewOpen(true)}
											size='sm'
											variant='secondary'
										>
											Review duplicates
										</Button>
										<Button
											onClick={() => {
												setDuplicateSelections({});
												importDuplicatesMutation.reset();
											}}
											size='sm'
											variant='ghost'
										>
											Clear selections
										</Button>
									</div>
								</div>
							) : null}
							{importResult.errors.length > 0 ? (
								<div className='space-y-2'>
									<p className='text-sm font-medium text-destructive'>
										Rows that could not be imported:
									</p>
									<div className='max-h-40 space-y-1 overflow-auto text-xs'>
										{importResult.errors.map((err) => (
											<div
												className='rounded-md bg-destructive/10 px-2 py-1'
												key={`${err.line}-${err.message}`}
											>
												Line {err.line}: {err.message}
											</div>
										))}
									</div>
								</div>
							) : null}
						</div>
					) : null}
					<DialogFooter>
						{importResult ? (
							<div className='flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
								{duplicates.length > 0 ? (
									<Button onClick={() => setDuplicateReviewOpen(true)} size='sm' variant='secondary'>
										Review duplicates
										{selectedDuplicateCount > 0 ? ` (${selectedDuplicateCount} selected)` : ''}
									</Button>
								) : (
									<p className='text-sm text-muted-foreground'>Review complete.</p>
								)}
								<div className='flex gap-2'>
									<Button
										onClick={() => {
											setImportResult(null);
											setImportFiles([]);
											setDuplicateSelections({});
											importMutation.reset();
											importDuplicatesMutation.reset();
											setDuplicateReviewOpen(false);
										}}
										variant='outline'
									>
										Import another file
									</Button>
									<Button onClick={() => setImportOpen(false)}>Done</Button>
								</div>
							</div>
						) : (
							<>
								<Button onClick={() => setImportOpen(false)} variant='outline'>
									Cancel
								</Button>
								<Button
									disabled={!importFiles.length || importMutation.isPending}
									onClick={() => void handleImport()}
								>
									{importMutation.isPending ? (
										<Loader2 className='mr-2 h-4 w-4 animate-spin' />
									) : null}
									Import
								</Button>
							</>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Duplicate review dialog */}
			<Dialog
				onOpenChange={(open) => {
					setDuplicateReviewOpen(open);
				}}
				open={duplicateReviewOpen}
			>
				<DialogContent className='max-w-3xl sm:max-h-[85vh] flex min-h-0 flex-col overflow-hidden'>
					<DialogHeader>
						<DialogTitle>Review duplicate transactions</DialogTitle>
						<DialogDescription>
							Select any of the flagged rows below to import them as additional transactions.
						</DialogDescription>
					</DialogHeader>
					<div className='mt-4 flex-1 overflow-hidden'>
						{duplicates.length > 0 ? (
							<div className='flex h-full min-h-0 flex-col gap-4 overflow-hidden'>
								<div className='flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground'>
									<p>
										{selectedDuplicateCount} selected · {duplicates.length} potential duplicate
										{duplicates.length === 1 ? '' : 's'}
									</p>
									<div className='flex gap-2'>
										<Button
											onClick={() =>
												setDuplicateSelections(
													duplicates.reduce(
														(acc, dup) => ({ ...acc, [dup.id]: true }),
														{} as Record<string, boolean>
													)
												)
											}
											size='sm'
											variant='ghost'
										>
											Select all
										</Button>
										<Button onClick={() => setDuplicateSelections({})} size='sm' variant='ghost'>
											Clear
										</Button>
									</div>
								</div>
								<ScrollArea className='h-72 pr-4'>
									<div className='space-y-4 pb-2'>
										{duplicates.map((dup) => {
											const checkboxId = duplicateCheckboxId(dup.id);
											const feeCurrency = dup.incoming.feeCurrency ?? dup.incoming.priceCurrency;
											return (
												<div
													className='rounded-lg border border-border bg-muted/50 p-4 shadow-sm'
													key={dup.id}
												>
													<div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
														<div className='space-y-1 text-sm'>
															<div className='flex flex-wrap items-center gap-2'>
																<p className='font-semibold'>{dup.incoming.symbol}</p>
																<span className='rounded bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-primary'>
																	{dup.incoming.side}
																</span>
															</div>
															<p className='text-muted-foreground'>
																{dup.incoming.date} · Qty {dup.incoming.quantity} ·
																Price {dup.incoming.price} {dup.incoming.priceCurrency}
															</p>
															{dup.incoming.fee != null ? (
																<p className='text-muted-foreground'>
																	Fee {dup.incoming.fee} {feeCurrency}
																</p>
															) : null}
															{dup.incoming.note ? (
																<p className='text-muted-foreground'>
																	Note: {dup.incoming.note}
																</p>
															) : null}
														</div>
														<div className='space-y-2 rounded-md border border-border/60 bg-background/60 p-3 text-xs text-muted-foreground'>
															<p className='font-medium text-foreground'>
																Matching transaction
																{dup.existing.length === 1 ? '' : 's'}
															</p>
															<div className='space-y-1'>
																{dup.existing.map((existing) => (
																	<div
																		className='rounded-md bg-muted px-2 py-1 text-xs'
																		key={existing.id}
																	>
																		<div>
																			{existing.date} · Qty {existing.quantity} @{' '}
																			{existing.price} {existing.priceCurrency}
																		</div>
																		<div>
																			{existing.side}
																			{existing.note
																				? ` · Note: ${existing.note}`
																				: ''}
																		</div>
																	</div>
																))}
															</div>
														</div>
													</div>
													<div className='flex items-center gap-2'>
														<Checkbox
															checked={duplicateSelections[dup.id] ?? false}
															id={checkboxId}
															onCheckedChange={(checked) =>
																updateDuplicateSelection(dup.id, checked === true)
															}
														/>
														<Label
															className='text-sm font-medium leading-none'
															htmlFor={checkboxId}
														>
															Import as separate
														</Label>
													</div>
												</div>
											);
										})}
									</div>
								</ScrollArea>
							</div>
						) : (
							<p className='text-sm text-muted-foreground'>No duplicates require review.</p>
						)}
					</div>
					<DialogFooter className='pt-4'>
						<Button onClick={() => setDuplicateReviewOpen(false)} variant='outline'>
							Close
						</Button>
						<Button
							disabled={selectedDuplicateCount === 0 || importDuplicatesMutation.isPending}
							onClick={handleImportDuplicates}
						>
							{importDuplicatesMutation.isPending ? (
								<Loader2 className='mr-2 h-4 w-4 animate-spin' />
							) : null}
							Import selected duplicate{selectedDuplicateCount === 1 ? '' : 's'}
							{selectedDuplicateCount > 0 ? ` (${selectedDuplicateCount})` : ''}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function CsvExportButton({
	filters
}: {
	filters: {
		sortBy: 'date' | 'symbol' | 'quantity' | 'price';
		sortDir: 'asc' | 'desc';
		symbol?: string;
		side?: 'BUY' | 'SELL';
		dateFrom?: string;
		dateTo?: string;
	};
}) {
	const { refetch, isFetching } = api.transactions.exportCsv.useQuery(filters, { enabled: false });
	return (
		<Button
			className='w-full lg:w-auto lg:ml-2'
			onClick={async () => {
				const res = await refetch();
				const csv = res.data ?? '';
				if (!csv) {
					toast.error('Failed to export CSV');
					return;
				}
				const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}}
			size='sm'
			variant='outline'
		>
			<DownloadIcon className='mr-2 size-4' /> Export CSV
		</Button>
	);
}
