import { headers } from 'next/headers';
import ConnectedAccountsCard from '@/app/(dashboard)/account/_components/connected-accounts-card';
import DangerZoneCard from '@/app/(dashboard)/account/_components/danger-zone-card';
import PasswordCard from '@/app/(dashboard)/account/_components/password-card';
import ProfileCard from '@/app/(dashboard)/account/_components/profile-card';
import TwoFactorCard from '@/app/(dashboard)/account/_components/two-factor-card';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { auth } from '@/lib/auth';
import { api, HydrateClient } from '@/trpc/server';
import AccountTabsClient from './_components/account-tabs-client';

export default async function AccountPage() {
	const session = await auth.api.getSession({ headers: await headers() });

	console.log('🚀 ~ page.tsx:15 ~ AccountPage ~ session:', session);

	// Seed client cache for smoother hydration (pattern-aligned)
	if (session?.user) {
		await api.account.getProfile.prefetch();
		await api.account.getTwoFactorState.prefetch();
	}

	const profile = await api.account.getProfile();

	return (
		<HydrateClient>
			<AccountTabsClient defaultValue='profile' valid={['profile', 'security', 'danger']}>
				<TabsList>
					<TabsTrigger value='profile'>Profile</TabsTrigger>
					<TabsTrigger value='security'>Security</TabsTrigger>
					<TabsTrigger value='danger'>Danger</TabsTrigger>
				</TabsList>
				<div className='mt-4 grid grid-cols-1 gap-4 md:grid-cols-2'>
					<TabsContent className='col-span-1 md:col-span-2' value='profile'>
						<ProfileCard initial={profile} />
					</TabsContent>
					<TabsContent className='col-span-1 md:col-span-2' value='security'>
						<div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
							<div className='md:col-span-2'>
								<TwoFactorCard />
							</div>
							<PasswordCard />
							<ConnectedAccountsCard />
						</div>
					</TabsContent>
					<TabsContent className='col-span-1 md:col-span-2' value='danger'>
						<DangerZoneCard />
					</TabsContent>
				</div>
			</AccountTabsClient>
		</HydrateClient>
	);
}
