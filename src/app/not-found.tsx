import { ChartLine, Home, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
	return (
		<div className='flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-background via-background to-muted/20 px-4'>
			{/* Decorative glow */}
			<div className='pointer-events-none absolute inset-0 -z-10'>
				<div className='absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[120px]' />
			</div>

			<div className='mx-auto max-w-md text-center'>
				{/* Logo */}
				<Link className='mb-8 inline-flex items-center gap-2 text-foreground' href='/'>
					<span className='grid size-12 place-items-center rounded-lg bg-primary/10 text-primary'>
						<ChartLine className='size-6' />
					</span>
					<span className='text-xl font-semibold'>Invest-igator</span>
				</Link>

				{/* 404 Display */}
				<div className='mb-6'>
					<h1 className='bg-linear-to-br from-foreground to-foreground/60 bg-clip-text text-8xl font-bold tracking-tight text-transparent'>
						404
					</h1>
					<div className='mt-2 h-1 w-24 rounded-full bg-linear-to-r from-primary to-primary/40 mx-auto' />
				</div>

				{/* Message */}
				<h2 className='mb-3 text-2xl font-semibold tracking-tight text-foreground'>Page Not Found</h2>
				<p className='mb-8 text-muted-foreground'>
					The page you're looking for doesn't exist. It might have been moved or deleted, or you may have
					mistyped the URL.
				</p>

				{/* Actions */}
				<div className='flex flex-col gap-3 sm:flex-row sm:justify-center'>
					<Button asChild size='lg'>
						<Link href='/'>
							<Home className='mr-2 size-4' />
							Back to Home
						</Link>
					</Button>
					<Button asChild size='lg' variant='outline'>
						<Link href='/portfolio'>
							<Search className='mr-2 size-4' />
							Go to Portfolio
						</Link>
					</Button>
				</div>

				{/* Help text */}
				<p className='mt-8 text-sm text-muted-foreground'>
					Need help?{' '}
					<Link className='text-primary hover:underline' href='/'>
						Contact support
					</Link>
				</p>
			</div>
		</div>
	);
}
