import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AnalyticsDashboard } from '@/app/(dashboard)/admin/_components/analytics-dashboard';
import { auth } from '@/lib/auth';

export default async function AdminAnalyticsPage() {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		redirect('/login');
	}

	const userRole = session.user.role;
	if (userRole !== 'admin' && userRole !== 'superadmin') {
		redirect('/');
	}

	return (
		<div className='flex flex-1 flex-col gap-4 p-4 pt-0'>
			<div className='flex flex-col gap-2'>
				<h1 className='text-3xl font-bold tracking-tight'>Analytics & Insights</h1>
				<p className='text-muted-foreground'>
					Platform usage statistics, user growth trends, and engagement metrics.
				</p>
			</div>
			<AnalyticsDashboard />
		</div>
	);
}
