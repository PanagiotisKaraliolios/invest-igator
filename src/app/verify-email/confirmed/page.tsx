import Link from 'next/link';

export default function VerifiedPage() {
	return (
		<div className='flex min-h-[50vh] items-center justify-center p-6'>
			<div className='mx-auto w-full max-w-md rounded-lg border bg-background p-6 text-center'>
				<h1 className='mb-2 text-2xl font-semibold'>Email verified</h1>
				<p className='mb-6 text-sm text-muted-foreground'>Your email address has been verified successfully.</p>
				<div className='flex justify-center'>
					<Link className='text-primary underline' href='/account?tab=Profile'>
						Back to Account
					</Link>
				</div>
			</div>
		</div>
	);
}
