'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
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
		comingSoon?: boolean;
		items?: {
			title: string;
			url: string;
			comingSoon?: boolean;
		}[];
	}[];
}) {
	const pathname = usePathname();
	// Freeze which sections start open at mount. item.isActive is derived from the pathname
	// and changes on navigation; feeding that into an uncontrolled Collapsible's defaultOpen
	// makes Base UI warn about the default open state changing after init.
	const [initiallyOpen] = useState(() => new Set(items.filter((i) => i.isActive).map((i) => i.title)));
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Platform</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<Collapsible
						className='group/collapsible'
						defaultOpen={initiallyOpen.has(item.title)}
						key={item.title}
						render={<SidebarMenuItem />}
					>
						<CollapsibleTrigger render={<SidebarMenuButton tooltip={item.title} />}>
							{item.icon && <item.icon />}
							<span>{item.title}</span>
							{item.comingSoon && (
								<Badge className='h-4 px-1.5 text-[10px] leading-none' variant='secondary'>
									Soon
								</Badge>
							)}
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
												render={<Link href={subItem.url} />}
											>
												<span>{subItem.title}</span>
												{subItem.comingSoon && (
													<Badge
														className='ml-auto h-4 px-1.5 text-[10px] leading-none'
														variant='secondary'
													>
														Soon
													</Badge>
												)}
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
