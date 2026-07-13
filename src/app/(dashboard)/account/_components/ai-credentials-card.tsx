'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { BadgeCheck, KeyRound, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/trpc/react';

const PROVIDERS = {
	ANTHROPIC: 'Anthropic',
	AZURE: 'Azure OpenAI',
	GOOGLE: 'Google',
	OPENAI: 'OpenAI',
	OPENAI_COMPATIBLE: 'OpenAI-compatible'
} as const;

const formSchema = z.object({
	apiVersion: z.string().optional(),
	baseURL: z.string().optional(),
	defaultModelId: z.string().min(1, 'The real model id is required — this is what we price on'),
	deployment: z.string().optional(),
	label: z.string().optional(),
	provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE']),
	resourceName: z.string().optional(),
	secret: z.string().min(8, 'Enter your API key')
});

type FormValues = z.infer<typeof formSchema>;

// Base UI form controls error when a controlled value flips undefined -> defined, so
// `provider` MUST have a default here (see baseui-controlled-uncontrolled lesson).
const DEFAULTS: Partial<FormValues> = { defaultModelId: 'gpt-5.4-mini', provider: 'AZURE' };

export function AiCredentialsCard() {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [toDelete, setToDelete] = useState<string | null>(null);

	const utils = api.useUtils();
	const { data: credentials, isLoading } = api.aiCredentials.list.useQuery();

	const {
		formState: { errors },
		handleSubmit,
		register,
		reset,
		setValue,
		watch
	} = useForm<FormValues>({
		defaultValues: DEFAULTS,
		resolver: zodResolver(formSchema)
	});

	const provider = watch('provider');

	const createMutation = api.aiCredentials.create.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: () => {
			toast.success('Credential verified and saved');
			void utils.aiCredentials.list.invalidate();
			setDialogOpen(false);
			reset(DEFAULTS);
		}
	});

	const deleteMutation = api.aiCredentials.delete.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: () => {
			toast.success('Credential deleted');
			void utils.aiCredentials.list.invalidate();
			setToDelete(null);
		}
	});

	const onSubmit = (values: FormValues) => {
		createMutation.mutate({
			apiVersion: values.apiVersion || undefined,
			baseURL: values.baseURL || undefined,
			defaultModelId: values.defaultModelId,
			deployment: values.deployment || undefined,
			label: values.label || undefined,
			provider: values.provider,
			resourceName: values.resourceName || undefined,
			secret: values.secret
		});
	};

	return (
		<Card>
			<CardHeader className='flex flex-row items-start justify-between gap-4'>
				<div>
					<CardTitle className='flex items-center gap-2'>
						<KeyRound className='size-4' />
						AI provider keys
					</CardTitle>
					<CardDescription>
						Bring your own key. Keys are encrypted at rest, never shown again, and never sent to the
						browser. A key you supply is billed to you and bypasses the platform quota — the same guardrails
						and the same data access rules still apply.
					</CardDescription>
				</div>
				<Button onClick={() => setDialogOpen(true)} size='sm'>
					<Plus className='size-4' />
					Add key
				</Button>
			</CardHeader>

			<CardContent className='space-y-3'>
				{isLoading ? (
					<>
						<Skeleton className='h-16 w-full' />
						<Skeleton className='h-16 w-full' />
					</>
				) : !credentials || credentials.length === 0 ? (
					<p className='text-muted-foreground text-sm'>
						No provider keys. Without one, AI features use the platform key and count against your quota.
					</p>
				) : (
					credentials.map((credential) => (
						<div
							className='flex items-center justify-between gap-4 rounded-md border p-3'
							key={credential.id}
						>
							<div className='min-w-0 space-y-1'>
								<div className='flex flex-wrap items-center gap-2'>
									<span className='font-medium'>{PROVIDERS[credential.provider]}</span>
									<Badge variant='outline'>{credential.defaultModelId}</Badge>
									{credential.lastVerifiedAt ? (
										<Badge variant='secondary'>
											<BadgeCheck className='size-3' />
											Verified {format(credential.lastVerifiedAt, 'd MMM yyyy')}
										</Badge>
									) : (
										<Badge variant='destructive'>
											<ShieldAlert className='size-3' />
											Never verified
										</Badge>
									)}
								</div>
								<p className='text-muted-foreground truncate text-xs'>
									{credential.hint ??
										'Key cannot be read — the encryption key that sealed it was retired.'}
									{credential.deployment ? ` · deployment ${credential.deployment}` : ''}
									{credential.resourceName ? ` · ${credential.resourceName}` : ''}
								</p>
							</div>
							<Button
								aria-label={`Delete ${PROVIDERS[credential.provider]} key`}
								onClick={() => setToDelete(credential.id)}
								size='icon'
								variant='ghost'
							>
								<Trash2 className='size-4' />
							</Button>
						</div>
					))
				)}
			</CardContent>

			<Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
				<DialogContent>
					<form onSubmit={handleSubmit(onSubmit)}>
						<DialogHeader>
							<DialogTitle>Add a provider key</DialogTitle>
							<DialogDescription>
								We send one small request to the provider before saving. If it fails, nothing is stored.
							</DialogDescription>
						</DialogHeader>

						<div className='space-y-4 py-4'>
							<Field>
								<FieldLabel htmlFor='byok-provider'>Provider</FieldLabel>
								<Select
									items={PROVIDERS}
									onValueChange={(value) => setValue('provider', value as FormValues['provider'])}
									value={provider}
								>
									<SelectTrigger className='w-full' id='byok-provider'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Object.entries(PROVIDERS).map(([value, label]) => (
											<SelectItem key={value} value={value}>
												{label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>

							<Field>
								<FieldLabel htmlFor='byok-secret'>API key</FieldLabel>
								<Input autoComplete='off' id='byok-secret' type='password' {...register('secret')} />
								<FieldError errors={[errors.secret]} />
							</Field>

							<Field>
								<FieldLabel htmlFor='byok-model'>Model id</FieldLabel>
								<Input id='byok-model' placeholder='gpt-5.4-mini' {...register('defaultModelId')} />
								<p className='text-muted-foreground text-xs'>
									The real model name. On Azure this is NOT the deployment name — we price on this.
								</p>
								<FieldError errors={[errors.defaultModelId]} />
							</Field>

							{provider === 'AZURE' ? (
								<>
									<Field>
										<FieldLabel htmlFor='byok-resource'>Resource name</FieldLabel>
										<Input
											id='byok-resource'
											placeholder='my-resource'
											{...register('resourceName')}
										/>
										<p className='text-muted-foreground text-xs'>
											Just the name. Paste the full endpoint if you like — we will strip it.
										</p>
									</Field>
									<Field>
										<FieldLabel htmlFor='byok-deployment'>Deployment name</FieldLabel>
										<Input
											id='byok-deployment'
											placeholder='my-deployment'
											{...register('deployment')}
										/>
										<p className='text-muted-foreground text-xs'>
											Azure passes this as the model id. It is often different from the model name
											above.
										</p>
									</Field>
									<Field>
										<FieldLabel htmlFor='byok-apiversion'>API version (optional)</FieldLabel>
										<Input id='byok-apiversion' placeholder='v1' {...register('apiVersion')} />
										<p className='text-muted-foreground text-xs'>
											Leave blank. A date here is the old dialect and will 404.
										</p>
									</Field>
								</>
							) : null}

							{provider === 'OPENAI_COMPATIBLE' || provider === 'OPENAI' || provider === 'ANTHROPIC' ? (
								<Field>
									<FieldLabel htmlFor='byok-baseurl'>
										Base URL{provider === 'OPENAI_COMPATIBLE' ? '' : ' (optional)'}
									</FieldLabel>
									<Input
										id='byok-baseurl'
										placeholder='https://api.example.com'
										{...register('baseURL')}
									/>
								</Field>
							) : null}

							<Field>
								<FieldLabel htmlFor='byok-label'>Label (optional)</FieldLabel>
								<Input id='byok-label' placeholder='Work account' {...register('label')} />
							</Field>
						</div>

						<DialogFooter>
							<Button onClick={() => setDialogOpen(false)} type='button' variant='outline'>
								Cancel
							</Button>
							<Button disabled={createMutation.isPending} type='submit'>
								{createMutation.isPending ? <Spinner /> : null}
								Verify and save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog onOpenChange={(open) => !open && setToDelete(null)} open={toDelete !== null}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this provider key?</AlertDialogTitle>
						<AlertDialogDescription>
							AI features will fall back to the platform key and start counting against your quota.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (toDelete) deleteMutation.mutate({ id: toDelete });
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
