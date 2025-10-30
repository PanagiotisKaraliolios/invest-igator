'use client';

import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface BanUserModalProps {
	isOpen: boolean;
	onConfirm: (reason?: string) => void;
	onOpenChange: (open: boolean) => void;
	userEmail?: string;
}

export function BanUserModal({ isOpen, onConfirm, onOpenChange, userEmail }: BanUserModalProps) {
	const [banReason, setBanReason] = useState('');

	const handleConfirm = () => {
		onConfirm(banReason.trim() || undefined);
		setBanReason(''); // Reset for next use
	};

	const handleCancel = () => {
		setBanReason(''); // Reset on cancel
		onOpenChange(false);
	};

	return (
		<AlertDialog onOpenChange={onOpenChange} open={isOpen}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Ban User</AlertDialogTitle>
					<AlertDialogDescription>
						{userEmail
							? `Are you sure you want to ban ${userEmail}? This will prevent them from accessing their account.`
							: 'Are you sure you want to ban this user? This will prevent them from accessing their account.'}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className='space-y-2 py-4'>
					<Label htmlFor='ban-reason'>Reason (optional)</Label>
					<Textarea
						data-testid='ban-reason-input'
						id='ban-reason'
						onChange={(e) => setBanReason(e.target.value)}
						placeholder='Enter a reason for banning this user...'
						rows={3}
						value={banReason}
					/>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
					<AlertDialogAction data-testid='confirm-ban-button' onClick={handleConfirm}>
						Ban User
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
