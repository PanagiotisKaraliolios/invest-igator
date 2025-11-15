'use client';

import { AudioWaveform, BookOpen, Command, PieChart, Shield } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { ApplicationNameLogo } from './application-name-logo';
import { NavMain } from './nav-main';
import { NavUser } from './nav-user';

export function AppSidebar({
	applicationName,
	isAdmin = false,
	...props
}: Omit<React.ComponentProps<typeof Sidebar>, 'children'> & { applicationName: string; isAdmin?: boolean }) {
	const pathname = usePathname();

	// Helper function to check if a nav item is active based on current pathname
	const isNavItemActive = (items: Array<{ url: string }>) => {
		return items.some((item) => pathname.startsWith(item.url));
	};

	const baseNavItems = [
		{
			icon: PieChart,
			isActive: isNavItemActive([{ url: '/portfolio' }, { url: '/transactions' }, { url: '/watchlist' }]),
			items: [
				{ title: 'Portfolio', url: '/portfolio' },
				{ title: 'Transactions', url: '/transactions' },
				{ title: 'Watchlist', url: '/watchlist' }
			],
			title: 'Dashboard'
		},
		{
			icon: AudioWaveform,
			isActive: isNavItemActive([{ url: '/analytics/risk' }, { url: '/analytics/reports' }]),
			items: [
				{ title: 'Risk', url: '/analytics/risk' },
				{ title: 'Reports', url: '/analytics/reports' }
			],
			title: 'Analytics'
		},
		{
			icon: BookOpen,
			isActive: isNavItemActive([
				{ url: '/research/markets' },
				{ url: '/research/etfs' },
				{ url: '/research/stocks' },
				{ url: '/research/news' }
			]),
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
			isActive: isNavItemActive([
				{ url: '/tools/goals' },
				{ url: '/tools/simulations' },
				{ url: '/tools/taxes' },
				{ url: '/tools/notes' }
			]),
			items: [
				{ title: 'Goals', url: '/tools/goals' },
				{ title: 'Simulations', url: '/tools/simulations' },
				{ title: 'Taxes', url: '/tools/taxes' },
				{ title: 'Notes', url: '/tools/notes' }
			],
			title: 'Tools'
		}
	];

	const navItems = isAdmin
		? [
				...baseNavItems,
				{
					icon: Shield,
					isActive: isNavItemActive([
						{ url: '/admin/analytics' },
						{ url: '/admin/users' },
						{ url: '/admin/audit-logs' },
						{ url: '/admin/financial-data' }
					]),
					items: [
						{ title: 'Analytics', url: '/admin/analytics' },
						{ title: 'Users', url: '/admin/users' },
						{ title: 'Audit Logs', url: '/admin/audit-logs' },
						{ title: 'Financial Data', url: '/admin/financial-data' }
					],
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
