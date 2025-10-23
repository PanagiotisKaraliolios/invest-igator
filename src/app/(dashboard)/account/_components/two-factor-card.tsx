'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/trpc/react';
import { DisabledTwoFactorSection } from './disabled-two-factor-section';
import { EnabledTwoFactorSection } from './enabled-two-factor-section';
import { PendingTwoFactorSection, type TwoFactorSetupPayload } from './pending-two-factor-section';

export default function TwoFactorCard() {
	const [pendingSetup, setPendingSetup] = useState<TwoFactorSetupPayload | null>(null);
	const twoFactor = api.account.getTwoFactorState.useQuery(undefined, {
		refetchOnMount: true,
		refetchOnWindowFocus: false,
		retry: 1
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
		body = (
			<div className='space-y-3'>
				<div className='space-y-2'>
					<Skeleton className='h-4 w-3/4' />
					<Skeleton className='h-4 w-1/2' />
				</div>
			</div>
		);
	} else if (twoFactor.isError || !twoFactor.data) {
		body = (
			<Alert variant='destructive'>
				<AlertCircle className='h-4 w-4' />
				<AlertTitle>Error loading two-factor information</AlertTitle>
				<AlertDescription>
					Unable to load your two-factor authentication status. Please refresh the page and try again.
				</AlertDescription>
			</Alert>
		);
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
