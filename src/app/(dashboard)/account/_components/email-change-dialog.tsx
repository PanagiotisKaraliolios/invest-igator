'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { EmailChangeForm } from './email-change-form';

export function EmailChangeDialog() {
	const [open, setOpen] = useState(false);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger asChild>
				<Button variant='outline'>Change email</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Change email securely</DialogTitle>
					<DialogDescription>
						Enter a new email. If your account has a password, you must confirm it. We’ll send a
						confirmation link to the new email to complete the change.
					</DialogDescription>
				</DialogHeader>
				<EmailChangeForm onDone={() => setOpen(false)} />
				<DialogFooter />
			</DialogContent>
		</Dialog>
	);
}

export default EmailChangeDialog;
