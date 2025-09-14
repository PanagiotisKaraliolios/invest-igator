'use client';

import { signOut } from 'next-auth/react';
import React, { useTransition } from 'react';
import { Button } from '@/components/ui/button';

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

	return (
		<Button
			className={className}
			disabled={pending}
			onClick={() => startTransition(() => signOut({ callbackUrl }))}
			size={size as any}
			variant={variant as any}
		>
			{pending ? 'Signing out…' : label}
		</Button>
	);
}
