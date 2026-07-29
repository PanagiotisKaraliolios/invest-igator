'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { BadgeCheck, KeyRound, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
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
import type { AiCredentialView } from '@/server/api/routers/ai-credentials';
import { api } from '@/trpc/react';
import { ModelSetField } from './model-set-field';

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
		enabledModelIds: z
			.array(z.string().min(1))
			.min(1, 'Enable at least one model')
			// Mirrors the server bound (`createInput.enabledModelIds` in ai-credentials.ts, and
			// `MAX_MODELS` in list-models.ts) — without this, 150 selected models pass client
			// validation and die with an opaque zod error from the server instead of this message.
			.max(100, 'At most 100 models'),
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
// `provider`, `enabledModelIds`, and `defaultModelId` MUST have defaults here
// (baseui-controlled-uncontrolled) — but the defaults must NOT pre-select a model. A
// seeded chip survives a provider switch (it is not in the newly-fetched list, so nothing
// removes it), so the primary-repair logic in the models Combobox's `onValueChange` never
// fires for it, the server probes the NEW provider with the OLD provider's model id, and
// the user sees "The provider rejected this credential" for a chip they never added.
const DEFAULTS: Partial<FormValues> = {
	defaultModelId: '',
	enabledModelIds: [],
	provider: 'AZURE'
};

export function AiCredentialsCard() {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [toDelete, setToDelete] = useState<string | null>(null);

	// Kept separate from the add dialog's `useForm` state so the two dialogs cannot corrupt
	// each other — opening "Edit" must not touch the add form, and vice versa.
	const [editing, setEditing] = useState<AiCredentialView | null>(null);
	const [editModels, setEditModels] = useState<string[]>([]);
	const [editPrimary, setEditPrimary] = useState('');
	const [editQuery, setEditQuery] = useState('');
	const [editFetched, setEditFetched] = useState<string[]>([]);

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

	const listStoredModelsMutation = api.aiCredentials.listStoredModels.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: (result) => {
			if (!result.supported) {
				toast.info('Model listing is not available for this provider — type the model id instead.');
				return;
			}
			setEditFetched(result.models);
			toast.success(
				result.models.length > 0
					? `Found ${result.models.length} model(s)`
					: 'The provider returned no models — you can still type an id.'
			);
		}
	});

	const updateModelsMutation = api.aiCredentials.updateModels.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: () => {
			toast.success('Models updated');
			void utils.aiCredentials.list.invalidate();
			setEditing(null);
		}
	});

	// A pre-migration row can have an empty `enabledModelIds` — seed from `[defaultModelId]`
	// so it still edits sensibly instead of opening on an empty chooser.
	const openEdit = (credential: AiCredentialView) => {
		const seeded = credential.enabledModelIds.length > 0 ? credential.enabledModelIds : [credential.defaultModelId];
		setEditing(credential);
		setEditModels(seeded);
		setEditPrimary(credential.defaultModelId);
		setEditQuery('');
		setEditFetched([]);
	};

	const closeEdit = () => {
		setEditing(null);
		setEditQuery('');
		setEditFetched([]);
	};

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
							<div className='flex items-center gap-1'>
								<Button
									aria-label={`Edit ${PROVIDERS[credential.provider]} models`}
									onClick={() => openEdit(credential)}
									size='icon'
									variant='ghost'
								>
									<Pencil className='size-4' />
								</Button>
								<Button
									aria-label={`Delete ${PROVIDERS[credential.provider]} key`}
									onClick={() => setToDelete(credential.id)}
									size='icon'
									variant='ghost'
								>
									<Trash2 className='size-4' />
								</Button>
							</div>
						</div>
					))
				)}
			</CardContent>

			<Dialog
				onOpenChange={(open) => {
					setDialogOpen(open);
					// Escape / overlay-click / the X close the dialog through THIS handler, not
					// through the Cancel button — cleanup must live here too, or those paths leave
					// the previous provider's fetched list for the next "Add key".
					if (!open) {
						setFetchedModels([]);
						setModelQuery('');
					}
				}}
				open={dialogOpen}
			>
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
									onValueChange={(value) => {
										setValue('provider', value as FormValues['provider']);
										// A different provider invalidates every model choice made so far — the
										// enabled/primary ids belonged to the OLD provider, and a stale
										// `fetchedModels` list from the old provider would otherwise keep being
										// offered (rendered untagged, so it looks authoritative).
										setValue('enabledModelIds', [], { shouldValidate: false });
										setValue('defaultModelId', '', { shouldValidate: false });
										setFetchedModels([]);
										setModelQuery('');
									}}
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

							<ModelSetField
								canListModels={canListModels}
								defaultModelId={defaultModelId}
								enabledModelIds={enabledModelIds}
								error={<FieldError errors={[errors.enabledModelIds, errors.defaultModelId]} />}
								fetchDisabled={
									!canListModels ||
									listModelsMutation.isPending ||
									(watch('secret') ?? '').length < 8 ||
									(provider === 'OPENAI_COMPATIBLE' && !watch('baseURL'))
								}
								fetchedModels={fetchedModels}
								fetching={listModelsMutation.isPending}
								idPrefix='byok'
								modelQuery={modelQuery}
								onEnabledChange={(next) => {
									setValue('enabledModelIds', next, { shouldValidate: true });
									// Keep the primary valid: default to the first enabled model.
									if (next.length > 0 && !next.includes(getValues('defaultModelId'))) {
										setValue('defaultModelId', next[0] as string, { shouldValidate: true });
									}
								}}
								onFetch={() =>
									listModelsMutation.mutate({
										baseURL: watch('baseURL') || undefined,
										provider,
										secret: watch('secret')
									})
								}
								onModelQueryChange={setModelQuery}
								onPrimaryChange={(value) => setValue('defaultModelId', value)}
							/>

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

			{/*
			 * No provider select and no API-key field here — the stored key is reused, so the
			 * server never needs the browser to re-send a secret it does not have.
			 */}
			<Dialog
				onOpenChange={(open) => {
					if (!open) closeEdit();
				}}
				open={editing !== null}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit {editing ? PROVIDERS[editing.provider] : ''} models</DialogTitle>
						<DialogDescription>
							The saved key is reused — it is never sent to the browser. The new primary model is
							re-verified with the provider on save.
						</DialogDescription>
					</DialogHeader>

					{editing ? (
						<div className='space-y-4 py-4'>
							<ModelSetField
								canListModels={MODEL_LISTING_PROVIDERS.has(editing.provider)}
								defaultModelId={editPrimary}
								enabledModelIds={editModels}
								fetchDisabled={!MODEL_LISTING_PROVIDERS.has(editing.provider)}
								fetchedModels={editFetched}
								fetching={listStoredModelsMutation.isPending}
								idPrefix='edit'
								modelQuery={editQuery}
								onEnabledChange={(next) => {
									setEditModels(next);
									// Keep the primary valid: default to the first enabled model.
									if (next.length > 0 && !next.includes(editPrimary)) {
										setEditPrimary(next[0] as string);
									}
								}}
								onFetch={() => listStoredModelsMutation.mutate({ provider: editing.provider })}
								onModelQueryChange={setEditQuery}
								onPrimaryChange={setEditPrimary}
							/>
						</div>
					) : null}

					<DialogFooter>
						<Button onClick={closeEdit} type='button' variant='outline'>
							Cancel
						</Button>
						<Button
							disabled={
								updateModelsMutation.isPending ||
								editModels.length === 0 ||
								!editModels.includes(editPrimary)
							}
							onClick={() => {
								if (!editing) return;
								updateModelsMutation.mutate({
									defaultModelId: editPrimary,
									enabledModelIds: editModels,
									provider: editing.provider
								});
							}}
							type='button'
						>
							{updateModelsMutation.isPending ? <Spinner /> : null}
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
