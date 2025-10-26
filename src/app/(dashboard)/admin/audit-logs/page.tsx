import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { AuditLogsTable } from '../_components/audit-logs-table';

export default async function AuditLogsPage() {
	const session = await auth.api.getSession({ headers: await headers() });

	// Check if user is admin or superadmin
	if (!session?.user || (session.user.role !== 'admin' && session.user.role !== 'superadmin')) {
		redirect('/');
	}

	return (
		<div className='space-y-8'>
			<div>
				<h1 className='mb-2 text-3xl font-bold tracking-tight'>Audit Logs</h1>
				<p className='text-muted-foreground'>View all admin actions and activity history</p>
			</div>

			{/* Audit Logs */}
			<Card>
				<CardHeader>
					<CardTitle>Admin Activity</CardTitle>
					<CardDescription>Complete history of administrative actions</CardDescription>
				</CardHeader>
				<CardContent>
					<AuditLogsTable />
				</CardContent>
			</Card>
		</div>
	);
}
