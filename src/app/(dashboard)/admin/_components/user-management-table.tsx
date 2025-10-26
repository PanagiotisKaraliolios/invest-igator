'use client';

import { Ban, Crown, MoreHorizontal, Search, Shield, Trash2, UserCog, UserRoundCog } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { authClient, useSession } from '@/lib/auth-client';
import { api } from '@/trpc/react';

export function UserManagementTable() {
	const router = useRouter();
	const session = useSession();
	const [searchQuery, setSearchQuery] = useState('');
	const [currentPage, setCurrentPage] = useState(1);
	const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
	const pageSize = 10;

	const utils = api.useUtils();

	// Get current user's role to determine available actions
	const { data: currentUser } = api.account.getMe.useQuery();
	const isSuperadmin = currentUser?.role === 'superadmin';

	// Query for users list
	const { data, isLoading } = api.admin.listUsers.useQuery({
		limit: pageSize,
		offset: (currentPage - 1) * pageSize,
		searchField: 'email',
		searchOperator: 'contains',
		searchValue: searchQuery || undefined
	});

	const users = data?.users ?? [];
	const total = data?.total ?? 0;
	const totalPages = Math.ceil(total / pageSize);

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

	const handleSearch = () => {
		setCurrentPage(1);
	};

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
	return (
		<div className='space-y-4'>
			<div className='flex items-center gap-2'>
				<div className='relative flex-1'>
					<Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
					<Input
						className='pl-9'
						data-testid='admin-user-search'
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleSearch();
						}}
						placeholder='Search users by email...'
						value={searchQuery}
					/>
				</div>
				<Button data-testid='admin-search-button' onClick={handleSearch}>
					Search
				</Button>
			</div>

			<div className='rounded-md border'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Email</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Role</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Verified</TableHead>
							<TableHead>Joined</TableHead>
							<TableHead className='text-right'>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell className='text-center' colSpan={7}>
									Loading...
								</TableCell>
							</TableRow>
						) : users.length === 0 ? (
							<TableRow>
								<TableCell className='text-center' colSpan={7}>
									No users found
								</TableCell>
							</TableRow>
						) : (
							users.map((user) => (
								<TableRow key={user.id}>
									<TableCell className='font-medium'>{user.email}</TableCell>
									<TableCell>{user.name || '-'}</TableCell>
									<TableCell>
										<Badge
											variant={
												user.role === 'superadmin' || user.role === 'admin'
													? 'default'
													: 'outline'
											}
										>
											{user.role === 'superadmin' && <Crown className='mr-1 size-3' />}
											{user.role}
										</Badge>
									</TableCell>
									<TableCell>
										{user.banned ? (
											<Badge variant='destructive'>Banned</Badge>
										) : (
											<Badge variant='outline'>Active</Badge>
										)}
									</TableCell>
									<TableCell>
										{user.emailVerified ? (
											<Badge variant='outline'>✓</Badge>
										) : (
											<Badge variant='secondary'>Pending</Badge>
										)}
									</TableCell>
									<TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
									<TableCell className='text-right'>
										{/* Admins cannot perform any actions on superadmin accounts */}
										{user.role === 'superadmin' && !isSuperadmin ? (
											<Button disabled size='icon' variant='ghost'>
												<MoreHorizontal className='size-4' />
												<span className='sr-only'>No actions available</span>
											</Button>
										) : (
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
													{isSuperadmin &&
														user.role !== 'superadmin' &&
														user.id !== currentUser?.id && (
															<>
																<DropdownMenuSeparator />
																<DropdownMenuItem
																	onClick={() => handleSetRole(user.id, 'superadmin')}
																>
																	<Crown className='mr-2 size-4' />
																	Make Superadmin
																</DropdownMenuItem>
															</>
														)}

													{/* Only superadmins can change admin roles */}
													{isSuperadmin &&
														user.role !== 'admin' &&
														user.id !== currentUser?.id && (
															<DropdownMenuItem
																onClick={() => handleSetRole(user.id, 'admin')}
															>
																<Shield className='mr-2 size-4' />
																Make Admin
															</DropdownMenuItem>
														)}

													{/* Demote to user - cannot demote yourself */}
													{user.role !== 'user' && user.id !== currentUser?.id && (
														<DropdownMenuItem
															onClick={() => handleSetRole(user.id, 'user')}
														>
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
																<DropdownMenuItem
																	onClick={() => handleBanUser(user.id)}
																>
																	<Ban className='mr-2 size-4' />
																	Ban User
																</DropdownMenuItem>
															</>
														))}

													{/* Impersonate user - cannot impersonate yourself or superadmins */}
													{user.id !== currentUser?.id && user.role !== 'superadmin' && (
														<>
															<DropdownMenuSeparator />
															<DropdownMenuItem
																onClick={() => handleImpersonateUser(user.id)}
															>
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
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className='flex items-center justify-between'>
					<p className='text-sm text-muted-foreground'>
						Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, total)} of{' '}
						{total} users
					</p>
					<div className='flex gap-2'>
						<Button
							disabled={currentPage === 1}
							onClick={() => setCurrentPage(currentPage - 1)}
							size='sm'
							variant='outline'
						>
							Previous
						</Button>
						<Button
							disabled={currentPage === totalPages}
							onClick={() => setCurrentPage(currentPage + 1)}
							size='sm'
							variant='outline'
						>
							Next
						</Button>
					</div>
				</div>
			)}

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
