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
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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

	const form = useForm<EditApiKeyFormValues>({
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
		form.reset({
			name: apiKey.name ?? '',
			permissionTemplate: permissionTemplate,
			rateLimitEnabled: apiKey.rateLimitEnabled,
			rateLimitMax: apiKey.rateLimitMax?.toString() ?? '100',
			rateLimitTimeWindow: apiKey.rateLimitTimeWindow?.toString() ?? '3600000'
		});
	}, [apiKey, permissionTemplate, form]);

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

	const rateLimitEnabled = form.watch('rateLimitEnabled');

	return (
		<Dialog onOpenChange={onClose} open={open}>
			<DialogContent className='sm:max-w-[500px] max-h-[90vh] overflow-y-auto'>
				<DialogHeader>
					<DialogTitle>Edit API Key</DialogTitle>
					<DialogDescription>Update the settings for this API key.</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form className='space-y-4' onSubmit={form.handleSubmit(onSubmit)}>
						<FormField
							control={form.control}
							name='name'
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input placeholder='My API Key' {...field} />
									</FormControl>
									<FormDescription>A descriptive name to identify this key</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<Separator />

						<div className='space-y-4'>
							<div>
								<Label>Permissions</Label>
								<p className='text-sm text-muted-foreground mt-1'>
									Control what this API key can access
								</p>
							</div>

							<FormField
								control={form.control}
								name='permissionTemplate'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Permission Template</FormLabel>
										<Select
											defaultValue={permissionTemplate}
											onValueChange={(value) => {
												field.onChange(value);
												handlePermissionTemplateChange(value as PermissionTemplate);
											}}
											value={permissionTemplate}
										>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder='Select permission template' />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{(Object.keys(PERMISSION_TEMPLATES) as PermissionTemplate[]).map(
													(template) => (
														<SelectItem key={template} value={template}>
															{template === 'read-only' && '🔍 Read Only'}
															{template === 'full-access' && '🔓 Full Access'}
															{template === 'portfolio-manager' && '💼 Portfolio Manager'}
															{template === 'custom' && '⚙️ Custom'}
														</SelectItem>
													)
												)}
											</SelectContent>
										</Select>
										<FormDescription>
											{PERMISSION_TEMPLATES[permissionTemplate].description}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							{permissionTemplate === 'custom' && (
								<div className='space-y-3 rounded-md border p-4'>
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
											<div className='space-y-2' key={scope}>
												<Label className='text-sm font-medium'>{config.description}</Label>
												<div className='flex flex-wrap gap-2'>
													{actions.map((action) => {
														const isChecked =
															customPermissions[scope]?.includes(action) ?? false;
														return (
															<div className='flex items-center space-x-2' key={action}>
																<Checkbox
																	checked={isChecked}
																	id={`${scope}-${action}`}
																	onCheckedChange={() =>
																		toggleScopeAction(scope, action)
																	}
																/>
																<label
																	className='text-sm cursor-pointer'
																	htmlFor={`${scope}-${action}`}
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
								<div className='rounded-md border p-4 space-y-2 bg-muted/50'>
									<Label className='text-sm font-medium'>Included Permissions</Label>
									<div className='space-y-1 text-sm text-muted-foreground'>
										{Object.entries(PERMISSION_TEMPLATES[permissionTemplate].permissions).map(
											([scope, actions]) => (
												<div key={scope}>
													<span className='font-medium text-foreground'>
														{PERMISSION_SCOPES[scope as PermissionScope]?.description ??
															scope}
														:
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

						<FormField
							control={form.control}
							name='rateLimitEnabled'
							render={({ field }) => (
								<FormItem className='flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4'>
									<FormControl>
										<Checkbox checked={field.value} onCheckedChange={field.onChange} />
									</FormControl>
									<div className='space-y-1 leading-none'>
										<FormLabel>Enable Rate Limiting</FormLabel>
										<FormDescription>Limit the number of requests per time window</FormDescription>
									</div>
								</FormItem>
							)}
						/>

						{rateLimitEnabled && (
							<div className='space-y-4 rounded-md border p-4'>
								<FormField
									control={form.control}
									name='rateLimitMax'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Max Requests</FormLabel>
											<FormControl>
												<Input placeholder='100' type='number' {...field} />
											</FormControl>
											<FormDescription>Maximum number of requests allowed</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name='rateLimitTimeWindow'
									render={({ field }) => (
										<FormItem>
											<FormLabel>Time Window</FormLabel>
											<Select defaultValue={field.value} onValueChange={field.onChange}>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder='Select time window' />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													<SelectItem value='60000'>1 minute</SelectItem>
													<SelectItem value='300000'>5 minutes</SelectItem>
													<SelectItem value='900000'>15 minutes</SelectItem>
													<SelectItem value='3600000'>1 hour</SelectItem>
													<SelectItem value='86400000'>1 day</SelectItem>
												</SelectContent>
											</Select>
											<FormDescription>Time period for rate limit calculation</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						)}

						<DialogFooter>
							<Button
								disabled={updateMutation.isPending}
								onClick={onClose}
								type='button'
								variant='outline'
							>
								Cancel
							</Button>
							<Button disabled={updateMutation.isPending} type='submit'>
								{updateMutation.isPending ? 'Updating...' : 'Update Key'}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
