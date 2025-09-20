'use client';

import type { ColumnDef, SortingState, VisibilityState } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { CalendarIcon, ChevronDownIcon, DownloadIcon, Loader2, Search } from 'lucide-react';
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/trpc/react';
import type { TransactionRow } from './columns';
import { TransactionForm, type TransactionFormValues } from './transaction-form';

type DataTableProps<TData, TValue> = { columns: ColumnDef<TData, TValue>[] };

export function DataTable<TData extends { id?: string }, TValue>({ columns }: DataTableProps<TData, TValue>) {
	const [sorting, setSorting] = useState<SortingState>([{ desc: true, id: 'date' }]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [rowSelection, setRowSelection] = useState({});
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);

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

	const rows: TransactionRow[] = useMemo(() => (data?.items ?? []).map((t) => ({ ...t })), [data]);

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

	return (
		<div className='space-y-4'>
			{/* Top row: primary action left, utilities right */}
			<div className='flex flex-wrap items-center gap-2'>
				<Button data-testid='add-transaction' onClick={() => setCreateOpen(true)} size='sm'>
					Add Transaction
				</Button>
				<div className='ml-auto flex items-center gap-2'>
					{isFetching ? (
						<span className='inline-flex items-center text-xs text-muted-foreground'>
							<Loader2 className='mr-1 size-3 animate-spin' /> Updating…
						</span>
					) : null}
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
									return (
										<TableHead key={header.id}>
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
										const widths = ['w-16', 'w-24', 'w-20', 'w-12', 'w-28'];
										const w = widths[j % widths.length];
										return (
											<TableCell key={`skeleton-cell-${i}-${col.id}`}>
												<Skeleton className={`h-5 ${w}`} />
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
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
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
					<DialogFooter>
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
								note: vals.note,
								price: vals.price,
								quantity: vals.quantity,
								side: vals.side,
								symbol: vals.symbol
							});
						}}
						pending={createMutation.isPending}
					/>
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
