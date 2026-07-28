'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { BadgeCheck, Download, KeyRound, Plus, ShieldAlert, Trash2 } from 'lucide-react';
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
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxValue
} from '@/components/ui/combobox';
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

const formSchema = z
	.object({
		apiVersion: z.string().optional(),
		baseURL: z.string().optional(),
		defaultModelId: z.string().min(1, 'Pick a primary model'),
		deployment: z.string().optional(),
		enabledModelIds: z.array(z.string().min(1)).min(1, 'Enable at least one model'),
		label: z.string().optional(),
		provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE']),
		resourceName: z.string().optional(),
		secret: z.string().min(8, 'Enter your API key')
	})
	.refine((value) => value.enabledModelIds.includes(value.defaultModelId), {
		message: 'The primary model must be one of the enabled models',
		path: ['defaultModelId']
	});

type FormValues = z.infer<typeof formSchema>;

/** Providers that expose a model list. Azure lists deployments, not models. */
const MODEL_LISTING_PROVIDERS = new Set<FormValues['provider']>(['ANTHROPIC', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE']);

// Base UI form controls error when a controlled value flips undefined -> defined, so
// `provider` and `enabledModelIds` MUST have defaults here (baseui-controlled-uncontrolled).
const DEFAULTS: Partial<FormValues> = {
	defaultModelId: 'gpt-5.4-mini',
	enabledModelIds: ['gpt-5.4-mini'],
	provider: 'AZURE'
};

export function AiCredentialsCard() {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [toDelete, setToDelete] = useState<string | null>(null);

	const utils = api.useUtils();
	const { data: credentials, isLoading } = api.aiCredentials.list.useQuery();

	const {
		formState: { errors },
		getValues,
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

	const [modelQuery, setModelQuery] = useState('');
	const [fetchedModels, setFetchedModels] = useState<string[]>([]);

	const enabledModelIds = watch('enabledModelIds') ?? [];
	const defaultModelId = watch('defaultModelId');
	const canListModels = MODEL_LISTING_PROVIDERS.has(provider);

	const listModelsMutation = api.aiCredentials.listModels.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: (result) => {
			if (!result.supported) {
				toast.info('Model listing is not available for this provider — type the model id instead.');
				return;
			}
			setFetchedModels(result.models);
			toast.success(
				result.models.length > 0
					? `Found ${result.models.length} model(s)`
					: 'The provider returned no models — you can still type an id.'
			);
		}
	});

	// The typed text becomes a selectable row when it is not already a known model, so a
	// custom/unlisted id can always be added without a separate free-text field.
	const trimmedQuery = modelQuery.trim();
	const modelItems =
		trimmedQuery !== '' && !fetchedModels.includes(trimmedQuery) ? [...fetchedModels, trimmedQuery] : fetchedModels;

	const createMutation = api.aiCredentials.create.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: () => {
			toast.success('Credential verified and saved');
			void utils.aiCredentials.list.invalidate();
			setDialogOpen(false);
			reset(DEFAULTS);
			setFetchedModels([]);
			setModelQuery('');
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
			enabledModelIds: values.enabledModelIds,
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
									{(credential.enabledModelIds.length > 0
										? credential.enabledModelIds
										: [credential.defaultModelId]
									).map((model) => (
										<Badge
											key={model}
											variant={model === credential.defaultModelId ? 'default' : 'outline'}
										>
											{model}
										</Badge>
									))}
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
								<div className='flex items-center justify-between gap-2'>
									<FieldLabel htmlFor='byok-model'>Models</FieldLabel>
									<Button
										disabled={
											!canListModels ||
											listModelsMutation.isPending ||
											(watch('secret') ?? '').length < 8 ||
											(provider === 'OPENAI_COMPATIBLE' && !watch('baseURL'))
										}
										onClick={() =>
											listModelsMutation.mutate({
												baseURL: watch('baseURL') || undefined,
												provider,
												secret: watch('secret')
											})
										}
										size='sm'
										type='button'
										variant='outline'
									>
										{listModelsMutation.isPending ? <Spinner /> : <Download className='size-4' />}
										Fetch models
									</Button>
								</div>

								<Combobox
									inputValue={modelQuery}
									items={modelItems}
									multiple
									onInputValueChange={setModelQuery}
									onValueChange={(next: string[]) => {
										setValue('enabledModelIds', next, { shouldValidate: true });
										// Keep the primary valid: default to the first enabled model.
										if (next.length > 0 && !next.includes(getValues('defaultModelId'))) {
											setValue('defaultModelId', next[0] as string, { shouldValidate: true });
										}
										setModelQuery('');
									}}
									value={enabledModelIds}
								>
									<ComboboxChips>
										<ComboboxValue>
											{(value: string[]) => (
												<>
													{value.map((model) => (
														<ComboboxChip aria-label={model} key={model}>
															{model}
														</ComboboxChip>
													))}
													<ComboboxChipsInput
														id='byok-model'
														placeholder={value.length > 0 ? '' : 'gpt-5.4-mini'}
													/>
												</>
											)}
										</ComboboxValue>
									</ComboboxChips>
									<ComboboxContent>
										<ComboboxEmpty>Type a model id to add it.</ComboboxEmpty>
										<ComboboxList>
											{(item: string) => (
												<ComboboxItem key={item} value={item}>
													{item}
													{!fetchedModels.includes(item) ? (
														<span className='ml-auto text-muted-foreground text-xs'>
															custom
														</span>
													) : null}
												</ComboboxItem>
											)}
										</ComboboxList>
									</ComboboxContent>
								</Combobox>

								<p className='text-muted-foreground text-xs'>
									{canListModels
										? 'Fetch the list, or type any model id to add it. One key often serves several models.'
										: 'Azure lists deployments rather than models — type the model id. This is NOT the deployment name.'}
								</p>
								<p className='text-muted-foreground text-xs'>
									A model we have no published price for is recorded as an unknown-price call.
								</p>
								<FieldError errors={[errors.enabledModelIds, errors.defaultModelId]} />
							</Field>

							{enabledModelIds.length > 1 ? (
								<Field>
									<FieldLabel htmlFor='byok-primary'>Primary model</FieldLabel>
									<Select
										onValueChange={(value) => setValue('defaultModelId', value as string)}
										value={defaultModelId}
									>
										<SelectTrigger className='w-full' id='byok-primary'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{enabledModelIds.map((model) => (
												<SelectItem key={model} value={model}>
													{model}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<p className='text-muted-foreground text-xs'>
										Used when a request does not name a model — and the one we verify on save.
									</p>
								</Field>
							) : null}

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
							<Button
								onClick={() => {
									setDialogOpen(false);
									setFetchedModels([]);
									setModelQuery('');
								}}
								type='button'
								variant='outline'
							>
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
