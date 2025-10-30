'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Crown, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { User } from './user-management-types';

export function createUserColumns(): ColumnDef<User>[] {
	return [
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
				const banReason = row.original.banReason;

				if (banned && banReason) {
					return (
						<div className='flex items-center gap-1'>
							<Badge variant='destructive'>Banned</Badge>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											className='size-5 p-0'
											data-testid='ban-reason-tooltip-trigger'
											size='icon'
											variant='ghost'
										>
											<Info className='size-3.5 text-muted-foreground' />
											<span className='sr-only'>View ban reason</span>
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p className='max-w-xs'>{banReason}</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
					);
				}

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
		}
	];
}
