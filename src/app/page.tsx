import { headers } from 'next/headers';
import { AdSlot } from '@/components/ads/AdSlot';
import { env } from '@/env';
import { auth } from '@/lib/auth';
import HeroCharts from './_components/hero-charts';
import { AnimatedFooter } from './_components/landing/animated-footer';
import { AnimatedCta, AnimatedHeader, AnimatedHero } from './_components/landing/animated-hero';
import { BenefitsSection } from './_components/landing/benefits';
import { DataPipelineSection } from './_components/landing/data-pipeline';
import { FeatureShowcaseSection } from './_components/landing/feature-showcase';
import { FAQSection } from './_components/landing/faq';
import { HowItWorksSection } from './_components/landing/how-it-works';
import { PartnersRow } from './_components/landing/partners';
import { PricingSection } from './_components/landing/pricing';
import { QuickstartSection } from './_components/landing/quickstart';
import { TestimonialsSection } from './_components/landing/testimonials';
import { TrustSignalsSection } from './_components/landing/trust-signals';
import ThemeSwitch from './(dashboard)/_components/theme-switch';

export const revalidate = 60;

export default async function Home() {
	const session = await auth.api.getSession({ headers: await headers() });
	const appName = env.APP_NAME ?? 'Invest-igator';

	return (
		<main className='relative min-h-screen overflow-hidden bg-gradient-to-b from-background via-background to-background'>
			{/* Decorative glow */}
			<div className='pointer-events-none absolute inset-0 -z-10'>
				<div className='absolute left-1/2 top-[-10%] h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]' />
			</div>

			{/* Header */}
			<AnimatedHeader appName={appName}>
				<div className='mr-4 ml-auto'>
					<ThemeSwitch />
				</div>
			</AnimatedHeader>

			{/* Hero */}
			<AnimatedHero appName={appName} chartComponent={<HeroCharts />} isSignedIn={Boolean(session?.user)} />

			{/* Partners / stack logos */}
			<PartnersRow />

			{/* Feature deep-dive */}
			<FeatureShowcaseSection />

			{/* Benefits grid */}
			<BenefitsSection />

			{/* How it works */}
			<HowItWorksSection />

			{/* Data pipeline */}
			<DataPipelineSection />

			{/* Quickstart */}
			<QuickstartSection />

			{/* Trust */}
			<TrustSignalsSection />

			{/* Pricing */}
			<PricingSection signedIn={Boolean(session?.user)} />

			{/* Testimonials */}
			<TestimonialsSection />

			{/* FAQ */}
			<FAQSection />

			{/* Final CTA */}
			<AnimatedCta isSignedIn={Boolean(session?.user)} />

			{/* Landing Ad */}
			{env.NEXT_PUBLIC_ADSENSE_SLOT_LANDING ? (
				<section className='container mx-auto px-6'>
					<AdSlot className='my-8' format='auto' slot={env.NEXT_PUBLIC_ADSENSE_SLOT_LANDING} />
				</section>
			) : null}

			{/* Footer */}
			<AnimatedFooter appName={appName} />
		</main>
	);
}
