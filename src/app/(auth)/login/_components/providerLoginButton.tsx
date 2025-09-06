'use client';
import { Button } from '@/components/ui/button';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

export default function ProviderLoginButton({ provider }: { provider: string }) {
	const searchParams = useSearchParams();

	const callbackUrl = searchParams.get('callbackUrl') ?? '/';

	return (
		<>
			{provider === 'discord' && (
				<Button
					variant='outline'
					className='w-full'
					onClick={() => signIn(provider, { callbackUrl })}>
					Login with {provider}
				</Button>
			)}
		</>
	);
}
