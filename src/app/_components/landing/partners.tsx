'use client';

import { useTheme } from '@/components/theme/ThemeProvider';
import { BetterAuthWordmarkDark } from '@/components/ui/svgs/betterAuthWordmarkDark';
import { BetterAuthWordmarkLight } from '@/components/ui/svgs/betterAuthWordmarkLight';
import { InfluxCuboNavy } from '@/components/ui/svgs/influxCuboNavy';
import { InfluxCuboPink } from '@/components/ui/svgs/influxCuboPink';
import { NextjsLogoDark } from '@/components/ui/svgs/nextjsLogoDark';
import { NextjsLogoLight } from '@/components/ui/svgs/nextjsLogoLight';
import { Prisma } from '@/components/ui/svgs/prisma';
import { PrismaDark } from '@/components/ui/svgs/prismaDark';
import { TrpcWordmarkDark } from '@/components/ui/svgs/trpcWordmarkDark';
import { TrpcWordmarkLight } from '@/components/ui/svgs/trpcWordmarkLight';
import { useGsapStagger } from '@/hooks/use-gsap';

interface PartnerDef {
	name: string;
	label: string;
	// Return JSX for light variant
	light: () => React.ReactNode;
	// Return JSX for dark variant
	dark: () => React.ReactNode;
}

const partners: PartnerDef[] = [
	{
		dark: () => <NextjsLogoDark aria-label='Next.js logo' className='h-full w-auto' />,
		label: 'Next.js',
		light: () => <NextjsLogoLight aria-label='Next.js logo' className='h-full w-auto' />,
		name: 'nextjs'
	},
	{
		dark: () => <PrismaDark aria-label='Prisma logo' className='h-full w-auto' />,
		label: 'Prisma',
		light: () => <Prisma aria-label='Prisma logo' className='h-full w-auto' />,
		name: 'prisma'
	},
	{
		dark: () => <TrpcWordmarkDark aria-label='tRPC logo' className='h-full w-auto' />,
		label: 'tRPC',
		light: () => <TrpcWordmarkLight aria-label='tRPC logo' className='h-full w-auto' />,
		name: 'trpc'
	},
	{
		dark: () => <InfluxCuboPink aria-label='InfluxDB logo' className='h-full w-auto' />,
		label: 'InfluxDB',
		light: () => <InfluxCuboNavy aria-label='InfluxDB logo' className='h-full w-auto' />,
		name: 'influxdb'
	},
	{
		dark: () => <BetterAuthWordmarkDark aria-label='Better Auth logo' className='h-full w-auto' />,
		label: 'Better Auth',
		light: () => <BetterAuthWordmarkLight aria-label='Better Auth logo' className='h-full w-auto' />,
		name: 'auth'
	}
];

export function PartnersRow() {
	const { isLight, mounted } = useTheme();
	const logosRef = useGsapStagger<HTMLDivElement>({ duration: 0.5, stagger: 0.08, type: 'fadeUp' });

	// Avoid hydration mismatch: render nothing until mounted so theme is consistent client/server
	if (!mounted) {
		// Render a stable skeleton layout to avoid layout shift
		return (
			<section
				aria-label='Technology stack logos'
				className='container mx-auto px-6 pt-4 pb-10'
				data-testid='landing-partners'
			>
				<div className='flex flex-wrap items-center justify-center gap-10 opacity-40'>
					{partners.map((p) => (
						<div aria-hidden className='h-6 w-24 animate-pulse rounded bg-muted/40' key={p.name} />
					))}
				</div>
			</section>
		);
	}

	return (
		<section
			aria-label='Technology stack logos'
			className='container mx-auto px-6 pt-4 pb-10'
			data-testid='landing-partners'
		>
			<div className='flex flex-wrap items-center justify-center gap-10 opacity-80' ref={logosRef}>
				{partners.map((p) => {
					const Logo = isLight ? p.light : p.dark;
					return (
						<div
							aria-label={p.label}
							className='h-8 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-opacity hover:opacity-100'
							data-gsap-item
							data-testid={`landing-partner-${p.name}`}
							key={p.name}
							role='img'
						>
							{Logo()}
						</div>
					);
				})}
			</div>
		</section>
	);
}
