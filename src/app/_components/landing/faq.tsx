import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const faqs = [
	{
		a: 'Time-weighted return (TWR) chains sub-period returns removing external cash flow timing bias; money-weighted return (MWR) uses a Modified Dietz approach accounting for intraperiod flows.',
		q: 'How do you calculate performance?'
	},
	{
		a: 'Yes. You can export transactions and performance series. More formats (JSON, CSV with benchmarks) are planned.',
		q: 'Can I export my data?'
	},
	{
		a: 'No. You import transactions manually or via future file adapters. Self-host mode means all data stays on your infrastructure.',
		q: 'Do you store my brokerage credentials?'
	},
	{
		a: 'Private tRPC endpoints power the app. A public token-based API is on the roadmap once scopes & rate limits solidify.',
		q: 'Is there an API?'
	},
	{
		a: 'Most users stay on the free tier. Paid plans fund ingestion scale, extended history retention, and premium attribution analytics.',
		q: 'How is pricing determined?'
	}
];

export function FAQSection() {
	return (
		<section className='container mx-auto px-6 py-16' data-testid='landing-faq' id='faq'>
			<div className='mx-auto mb-12 max-w-2xl text-center'>
				<h2 className='text-3xl font-semibold md:text-4xl'>FAQ</h2>
				<p className='text-muted-foreground mt-3'>Answers to common questions about the platform.</p>
			</div>
			<Accordion className='mx-auto max-w-3xl' collapsible type='single'>
				{faqs.map((f, i) => (
					<AccordionItem key={f.q} value={`item-${i}`}>
						<AccordionTrigger className='text-left'>{f.q}</AccordionTrigger>
						<AccordionContent className='text-sm leading-relaxed text-muted-foreground'>
							{f.a}
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>
		</section>
	);
}
