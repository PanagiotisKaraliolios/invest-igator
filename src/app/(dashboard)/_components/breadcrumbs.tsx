'use client';

import { usePathname } from 'next/navigation';
import { Fragment, useMemo } from 'react';
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator
} from '@/components/ui/breadcrumb';

function toTitleCase(input: string) {
	return input
		.split('-')
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join(' ');
}

const LABELS: Record<string, string> = {
	account: 'Account',
	allocation: 'Allocation',
	analytics: 'Analytics',
	etfs: 'ETFs',
	goals: 'Goals',
	markets: 'Markets',
	news: 'News',
	notes: 'Notes',
	performance: 'Performance',
	portfolio: 'Portfolio',
	profile: 'Profile',
	reports: 'Reports',
	research: 'Research',
	risk: 'Risk',
	settings: 'Settings',
	simulations: 'Simulations',
	stocks: 'Stocks',
	support: 'Support',
	taxes: 'Taxes',
	tools: 'Tools',
	transactions: 'Transactions',
	watchlist: 'Watchlist'
};

export default function DashboardBreadcrumbs() {
	const pathname = usePathname();

	const crumbs = useMemo(() => {
		const segs = pathname.split('/').filter(Boolean);

		// Build breadcrumbs from actual path segments.
		const items: { label: string; href?: string }[] = [];

		segs.forEach((seg, idx) => {
			const href = `/${segs.slice(0, idx + 1).join('/')}`;
			const label = LABELS[seg] ?? toTitleCase(seg);
			items.push({ href, label });
		});

		return items;
	}, [pathname]);

	return (
		<Breadcrumb>
			<BreadcrumbList>
				{crumbs.map((c, i) => {
					const isLast = i === crumbs.length - 1;
					return (
						<Fragment key={`crumb-${i}`}>
							<BreadcrumbItem className={i === 0 ? 'hidden md:block' : undefined}>
								{isLast ? (
									<BreadcrumbPage>{c.label}</BreadcrumbPage>
								) : (
									<BreadcrumbLink href={c.href}>{c.label}</BreadcrumbLink>
								)}
							</BreadcrumbItem>
							{!isLast && <BreadcrumbSeparator className={i === 0 ? 'hidden md:block' : undefined} />}
						</Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
