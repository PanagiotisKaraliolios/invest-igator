'use client';

import {
	AudioWaveform,
	BookOpen,
	Command,
	Frame,
	GalleryVerticalEnd,
	Map as MapIcon,
	PieChart,
	Settings2
} from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { NavMain } from './nav-main';
import { NavProjects } from './nav-projects';
import { NavUser } from './nav-user';
import { ApplicationNameLogo } from './team-switcher';

// This is sample data.
const data = {
	navMain: [
		{
			icon: PieChart,
			isActive: true,
			items: [
				{ title: 'Portfolio', url: '/portfolio' },
				{ title: 'Transactions', url: '/transactions' },
				{ title: 'Watchlist', url: '/watchlist' }
			],
			title: 'Dashboard'
		},
		{
			icon: AudioWaveform,
			items: [
				{ title: 'Performance', url: '/analytics/performance' },
				{ title: 'Allocation', url: '/analytics/allocation' },
				{ title: 'Risk', url: '/analytics/risk' },
				{ title: 'Reports', url: '/analytics/reports' }
			],
			title: 'Analytics'
		},
		{
			icon: BookOpen,
			items: [
				{ title: 'Markets', url: '/research/markets' },
				{ title: 'ETFs', url: '/research/etfs' },
				{ title: 'Stocks', url: '/research/stocks' },
				{ title: 'News', url: '/research/news' }
			],
			title: 'Research'
		},
		{
			icon: Command,
			items: [
				{ title: 'Goals', url: '/tools/goals' },
				{ title: 'Simulations', url: '/tools/simulations' },
				{ title: 'Taxes', url: '/tools/taxes' },
				{ title: 'Notes', url: '/tools/notes' }
			],
			title: 'Tools'
		}
	]
};

type User = { name: string; email: string; avatar?: string | null };

export function AppSidebar({
	user,
	applicationName,
	...props
}: React.ComponentProps<typeof Sidebar> & { user: User; applicationName: string }) {
	return (
		<Sidebar collapsible='icon' {...props}>
			<SidebarHeader>
				<ApplicationNameLogo applicationName={applicationName} />
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={data.navMain} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
