'use client';

import { AudioWaveform, BookOpen, Command, PieChart, Shield } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { api } from '@/trpc/react';
import { ApplicationNameLogo } from './application-name-logo';
import { NavMain } from './nav-main';
import { NavUser } from './nav-user';

// This is sample data.
const baseNavItems = [
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
];

export function AppSidebar({
	applicationName,
	...props
}: Omit<React.ComponentProps<typeof Sidebar>, 'children'> & { applicationName: string }) {
	const { data: user } = api.account.getMe.useQuery(undefined, {
		gcTime: 10 * 60 * 1000, // 10 minutes
		staleTime: 5 * 60 * 1000 // 5 minutes
	});

	const navItems =
		user?.role === 'admin' || user?.role === 'superadmin'
			? [
					...baseNavItems,
					{
						icon: Shield,
						items: [{ title: 'Dashboard', url: '/admin' }],
						title: 'Admin'
					}
				]
			: baseNavItems;

	return (
		<Sidebar collapsible='icon' {...props}>
			<SidebarHeader>
				<ApplicationNameLogo applicationName={applicationName} />
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={navItems} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
