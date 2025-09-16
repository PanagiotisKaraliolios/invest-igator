'use client';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import type { IconType } from 'react-icons';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { FcGoogle } from 'react-icons/fc';
import { MdEmail } from 'react-icons/md';
import { Button } from '@/components/ui/button';

const providerIcons: Record<string, IconType> = {
	discord: FaDiscord,
	email: MdEmail,
	github: FaGithub,
	google: FcGoogle
};

export default function ProviderLoginButton({ provider }: { provider: string }) {
	const searchParams = useSearchParams();

	const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard';

	const Icon = providerIcons[provider];

	return (
		<>
			<Button
				className='flex w-full items-center justify-center gap-2'
				onClick={() => signIn(provider, { callbackUrl })}
				variant='outline'
			>
				{Icon ? <Icon className='inline-block' /> : null}
				Login with {provider.charAt(0).toUpperCase() + provider.slice(1)}
			</Button>
		</>
	);
}
