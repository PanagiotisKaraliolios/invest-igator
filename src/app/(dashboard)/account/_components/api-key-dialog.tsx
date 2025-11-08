'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import {
	PERMISSION_SCOPES,
	PERMISSION_TEMPLATES,
	type PermissionScope,
	type PermissionTemplate
} from '@/lib/api-key-permissions';
import { api } from '@/trpc/react';

const apiKeySchema = z.object({
	expiresIn: z.string().optional(),
	name: z.string().min(1, 'Name is required').max(100),
	permissionTemplate: z.string().optional(),
	prefix: z
		.string()
		.regex(/^[a-zA-Z0-9_-]*$/, 'Invalid prefix format')
		.max(10)
		.optional(),
	rateLimitEnabled: z.boolean().optional(),
	rateLimitMax: z.string().optional(),
	rateLimitTimeWindow: z.string().optional()
});

type ApiKeyFormValues = z.infer<typeof apiKeySchema>;

interface ApiKeyDialogProps {
	mode: 'create' | 'edit';
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (apiKey: string, name: string | null) => void;
	apiKey?: {
		id: string;
		name: string | null;
		enabled: boolean;
		permissions: Record<string, string[]> | null;
		rateLimitEnabled: boolean;
		rateLimitMax: number | null;
		rateLimitTimeWindow: number | null;
	};
}

// Legacy wrapper for create mode with trigger button
interface CreateApiKeyDialogProps {
	onSuccess: (apiKey: string, name: string | null) => void;
}

function ApiKeyDialog({ mode, open, onOpenChange, onSuccess, apiKey }: ApiKeyDialogProps) {
	const utils = api.useUtils();

	// Detect which template matches the current permissions (for edit mode)
	const getInitialTemplate = (): PermissionTemplate => {
		if (mode === 'create' || !apiKey?.permissions) {
			return 'full-access';
		}

		const matchingTemplate = (Object.keys(PERMISSION_TEMPLATES) as PermissionTemplate[]).find((template) => {
			if (template === 'custom') return false;
			const templatePerms = PERMISSION_TEMPLATES[template].permissions;
			const sortedTemplatePerms = JSON.stringify(
				Object.entries(templatePerms)
					.sort()
					.map(([k, v]) => [k, [...v].sort()])
			);
			const sortedCurrentPerms = JSON.stringify(
				Object.entries(apiKey.permissions!)
					.sort()
					.map(([k, v]) => [k, [...v].sort()])
			);
			return sortedTemplatePerms === sortedCurrentPerms;
		});
		return matchingTemplate ?? 'custom';
	};

	const [permissionTemplate, setPermissionTemplate] = useState<PermissionTemplate>(getInitialTemplate());
	const [customPermissions, setCustomPermissions] = useState<Record<string, string[]>>(apiKey?.permissions ?? {});

	const {
		formState: { errors },
		handleSubmit,
		register,
		reset,
		setValue,
		watch
	} = useForm<ApiKeyFormValues>({
		defaultValues: {
			expiresIn: mode === 'create' ? '2592000' : undefined,
			name: apiKey?.name ?? '',
			permissionTemplate: getInitialTemplate(),
			prefix: '',
			rateLimitEnabled: apiKey?.rateLimitEnabled ?? false,
			rateLimitMax: apiKey?.rateLimitMax?.toString() ?? '100',
			rateLimitTimeWindow: apiKey?.rateLimitTimeWindow?.toString() ?? '3600000'
		},
		resolver: zodResolver(apiKeySchema)
	});

	// Update form when apiKey changes (edit mode)
	useEffect(() => {
		if (mode === 'edit' && apiKey) {
			const template = getInitialTemplate();
			setPermissionTemplate(template);
			setCustomPermissions(apiKey.permissions ?? {});
			reset({
				name: apiKey.name ?? '',
				permissionTemplate: template,
				rateLimitEnabled: apiKey.rateLimitEnabled,
				rateLimitMax: apiKey.rateLimitMax?.toString() ?? '100',
				rateLimitTimeWindow: apiKey.rateLimitTimeWindow?.toString() ?? '3600000'
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiKey, mode, reset]);

	const createMutation = api.apiKeys.create.useMutation({
		onError: (error) => {
			toast.error(error.message);
		},
		onSuccess: (data) => {
			toast.success('API key created successfully');
			void utils.apiKeys.list.invalidate();
			onOpenChange(false);
			reset();
			setPermissionTemplate('full-access');
			setCustomPermissions({});
			onSuccess?.(data.key, data.name);
		}
	});

	const updateMutation = api.apiKeys.update.useMutation({
		onError: (error) => {
			toast.error(error.message);
		},
		onSuccess: () => {
			toast.success('API key updated successfully');
			void utils.apiKeys.list.invalidate();
			onOpenChange(false);
		}
	});

	const onSubmit = (values: ApiKeyFormValues) => {
		if (mode === 'create') {
			handleCreateSubmit(values);
		} else {
			handleUpdateSubmit(values);
		}
	};

	const handleCreateSubmit = (values: ApiKeyFormValues) => {
		const input: {
			name: string;
			expiresIn?: number;
			permissions?: Record<string, string[]> | null;
			prefix?: string;
			rateLimitEnabled?: boolean;
			rateLimitMax?: number;
			rateLimitTimeWindow?: number;
		} = {
			name: values.name
		};

		// Only set expiresIn if it's not "never" and is a valid number
		if (values.expiresIn && values.expiresIn !== 'never') {
			input.expiresIn = Number.parseInt(values.expiresIn, 10);
		}

		if (values.prefix) {
			input.prefix = values.prefix;
		}

		// Set permissions based on template or custom selection
		if (permissionTemplate === 'custom') {
			input.permissions = Object.keys(customPermissions).length > 0 ? customPermissions : null;
		} else {
			// Convert readonly arrays to mutable arrays
			const templatePermissions = PERMISSION_TEMPLATES[permissionTemplate].permissions;
			input.permissions = Object.fromEntries(
				Object.entries(templatePermissions).map(([key, value]) => [key, [...value]])
			);
		}

		if (values.rateLimitEnabled) {
			input.rateLimitEnabled = true;
			if (values.rateLimitTimeWindow) {
				input.rateLimitTimeWindow = Number.parseInt(values.rateLimitTimeWindow, 10);
			}
			if (values.rateLimitMax) {
				input.rateLimitMax = Number.parseInt(values.rateLimitMax, 10);
			}
		}

		createMutation.mutate(input);
	};

	const handleUpdateSubmit = (values: ApiKeyFormValues) => {
		if (!apiKey) return;

		const input: {
			keyId: string;
			name: string;
			enabled: boolean;
			permissions?: Record<string, string[]> | null;
			rateLimitEnabled?: boolean;
			rateLimitMax?: number;
			rateLimitTimeWindow?: number;
		} = {
			enabled: apiKey.enabled,
			keyId: apiKey.id,
			name: values.name
		};

		// Set permissions based on template or custom selection
		if (permissionTemplate === 'custom') {
			input.permissions = Object.keys(customPermissions).length > 0 ? customPermissions : null;
		} else {
			const templatePermissions = PERMISSION_TEMPLATES[permissionTemplate].permissions;
			input.permissions = Object.fromEntries(
				Object.entries(templatePermissions).map(([key, value]) => [key, [...value]])
			);
		}

		if (values.rateLimitEnabled) {
			input.rateLimitEnabled = true;
			if (values.rateLimitTimeWindow) {
				input.rateLimitTimeWindow = Number.parseInt(values.rateLimitTimeWindow, 10);
			}
			if (values.rateLimitMax) {
				input.rateLimitMax = Number.parseInt(values.rateLimitMax, 10);
			}
		} else {
			input.rateLimitEnabled = false;
		}

		updateMutation.mutate(input);
	};

	const handlePermissionTemplateChange = (template: PermissionTemplate) => {
		setPermissionTemplate(template);
		if (template !== 'custom') {
			// Reset custom permissions when switching to a preset
			setCustomPermissions({});
		}
	};

	const toggleScopeAction = (scope: PermissionScope, action: string) => {
		setCustomPermissions((prev) => {
			const newPermissions = { ...prev };
			const actions = newPermissions[scope] ?? [];

			if (actions.includes(action)) {
				// Remove action
				const filtered = actions.filter((a) => a !== action);
				if (filtered.length === 0) {
					delete newPermissions[scope];
				} else {
					newPermissions[scope] = filtered;
				}
			} else {
				// Add action
				newPermissions[scope] = [...actions, action];
			}

			return newPermissions;
		});
	};

	const rateLimitEnabled = watch('rateLimitEnabled');
	const isPending = createMutation.isPending || updateMutation.isPending;

	const handleDialogOpenChange = (newOpen: boolean) => {
		onOpenChange(newOpen);
		// Reset form and state when dialog closes
		if (!newOpen && mode === 'create') {
			reset();
			setPermissionTemplate('full-access');
			setCustomPermissions({});
		}
	};

	const idPrefix = mode === 'create' ? 'create' : 'edit';

	return (
		<Dialog onOpenChange={handleDialogOpenChange} open={open}>
			<DialogContent className='sm:max-w-[600px] lg:max-w-[700px] overflow-y-auto'>
				<DialogHeader>
					<DialogTitle>{mode === 'create' ? 'Create API Key' : 'Edit API Key'}</DialogTitle>
					<DialogDescription>
						{mode === 'create'
							? 'Create a new API key for programmatic access to your account.'
							: 'Update the settings for this API key.'}
					</DialogDescription>
				</DialogHeader>
				<form className='space-y-3' onSubmit={handleSubmit(onSubmit)}>
					{mode === 'create' ? (
						<>
							<div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
								<Field data-invalid={!!errors.name}>
									<FieldLabel htmlFor={`${idPrefix}-api-key-name`}>Name</FieldLabel>
									<Input
										{...register('name')}
										aria-invalid={!!errors.name}
										data-testid='api-key-name-input'
										id={`${idPrefix}-api-key-name`}
										placeholder='My API Key'
									/>
									<p className='text-sm text-muted-foreground'>
										A descriptive name to identify this key
									</p>
									<FieldError errors={[errors.name]} />
								</Field>

								<Field data-invalid={!!errors.prefix}>
									<FieldLabel htmlFor={`${idPrefix}-api-key-prefix`}>Prefix (Optional)</FieldLabel>
									<Input
										{...register('prefix')}
										aria-invalid={!!errors.prefix}
										data-testid='api-key-prefix-input'
										id={`${idPrefix}-api-key-prefix`}
										placeholder='proj_'
									/>
									<p className='text-sm text-muted-foreground'>
										Optional prefix for easier identification (e.g., &quot;proj_&quot;)
									</p>
									<FieldError errors={[errors.prefix]} />
								</Field>
							</div>

							<Field data-invalid={!!errors.expiresIn}>
								<FieldLabel htmlFor={`${idPrefix}-api-key-expiration`}>Expiration</FieldLabel>
								<Select defaultValue='2592000' onValueChange={(value) => setValue('expiresIn', value)}>
									<SelectTrigger
										data-testid='api-key-expiration-select'
										id={`${idPrefix}-api-key-expiration`}
									>
										<SelectValue placeholder='Select expiration' />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='604800'>7 days</SelectItem>
										<SelectItem value='2592000'>30 days</SelectItem>
										<SelectItem value='7776000'>90 days</SelectItem>
										<SelectItem value='15552000'>180 days</SelectItem>
										<SelectItem value='31536000'>1 year</SelectItem>
										<SelectItem value='never'>Never</SelectItem>
									</SelectContent>
								</Select>
								<p className='text-sm text-muted-foreground'>
									When this key will expire and become invalid
								</p>
								<FieldError errors={[errors.expiresIn]} />
							</Field>
						</>
					) : (
						<Field data-invalid={!!errors.name}>
							<FieldLabel htmlFor={`${idPrefix}-api-key-name`}>Name</FieldLabel>
							<Input
								{...register('name')}
								aria-invalid={!!errors.name}
								id={`${idPrefix}-api-key-name`}
								placeholder='My API Key'
							/>
							<p className='text-sm text-muted-foreground'>A descriptive name to identify this key</p>
							<FieldError errors={[errors.name]} />
						</Field>
					)}

					<Separator />

					<div className='space-y-3'>
						<div>
							<Label>Permissions</Label>
							<p className='text-sm text-muted-foreground mt-1'>Control what this API key can access</p>
						</div>

						<Field data-invalid={!!errors.permissionTemplate}>
							<FieldLabel htmlFor={`${idPrefix}-permission-template`}>Permission Template</FieldLabel>
							<Select
								onValueChange={(value) => {
									setValue('permissionTemplate', value);
									handlePermissionTemplateChange(value as PermissionTemplate);
								}}
								value={permissionTemplate}
							>
								<SelectTrigger
									data-testid='permission-template-select'
									id={`${idPrefix}-permission-template`}
								>
									<SelectValue placeholder='Select permission template' />
								</SelectTrigger>
								<SelectContent>
									{(Object.keys(PERMISSION_TEMPLATES) as PermissionTemplate[]).map((template) => (
										<SelectItem key={template} value={template}>
											{template === 'read-only' && '🔍 Read Only'}
											{template === 'full-access' && '🔓 Full Access'}
											{template === 'portfolio-manager' && '💼 Portfolio Manager'}
											{template === 'custom' && '⚙️ Custom'}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className='text-sm text-muted-foreground'>
								{PERMISSION_TEMPLATES[permissionTemplate].description}
							</p>
							<FieldError errors={[errors.permissionTemplate]} />
						</Field>

						{permissionTemplate === 'custom' && (
							<div className='space-y-2 rounded-md border p-3'>
								<div className='flex items-center gap-2 text-sm text-muted-foreground'>
									<Info className='h-4 w-4' />
									<span>Select specific permissions for this key</span>
								</div>
								{(
									Object.entries(PERMISSION_SCOPES) as [
										PermissionScope,
										(typeof PERMISSION_SCOPES)[PermissionScope]
									][]
								).map(([scope, config]) => {
									const actions = config.actions as readonly string[];
									return (
										<div className='space-y-1.5' key={scope}>
											<Label className='text-sm font-medium'>{config.description}</Label>
											<div className='flex flex-wrap gap-2'>
												{actions.map((action) => {
													const isChecked =
														customPermissions[scope]?.includes(action) ?? false;
													return (
														<div className='flex items-center space-x-2' key={action}>
															<Checkbox
																checked={isChecked}
																id={`${idPrefix}-${scope}-${action}`}
																onCheckedChange={() => toggleScopeAction(scope, action)}
															/>
															<label
																className='text-sm cursor-pointer'
																htmlFor={`${idPrefix}-${scope}-${action}`}
															>
																{action}
															</label>
														</div>
													);
												})}
											</div>
										</div>
									);
								})}
							</div>
						)}

						{permissionTemplate !== 'custom' && (
							<div className='rounded-md border p-3 space-y-1.5 bg-muted/50'>
								<Label className='text-sm font-medium'>Included Permissions</Label>
								<div className='space-y-0.5 text-sm text-muted-foreground'>
									{Object.entries(PERMISSION_TEMPLATES[permissionTemplate].permissions).map(
										([scope, actions]) => (
											<div key={scope}>
												<span className='font-medium text-foreground'>
													{PERMISSION_SCOPES[scope as PermissionScope]?.description ?? scope}:
												</span>{' '}
												{[...actions].join(', ')}
											</div>
										)
									)}
								</div>
							</div>
						)}
					</div>

					<Separator />

					<div className='flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3'>
						<Checkbox
							checked={rateLimitEnabled}
							data-testid='rate-limit-checkbox'
							id={`${idPrefix}-rate-limit-enabled`}
							onCheckedChange={(checked) => setValue('rateLimitEnabled', !!checked)}
						/>
						<div className='space-y-0.5 leading-none'>
							<Label htmlFor={`${idPrefix}-rate-limit-enabled`}>Enable Rate Limiting</Label>
							<p className='text-sm text-muted-foreground'>
								Limit the number of requests per time window
							</p>
						</div>
					</div>

					{rateLimitEnabled && (
						<div className='grid grid-cols-1 lg:grid-cols-2 gap-3 rounded-md border p-3'>
							<Field data-invalid={!!errors.rateLimitMax}>
								<FieldLabel htmlFor={`${idPrefix}-rate-limit-max`}>Max Requests</FieldLabel>
								<Input
									{...register('rateLimitMax')}
									aria-invalid={!!errors.rateLimitMax}
									data-testid='rate-limit-max-input'
									id={`${idPrefix}-rate-limit-max`}
									placeholder='100'
									type='number'
								/>
								<p className='text-sm text-muted-foreground'>Maximum number of requests allowed</p>
								<FieldError errors={[errors.rateLimitMax]} />
							</Field>

							<Field data-invalid={!!errors.rateLimitTimeWindow}>
								<FieldLabel htmlFor={`${idPrefix}-rate-limit-window`}>Time Window</FieldLabel>
								<Select
									defaultValue={apiKey?.rateLimitTimeWindow?.toString() ?? '3600000'}
									onValueChange={(value) => setValue('rateLimitTimeWindow', value)}
								>
									<SelectTrigger
										data-testid='rate-limit-window-select'
										id={`${idPrefix}-rate-limit-window`}
									>
										<SelectValue placeholder='Select time window' />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='60000'>1 minute</SelectItem>
										<SelectItem value='300000'>5 minutes</SelectItem>
										<SelectItem value='900000'>15 minutes</SelectItem>
										<SelectItem value='3600000'>1 hour</SelectItem>
										<SelectItem value='86400000'>1 day</SelectItem>
									</SelectContent>
								</Select>
								<p className='text-sm text-muted-foreground'>Time period for rate limit calculation</p>
								<FieldError errors={[errors.rateLimitTimeWindow]} />
							</Field>
						</div>
					)}

					<DialogFooter>
						<Button
							disabled={isPending}
							onClick={() => onOpenChange(false)}
							type='button'
							variant='outline'
						>
							Cancel
						</Button>
						<Button data-testid='submit-api-key' disabled={isPending} type='submit'>
							{isPending && <Spinner className='mr-2' />}
							{mode === 'create'
								? isPending
									? 'Creating...'
									: 'Create Key'
								: isPending
									? 'Updating...'
									: 'Update Key'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// Legacy wrapper for create mode with trigger button
export function CreateApiKeyDialog({ onSuccess }: CreateApiKeyDialogProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button data-testid='create-api-key-button' onClick={() => setOpen(true)}>
				<Plus className='mr-2 h-4 w-4' />
				Create API Key
			</Button>
			<ApiKeyDialog mode='create' onOpenChange={setOpen} onSuccess={onSuccess} open={open} />
		</>
	);
}

// New export for edit mode
export function EditApiKeyDialog({
	apiKey,
	onClose,
	open
}: {
	apiKey: {
		id: string;
		name: string | null;
		enabled: boolean;
		permissions: Record<string, string[]> | null;
		rateLimitEnabled: boolean;
		rateLimitMax: number | null;
		rateLimitTimeWindow: number | null;
	};
	onClose: () => void;
	open: boolean;
}) {
	return <ApiKeyDialog apiKey={apiKey} mode='edit' onOpenChange={onClose} open={open} />;
}
