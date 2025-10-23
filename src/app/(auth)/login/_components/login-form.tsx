import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CredentialsLoginForm } from './credentialsLoginForm';
import { MagicLinkLoginForm } from './magicLinkLoginForm';
import ProvidersList from './providersList';

export function LoginForm({ className, errorCode, ...props }: React.ComponentProps<'div'> & { errorCode?: string }) {
	return (
		<div className={cn('flex flex-col gap-6', className)} {...props}>
			<Card>
				<CardHeader className='text-center'>
					<CardTitle className='text-xl'>Welcome back</CardTitle>
					<CardDescription>
						Login with one of the providers below or with your email and password.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className='grid gap-6'>
						{errorCode === 'OAuthAccountNotLinked' ? (
							<Alert variant='destructive'>
								<AlertTitle>Account not linked</AlertTitle>
								<AlertDescription>
									This email is already linked to a different sign-in provider. Sign in with the
									original provider and then link this provider through your account settings.
								</AlertDescription>
							</Alert>
						) : null}
						{errorCode === 'magic-link-failed' ? (
							<Alert variant='destructive'>
								<AlertTitle>Magic link failed</AlertTitle>
								<AlertDescription>
									The magic link has expired or is invalid. Please request a new one.
								</AlertDescription>
							</Alert>
						) : null}
						<ProvidersList />
						<div className='relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-border after:border-t'>
							<span className='relative z-10 bg-card px-2 text-muted-foreground'>Or continue with</span>
						</div>
						{/* Tabs for Credentials or Magic Link sign-in */}
						<Tabs className='w-full' defaultValue='password'>
							<TabsList className='grid w-full grid-cols-2'>
								<TabsTrigger value='password'>Password</TabsTrigger>
								<TabsTrigger value='magic-link'>Magic Link</TabsTrigger>
							</TabsList>
							<TabsContent className='mt-4' value='password'>
								<CredentialsLoginForm />
							</TabsContent>
							<TabsContent className='mt-4' value='magic-link'>
								<MagicLinkLoginForm />
							</TabsContent>
						</Tabs>
						<div className='text-center text-sm'>
							Don&apos;t have an account?{' '}
							<a className='underline underline-offset-4' href='/signup'>
								Sign up
							</a>
						</div>
					</div>
				</CardContent>
			</Card>
			<div className='text-balance text-center text-muted-foreground text-xs *:[a]:underline *:[a]:underline-offset-4 *:[a]:hover:text-primary'>
				By clicking continue, you agree to our <Link href='/terms-of-service'>Terms of Service</Link> and{' '}
				<Link href='/privacy-policy'>Privacy Policy</Link>.
			</div>
		</div>
	);
}
