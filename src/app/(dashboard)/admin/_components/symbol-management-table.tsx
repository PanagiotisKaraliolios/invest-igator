'use client';

import {
	flexRender,
	getCoreRowModel,
	type SortingState,
	useReactTable,
	type VisibilityState
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/trpc/react';
import { EditSymbolModal } from './edit-symbol-modal';

type SymbolData = {
	createdAt: Date;
	currency: string;
	description: string | null;
	displaySymbol: string | null;
	symbol: string;
	type: string | null;
	userCount: number;
};

export function SymbolManagementTable() {
	const [searchQuery, setSearchQuery] = useState('');
	const [sorting, setSorting] = useState<SortingState>([{ desc: false, id: 'symbol' }]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize] = useState(20);
	const [editingSymbol, setEditingSymbol] = useState<SymbolData | null>(null);

	// Debounce search query
	const debouncedSearchQuery = useDebounce(searchQuery, 300);

	// Reset to first page when filters or sorting change
	useEffect(() => {
		setPageIndex(0);
	}, [debouncedSearchQuery, sorting]);

	const sortBy = useMemo(() => {
		const s = sorting[0];
		const allowed = new Set(['symbol', 'users', 'createdAt']);
		return allowed.has(String(s?.id)) ? (s!.id as 'symbol' | 'users' | 'createdAt') : 'symbol';
	}, [sorting]);

	const sortDir = sorting[0]?.desc ? 'desc' : 'asc';

	// Query for symbols
	const { data, isLoading, isFetching } = api.financialData.getAllSymbols.useQuery({
		limit: pageSize,
		page: pageIndex + 1,
		search: debouncedSearchQuery || undefined,
		sortBy,
		sortDir
	});

	const symbols: SymbolData[] = useMemo(() => data?.symbols ?? [], [data]);
	const total = data?.total ?? 0;
	const hasMore = data?.hasMore ?? false;

	const showSkeletons = isLoading || (isFetching && symbols.length === 0);

	// Create columns
	const columns = useMemo(
		() => [
			{
				accessorKey: 'symbol',
				cell: ({ row }: any) => <div className='font-mono font-medium'>{row.getValue('symbol')}</div>,
				header: ({ column }: any) => {
					const isSorted = column.getIsSorted();
					return (
						<Button
							className='h-8 px-2 lg:px-3'
							onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
							variant='ghost'
						>
							Symbol
							{isSorted === 'asc' ? (
								<ArrowUp className='ml-2 h-4 w-4' />
							) : isSorted === 'desc' ? (
								<ArrowDown className='ml-2 h-4 w-4' />
							) : (
								<ArrowUpDown className='ml-2 h-4 w-4' />
							)}
						</Button>
					);
				},
				id: 'symbol'
			},
			{
				accessorKey: 'displaySymbol',
				cell: ({ row }: any) => (
					<div className='text-muted-foreground'>{row.getValue('displaySymbol') || '—'}</div>
				),
				header: 'Display Name',
				id: 'displaySymbol'
			},
			{
				accessorKey: 'description',
				cell: ({ row }: any) => (
					<div className='max-w-md truncate text-sm'>{row.getValue('description') || '—'}</div>
				),
				header: 'Description',
				id: 'description'
			},
			{
				accessorKey: 'type',
				cell: ({ row }: any) => <div className='text-sm capitalize'>{row.getValue('type') || '—'}</div>,
				header: 'Type',
				id: 'type'
			},
			{
				accessorKey: 'currency',
				cell: ({ row }: any) => <div className='font-medium'>{row.getValue('currency')}</div>,
				header: 'Currency',
				id: 'currency'
			},
			{
				accessorKey: 'userCount',
				cell: ({ row }: any) => <div className='text-center font-medium'>{row.getValue('userCount')}</div>,
				header: ({ column }: any) => {
					const isSorted = column.getIsSorted();
					return (
						<Button
							className='h-8 px-2 lg:px-3'
							onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
							variant='ghost'
						>
							Users
							{isSorted === 'asc' ? (
								<ArrowUp className='ml-2 h-4 w-4' />
							) : isSorted === 'desc' ? (
								<ArrowDown className='ml-2 h-4 w-4' />
							) : (
								<ArrowUpDown className='ml-2 h-4 w-4' />
							)}
						</Button>
					);
				},
				id: 'userCount'
			},
			{
				accessorKey: 'createdAt',
				cell: ({ row }: any) => {
					const date = row.getValue('createdAt') as Date;
					return <div className='text-sm'>{date.toLocaleDateString()}</div>;
				},
				header: ({ column }: any) => {
					const isSorted = column.getIsSorted();
					return (
						<Button
							className='h-8 px-2 lg:px-3'
							onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
							variant='ghost'
						>
							Added
							{isSorted === 'asc' ? (
								<ArrowUp className='ml-2 h-4 w-4' />
							) : isSorted === 'desc' ? (
								<ArrowDown className='ml-2 h-4 w-4' />
							) : (
								<ArrowUpDown className='ml-2 h-4 w-4' />
							)}
						</Button>
					);
				},
				id: 'createdAt'
			},
			{
				cell: ({ row }: any) => (
					<Button
						data-testid={`edit-symbol-${row.original.symbol}`}
						onClick={() => setEditingSymbol(row.original)}
						size='sm'
						variant='ghost'
					>
						<Pencil className='h-4 w-4' />
					</Button>
				),
				header: 'Actions',
				id: 'actions'
			}
		],
		[]
	);

	const table = useReactTable({
		columns,
		data: symbols,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		manualSorting: true,
		onColumnVisibilityChange: setColumnVisibility,
		onSortingChange: setSorting,
		pageCount: Math.ceil(total / pageSize),
		state: {
			columnVisibility,
			pagination: { pageIndex, pageSize },
			sorting
		}
	});

	return (
		<div className='space-y-4'>
			{/* Search */}
			<div className='flex items-center gap-2'>
				<div className='relative flex-1 max-w-sm'>
					<Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						className='pl-9'
						data-testid='symbol-search'
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder='Search symbols...'
						value={searchQuery}
					/>
				</div>
				<div className='text-muted-foreground text-sm'>
					Showing {symbols.length} of {total} symbols
				</div>
			</div>

			{/* Table */}
			<div className='rounded-md border'>
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead key={header.id}>
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{showSkeletons ? (
							// Show skeleton rows while loading
							Array.from({ length: pageSize }).map((_, i) => (
								<TableRow key={i}>
									{columns.map((_, j) => (
										<TableCell key={j}>
											<Skeleton className='h-5 w-full' />
										</TableCell>
									))}
								</TableRow>
							))
						) : table.getRowModel().rows.length === 0 ? (
							<TableRow>
								<TableCell className='h-24 text-center' colSpan={columns.length}>
									No symbols found.
								</TableCell>
							</TableRow>
						) : (
							table.getRowModel().rows.map((row) => (
								<TableRow data-state={row.getIsSelected() && 'selected'} key={row.id}>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{/* Pagination */}
			<div className='flex items-center justify-between'>
				<div className='text-muted-foreground text-sm'>
					Page {pageIndex + 1} of {Math.ceil(total / pageSize) || 1}
				</div>
				<div className='flex gap-2'>
					<Button
						disabled={pageIndex === 0 || isLoading}
						onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
						size='sm'
						variant='outline'
					>
						Previous
					</Button>
					<Button
						disabled={!hasMore || isLoading}
						onClick={() => setPageIndex((p) => p + 1)}
						size='sm'
						variant='outline'
					>
						Next
					</Button>
				</div>
			</div>

			{/* Edit Modal */}
			{editingSymbol && <EditSymbolModal onClose={() => setEditingSymbol(null)} symbol={editingSymbol} />}
		</div>
	);
}
