import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const ERROR_MESSAGES: Record<string, string> = {
	AccessDenied: 'Access was denied. This usually happens when a callback or signIn check blocks the request.',
	Configuration:
		'There is a problem with the server configuration. Check if your provider options and environment variables are correct.',
	Default: 'An unexpected error occurred. Please try again.',
	Verification: 'The verification token is invalid, expired, or has already been used. Request a new magic link.'
};

function friendlyMessage(code?: string | string[]) {
	const key = Array.isArray(code) ? code[0] : code;
	if (!key) return ERROR_MESSAGES.Default;
	return ERROR_MESSAGES[key] ?? `${ERROR_MESSAGES.Default} (${key})`;
}

export default async function AuthErrorPage({ searchParams }: Props) {
	const sp = await searchParams;
	const code = sp?.error;
	const description = sp?.error_description as string | undefined;

	return (
		<div className='flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10'>
			<Card className='mx-auto w-full max-w-lg'>
				<CardHeader>
					<CardTitle>Authentication error</CardTitle>
					<CardDescription>{friendlyMessage(code)}</CardDescription>
				</CardHeader>
				<CardContent className='space-y-4'>
					{code ? (
						<Alert variant='destructive'>
							<AlertTitle>Error code</AlertTitle>
							<AlertDescription>
								<Badge className='font-mono' variant='secondary'>
									{Array.isArray(code) ? code[0] : code}
								</Badge>
							</AlertDescription>
						</Alert>
					) : null}

					{description ? (
						<Alert>
							<AlertTitle>Details</AlertTitle>
							<AlertDescription>{description}</AlertDescription>
						</Alert>
					) : null}
				</CardContent>
				<CardFooter className='flex gap-3'>
					<Button asChild>
						<Link href='/login'>Back to sign in</Link>
					</Button>
					<Button asChild variant='outline'>
						<Link href='/'>Home</Link>
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}
