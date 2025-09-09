import '@/styles/globals.css';

import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { cookies } from 'next/headers';
import { Toaster } from '@/components/ui/sonner';
import { env } from '@/env';
import { TRPCReactProvider } from '@/trpc/react';

export const metadata: Metadata = {
	description: 'An open-source investment portfolio tracker',
	icons: [{ rel: 'icon', url: '/favicon.ico' }],
	title: env.APP_NAME || 'Invest-igator'
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
