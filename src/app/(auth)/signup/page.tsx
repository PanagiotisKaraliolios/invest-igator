import { ChartLine } from 'lucide-react';
import { redirect } from 'next/navigation';
import { env } from '@/env';
import { auth } from '@/server/auth';
import { SignUpForm } from './_components/sign-up-form';

export const dynamic = 'force-dynamic';
export const metadata = {
	description: 'Create an account',
	icons: [{ rel: 'icon', url: '/favicon.ico' }],
	title: `Sign up - ${env.APP_NAME}`
};

export default async function SignUpPage() {
	const session = await auth();
	if (session?.user) redirect('/');

	return (
		<div className='flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10'>
			<div className='flex w-full max-w-sm flex-col gap-6'>
				<a className='flex items-center gap-2 self-center font-medium' href='/'>
					<span className='grid size-9 place-items-center rounded-md bg-primary/10 text-primary'>
						<ChartLine className='size-5' />
					</span>
					{env.APP_NAME}
				</a>
				<SignUpForm />
			</div>
		</div>
	);
}
