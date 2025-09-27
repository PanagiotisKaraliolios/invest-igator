'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/trpc/react';
import { DisabledTwoFactorSection } from './disabled-two-factor-section';
import { EnabledTwoFactorSection } from './enabled-two-factor-section';
import { PendingTwoFactorSection, type TwoFactorSetupPayload } from './pending-two-factor-section';

export default function TwoFactorCard() {
	const [pendingSetup, setPendingSetup] = useState<TwoFactorSetupPayload | null>(null);
	const twoFactor = api.account.getTwoFactorState.useQuery(undefined, {
		retry: 1,
		refetchOnMount: true,
		refetchOnWindowFocus: false
	});

	const handleRefetch = async () => {
		await twoFactor.refetch();
	};

	useEffect(() => {
		if (!twoFactor.data?.pending) {
			setPendingSetup(null);
		}
	}, [twoFactor.data?.pending]);

	let body;
	if (twoFactor.isLoading) {
		body = <p className='text-muted-foreground text-sm'>Loading two-factor status…</p>;
	} else if (!twoFactor.data) {
		body = <p className='text-muted-foreground text-sm'>Unable to load two-factor information.</p>;
	} else if (twoFactor.data.pending) {
		body = (
			<PendingTwoFactorSection
				initialSetup={pendingSetup}
				onRefetch={handleRefetch}
				onSetupChange={setPendingSetup}
			/>
		);
	} else if (twoFactor.data.enabled) {
		body = (
			<EnabledTwoFactorSection
				hasPassword={twoFactor.data.hasPassword}
				onRefetch={handleRefetch}
				recoveryCodesRemaining={twoFactor.data.recoveryCodesRemaining}
			/>
		);
	} else {
		body = (
			<DisabledTwoFactorSection
				onRefetch={handleRefetch}
				onSetupStarted={(payload) => setPendingSetup(payload)}
			/>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Two-factor authentication</CardTitle>
				<CardDescription>Add a second factor to your login for better account security.</CardDescription>
			</CardHeader>
			<CardContent className='space-y-4'>{body}</CardContent>
		</Card>
	);
}
