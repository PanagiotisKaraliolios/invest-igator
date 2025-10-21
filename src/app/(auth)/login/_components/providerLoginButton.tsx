'use client';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { providerIcons } from '@/lib/auth/providerMeta';
import { signIn } from '@/lib/auth-client';

// icons come from providerMeta

export default function ProviderLoginButton({ provider }: { provider: string }) {
	const searchParams = useSearchParams();

	const callbackUrl = searchParams.get('callbackUrl') ?? '/portfolio';

	const Icon = providerIcons[provider];

	return (
		<>
			<Button
				className='flex w-full items-center justify-center gap-2'
				onClick={() =>
					signIn.social({
						callbackURL: callbackUrl,
						provider: provider
					})
				}
				variant='outline'
			>
				{Icon ? <Icon className='inline-block' /> : null}
				Login with {provider.charAt(0).toUpperCase() + provider.slice(1)}
			</Button>
		</>
	);
}
