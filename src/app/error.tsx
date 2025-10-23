'use client';

import { AlertTriangle, ChartLine, Home, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	useEffect(() => {
		// Log the error to an error reporting service
		console.error('Error boundary caught:', error);
	}, [error]);

	return (
		<div className='flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-background via-background to-muted/20 px-4'>
			{/* Decorative glow */}
			<div className='pointer-events-none absolute inset-0 -z-10'>
				<div className='absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive/5 blur-[120px]' />
			</div>

			<div className='mx-auto max-w-md text-center'>
				{/* Logo */}
				<Link className='mb-8 inline-flex items-center gap-2 text-foreground' href='/'>
					<span className='grid size-12 place-items-center rounded-lg bg-primary/10 text-primary'>
						<ChartLine className='size-6' />
					</span>
					<span className='text-xl font-semibold'>Invest-igator</span>
					
					{/* Error Icon */}
					<div className='inline-flex items-center justify-center'>
						<div className='rounded-full bg-destructive/10 p-4'>
							<AlertTriangle className='size-6 text-destructive' />
						</div>
					</div>
				</Link>


				{/* Message */}
				<h2 className='mb-3 text-2xl font-semibold tracking-tight text-foreground'>
					Something went wrong
				</h2>
				<p className='mb-8 text-muted-foreground'>
					We encountered an unexpected error. This has been logged and we'll look into it.
					You can try again or return to the home page.
				</p>

				{/* Error details (dev only) */}
				{process.env.NODE_ENV === 'development' && (
					<div className='mb-6 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-left'>
						<p className='mb-2 text-xs font-semibold text-destructive'>Development Error Details:</p>
						<p className='text-xs font-mono text-muted-foreground break-all'>
							{error.message || 'Unknown error'}
						</p>
						{error.digest && (
							<p className='mt-2 text-xs text-muted-foreground'>
								Error ID: <span className='font-mono'>{error.digest}</span>
							</p>
						)}
					</div>
				)}

				{/* Actions */}
				<div className='flex flex-col gap-3 sm:flex-row sm:justify-center'>
					<Button onClick={reset} size='lg'>
						<RotateCw className='mr-2 size-4' />
						Try Again
					</Button>
					<Button asChild size='lg' variant='outline'>
						<Link href='/'>
							<Home className='mr-2 size-4' />
							Back to Home
						</Link>
					</Button>
				</div>

				{/* Help text */}
				<p className='mt-8 text-sm text-muted-foreground'>
					If this problem persists,{' '}
					<Link className='text-primary hover:underline' href='/'>
						contact support
					</Link>
				</p>
			</div>
		</div>
	);
}
