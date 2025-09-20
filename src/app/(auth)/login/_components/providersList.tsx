'use client';

import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { availableAuthProvidersQueryOptions } from '@/lib/auth/providersQuery';
import ProviderLoginButton from './providerLoginButton';

export default function ProvidersList() {
	const { data: providers, isLoading } = useQuery(availableAuthProvidersQueryOptions());

	if (isLoading) {
		return (
			<div className='grid gap-4'>
				<Skeleton className='h-10 w-full rounded-md' />
			</div>
		);
	}

	if (!providers?.length) return null;

	return (
		<div className='grid gap-4'>
			{providers.map((providerId) => (
				<ProviderLoginButton key={providerId} provider={providerId} />
			))}
		</div>
	);
}
