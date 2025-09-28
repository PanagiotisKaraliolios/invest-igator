import '@/styles/globals.css';

import { GoogleAnalytics  } from '@next/third-parties/google';
import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { cookies } from 'next/headers';
import { ConsentProvider } from '@/components/consent/ConsentProvider';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { Toaster } from '@/components/ui/sonner';
import { env } from '@/env';
import { auth } from '@/server/auth';
import { TRPCReactProvider } from '@/trpc/react';

const siteUrl = env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const gaMeasurementId = env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export const metadata: Metadata = {
	description: 'An open-source investment portfolio tracker',
	icons: [
		{ rel: 'icon', url: '/icon' },
		{ rel: 'shortcut icon', url: '/favicon.ico' },
		{ rel: 'apple-touch-icon', url: '/apple-icon' }
	],
	metadataBase: new URL(siteUrl),
	openGraph: {
		description: 'An open-source investment portfolio tracker',
		images: [{ url: '/opengraph-image' }],
		siteName: env.APP_NAME || 'Invest-igator',
		title: env.APP_NAME || 'Invest-igator',
		type: 'website',
		url: siteUrl
	},
	other: env.NEXT_PUBLIC_ADSENSE_CLIENT_ID
		? { 'google-adsense-account': env.NEXT_PUBLIC_ADSENSE_CLIENT_ID }
		: undefined,
	title: env.APP_NAME || 'Invest-igator',
	twitter: {
		card: 'summary_large_image',
		description: 'An open-source investment portfolio tracker',
		images: [{ url: '/twitter-image' }],
		title: env.APP_NAME || 'Invest-igator'
	}
};

const geist = Geist({
	subsets: ['latin'],
	variable: '--font-geist-sans'
});

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	// Determine theme on the server using a cookie set by the client/API
	const cookieStore = await cookies();
	const themeCookie = cookieStore.get('ui-theme')?.value;
	const isDark = themeCookie ? themeCookie === 'dark' : true;
	const session = await auth();
	const isAuthenticated = Boolean(session?.user);

	return (
		<html className={`${geist.variable} ${isDark ? 'dark' : ''}`} lang='en'>
			<body className='min-h-screen bg-background' suppressHydrationWarning>
				<TRPCReactProvider>
					<ThemeProvider initialTheme={isDark ? 'dark' : 'light'} isAuthenticated={isAuthenticated}>
						<ConsentProvider>{children}</ConsentProvider>
					</ThemeProvider>
				</TRPCReactProvider>
				<Toaster position='top-right' richColors />
			</body>
			{gaMeasurementId && <GoogleAnalytics gaId={gaMeasurementId} />}
		</html>
	);
}
