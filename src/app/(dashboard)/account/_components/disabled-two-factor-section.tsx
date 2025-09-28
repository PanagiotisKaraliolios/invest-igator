'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/trpc/react';
import type { TwoFactorSetupPayload } from './pending-two-factor-section';

interface DisabledTwoFactorSectionProps {
	onRefetch: () => Promise<unknown>;
	onSetupStarted: (payload: TwoFactorSetupPayload) => void;
}

export function DisabledTwoFactorSection({ onRefetch, onSetupStarted }: DisabledTwoFactorSectionProps) {
	const startSetup = api.account.startTwoFactorSetup.useMutation({
		onError: (err) => toast.error(err.message || 'Failed to start setup')
	});

	return (
		<div className='space-y-4'>
			<p className='text-sm'>Protect your account with an authenticator app or phone-based code.</p>
			<Button
				disabled={startSetup.isPending}
				onClick={async () => {
					try {
						const payload = await startSetup.mutateAsync();
						if (payload) {
							onSetupStarted(payload);
							await onRefetch();
							toast.success('Two-factor setup started');
						}
					} catch {
						// toast handled by mutation
					}
				}}
			>
				{startSetup.isPending ? 'Preparing…' : 'Enable two-factor authentication'}
			</Button>
		</div>
	);
}
