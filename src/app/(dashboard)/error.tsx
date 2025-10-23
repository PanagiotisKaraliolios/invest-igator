'use client';

import { AlertTriangle, Home, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	useEffect(() => {
		// Log the error to an error reporting service
		console.error('Dashboard error boundary caught:', error);
	}, [error]);

	return (
		<div className='flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4'>
			{/* Error Icon */}
			<div className='mb-6 inline-flex items-center justify-center'>
				<div className='rounded-full bg-destructive/10 p-4'>
					<AlertTriangle className='size-12 text-destructive' />
				</div>
			</div>

			{/* Message */}
			<h2 className='mb-3 text-2xl font-semibold tracking-tight text-foreground'>Dashboard Error</h2>
			<p className='mb-6 max-w-md text-center text-muted-foreground'>
				We encountered an error while loading this dashboard page. This has been logged and we'll investigate.
				You can try again or navigate to another section.
			</p>

			{/* Error details (dev only) */}
			{process.env.NODE_ENV === 'development' && (
				<div className='mb-6 w-full max-w-md rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-left'>
					<p className='mb-2 text-xs font-semibold text-destructive'>Development Error Details:</p>
					<p className='text-xs font-mono text-muted-foreground break-all'>
						{error.message || 'Unknown error'}
					</p>
					{error.digest && (
						<p className='mt-2 text-xs text-muted-foreground'>
							Error ID: <span className='font-mono'>{error.digest}</span>
						</p>
					)}
					{error.stack && (
						<details className='mt-3'>
							<summary className='cursor-pointer text-xs font-semibold text-destructive'>
								Stack Trace
							</summary>
							<pre className='mt-2 max-h-48 overflow-auto text-xs text-muted-foreground whitespace-pre-wrap break-all'>
								{error.stack}
							</pre>
						</details>
					)}
				</div>
			)}

			{/* Actions */}
			<div className='flex flex-wrap justify-center gap-3'>
				<Button onClick={reset} size='lg'>
					<RotateCw className='mr-2 size-4' />
					Try Again
				</Button>
				<Button asChild size='lg' variant='outline'>
					<Link href='/portfolio'>Go to Portfolio</Link>
				</Button>
				<Button asChild size='lg' variant='ghost'>
					<Link href='/'>
						<Home className='mr-2 size-4' />
						Back to Home
					</Link>
				</Button>
			</div>
		</div>
	);
}
