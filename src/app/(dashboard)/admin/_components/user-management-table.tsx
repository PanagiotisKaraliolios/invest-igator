'use client';

import {
	flexRender,
	getCoreRowModel,
	type SortingState,
	useReactTable,
	type VisibilityState
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/trpc/react';
import { BanUserModal } from './ban-user-modal';
import { useUserManagementActions } from './use-user-management-actions';
import { UserActionsDropdown } from './user-actions-dropdown';
import { createUserColumns } from './user-management-columns';
import type { User } from './user-management-types';

export function UserManagementTable() {
	const [searchQuery, setSearchQuery] = useState('');
	const [sorting, setSorting] = useState<SortingState>([{ desc: false, id: 'createdAt' }]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(10);

	// Custom hook for all actions and mutations
	const {
		banUser,
		deleteUserId,
		handleBanUser,
		handleConfirmBan,
		handleDeleteUser,
		handleImpersonateUser,
		handleSetRole,
		handleUnbanUser,
		setBanUser,
		setDeleteUserId
	} = useUserManagementActions();

	// Debounce search query
	const debouncedSearchQuery = useDebounce(searchQuery, 300);

	// Reset to first page when filters or sorting change
	useEffect(() => {
		setPageIndex(0);
	}, [debouncedSearchQuery, sorting]);

	const sortBy = useMemo(() => {
		const s = sorting[0];
		// Only email, name, role, and createdAt are supported by the backend
		const allowed = new Set(['email', 'name', 'role', 'createdAt']);
		return allowed.has(String(s?.id)) ? (s!.id as 'email' | 'name' | 'role' | 'createdAt') : 'createdAt';
	}, [sorting]);

	const sortDir = sorting[0]?.desc ? 'desc' : 'asc';

	const utils = api.useUtils();

	// Get current user's role to determine available actions
	const { data: currentUser } = api.account.getMe.useQuery();
	const isSuperadmin = currentUser?.role === 'superadmin';

	// Query for users list
	const { data, isLoading, isFetching } = api.admin.listUsers.useQuery({
		limit: pageSize,
		offset: pageIndex * pageSize,
		searchField: 'email',
		searchOperator: 'contains',
		searchValue: debouncedSearchQuery || undefined,
		sortBy,
		sortDir
	});

	const users: User[] = useMemo(() => data?.users ?? [], [data]);
	const total = data?.total ?? 0;

	const showSkeletons = isLoading || (isFetching && users.length === 0);

	// Create columns with the actions dropdown
	const columns = useMemo(
		() => [
			...createUserColumns(),
			{
				cell: ({ row }) => (
					<UserActionsDropdown
						currentUserId={currentUser?.id}
						isSuperadmin={isSuperadmin}
						onBanUser={handleBanUser}
						onDeleteUser={setDeleteUserId}
						onImpersonateUser={handleImpersonateUser}
						onSetRole={handleSetRole}
						onUnbanUser={handleUnbanUser}
						user={row.original}
					/>
				),
				enableSorting: false,
				header: () => <div className='text-right'>Actions</div>,
				id: 'actions'
			}
		],
		[currentUser?.id, isSuperadmin, handleBanUser, handleSetRole, handleUnbanUser, handleImpersonateUser]
	);

	const table = useReactTable({
		columns,
		data: users,
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
		pageCount: data ? Math.ceil(total / pageSize) : -1,
		state: {
			columnVisibility,
			pagination: { pageIndex, pageSize },
			sorting
		}
	});

	return (
		<div className='space-y-4'>
			<div className='flex items-center gap-2'>
				<div className='relative w-full sm:w-[300px]'>
					<Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						className='pl-9'
						data-testid='admin-user-search'
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder='Search users by email...'
						value={searchQuery}
					/>
				</div>
			</div>

			<div className='rounded-md border'>
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const isActions = header.id === 'actions';
									return (
										<TableHead className={isActions ? 'text-right' : undefined} key={header.id}>
											{header.isPlaceholder ? null : header.column.getCanSort() ? (
												<div
													className='flex cursor-pointer select-none items-center gap-1 hover:text-foreground'
													onClick={header.column.getToggleSortingHandler()}
												>
													{flexRender(header.column.columnDef.header, header.getContext())}
													{!header.column.getIsSorted() && (
														<ArrowUpDown className='h-4 w-4' />
													)}
													{{
														asc: (
															<ArrowUp
																aria-label='Sorted ascending'
																className='h-4 w-4'
															/>
														),
														desc: (
															<ArrowDown
																aria-label='Sorted descending'
																className='h-4 w-4'
															/>
														)
													}[header.column.getIsSorted() as string] ?? null}
												</div>
											) : (
												flexRender(header.column.columnDef.header, header.getContext())
											)}
										</TableHead>
									);
								})}
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
										<TableCell
											className={cell.column.id === 'actions' ? 'text-right' : undefined}
											key={cell.id}
										>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell className='h-24 text-center' colSpan={columns.length}>
									No users found
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			<div className='flex flex-wrap items-center justify-end gap-2 py-4'>
				<div className='flex-1 text-sm text-muted-foreground'>
					{total} total user{total !== 1 ? 's' : ''}
				</div>
				<div className='flex items-center gap-2'>
					<Button disabled={pageIndex === 0} onClick={() => table.previousPage()} size='sm' variant='outline'>
						Previous
					</Button>
					<Button
						disabled={data ? (pageIndex + 1) * pageSize >= total : true}
						onClick={() => table.nextPage()}
						size='sm'
						variant='outline'
					>
						Next
					</Button>
				</div>
			</div>

			<BanUserModal
				isOpen={!!banUser}
				onConfirm={handleConfirmBan}
				onOpenChange={(open) => !open && setBanUser(null)}
				userEmail={banUser?.email}
			/>

			<AlertDialog onOpenChange={(open) => !open && setDeleteUserId(null)} open={!!deleteUserId}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete the user account and all
							associated data.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => deleteUserId && handleDeleteUser(deleteUserId)}>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
