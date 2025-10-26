'use client';

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type SortingState,
	useReactTable,
	type VisibilityState
} from '@tanstack/react-table';
import { format, formatDistanceToNow } from 'date-fns';
import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createDateRangePresets, DateRangePicker } from '@/components/ui/date-range-picker';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/trpc/react';

const ACTIONS_CONFIG = {
	BAN_USER: { label: 'Ban User', variant: 'destructive' as const },
	DELETE_USER: { label: 'Delete User', variant: 'destructive' as const },
	IMPERSONATE_USER: { label: 'Impersonate', variant: 'outline' as const },
	SET_ROLE: { label: 'Set Role', variant: 'secondary' as const },
	STOP_IMPERSONATION: { label: 'Stop Impersonation', variant: 'outline' as const },
	UNBAN_USER: { label: 'Unban User', variant: 'default' as const },
	VIEW_STATS: { label: 'View Stats', variant: 'secondary' as const },
	VIEW_USERS: { label: 'View Users', variant: 'secondary' as const }
};

type AuditLog = {
	id: string;
	action: string;
	adminEmail: string;
	targetEmail: string | null;
	details: Record<string, unknown> | null;
	createdAt: Date;
};

export function AuditLogsTable() {
	const [sorting, setSorting] = useState<SortingState>([{ desc: true, id: 'createdAt' }]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(25);

	// Filters
	const [actionFilter, setActionFilter] = useState<string>('ALL');
	const [adminEmail, setAdminEmail] = useState('');
	const [targetEmail, setTargetEmail] = useState('');
	const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

	// Reset to first page when filters change
	useEffect(() => {
		setPageIndex(0);
	}, [actionFilter, adminEmail, targetEmail, dateRange]);

	const { data, isLoading, isFetching } = api.admin.getAuditLogs.useQuery({
		action: actionFilter === 'ALL' ? undefined : actionFilter,
		adminId: undefined,
		endDate: dateRange?.to,
		limit: pageSize,
		offset: pageIndex * pageSize,
		startDate: dateRange?.from,
		targetId: undefined
	});

	const auditPresets = useMemo(
		() => [
			createDateRangePresets.last7Days(),
			createDateRangePresets.last30Days(),
			createDateRangePresets.last90Days(),
			createDateRangePresets.thisMonth(),
			createDateRangePresets.lastMonth(),
			createDateRangePresets.thisYear()
		],
		[]
	);

	const showSkeletons = isLoading || (isFetching && (data?.logs?.length ?? 0) === 0);

	const rows: AuditLog[] = useMemo(
		() =>
			(data?.logs ?? []).map((log) => ({
				...log,
				createdAt: new Date(log.createdAt)
			})),
		[data]
	);

	// Filter rows by email search (client-side for simplicity)
	const filteredRows = useMemo(() => {
		let result = rows;
		if (adminEmail) {
			const lower = adminEmail.toLowerCase();
			result = result.filter((row) => row.adminEmail.toLowerCase().includes(lower));
		}
		if (targetEmail) {
			const lower = targetEmail.toLowerCase();
			result = result.filter((row) => row.targetEmail?.toLowerCase().includes(lower));
		}
		return result;
	}, [rows, adminEmail, targetEmail]);

	const columns: ColumnDef<AuditLog>[] = useMemo(
		() => [
			{
				accessorKey: 'action',
				cell: ({ row }) => {
					const action = row.getValue('action') as string;
					const actionConfig = ACTIONS_CONFIG[action as keyof typeof ACTIONS_CONFIG] || {
						label: action,
						variant: 'secondary' as const
					};
					return <Badge variant={actionConfig.variant}>{actionConfig.label}</Badge>;
				},
				header: 'Action'
			},
			{
				accessorKey: 'adminEmail',
				cell: ({ row }) => <span className='font-medium'>{row.getValue('adminEmail')}</span>,
				header: 'Admin'
			},
			{
				accessorKey: 'targetEmail',
				cell: ({ row }) => {
					const email = row.getValue('targetEmail') as string | null;
					return email ? (
						<span className='text-sm'>{email}</span>
					) : (
						<span className='text-sm text-muted-foreground'>—</span>
					);
				},
				header: 'Target User'
			},
			{
				accessorKey: 'details',
				cell: ({ row }) => {
					const details = row.getValue('details') as Record<string, unknown> | null;
					return details ? (
						<code className='rounded bg-muted px-1 py-0.5 text-xs'>{JSON.stringify(details)}</code>
					) : (
						<span className='text-sm text-muted-foreground'>—</span>
					);
				},
				header: 'Details'
			},
			{
				accessorKey: 'createdAt',
				cell: ({ row }) => {
					const date = row.getValue('createdAt') as Date;
					return (
						<div className='flex flex-col'>
							<span className='text-sm'>{format(date, 'MMM d, yyyy HH:mm')}</span>
							<span className='text-xs text-muted-foreground'>
								{formatDistanceToNow(date, { addSuffix: true })}
							</span>
						</div>
					);
				},
				header: 'Time'
			}
		],
		[]
	);

	const table = useReactTable({
		columns,
		data: filteredRows,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		manualSorting: true,
		onColumnVisibilityChange: setColumnVisibility,
		onPaginationChange: (updater) => {
			const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
			setPageIndex(next.pageIndex);
			setPageSize(next.pageSize);
		},
		onSortingChange: setSorting,
		pageCount: data ? Math.ceil(data.total / pageSize) : -1,
		state: {
			columnVisibility,
			pagination: { pageIndex, pageSize },
			sorting
		}
	});

	return (
		<div className='space-y-4'>
			{/* Filters row */}
			<div className='flex flex-wrap items-center gap-2'>
				<div className='relative w-full sm:w-[200px]'>
					<Search className='pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						className='h-9 pl-8'
						onChange={(e) => setAdminEmail(e.target.value)}
						placeholder='Admin email...'
						value={adminEmail}
					/>
				</div>

				<div className='relative w-full sm:w-[200px]'>
					<Search className='pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						className='h-9 pl-8'
						onChange={(e) => setTargetEmail(e.target.value)}
						placeholder='Target email...'
						value={targetEmail}
					/>
				</div>

				<Select onValueChange={(val) => setActionFilter(val)} value={actionFilter}>
					<SelectTrigger className='h-9 w-[180px]'>
						<SelectValue placeholder='All actions' />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='ALL'>All actions</SelectItem>
						{Object.entries(ACTIONS_CONFIG).map(([action, config]) => (
							<SelectItem key={action} value={action}>
								{config.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{/* Date range filter */}
				<DateRangePicker
					className='h-9'
					maxDate={new Date()}
					onChange={setDateRange}
					placeholder='Date range'
					presets={auditPresets}
					value={dateRange}
				/>

				<div className='ml-auto'>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size='sm' variant='outline'>
								Columns <ChevronDown className='ml-2 size-4' />
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
				</div>
			</div>

			<div className='rounded-md border overflow-x-auto'>
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
							Array.from({ length: pageSize }).map((_, i) => (
								<TableRow key={i}>
									{table.getAllColumns().map((col, j) => (
										<TableCell key={j}>
											<Skeleton className='h-6 w-full' />
										</TableCell>
									))}
								</TableRow>
							))
						) : table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow key={row.id}>
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
									No audit logs found.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			<div className='flex flex-wrap items-center justify-end gap-2 py-4'>
				<div className='flex-1 text-sm text-muted-foreground'>
					{data?.total ?? 0} total log{(data?.total ?? 0) !== 1 ? 's' : ''}
				</div>
				<div className='flex items-center gap-2'>
					<Select onValueChange={(v) => table.setPageSize(Number(v))} value={String(pageSize)}>
						<SelectTrigger className='h-8 w-[110px]'>
							<SelectValue placeholder='Rows' />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='10'>10 rows</SelectItem>
							<SelectItem value='25'>25 rows</SelectItem>
							<SelectItem value='50'>50 rows</SelectItem>
							<SelectItem value='100'>100 rows</SelectItem>
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
		</div>
	);
}
