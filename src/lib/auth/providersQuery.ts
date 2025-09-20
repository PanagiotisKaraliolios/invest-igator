import { getProviders } from 'next-auth/react';

export const availableAuthProvidersQueryKey = ['authProviders'] as const;

export async function fetchAvailableAuthProviders() {
	const providers = await getProviders();
	if (!providers) return [] as string[];
	return Object.values(providers)
		.filter((prov) => prov.type !== 'email' && prov.id !== 'credentials')
		.map((prov) => prov.id);
}

export function availableAuthProvidersQueryOptions() {
	return {
		queryFn: fetchAvailableAuthProviders,
		queryKey: availableAuthProvidersQueryKey
	} as const;
}
