'use client';

import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/trpc/react';

export default function RecentLogsCard() {
	const sessions = api.account.getRecentSessions.useQuery(undefined, {
		refetchOnMount: true,
		refetchOnWindowFocus: false,
		retry: 1
	});

	const formatDate = (date: Date) => {
		return new Intl.DateTimeFormat('en-US', {
			day: 'numeric',
			hour: 'numeric',
			hour12: true,
			minute: '2-digit',
			month: 'short',
			year: 'numeric'
		}).format(new Date(date));
	};

	let body;
	if (sessions.isLoading) {
		body = (
			<div className='space-y-4'>
				{[...Array(3)].map((_, i) => (
					<div className='space-y-2 border-b pb-4 last:border-b-0 last:pb-0' key={i}>
						<Skeleton className='h-4 w-1/4' />
						<Skeleton className='h-4 w-1/3' />
						<Skeleton className='h-4 w-1/2' />
						<Skeleton className='h-3 w-1/4' />
					</div>
				))}
			</div>
		);
	} else if (sessions.isError || !sessions.data) {
		body = (
			<Alert variant='destructive'>
				<AlertCircle className='h-4 w-4' />
				<AlertTitle>Error loading recent logins</AlertTitle>
				<AlertDescription>
					Unable to load your recent login activity. Please refresh the page and try again.
				</AlertDescription>
			</Alert>
		);
	} else if (sessions.data.length === 0) {
		body = (
			<div className='text-center py-8 text-muted-foreground'>
				<p>No recent login activity found.</p>
			</div>
		);
	} else {
		body = (
			<div className='space-y-4'>
				<div className='overflow-x-auto'>
					<table className='w-full'>
						<thead>
							<tr className='border-b'>
								<th className='text-left py-3 px-2 font-medium text-sm text-muted-foreground'>
									User Agent
								</th>
								<th className='text-left py-3 px-2 font-medium text-sm text-muted-foreground'>
									Device
								</th>
								<th className='text-left py-3 px-2 font-medium text-sm text-muted-foreground'>
									Location
								</th>
								<th className='text-left py-3 px-2 font-medium text-sm text-muted-foreground'>Date</th>
							</tr>
						</thead>
						<tbody>
							{sessions.data.map((session) => (
								<tr className='border-b last:border-b-0' key={session.id}>
									<td className='py-3 px-2 text-sm'>{session.userAgent}</td>
									<td className='py-3 px-2 text-sm'>{session.device}</td>
									<td className='py-3 px-2 text-sm'>{session.location}</td>
									<td className='py-3 px-2 text-sm text-muted-foreground'>
										{formatDate(session.date)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className='flex justify-end'>
					<Button onClick={() => sessions.refetch()} size='sm' variant='outline'>
						Refresh
					</Button>
				</div>
			</div>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent Logins</CardTitle>
				<CardDescription>
					View recent activity on your account. Check for any unusual or suspicious actions.
				</CardDescription>
			</CardHeader>
			<CardContent>{body}</CardContent>
		</Card>
	);
}
