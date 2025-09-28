import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';

interface Testimonial {
	quote: string;
	name: string;
	role: string;
	initials: string;
}

const testimonials: Testimonial[] = [
	{
		initials: 'AP',
		name: 'Alex P.',
		quote: 'The first open tool that calculates returns correctly. My spreadsheets are finally retired.',
		role: 'Retail Investor'
	},
	{
		initials: 'MS',
		name: 'Maria S.',
		quote: 'I plugged in years of trades and the performance attribution was instant and accurate.',
		role: 'Ex-Analyst'
	},
	{
		initials: 'DW',
		name: 'Dan W.',
		quote: 'The self-host option plus transparent math is perfect for compliance at our small fund.',
		role: 'Fund Partner'
	}
];

export function TestimonialsSection() {
	return (
		<section className='container mx-auto px-6 py-16' data-testid='landing-testimonials' id='testimonials'>
			<div className='mx-auto mb-12 max-w-2xl text-center'>
				<h2 className='text-3xl font-semibold md:text-4xl'>What users say</h2>
				<p className='text-muted-foreground mt-3'>
					Early adopters already rely on Invest-igator for daily insight.
				</p>
			</div>
			<div className='grid gap-6 md:grid-cols-3'>
				{testimonials.map((t) => (
					<Card key={t.name}>
						<CardHeader className='pb-0'>
							<div className='flex items-center gap-3'>
								<Avatar className='h-10 w-10'>
									<AvatarFallback>{t.initials}</AvatarFallback>
								</Avatar>
								<div>
									<p className='font-medium leading-tight'>{t.name}</p>
									<p className='text-xs text-muted-foreground'>{t.role}</p>
								</div>
							</div>
						</CardHeader>
						<CardContent className='pt-4'>
							<p className='text-sm italic leading-relaxed'>“{t.quote}”</p>
						</CardContent>
						<CardFooter />
					</Card>
				))}
			</div>
		</section>
	);
}
