'use client';

import { Ban, Crown, MoreHorizontal, Shield, Trash2, UserCog, UserRoundCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { User } from './user-management-types';

interface UserActionsDropdownProps {
	currentUserId?: string;
	isSuperadmin: boolean;
	onBanUser: (userId: string, email: string) => void;
	onDeleteUser: (userId: string) => void;
	onImpersonateUser: (userId: string, userName?: string, userEmail?: string) => void;
	onSetRole: (userId: string, role: 'superadmin' | 'admin' | 'user') => void;
	onUnbanUser: (userId: string) => void;
	user: User;
}

export function UserActionsDropdown({
	currentUserId,
	isSuperadmin,
	onBanUser,
	onDeleteUser,
	onImpersonateUser,
	onSetRole,
	onUnbanUser,
	user
}: UserActionsDropdownProps) {
	// Admins cannot perform any actions on superadmin accounts
	// Users cannot perform any actions on themselves
	if ((user.role === 'superadmin' && !isSuperadmin) || user.id === currentUserId) {
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
				{isSuperadmin && user.role !== 'superadmin' && user.id !== currentUserId && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => onSetRole(user.id, 'superadmin')}>
							<Crown className='mr-2 size-4' />
							Make Superadmin
						</DropdownMenuItem>
					</>
				)}

				{/* Only superadmins can change admin roles */}
				{isSuperadmin && user.role !== 'admin' && user.id !== currentUserId && (
					<DropdownMenuItem onClick={() => onSetRole(user.id, 'admin')}>
						<Shield className='mr-2 size-4' />
						Make Admin
					</DropdownMenuItem>
				)}

				{/* Demote to user - cannot demote yourself */}
				{user.role !== 'user' && user.id !== currentUserId && (
					<DropdownMenuItem onClick={() => onSetRole(user.id, 'user')}>
						<UserCog className='mr-2 size-4' />
						Make User
					</DropdownMenuItem>
				)}

				{/* Ban/Unban - cannot ban yourself */}
				{user.id !== currentUserId &&
					(user.banned ? (
						<DropdownMenuItem onClick={() => onUnbanUser(user.id)}>
							<UserCog className='mr-2 size-4' />
							Unban User
						</DropdownMenuItem>
					) : (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => onBanUser(user.id, user.email)}>
								<Ban className='mr-2 size-4' />
								Ban User
							</DropdownMenuItem>
						</>
					))}

				{/* Impersonate user - cannot impersonate yourself or superadmins */}
				{user.id !== currentUserId && user.role !== 'superadmin' && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => onImpersonateUser(user.id, user.name ?? undefined, user.email ?? undefined)}
						>
							<UserRoundCog className='mr-2 size-4' />
							Impersonate User
						</DropdownMenuItem>
					</>
				)}

				{/* Delete user - cannot delete yourself */}
				{user.id !== currentUserId && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem className='text-destructive' onClick={() => onDeleteUser(user.id)}>
							<Trash2 className='mr-2 size-4' />
							Delete User
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
