'use client';

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type SortingState,
	useReactTable,
	type VisibilityState
} from '@tanstack/react-table';
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	Ban,
	Crown,
	MoreHorizontal,
	Search,
	Shield,
	Trash2,
	UserCog,
	UserRoundCog
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounce } from '@/hooks/use-debounce';
import { authClient, useSession } from '@/lib/auth-client';
import { api } from '@/trpc/react';

type User = {
	id: string;
	email: string;
	name: string | null;
	role: string;
	banned: boolean;
	emailVerified: boolean;
	createdAt: string;
};

export function UserManagementTable() {
	const router = useRouter();
	const session = useSession();
	const [searchQuery, setSearchQuery] = useState('');
	const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
	const [sorting, setSorting] = useState<SortingState>([{ desc: false, id: 'createdAt' }]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(10);

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

	// Mutations
	const setRoleMutation = api.admin.setRole.useMutation({
		onError: (error) => {
			toast.error(error.message || 'Failed to update user role');
		},
		onSuccess: () => {
			toast.success('User role updated successfully');
			void utils.admin.listUsers.invalidate();
			void utils.admin.getAuditLogs.invalidate();
			router.refresh();
		}
	});

	const banUserMutation = api.admin.banUser.useMutation({
		onError: (error) => {
			toast.error(error.message || 'Failed to ban user');
		},
		onSuccess: () => {
			toast.success('User banned successfully');
			void utils.admin.listUsers.invalidate();
			void utils.admin.getAuditLogs.invalidate();
			router.refresh();
		}
	});

	const unbanUserMutation = api.admin.unbanUser.useMutation({
		onError: (error) => {
			toast.error(error.message || 'Failed to unban user');
		},
		onSuccess: () => {
			toast.success('User unbanned successfully');
			void utils.admin.listUsers.invalidate();
			void utils.admin.getAuditLogs.invalidate();
			router.refresh();
		}
	});

	const removeUserMutation = api.admin.removeUser.useMutation({
		onError: (error) => {
			toast.error(error.message || 'Failed to delete user');
		},
		onSuccess: () => {
			toast.success('User deleted successfully');
			setDeleteUserId(null);
			void utils.admin.listUsers.invalidate();
			void utils.admin.getAuditLogs.invalidate();
			router.refresh();
		}
	});

	const handleSetRole = (userId: string, newRole: 'superadmin' | 'admin' | 'user') => {
		setRoleMutation.mutate({ role: newRole, userId });
	};

	const handleBanUser = (userId: string) => {
		banUserMutation.mutate({ banReason: 'Banned by administrator', userId });
	};

	const handleUnbanUser = (userId: string) => {
		unbanUserMutation.mutate({ userId });
	};

	const handleDeleteUser = (userId: string) => {
		removeUserMutation.mutate({ userId });
	};

	const handleImpersonateUser = async (userId: string) => {
		try {
			const result = await authClient.admin.impersonateUser({ userId });

			if (result.error) {
				toast.error(result.error.message || 'Failed to impersonate user');
				return;
			}

			toast.success('Now impersonating user');

			// Hard navigation to ensure server components refetch with updated session
			window.location.href = '/portfolio';
		} catch (error) {
			toast.error('Failed to impersonate user');
			console.error('Impersonation error:', error);
		}
	};

	const columns: ColumnDef<User>[] = useMemo(
		() => [
			{
				accessorKey: 'email',
				cell: ({ row }) => <span className='font-medium'>{row.getValue('email')}</span>,
				enableSorting: true,
				header: 'Email'
			},
			{
				accessorKey: 'name',
				cell: ({ row }) => {
					const name = row.getValue('name') as string | null;
					return name || '-';
				},
				enableSorting: true,
				header: 'Name'
			},
			{
				accessorKey: 'role',
				cell: ({ row }) => {
					const role = row.getValue('role') as string;
					return (
						<Badge variant={role === 'superadmin' || role === 'admin' ? 'default' : 'outline'}>
							{role === 'superadmin' && <Crown className='mr-1 size-3' />}
							{role}
						</Badge>
					);
				},
				enableSorting: true,
				header: 'Role'
			},
			{
				accessorKey: 'banned',
				cell: ({ row }) => {
					const banned = row.getValue('banned') as boolean;
					return banned ? (
						<Badge variant='destructive'>Banned</Badge>
					) : (
						<Badge variant='outline'>Active</Badge>
					);
				},
				enableSorting: false,
				header: 'Status'
			},
			{
				accessorKey: 'emailVerified',
				cell: ({ row }) => {
					const verified = row.getValue('emailVerified') as boolean;
					return verified ? <Badge variant='outline'>✓</Badge> : <Badge variant='secondary'>Pending</Badge>;
				},
				enableSorting: false,
				header: 'Verified'
			},
			{
				accessorKey: 'createdAt',
				cell: ({ row }) => {
					const date = row.getValue('createdAt') as string;
					return new Date(date).toLocaleDateString();
				},
				enableSorting: true,
				header: 'Joined'
			},
			{
				cell: ({ row }) => {
					const user = row.original;
					// Admins cannot perform any actions on superadmin accounts
					if (user.role === 'superadmin' && !isSuperadmin) {
						return (
							<Button disabled size='icon' variant='ghost'>
								<MoreHorizontal className='size-4' />
								<span className='sr-only'>No actions available</span>
							</Button>
						);
					}

					return (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button size='icon' variant='ghost'>
									<MoreHorizontal className='size-4' />
									<span className='sr-only'>Actions</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align='end'>
								<DropdownMenuLabel>Actions</DropdownMenuLabel>

								{/* Only superadmins can promote to superadmin */}
								{isSuperadmin && user.role !== 'superadmin' && user.id !== currentUser?.id && (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem onClick={() => handleSetRole(user.id, 'superadmin')}>
											<Crown className='mr-2 size-4' />
											Make Superadmin
										</DropdownMenuItem>
									</>
								)}

								{/* Only superadmins can change admin roles */}
								{isSuperadmin && user.role !== 'admin' && user.id !== currentUser?.id && (
									<DropdownMenuItem onClick={() => handleSetRole(user.id, 'admin')}>
										<Shield className='mr-2 size-4' />
										Make Admin
									</DropdownMenuItem>
								)}

								{/* Demote to user - cannot demote yourself */}
								{user.role !== 'user' && user.id !== currentUser?.id && (
									<DropdownMenuItem onClick={() => handleSetRole(user.id, 'user')}>
										<UserCog className='mr-2 size-4' />
										Make User
									</DropdownMenuItem>
								)}

								{/* Ban/Unban - cannot ban yourself */}
								{user.id !== currentUser?.id &&
									(user.banned ? (
										<DropdownMenuItem onClick={() => handleUnbanUser(user.id)}>
											<UserCog className='mr-2 size-4' />
											Unban User
										</DropdownMenuItem>
									) : (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuItem onClick={() => handleBanUser(user.id)}>
												<Ban className='mr-2 size-4' />
												Ban User
											</DropdownMenuItem>
										</>
									))}

								{/* Impersonate user - cannot impersonate yourself or superadmins */}
								{user.id !== currentUser?.id && user.role !== 'superadmin' && (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem onClick={() => handleImpersonateUser(user.id)}>
											<UserRoundCog className='mr-2 size-4' />
											Impersonate User
										</DropdownMenuItem>
									</>
								)}

								{/* Delete user - cannot delete yourself */}
								{user.id !== currentUser?.id && (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											className='text-destructive'
											onClick={() => setDeleteUserId(user.id)}
										>
											<Trash2 className='mr-2 size-4' />
											Delete User
										</DropdownMenuItem>
									</>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					);
				},
				enableSorting: false,
				header: () => <div className='text-right'>Actions</div>,
				id: 'actions'
			}
		],
		[currentUser?.id, isSuperadmin]
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
