import '@/styles/globals.css';

import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { cookies } from 'next/headers';
import { Toaster } from '@/components/ui/sonner';
import { env } from '@/env';
import { TRPCReactProvider } from '@/trpc/react';

const siteUrl = env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
	description: 'An open-source investment portfolio tracker',
	icons: [{ rel: 'icon', url: '/favicon.ico' }],
	metadataBase: new URL(siteUrl),
	openGraph: {
		description: 'An open-source investment portfolio tracker',
		images: [{ url: '/opengraph-image' }],
		siteName: env.APP_NAME || 'Invest-igator',
		title: env.APP_NAME || 'Invest-igator',
		type: 'website',
		url: siteUrl
	},
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

	return (
		<html className={`${geist.variable} ${isDark ? 'dark' : ''}`} lang='en'>
			<body className='min-h-screen bg-background' suppressHydrationWarning>
				<TRPCReactProvider>{children}</TRPCReactProvider>
				<Toaster position='top-right' richColors />
			</body>
		</html>
	);
}
