'use client';

import { AlertCircle, BadgeCheck, Bell, ChevronsUpDown, CreditCard, LogOut, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/trpc/react';

export function NavUser() {
	const { isMobile } = useSidebar();
	const {
		data: user,
		isLoading,
		error
	} = api.account.getMe.useQuery(undefined, {
		gcTime: 10 * 60 * 1000, // 10 minutes
		staleTime: 5 * 60 * 1000 // 5 minutes
	});

	// Loading state
	if (isLoading) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton disabled size='lg'>
						<Skeleton className='h-8 w-8 rounded-lg' />
						<div className='grid flex-1 gap-1 text-left text-sm leading-tight'>
							<Skeleton className='h-4 w-24' />
							<Skeleton className='h-3 w-32' />
						</div>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	// Error state
	if (error || !user) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton className='opacity-50' disabled size='lg'>
						<div className='flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10'>
							<AlertCircle className='h-4 w-4 text-destructive' />
						</div>
						<div className='grid flex-1 text-left text-sm leading-tight'>
							<span className='truncate font-medium text-destructive'>Error loading user</span>
							<span className='truncate text-xs text-muted-foreground'>Please try again</span>
						</div>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
							size='lg'
						>
							<Avatar className='h-8 w-8 rounded-lg'>
								<AvatarImage alt={`Profile picture of ${user.name}`} src={user.avatar ?? undefined} />
								<AvatarFallback className='rounded-lg'>
									{user.name?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase() ?? '?'}
								</AvatarFallback>
							</Avatar>
							<div className='grid flex-1 text-left text-sm leading-tight'>
								<span className='truncate font-medium'>{user.name}</span>
								<span className='truncate text-xs'>{user.email}</span>
							</div>
							<ChevronsUpDown className='ml-auto size-4' />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align='end'
						className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
						side={isMobile ? 'bottom' : 'right'}
						sideOffset={4}
					>
						<DropdownMenuLabel className='p-0 font-normal'>
							<div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
								<Avatar className='h-8 w-8 rounded-lg'>
									<AvatarImage
										alt={`Profile picture of ${user.name}`}
										src={user.avatar ?? undefined}
									/>
									<AvatarFallback className='rounded-lg'>
										{user.name?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase() ?? '?'}
									</AvatarFallback>
								</Avatar>
								<div className='grid flex-1 text-left text-sm leading-tight'>
									<span className='truncate font-medium'>{user.name}</span>
									<span className='truncate text-xs'>{user.email}</span>
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem>
								<Sparkles />
								Upgrade to Pro
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem asChild>
								<Link className='flex items-center gap-2' href='/account' prefetch>
									<BadgeCheck />
									Account
								</Link>
							</DropdownMenuItem>
							<DropdownMenuItem>
								<CreditCard />
								Billing
							</DropdownMenuItem>
							<DropdownMenuItem>
								<Bell />
								Notifications
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem asChild>
							<Link className='flex items-center gap-2' href='/signout'>
								<LogOut />
								Sign out
							</Link>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
