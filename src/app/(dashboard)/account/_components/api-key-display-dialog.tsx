'use client';

import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ApiKeyDisplayDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	apiKey: string;
	keyName: string | null;
}

export function ApiKeyDisplayDialog({ open, onOpenChange, apiKey, keyName }: ApiKeyDisplayDialogProps) {
	const [copied, setCopied] = useState(false);
	const [showKey, setShowKey] = useState(true);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(apiKey);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleClose = () => {
		onOpenChange(false);
		setShowKey(true);
		setCopied(false);
	};

	return (
		<Dialog onOpenChange={handleClose} open={open}>
			<DialogContent className='sm:max-w-[600px]'>
				<DialogHeader>
					<DialogTitle>API Key Created</DialogTitle>
					<DialogDescription>
						Save this API key securely. You won&apos;t be able to see it again!
					</DialogDescription>
				</DialogHeader>
				<div className='grid gap-4 py-4'>
					{keyName && (
						<div className='grid gap-2'>
							<Label>Key Name</Label>
							<p className='text-sm text-muted-foreground'>{keyName}</p>
						</div>
					)}
					<div className='grid gap-2'>
						<Label htmlFor='api-key'>Your API Key</Label>
						<div className='flex gap-2'>
							<div className='relative flex-1'>
								<Input
									className='pr-10 font-mono text-sm'
									id='api-key'
									readOnly
									type={showKey ? 'text' : 'password'}
									value={apiKey}
								/>
								<Button
									className='absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent'
									onClick={() => setShowKey(!showKey)}
									size='sm'
									type='button'
									variant='ghost'
								>
									{showKey ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
									<span className='sr-only'>{showKey ? 'Hide' : 'Show'} API key</span>
								</Button>
							</div>
							<Button
								data-testid='copy-api-key'
								onClick={handleCopy}
								size='icon'
								type='button'
								variant='secondary'
							>
								{copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
								<span className='sr-only'>Copy API key</span>
							</Button>
						</div>
					</div>
					<div className='rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950'>
						<p className='text-sm font-medium text-amber-900 dark:text-amber-100'>
							⚠️ Important Security Notice
						</p>
						<ul className='mt-2 list-inside list-disc space-y-1 text-sm text-amber-800 dark:text-amber-200'>
							<li>Store this key in a secure location (e.g., password manager)</li>
							<li>Never commit API keys to version control</li>
							<li>Use environment variables for API keys in your applications</li>
							<li>This key will only be shown once</li>
						</ul>
					</div>
				</div>
				<DialogFooter>
					<Button data-testid='close-dialog' onClick={handleClose} type='button'>
						I&apos;ve Saved My Key
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
