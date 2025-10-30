'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Plus } from 'lucide-react';
import { useState } from 'react';
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
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
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

const createApiKeySchema = z.object({
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

type CreateApiKeyFormValues = z.infer<typeof createApiKeySchema>;

interface CreateApiKeyDialogProps {
	onSuccess: (apiKey: string, name: string | null) => void;
}

export function CreateApiKeyDialog({ onSuccess }: CreateApiKeyDialogProps) {
	const [open, setOpen] = useState(false);
	const [permissionTemplate, setPermissionTemplate] = useState<PermissionTemplate>('full-access');
	const [customPermissions, setCustomPermissions] = useState<Record<string, string[]>>({});
	const utils = api.useUtils();

	const form = useForm<CreateApiKeyFormValues>({
		defaultValues: {
			expiresIn: '2592000', // 30 days
			name: '',
			permissionTemplate: 'full-access',
			prefix: '',
			rateLimitEnabled: false,
			rateLimitMax: '100',
			rateLimitTimeWindow: '3600000' // 1 hour
		},
		resolver: zodResolver(createApiKeySchema)
	});

	const createMutation = api.apiKeys.create.useMutation({
		onError: (error) => {
			toast.error(error.message);
		},
		onSuccess: (data) => {
			toast.success('API key created successfully');
			void utils.apiKeys.list.invalidate();
			setOpen(false);
			form.reset();
			// Reset permission state
			setPermissionTemplate('full-access');
			setCustomPermissions({});
			onSuccess(data.key, data.name);
		}
	});

	const onSubmit = (values: CreateApiKeyFormValues) => {
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

	const rateLimitEnabled = form.watch('rateLimitEnabled');

	const handleOpenChange = (newOpen: boolean) => {
		setOpen(newOpen);
		// Reset form and state when dialog closes
		if (!newOpen) {
			form.reset();
			setPermissionTemplate('full-access');
			setCustomPermissions({});
		}
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogTrigger asChild>
				<Button data-testid='create-api-key-button'>
					<Plus className='mr-2 h-4 w-4' />
					Create API Key
				</Button>
			</DialogTrigger>
			<DialogContent className='sm:max-w-[500px] max-h-[90vh] overflow-y-auto'>
				<DialogHeader>
					<DialogTitle>Create API Key</DialogTitle>
					<DialogDescription>Create a new API key for programmatic access to your account.</DialogDescription>
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
										<Input placeholder='My API Key' {...field} data-testid='api-key-name-input' />
									</FormControl>
									<FormDescription>A descriptive name to identify this key</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name='prefix'
							render={({ field }) => (
								<FormItem>
									<FormLabel>Prefix (Optional)</FormLabel>
									<FormControl>
										<Input placeholder='proj_' {...field} data-testid='api-key-prefix-input' />
									</FormControl>
									<FormDescription>
										Optional prefix for easier identification (e.g., &quot;proj_&quot;)
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name='expiresIn'
							render={({ field }) => (
								<FormItem>
									<FormLabel>Expiration</FormLabel>
									<Select defaultValue={field.value} onValueChange={field.onChange}>
										<FormControl>
											<SelectTrigger data-testid='api-key-expiration-select'>
												<SelectValue placeholder='Select expiration' />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value='604800'>7 days</SelectItem>
											<SelectItem value='2592000'>30 days</SelectItem>
											<SelectItem value='7776000'>90 days</SelectItem>
											<SelectItem value='15552000'>180 days</SelectItem>
											<SelectItem value='31536000'>1 year</SelectItem>
											<SelectItem value='never'>Never</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>When this key will expire and become invalid</FormDescription>
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
											defaultValue={field.value}
											onValueChange={(value) => {
												field.onChange(value);
												handlePermissionTemplateChange(value as PermissionTemplate);
											}}
										>
											<FormControl>
												<SelectTrigger data-testid='permission-template-select'>
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
										<Checkbox
											checked={field.value}
											data-testid='rate-limit-checkbox'
											onCheckedChange={field.onChange}
										/>
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
												<Input
													placeholder='100'
													type='number'
													{...field}
													data-testid='rate-limit-max-input'
												/>
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
													<SelectTrigger data-testid='rate-limit-window-select'>
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
								disabled={createMutation.isPending}
								onClick={() => setOpen(false)}
								type='button'
								variant='outline'
							>
								Cancel
							</Button>
							<Button data-testid='submit-api-key' disabled={createMutation.isPending} type='submit'>
								{createMutation.isPending && <Spinner className='mr-2' />}
								{createMutation.isPending ? 'Creating...' : 'Create Key'}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
