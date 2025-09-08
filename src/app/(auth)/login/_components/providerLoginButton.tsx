'use client';
import { Button } from '@/components/ui/button';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { FcGoogle } from 'react-icons/fc';
import { MdEmail } from 'react-icons/md';
import type { IconType } from 'react-icons';

const providerIcons: Record<string, IconType> = {
	discord: FaDiscord,
	github: FaGithub,
	google: FcGoogle,
	email: MdEmail,
};

export default function ProviderLoginButton({ provider }: { provider: string }) {
	const searchParams = useSearchParams();

	const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard';

	const Icon = providerIcons[provider];

	return (
		<>
			<Button
				variant='outline'
				className="flex w-full items-center justify-center gap-2"
				onClick={() => signIn(provider, { callbackUrl })}>
				{Icon ? <Icon className='inline-block' /> : null}
				Login with {provider.charAt(0).toUpperCase() + provider.slice(1)}
			</Button>
		</>
	);
}
