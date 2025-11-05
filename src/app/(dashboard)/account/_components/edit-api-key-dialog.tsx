'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info } from 'lucide-react';
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

const editApiKeySchema = z.object({
	name: z.string().min(1, 'Name is required').max(100),
	permissionTemplate: z.string().optional(),
	rateLimitEnabled: z.boolean().optional(),
	rateLimitMax: z.string().optional(),
	rateLimitTimeWindow: z.string().optional()
});

type EditApiKeyFormValues = z.infer<typeof editApiKeySchema>;

interface EditApiKeyDialogProps {
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
}

export function EditApiKeyDialog({ apiKey, onClose, open }: EditApiKeyDialogProps) {
	const [permissionTemplate, setPermissionTemplate] = useState<PermissionTemplate>('custom');
	const [customPermissions, setCustomPermissions] = useState<Record<string, string[]>>(apiKey.permissions ?? {});
	const utils = api.useUtils();

	// Detect which template matches the current permissions
	useEffect(() => {
		if (apiKey.permissions) {
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
			setPermissionTemplate(matchingTemplate ?? 'custom');
			setCustomPermissions(apiKey.permissions);
		} else {
			setPermissionTemplate('full-access');
			setCustomPermissions({});
		}
	}, [apiKey.permissions]);

	const {
		formState: { errors },
		handleSubmit,
		register,
		reset,
		setValue,
		watch
	} = useForm<EditApiKeyFormValues>({
		defaultValues: {
			name: apiKey.name ?? '',
			permissionTemplate: permissionTemplate,
			rateLimitEnabled: apiKey.rateLimitEnabled,
			rateLimitMax: apiKey.rateLimitMax?.toString() ?? '100',
			rateLimitTimeWindow: apiKey.rateLimitTimeWindow?.toString() ?? '3600000'
		},
		resolver: zodResolver(editApiKeySchema)
	});

	// Update form when apiKey changes
	useEffect(() => {
		reset({
			name: apiKey.name ?? '',
			permissionTemplate: permissionTemplate,
			rateLimitEnabled: apiKey.rateLimitEnabled,
			rateLimitMax: apiKey.rateLimitMax?.toString() ?? '100',
			rateLimitTimeWindow: apiKey.rateLimitTimeWindow?.toString() ?? '3600000'
		});
	}, [apiKey, permissionTemplate, reset]);

	const updateMutation = api.apiKeys.update.useMutation({
		onError: (error) => {
			toast.error(error.message);
		},
		onSuccess: () => {
			toast.success('API key updated successfully');
			void utils.apiKeys.list.invalidate();
			onClose();
		}
	});

	const onSubmit = (values: EditApiKeyFormValues) => {
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
		} else {
			input.rateLimitEnabled = false;
		}

		updateMutation.mutate(input);
	};

	const handlePermissionTemplateChange = (template: PermissionTemplate) => {
		setPermissionTemplate(template);
		if (template !== 'custom') {
			// Apply template permissions
			const templatePermissions = PERMISSION_TEMPLATES[template].permissions;
			setCustomPermissions(
				Object.fromEntries(Object.entries(templatePermissions).map(([key, value]) => [key, [...value]]))
			);
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

	return (
		<Dialog onOpenChange={onClose} open={open}>
			<DialogContent className='sm:max-w-[600px] lg:max-w-[700px] max-h-[90vh] overflow-y-auto'>
				<DialogHeader>
					<DialogTitle>Edit API Key</DialogTitle>
					<DialogDescription>Update the settings for this API key.</DialogDescription>
				</DialogHeader>
				<form className='space-y-3' onSubmit={handleSubmit(onSubmit)}>
					<Field data-invalid={!!errors.name}>
						<FieldLabel htmlFor='edit-api-key-name'>Name</FieldLabel>
						<Input
							{...register('name')}
							aria-invalid={!!errors.name}
							id='edit-api-key-name'
							placeholder='My API Key'
						/>
						<p className='text-sm text-muted-foreground'>A descriptive name to identify this key</p>
						<FieldError errors={[errors.name]} />
					</Field>

					<Separator />

					<div className='space-y-3'>
						<div>
							<Label>Permissions</Label>
							<p className='text-sm text-muted-foreground mt-1'>Control what this API key can access</p>
						</div>

						<Field data-invalid={!!errors.permissionTemplate}>
							<FieldLabel htmlFor='edit-permission-template'>Permission Template</FieldLabel>
							<Select
								onValueChange={(value) => {
									setValue('permissionTemplate', value);
									handlePermissionTemplateChange(value as PermissionTemplate);
								}}
								value={permissionTemplate}
							>
								<SelectTrigger id='edit-permission-template'>
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
																id={`edit-${scope}-${action}`}
																onCheckedChange={() => toggleScopeAction(scope, action)}
															/>
															<label
																className='text-sm cursor-pointer'
																htmlFor={`edit-${scope}-${action}`}
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
							id='edit-rate-limit-enabled'
							onCheckedChange={(checked) => setValue('rateLimitEnabled', !!checked)}
						/>
						<div className='space-y-0.5 leading-none'>
							<Label htmlFor='edit-rate-limit-enabled'>Enable Rate Limiting</Label>
							<p className='text-sm text-muted-foreground'>
								Limit the number of requests per time window
							</p>
						</div>
					</div>

					{rateLimitEnabled && (
						<div className='grid grid-cols-1 lg:grid-cols-2 gap-3 rounded-md border p-3'>
							<Field data-invalid={!!errors.rateLimitMax}>
								<FieldLabel htmlFor='edit-rate-limit-max'>Max Requests</FieldLabel>
								<Input
									{...register('rateLimitMax')}
									aria-invalid={!!errors.rateLimitMax}
									id='edit-rate-limit-max'
									placeholder='100'
									type='number'
								/>
								<p className='text-sm text-muted-foreground'>Maximum number of requests allowed</p>
								<FieldError errors={[errors.rateLimitMax]} />
							</Field>

							<Field data-invalid={!!errors.rateLimitTimeWindow}>
								<FieldLabel htmlFor='edit-rate-limit-window'>Time Window</FieldLabel>
								<Select
									defaultValue={apiKey.rateLimitTimeWindow?.toString() ?? '3600000'}
									onValueChange={(value) => setValue('rateLimitTimeWindow', value)}
								>
									<SelectTrigger id='edit-rate-limit-window'>
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
						<Button disabled={updateMutation.isPending} onClick={onClose} type='button' variant='outline'>
							Cancel
						</Button>
						<Button disabled={updateMutation.isPending} type='submit'>
							{updateMutation.isPending && <Spinner className='mr-2' />}
							{updateMutation.isPending ? 'Updating...' : 'Update Key'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
