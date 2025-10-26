'use client';

import { AlertCircle, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { authClient, useSession } from '@/lib/auth-client';

interface ImpersonationBannerProps {
	impersonatedBy: string;
	currentUserEmail: string;
}

export function ImpersonationBanner({ impersonatedBy, currentUserEmail }: ImpersonationBannerProps) {
	const router = useRouter();
	const session = useSession();
	const [isLoading, setIsLoading] = useState(false);

	const handleStopImpersonation = async () => {
		setIsLoading(true);
		try {
			const result = await authClient.admin.stopImpersonating();

			if (result.error) {
				toast.error(result.error.message || 'Failed to stop impersonation');
				setIsLoading(false);
				return;
			}

			toast.success('Stopped impersonating user');

			// Hard navigation to ensure server components refetch with updated session
			window.location.href = '/admin';
		} catch (error) {
			toast.error('Failed to stop impersonation');
			console.error('Stop impersonation error:', error);
			setIsLoading(false);
		}
	};

	return (
		<Alert className='border-orange-500 bg-orange-50 dark:bg-orange-950/20' variant='default'>
			<AlertCircle className='size-4 text-orange-600 dark:text-orange-400' />
			<AlertDescription className='flex items-center justify-between gap-4'>
				<span className='text-sm text-orange-900 dark:text-orange-100'>
					You are currently impersonating <strong>{currentUserEmail}</strong>
				</span>
				<Button disabled={isLoading} onClick={handleStopImpersonation} size='sm' variant='outline'>
					<LogOut className='mr-2 size-4' />
					{isLoading ? 'Stopping...' : 'Stop Impersonation'}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
