import Link from 'next/link';

export default async function VerifyErrorPage({ searchParams }: { searchParams?: Promise<{ reason?: string }> }) {
	const sp = (await searchParams) ?? {};
	const reason = decodeURIComponent(sp.reason ?? 'Verification failed');
	return (
		<div className='flex min-h-[50vh] items-center justify-center p-6'>
			<div className='mx-auto w-full max-w-md rounded-lg border bg-background p-6 text-center'>
				<h1 className='mb-2 text-2xl font-semibold'>Verification error</h1>
				<p className='mb-6 text-sm text-muted-foreground'>{reason}</p>
				<div className='flex justify-center gap-4'>
					<Link className='text-primary underline' href='/account?tab=profile'>
						Back to Account
					</Link>
					<Link className='text-primary underline' href='/'>
						Home
					</Link>
				</div>
			</div>
		</div>
	);
}
