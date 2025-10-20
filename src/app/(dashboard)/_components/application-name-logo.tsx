'use client';

import { ChartLine } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export function ApplicationNameLogo({ applicationName }: { applicationName: string }) {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarMenuButton
					className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
					size='lg'
				>
					<span className='grid size-8 place-items-center rounded-md bg-primary/10 text-primary'>
						<ChartLine className='size-5' />
					</span>
					<div className='grid flex-1 text-left text-sm leading-tight'>
						<span className='truncate font-medium'>{applicationName}</span>
					</div>
				</SidebarMenuButton>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
