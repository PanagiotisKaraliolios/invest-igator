'use client';

import { formatDistanceToNow } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/trpc/react';

const ACTIONS_CONFIG = {
	BAN_USER: { label: 'Ban User', variant: 'destructive' as const },
	DELETE_USER: { label: 'Delete User', variant: 'destructive' as const },
	IMPERSONATE_USER: { label: 'Impersonate', variant: 'outline' as const },
	SET_ROLE: { label: 'Set Role', variant: 'secondary' as const },
	STOP_IMPERSONATION: { label: 'Stop Impersonation', variant: 'outline' as const },
	UNBAN_USER: { label: 'Unban User', variant: 'default' as const },
	VIEW_STATS: { label: 'View Stats', variant: 'secondary' as const },
	VIEW_USERS: { label: 'View Users', variant: 'secondary' as const }
};

const PAGE_SIZE = 25;

export function AuditLogsTable() {
	const [page, setPage] = useState(0);
	const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);

	const { data, isLoading } = api.admin.getAuditLogs.useQuery({
		action: actionFilter,
		limit: PAGE_SIZE,
		offset: page * PAGE_SIZE
	});

	const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

	if (isLoading) {
		return (
			<div className='flex items-center justify-center py-8'>
				<p className='text-muted-foreground'>Loading audit logs...</p>
			</div>
		);
	}

	if (!data?.logs.length) {
		return (
			<div className='flex items-center justify-center py-8'>
				<p className='text-muted-foreground'>No audit logs found.</p>
			</div>
		);
	}

	return (
		<div className='space-y-4'>
			<div className='flex items-center gap-4'>
				<Select
					onValueChange={(val) => setActionFilter(val === 'all' ? undefined : val)}
					value={actionFilter || 'all'}
				>
					<SelectTrigger className='w-[200px]'>
						<SelectValue placeholder='All actions' />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='all'>All actions</SelectItem>
						{Object.entries(ACTIONS_CONFIG).map(([action, config]) => (
							<SelectItem key={action} value={action}>
								{config.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className='rounded-md border'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Action</TableHead>
							<TableHead>Admin</TableHead>
							<TableHead>Target User</TableHead>
							<TableHead>Details</TableHead>
							<TableHead>Time</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.logs.map((log) => {
							const actionConfig = ACTIONS_CONFIG[log.action as keyof typeof ACTIONS_CONFIG] || {
								label: log.action,
								variant: 'secondary' as const
							};

							return (
								<TableRow key={log.id}>
									<TableCell>
										<Badge variant={actionConfig.variant}>{actionConfig.label}</Badge>
									</TableCell>
									<TableCell className='font-medium'>{log.adminEmail}</TableCell>
									<TableCell>
										{log.targetEmail ? (
											<span className='text-sm'>{log.targetEmail}</span>
										) : (
											<span className='text-sm text-muted-foreground'>—</span>
										)}
									</TableCell>
									<TableCell>
										{log.details ? (
											<code className='rounded bg-muted px-1 py-0.5 text-xs'>
												{JSON.stringify(log.details)}
											</code>
										) : (
											<span className='text-sm text-muted-foreground'>—</span>
										)}
									</TableCell>
									<TableCell className='text-sm text-muted-foreground'>
										{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className='flex items-center justify-between'>
					<p className='text-sm text-muted-foreground'>
						Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total}{' '}
						logs
					</p>
					<div className='flex items-center gap-2'>
						<Button
							disabled={page === 0}
							onClick={() => setPage((p) => Math.max(0, p - 1))}
							size='sm'
							variant='outline'
						>
							<ChevronLeft className='size-4' />
							Previous
						</Button>
						<span className='text-sm'>
							Page {page + 1} of {totalPages}
						</span>
						<Button
							disabled={page >= totalPages - 1}
							onClick={() => setPage((p) => p + 1)}
							size='sm'
							variant='outline'
						>
							Next
							<ChevronRight className='size-4' />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
