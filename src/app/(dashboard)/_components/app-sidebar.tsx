'use client';

import { AudioWaveform, BookOpen, Command, PieChart } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { api } from '@/trpc/react';
import { ApplicationNameLogo } from './application-name-logo';
import { NavMain } from './nav-main';
import { NavUser } from './nav-user';

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

export function AppSidebar({
	applicationName,
	...props
}: Omit<React.ComponentProps<typeof Sidebar>, 'children'> & { applicationName: string }) {
	const { data: user } = api.account.getMe.useQuery();

	if (!user) {
		return null;
	}

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
