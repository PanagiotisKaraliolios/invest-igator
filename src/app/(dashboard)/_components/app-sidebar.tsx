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
			comingSoon: true,
			icon: AudioWaveform,
			isActive: isNavItemActive([{ url: '/analytics/risk' }, { url: '/analytics/reports' }]),
			items: [
				{ comingSoon: true, title: 'Risk', url: '/analytics/risk' },
				{ comingSoon: true, title: 'Reports', url: '/analytics/reports' }
			],
			title: 'Analytics'
		},
		{
			comingSoon: true,
			icon: BookOpen,
			isActive: isNavItemActive([
				{ url: '/research/markets' },
				{ url: '/research/etfs' },
				{ url: '/research/stocks' },
				{ url: '/research/news' }
			]),
			items: [
				{ comingSoon: true, title: 'Markets', url: '/research/markets' },
				{ comingSoon: true, title: 'ETFs', url: '/research/etfs' },
				{ comingSoon: true, title: 'Stocks', url: '/research/stocks' },
				{ comingSoon: true, title: 'News', url: '/research/news' }
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
				{ comingSoon: true, title: 'Simulations', url: '/tools/simulations' },
				{ comingSoon: true, title: 'Taxes', url: '/tools/taxes' },
				{ comingSoon: true, title: 'Notes', url: '/tools/notes' }
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
						{ url: '/admin/financial-data' },
						{ url: '/admin/ai' }
					]),
					items: [
						{ title: 'Analytics', url: '/admin/analytics' },
						{ title: 'Users', url: '/admin/users' },
						{ title: 'Audit Logs', url: '/admin/audit-logs' },
						{ title: 'Financial Data', url: '/admin/financial-data' },
						{ title: 'AI', url: '/admin/ai' }
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
