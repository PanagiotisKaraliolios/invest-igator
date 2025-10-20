'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CopyIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { authClient } from '@/lib/auth-client';
import { api } from '@/trpc/react';

export type TwoFactorSetupPayload = {
	otpauthUrl: string;
	recoveryCodes: string[];
	secret: string;
};

const confirmSchema = z.object({
	code: z.string().min(6, 'Enter the 6-digit code from your authenticator app').max(20, 'Code is too long')
});

interface PendingTwoFactorSectionProps {
	onRefetch: () => Promise<unknown>;
	initialSetup?: TwoFactorSetupPayload | null;
	onSetupChange: (payload: TwoFactorSetupPayload | null) => void;
}

export function PendingTwoFactorSection({ initialSetup, onSetupChange, onRefetch }: PendingTwoFactorSectionProps) {
	const [generated, setGenerated] = useState<TwoFactorSetupPayload | null>(initialSetup ?? null);
	const [isVerifying, setIsVerifying] = useState(false);
	const [isCancelling, setIsCancelling] = useState(false);
	const [setupError, setSetupError] = useState<string | null>(null);

	const cancelSetupMutation = api.account.cancelTwoFactorSetup.useMutation();

	const syncSetup = (payload: TwoFactorSetupPayload | null) => {
		setGenerated(payload);
		onSetupChange(payload);
		setSetupError(null);
	};

	useEffect(() => {
		setGenerated(initialSetup ?? null);
		if (initialSetup) setSetupError(null);
	}, [initialSetup]);

	const confirmForm = useForm<z.infer<typeof confirmSchema>>({
		defaultValues: { code: '' },
		resolver: zodResolver(confirmSchema)
	});

	const handleConfirm = async (values: z.infer<typeof confirmSchema>) => {
		setIsVerifying(true);
		try {
			const { data, error } = await authClient.twoFactor.verifyTotp({
				code: values.code.replace(/\s+/g, ''),
				trustDevice: false // Don't trust device during setup
			});

			if (error) {
				toast.error(error.message || 'Invalid authentication code');
				setIsVerifying(false);
				return;
			}

			if (data) {
				confirmForm.reset();
				syncSetup(null);
				await onRefetch();
				toast.success('Two-factor authentication enabled');
			}
		} catch (err) {
			toast.error('An unexpected error occurred');
		} finally {
			setIsVerifying(false);
		}
	};

	if (initialSetup && !generated) {
		syncSetup(initialSetup);
	}

	const setupDetails = generated ? (
		<div className='grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]'>
			<div className='flex items-center justify-center rounded-lg border bg-muted/30 p-4'>
				<QRCodeSVG className='size-56' value={generated.otpauthUrl} />
			</div>
			<div className='space-y-4'>
				{generated.secret && (
					<div>
						<div className='flex items-center gap-2'>
							<p className='font-medium'>Setup key</p>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										className='size-8'
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(generated.secret);
												toast.success('Setup key copied');
											} catch {
												toast.error('Failed to copy setup key');
											}
										}}
										size='icon'
										variant='outline'
									>
										<CopyIcon className='size-3' />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Copy setup key</TooltipContent>
							</Tooltip>
						</div>
						<code className='mt-2 inline-block rounded border bg-muted/50 px-2 py-1 text-sm'>
							{generated.secret}
						</code>
					</div>
				)}
				<div>
					<div className='flex items-center gap-2'>
						<p className='font-medium'>Recovery codes</p>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									className='size-8'
									onClick={async () => {
										try {
											await navigator.clipboard.writeText(generated.recoveryCodes.join('\n'));
											toast.success('Recovery codes copied');
										} catch {
											toast.error('Failed to copy recovery codes');
										}
									}}
									size='icon'
									variant='outline'
								>
									<CopyIcon className='size-3' />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Copy recovery codes</TooltipContent>
						</Tooltip>
					</div>
					<p className='mt-2 text-muted-foreground text-xs'>
						Store these in a safe place. Each can be used once.
					</p>
					<div className='mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3'>
						{generated.recoveryCodes.map((code) => (
							<code
								className='rounded border bg-background px-2 py-1 text-center font-mono text-sm'
								key={code}
							>
								{code}
							</code>
						))}
					</div>
				</div>
			</div>
		</div>
	) : null;

	return (
		<div className='space-y-4'>
			<p className='text-sm'>
				Scan this QR code with your authenticator app or enter the setup key manually. Then enter the first
				6-digit code to activate two-factor authentication.
			</p>
			{setupDetails ? (
				setupDetails
			) : (
				<div className='rounded border border-dashed p-4 text-sm text-muted-foreground'>
					Setup details are not available. This should not happen - please try again.
				</div>
			)}
			<Form {...confirmForm}>
				<form className='flex w-fit flex-col gap-3' onSubmit={confirmForm.handleSubmit(handleConfirm)}>
					<FormField
						control={confirmForm.control}
						name='code'
						render={({ field }) => (
							<FormItem>
								<FormLabel>Authenticator code</FormLabel>
								<FormControl>
									<InputOTP
										autoFocus
										disabled={isVerifying}
										maxLength={6}
										onChange={(val) => field.onChange(val)}
										value={field.value || ''}
									>
										<InputOTPGroup>
											{Array.from({ length: 3 }).map((_, index) => (
												<InputOTPSlot index={index} key={`confirm-otp-${index}`} />
											))}
										</InputOTPGroup>
										<InputOTPSeparator />
										<InputOTPGroup>
											{Array.from({ length: 3 }).map((_, index) => (
												<InputOTPSlot index={index + 3} key={`confirm-otp-${index + 3}`} />
											))}
										</InputOTPGroup>
									</InputOTP>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<Button className='w-full' disabled={!generated || isVerifying} type='submit'>
						{isVerifying && <Spinner className='mr-2' />}
						{isVerifying ? 'Enabling…' : 'Confirm & enable'}
					</Button>
				</form>
			</Form>
			<div className='flex flex-wrap gap-2'>
				<Button
					onClick={() => {
						// Note: Better Auth doesn't provide a way to regenerate without disabling first
						// User would need to cancel and start over
						toast.info('To get a new QR code, cancel setup and start again');
					}}
					variant='outline'
				>
					Generate new QR code
				</Button>
				<Button
					disabled={isCancelling}
					onClick={async () => {
						setIsCancelling(true);
						try {
							// Delete the TwoFactor record from the database
							await cancelSetupMutation.mutateAsync();
							syncSetup(null);
							await onRefetch();
							toast.success('Two-factor setup cancelled');
						} catch (err) {
							toast.error('Failed to cancel setup');
						} finally {
							setIsCancelling(false);
						}
					}}
					variant='ghost'
				>
					{isCancelling && <Spinner className='mr-2' />}
					{isCancelling ? 'Cancelling…' : 'Cancel setup'}
				</Button>
			</div>
			{setupError ? <p className='text-destructive text-sm'>{setupError}</p> : null}
		</div>
	);
}
