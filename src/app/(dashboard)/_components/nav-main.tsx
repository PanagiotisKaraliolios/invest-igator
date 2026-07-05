'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem
} from '@/components/ui/sidebar';

export function NavMain({
	items
}: {
	items: {
		title: string;
		icon?: LucideIcon;
		isActive?: boolean;
		items?: {
			title: string;
			url: string;
		}[];
	}[];
}) {
	const pathname = usePathname();
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Platform</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<Collapsible
						className='group/collapsible'
						defaultOpen={item.isActive}
						key={item.title}
						render={<SidebarMenuItem />}
					>
						<CollapsibleTrigger render={<SidebarMenuButton tooltip={item.title} />}>
							{item.icon && <item.icon />}
							<span>{item.title}</span>
							<ChevronRight className='ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90' />
						</CollapsibleTrigger>
						<CollapsibleContent>
							<SidebarMenuSub>
								{item.items?.map((subItem) => {
									const isSubItemActive = pathname.startsWith(subItem.url);
									return (
										<SidebarMenuSubItem key={subItem.title}>
											<SidebarMenuSubButton
												isActive={isSubItemActive}
												render={<a href={subItem.url} />}
											>
												<span>{subItem.title}</span>
											</SidebarMenuSubButton>
										</SidebarMenuSubItem>
									);
								})}
							</SidebarMenuSub>
						</CollapsibleContent>
					</Collapsible>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
