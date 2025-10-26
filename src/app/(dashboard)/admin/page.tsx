import { Activity, UserCheck, Users, UserX } from 'lucide-react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { api } from '@/trpc/server';
import { AuditLogsTable } from './_components/audit-logs-table';
import { UserManagementTable } from './_components/user-management-table';

export default async function AdminDashboardPage() {
	const session = await auth.api.getSession({ headers: await headers() });

	// Check if user is admin or superadmin
	if (!session?.user || (session.user.role !== 'admin' && session.user.role !== 'superadmin')) {
		redirect('/');
	}

	const stats = await api.admin.getStats();

	return (
		<div className='space-y-8'>
			<div>
				<h1 className='mb-2 text-3xl font-bold tracking-tight'>Admin Dashboard</h1>
				<p className='text-muted-foreground'>Manage users and view application statistics</p>
			</div>

			{/* Stats Grid */}
			<div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
				<Card>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<CardTitle className='text-sm font-medium'>Total Users</CardTitle>
						<Users className='size-4 text-muted-foreground' />
					</CardHeader>
					<CardContent>
						<div className='text-2xl font-bold'>{stats.totalUsers}</div>
						<p className='text-xs text-muted-foreground'>Registered accounts</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<CardTitle className='text-sm font-medium'>Active Users</CardTitle>
						<Activity className='size-4 text-muted-foreground' />
					</CardHeader>
					<CardContent>
						<div className='text-2xl font-bold'>{stats.activeUsers}</div>
						<p className='text-xs text-muted-foreground'>With active sessions</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<CardTitle className='text-sm font-medium'>New Signups</CardTitle>
						<UserCheck className='size-4 text-muted-foreground' />
					</CardHeader>
					<CardContent>
						<div className='text-2xl font-bold'>{stats.recentSignups}</div>
						<p className='text-xs text-muted-foreground'>Last 7 days</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
						<CardTitle className='text-sm font-medium'>Banned Users</CardTitle>
						<UserX className='size-4 text-muted-foreground' />
					</CardHeader>
					<CardContent>
						<div className='text-2xl font-bold'>{stats.bannedUsers}</div>
						<p className='text-xs text-muted-foreground'>Currently restricted</p>
					</CardContent>
				</Card>
			</div>

			{/* User Management Table */}
			<Card>
				<CardHeader>
					<CardTitle>User Management</CardTitle>
					<CardDescription>View and manage all users in the application</CardDescription>
				</CardHeader>
				<CardContent>
					<UserManagementTable />
				</CardContent>
			</Card>

			{/* Audit Logs */}
			<Card>
				<CardHeader>
					<CardTitle>Audit Logs</CardTitle>
					<CardDescription>View all admin actions and activity history</CardDescription>
				</CardHeader>
				<CardContent>
					<AuditLogsTable />
				</CardContent>
			</Card>
		</div>
	);
}
