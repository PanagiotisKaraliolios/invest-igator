'use client';

import { getProviders } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import ProviderLoginButton from './providerLoginButton';

export default function ProvidersList() {
	const [providers, setProviders] = useState<
		{
			id: string;
			name: string;
			type: string;
		}[]
	>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		getProviders()
			.then((p) => {
				if (!p) return setProviders([]);
				const list = Object.values(p).map((prov: any) => ({
					id: prov.id,
					name: prov.name,
					type: prov.type
				}));
				setProviders(list);
			})
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div className='grid gap-4'>
				<Skeleton className='h-10 w-full rounded-md' />
				{/* <Skeleton className="h-10 w-full rounded-md" /> */}
			</div>
		);
	}

	if (!providers.length) return null;

	return (
		<div className='grid gap-4'>
			{providers
				.filter((provider) => provider.type !== 'email' && provider.id !== 'credentials')
				.map((provider) => (
					<ProviderLoginButton key={provider.id} provider={provider.id} />
				))}
		</div>
	);
}
