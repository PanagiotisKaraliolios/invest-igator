import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/app/(dashboard)/_components/app-sidebar';
import DashboardBreadcrumbs from '@/app/(dashboard)/_components/breadcrumbs';
import CurrencySwitch from '@/app/(dashboard)/_components/currency-switch';
import ThemeSwitch from '@/app/(dashboard)/_components/theme-switch';
import { ImpersonationBanner } from '@/components/admin/impersonation-banner';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { env } from '@/env';
import { auth } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) redirect('/login');

	// Check if current session is impersonated
	const isImpersonated = session.session.impersonatedBy !== null && session.session.impersonatedBy !== undefined;

	// Check if user is admin or superadmin
	const isAdmin = session.user.role === 'admin' || session.user.role === 'superadmin';

	return (
		<SidebarProvider>
			<AppSidebar applicationName={env.APP_NAME} isAdmin={isAdmin} />
			<SidebarInset>
				<header className='flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12'>
					<div className='flex items-center gap-2 px-4'>
						<SidebarTrigger className='-ml-1' />
						<Separator className='mr-2 data-[orientation=vertical]:h-4' orientation='vertical' />
						<DashboardBreadcrumbs />
					</div>
					<div className='mr-4 ml-auto flex items-center gap-3'>
						<CurrencySwitch isAuthenticated={Boolean(session?.user)} />
						<ThemeSwitch />
					</div>
				</header>
				<div className='flex flex-1 flex-col gap-4 p-4 pt-0'>
					{isImpersonated && session.session.impersonatedBy && (
						<ImpersonationBanner
							currentUserEmail={session.user.email}
							impersonatedBy={session.session.impersonatedBy}
						/>
					)}
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
