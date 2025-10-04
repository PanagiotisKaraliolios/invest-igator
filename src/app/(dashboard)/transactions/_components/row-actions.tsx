'use client';

import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/trpc/react';
import { TransactionForm, type TransactionFormValues } from './transaction-form';
import type { RowData } from './types';

// RowData moved to ./types

export function RowActions({ row }: { row: RowData }) {
	const [editOpen, setEditOpen] = useState(false);
	const [duplicateOpen, setDuplicateOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const utils = api.useUtils();

	function parseFee(input: unknown): number | undefined {
		if (input == null) return undefined;
		if (typeof input === 'number' && Number.isFinite(input)) return input;
		const s = String(input).trim();
		if (!s) return undefined;
		const n = Number(s);
		return Number.isFinite(n) ? n : undefined;
	}

	const createMutation = api.transactions.create.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to duplicate');
		},
		async onSuccess() {
			toast.success('Transaction duplicated');
			setDuplicateOpen(false);
			await utils.transactions.list.invalidate();
		}
	});

	const updateMutation = api.transactions.update.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to update');
		},
		async onSuccess() {
			toast.success('Transaction updated');
			setEditOpen(false);
			await utils.transactions.list.invalidate();
		}
	});
	const deleteMutation = api.transactions.remove.useMutation({
		onError(err) {
			toast.error(err.message || 'Failed to delete');
		},
		async onSuccess() {
			toast.success('Transaction deleted');
			setDeleteOpen(false);
			await utils.transactions.list.invalidate();
		}
	});

	return (
		<div className='flex justify-end'>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size='icon' variant='ghost'>
						<MoreHorizontal className='size-4' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					<DropdownMenuItem onClick={() => setEditOpen(true)}>Edit</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setDuplicateOpen(true)}>Duplicate</DropdownMenuItem>
					<DropdownMenuItem className='text-destructive' onClick={() => setDeleteOpen(true)}>
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Edit dialog */}
			<Dialog onOpenChange={setEditOpen} open={editOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Transaction</DialogTitle>
					</DialogHeader>
					<TransactionForm
						defaultValues={{
							date: row.date.slice(0, 10),
							fee: row.fee != null ? String(row.fee) : undefined,
							feeCurrency: row.feeCurrency ?? undefined,
							note: row.note ?? undefined,
							price: row.price,
							priceCurrency: row.priceCurrency,
							quantity: row.quantity,
							side: row.side,
							symbol: row.symbol
						}}
						onCancel={() => setEditOpen(false)}
						onSubmit={(vals: TransactionFormValues) =>
							updateMutation.mutate({
								date: vals.date,
								fee: parseFee(vals.fee),
								feeCurrency: vals.feeCurrency,
								id: row.id,
								note: vals.note,
								price: vals.price,
								priceCurrency: vals.priceCurrency,
								quantity: vals.quantity,
								side: vals.side,
								symbol: vals.symbol
							})
						}
						pending={updateMutation.isPending}
					/>
				</DialogContent>
			</Dialog>

			{/* Duplicate dialog */}
			<Dialog onOpenChange={setDuplicateOpen} open={duplicateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Duplicate Transaction</DialogTitle>
					</DialogHeader>
					<TransactionForm
						defaultValues={{
							date: row.date.slice(0, 10),
							fee: row.fee != null ? String(row.fee) : undefined,
							feeCurrency: row.feeCurrency ?? undefined,
							note: row.note ?? undefined,
							price: row.price,
							priceCurrency: row.priceCurrency,
							quantity: row.quantity,
							side: row.side,
							symbol: row.symbol
						}}
						onCancel={() => setDuplicateOpen(false)}
						onSubmit={(vals: TransactionFormValues) =>
							createMutation.mutate({
								date: vals.date,
								fee: parseFee(vals.fee),
								feeCurrency: vals.feeCurrency,
								note: vals.note,
								price: vals.price,
								priceCurrency: vals.priceCurrency,
								quantity: vals.quantity,
								side: vals.side,
								symbol: vals.symbol
							})
						}
						pending={createMutation.isPending}
					/>
				</DialogContent>
			</Dialog>

			{/* Delete confirm */}
			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this transaction?</DialogTitle>
					</DialogHeader>
					<p className='text-sm text-muted-foreground'>This action cannot be undone.</p>
					<DialogFooter>
						<Button onClick={() => setDeleteOpen(false)} variant='outline'>
							Cancel
						</Button>
						<Button
							disabled={deleteMutation.isPending}
							onClick={() => deleteMutation.mutate({ id: row.id })}
							variant='destructive'
						>
							{deleteMutation.isPending && <Spinner className='mr-2' />}
							{deleteMutation.isPending ? 'Deleting...' : 'Delete'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
