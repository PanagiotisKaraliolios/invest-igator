'use client';

import { useRouter } from 'next/navigation';
import React, { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth-client';

type Props = {
	callbackUrl?: string;
	className?: string;
	size?: 'sm' | 'md' | 'lg' | 'icon';
	variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
	label?: string;
};

export default function SignOutButton({
	callbackUrl = '/',
	className,
	size = 'sm',
	variant = 'outline',
	label = 'Sign out'
}: Props) {
	const [pending, startTransition] = useTransition();
	const router = useRouter();

	const handleSignOut = async () => {
		await signOut();
		router.push(callbackUrl);
	};

	return (
		<Button
			className={className}
			disabled={pending}
			onClick={() => startTransition(() => handleSignOut())}
			size={size as any}
			variant={variant as any}
		>
			{pending ? 'Signing out…' : label}
		</Button>
	);
}
