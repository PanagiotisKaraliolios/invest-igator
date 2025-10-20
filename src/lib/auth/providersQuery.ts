// Better Auth providers are configured in src/lib/auth.ts
// This returns the list of social providers configured in the app
export const availableAuthProvidersQueryKey = ['authProviders'] as const;

export async function fetchAvailableAuthProviders() {
	// With Better Auth, we know our configured providers from the server config
	// Discord is currently the only configured social provider
	return ['discord'] as string[];
}

export function availableAuthProvidersQueryOptions() {
	return {
		queryFn: fetchAvailableAuthProviders,
		queryKey: availableAuthProvidersQueryKey,
		// This is static, so we can cache it indefinitely
		staleTime: Number.POSITIVE_INFINITY,
	} as const;
}
