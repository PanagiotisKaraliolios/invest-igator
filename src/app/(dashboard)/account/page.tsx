import DangerZoneCard from '@/app/(dashboard)/account/_components/danger-zone-card';
import PasswordCard from '@/app/(dashboard)/account/_components/password-card';
import ProfileCard from '@/app/(dashboard)/account/_components/profile-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { auth } from '@/server/auth';
import { api, HydrateClient } from '@/trpc/server';

export default async function AccountPage() {
	const session = await auth();

	// Seed client cache for smoother hydration (pattern-aligned)
	if (session?.user) {
		await api.account.getProfile.prefetch();
	}

	const profile = await api.account.getProfile();

	return (
		<HydrateClient>
			<Tabs className='w-full' defaultValue='profile'>
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
						<PasswordCard />
					</TabsContent>
					<TabsContent className='col-span-1 md:col-span-2' value='danger'>
						<DangerZoneCard />
					</TabsContent>
				</div>
			</Tabs>
		</HydrateClient>
	);
}
