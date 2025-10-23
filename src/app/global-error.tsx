'use client';

import { AlertTriangle, ChartLine, RotateCw } from 'lucide-react';
import { useEffect } from 'react';

export default function GlobalError({
	error,
	reset
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		// Log the error to an error reporting service
		console.error('Global error boundary caught:', error);
	}, [error]);

	return (
		<html lang='en'>
			<body className='min-h-screen bg-background'>
				<div className='flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-background via-background to-muted/20 px-4'>
					{/* Decorative glow */}
					<div className='pointer-events-none absolute inset-0 -z-10'>
						<div className='absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/10 blur-[120px]' />
					</div>

					<div className='mx-auto max-w-md text-center'>
						{/* Logo */}
						<div className='mb-8 inline-flex items-center gap-2 text-foreground'>
							<span className='grid size-12 place-items-center rounded-lg bg-blue-500/10 text-blue-500'>
								<ChartLine className='size-6' />
							</span>
							<span className='text-xl font-semibold'>Invest-igator</span>
						</div>

						{/* Error Icon */}
						<div className='mb-6 inline-flex items-center justify-center'>
							<div className='rounded-full bg-red-500/10 p-4'>
								<AlertTriangle className='size-12 text-red-500' />
							</div>
						</div>

						{/* Message */}
						<h2 className='mb-3 text-2xl font-semibold tracking-tight text-foreground'>
							Critical Error
						</h2>
						<p className='mb-8 text-gray-600 dark:text-gray-400'>
							A critical error occurred that prevented the application from loading. Please try
							refreshing the page.
						</p>

						{/* Error details (dev only) */}
						{process.env.NODE_ENV === 'development' && (
							<div className='mb-6 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-left'>
								<p className='mb-2 text-xs font-semibold text-red-500'>Development Error Details:</p>
								<p className='text-xs font-mono text-gray-600 dark:text-gray-400 break-all'>
									{error.message || 'Unknown critical error'}
								</p>
								{error.digest && (
									<p className='mt-2 text-xs text-gray-600 dark:text-gray-400'>
										Error ID: <span className='font-mono'>{error.digest}</span>
									</p>
								)}
							</div>
						)}

						{/* Actions */}
						<div className='flex flex-col gap-3 sm:flex-row sm:justify-center'>
							<button
								className='inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
								onClick={reset}
								type='button'
							>
								<RotateCw className='size-4' />
								Try Again
							</button>
							<button
								className='inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
								onClick={() => window.location.reload()}
								type='button'
							>
								Reload Page
							</button>
						</div>
					</div>
				</div>
			</body>
		</html>
	);
}
