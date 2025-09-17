'use client';

import Script from 'next/script';
import { useEffect, useMemo, useState } from 'react';
import { env } from '@/env';

type ConsentState = 'granted' | 'denied' | undefined;

function getInitialConsent(): ConsentState {
	if (typeof window === 'undefined') return undefined;
	const v = window.localStorage.getItem('consent.ads');
	return v === 'granted' ? 'granted' : v === 'denied' ? 'denied' : undefined;
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
	const [consent, setConsent] = useState<ConsentState>(undefined);

	useEffect(() => {
		setConsent(getInitialConsent());
	}, []);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		// Inject gtag stub for Consent Mode v2
		if (!(window as any).dataLayer) {
			(window as any).dataLayer = [];
		}
		function gtag(...args: any[]) {
			(window as any).dataLayer.push(args);
		}
		(window as any).gtag = gtag;

		// Default consent to denied until user choice (required for EEA)
		gtag('consent', 'default', {
			ad_personalization: 'denied',
			ad_storage: 'denied',
			ad_user_data: 'denied',
			analytics_storage: 'denied',
			wait_for_update: 500
		});

		if (consent === 'granted') {
			gtag('consent', 'update', {
				ad_personalization: 'granted',
				ad_storage: 'granted',
				ad_user_data: 'granted',
				analytics_storage: 'granted'
			});
		}
	}, [consent]);

	const showBanner = useMemo(() => consent === undefined, [consent]);

	const acceptAll = () => {
		window.localStorage.setItem('consent.ads', 'granted');
		setConsent('granted');
	};
	const rejectAll = () => {
		window.localStorage.setItem('consent.ads', 'denied');
		setConsent('denied');
	};

	const shouldLoadAds =
		process.env.NODE_ENV === 'production' && env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;

	return (
		<>
			{shouldLoadAds ? (
				<Script
					async
					crossOrigin='anonymous'
					src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${env.NEXT_PUBLIC_ADSENSE_CLIENT_ID}`}
					strategy='afterInteractive'
				/>
			) : null}
			{children}
			{showBanner ? (
				<div
					aria-live='polite'
					className='fixed inset-x-0 bottom-0 z-50 mx-auto max-w-screen-md rounded-t-md border bg-background p-4 shadow-2xl'
					role='dialog'
				>
					<div className='mb-3 text-sm'>
						We use cookies for ads and analytics. Grant consent to enable personalized ads. You can change
						this later.
					</div>
					<div className='flex items-center gap-2'>
						<button
							className='inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground'
							onClick={acceptAll}
						>
							Accept all
						</button>
						<button
							className='inline-flex items-center rounded-md border px-3 py-2 text-sm'
							onClick={rejectAll}
						>
							Reject
						</button>
					</div>
				</div>
			) : null}
		</>
	);
}
