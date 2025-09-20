import ForgotPasswordRequestForm from '@/app/forgot-password/request-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ForgotPasswordPage() {
	return (
		<div className='mx-auto max-w-md p-4'>
			<Card>
				<CardHeader className='text-center'>
					<CardTitle className='text-xl'>Reset your password</CardTitle>
					<CardDescription>Enter your email to receive a reset link.</CardDescription>
				</CardHeader>
				<CardContent>
					<ForgotPasswordRequestForm />
				</CardContent>
			</Card>
		</div>
	);
}
