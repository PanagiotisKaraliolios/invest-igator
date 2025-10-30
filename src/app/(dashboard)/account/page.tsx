import { headers } from 'next/headers';
import { ApiKeysCard } from '@/app/(dashboard)/account/_components/api-keys-card';
import ConnectedAccountsCard from '@/app/(dashboard)/account/_components/connected-accounts-card';
import DangerZoneCard from '@/app/(dashboard)/account/_components/danger-zone-card';
import PasswordCard from '@/app/(dashboard)/account/_components/password-card';
import ProfileCard from '@/app/(dashboard)/account/_components/profile-card';
import TwoFactorCard from '@/app/(dashboard)/account/_components/two-factor-card';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { auth } from '@/lib/auth';
import AccountTabsClient from './_components/account-tabs-client';

export default async function AccountPage() {
	const session = await auth.api.getSession({ headers: await headers() });

	return (
		<AccountTabsClient defaultValue='profile' valid={['profile', 'security', 'api-keys', 'danger']}>
			<TabsList>
				<TabsTrigger value='profile'>Profile</TabsTrigger>
				<TabsTrigger value='security'>Security</TabsTrigger>
				<TabsTrigger value='api-keys'>API Keys</TabsTrigger>
				<TabsTrigger value='danger'>Danger</TabsTrigger>
			</TabsList>
			<div className='mt-4 grid grid-cols-1 gap-4 md:grid-cols-2'>
				<TabsContent className='col-span-1 md:col-span-2' value='profile'>
					<ProfileCard />
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
				<TabsContent className='col-span-1 md:col-span-2' value='api-keys'>
					<ApiKeysCard />
				</TabsContent>
				<TabsContent className='col-span-1 md:col-span-2' value='danger'>
					<DangerZoneCard />
				</TabsContent>
			</div>
		</AccountTabsClient>
	);
}
