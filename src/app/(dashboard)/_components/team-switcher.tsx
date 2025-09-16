'use client';
import { FaMoneyBillWave } from 'react-icons/fa';

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export function ApplicationNameLogo({ applicationName }: { applicationName: string }) {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarMenuButton
					className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
					size='lg'
				>
					<div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
						<FaMoneyBillWave className='size-4' />
					</div>
					<div className='grid flex-1 text-left text-sm leading-tight'>
						<span className='truncate font-medium'>{applicationName}</span>
					</div>
				</SidebarMenuButton>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
