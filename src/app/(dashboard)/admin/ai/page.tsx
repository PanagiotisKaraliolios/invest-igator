import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AiObservabilityDashboard } from '@/app/(dashboard)/admin/_components/ai-observability-dashboard';
import { auth } from '@/lib/auth';

export default async function AdminAiPage() {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		redirect('/login');
	}

	// This is a UI redirect only, and it reads a possibly-stale cookieCache role on purpose:
	// it is a convenience, not a gate. The authorization that matters is `adminProcedure`,
	// which re-reads the role from Postgres on every query.
	const userRole = session.user.role;
	if (userRole !== 'admin' && userRole !== 'superadmin') {
		redirect('/');
	}

	return (
		<div className='flex flex-1 flex-col gap-4 p-4 pt-0'>
			<div className='flex flex-col gap-2'>
				<h1 className='text-3xl font-bold tracking-tight'>AI Observability</h1>
				<p className='text-muted-foreground'>
					Spend, latency, failures, and tool usage across every AI surface. One row per provider call.
				</p>
			</div>
			<AiObservabilityDashboard />
		</div>
	);
}
