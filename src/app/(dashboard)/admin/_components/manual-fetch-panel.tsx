'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, CheckCircle, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/trpc/react';

const fetchSchema = z.object({
	force: z.boolean(),
	symbol: z.string().min(1, 'Symbol is required').toUpperCase()
});

type FetchFormData = z.infer<typeof fetchSchema>;

export function ManualFetchPanel() {
	const utils = api.useUtils();
	const [lastResult, setLastResult] = useState<{
		barsIngested: number;
		skipped: boolean;
		success: boolean;
		symbol: string;
	} | null>(null);

	const {
		register,
		handleSubmit,
		setValue,
		watch,
		reset,
		formState: { errors }
	} = useForm<FetchFormData>({
		defaultValues: {
			force: false,
			symbol: ''
		},
		resolver: zodResolver(fetchSchema)
	});

	const forceValue = watch('force');

	const triggerFetch = api.financialData.triggerDataFetch.useMutation({
		onError: (error) => {
			toast.error('Failed to fetch data', {
				description: error.message
			});
			setLastResult(null);
		},
		onSuccess: (data) => {
			setLastResult(data);
			if (data.skipped) {
				toast.info('Data already exists', {
					description: `${data.symbol} already has data. Use "Force Re-fetch" to update.`
				});
			} else {
				toast.success('Data fetched successfully', {
					description: `Ingested ${data.barsIngested} bars for ${data.symbol}`
				});
			}
			void utils.financialData.getIngestionStats.invalidate();
			void utils.financialData.checkDataQuality.invalidate();
			reset();
		}
	});

	const onSubmit = async (data: FetchFormData) => {
		setLastResult(null);
		await triggerFetch.mutateAsync({
			force: data.force,
			symbol: data.symbol
		});
	};

	return (
		<div className='space-y-6'>
			<form className='space-y-4' onSubmit={handleSubmit(onSubmit)}>
				<Field data-invalid={!!errors.symbol}>
					<FieldLabel htmlFor='symbol'>Symbol</FieldLabel>
					<Input
						{...register('symbol')}
						aria-invalid={!!errors.symbol}
						disabled={triggerFetch.isPending}
						id='symbol'
						placeholder='e.g., AAPL, VUSA.L'
					/>
					<FieldError errors={[errors.symbol]} />
				</Field>

				<div className='flex items-center space-x-2'>
					<Checkbox
						checked={forceValue}
						disabled={triggerFetch.isPending}
						id='force'
						onCheckedChange={(checked) => setValue('force', checked === true)}
					/>
					<label
						className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
						htmlFor='force'
					>
						Force re-fetch (ignore existing data)
					</label>
				</div>

				<Button className='w-full sm:w-auto' disabled={triggerFetch.isPending} type='submit'>
					{triggerFetch.isPending ? (
						<>
							<Loader2 className='mr-2 h-4 w-4 animate-spin' />
							Fetching...
						</>
					) : (
						<>
							<Download className='mr-2 h-4 w-4' />
							Fetch Data
						</>
					)}
				</Button>
			</form>

			{/* Result Display */}
			{lastResult && (
				<Alert variant={lastResult.skipped ? 'default' : 'default'}>
					{lastResult.skipped ? (
						<AlertCircle className='h-4 w-4' />
					) : (
						<CheckCircle className='h-4 w-4 text-green-600' />
					)}
					<AlertTitle>{lastResult.skipped ? 'Data Already Exists' : 'Fetch Successful'}</AlertTitle>
					<AlertDescription>
						{lastResult.skipped ? (
							<span>
								Symbol <strong>{lastResult.symbol}</strong> already has historical data. Enable
								&quot;Force re-fetch&quot; to update existing data.
							</span>
						) : (
							<span>
								Successfully ingested <strong>{lastResult.barsIngested}</strong> OHLCV bars for{' '}
								<strong>{lastResult.symbol}</strong>.
							</span>
						)}
					</AlertDescription>
				</Alert>
			)}

			{/* Info Box */}
			<Alert>
				<AlertCircle className='h-4 w-4' />
				<AlertTitle>Manual Data Fetch</AlertTitle>
				<AlertDescription className='space-y-2'>
					<p>Manually trigger data ingestion for a specific symbol. This is useful for:</p>
					<ul className='ml-4 list-disc space-y-1'>
						<li>Adding data for newly tracked symbols</li>
						<li>Updating stale data (use force option)</li>
						<li>Troubleshooting missing data issues</li>
					</ul>
					<p className='text-muted-foreground text-xs'>
						Note: This fetches data from Yahoo Finance. Rate limits may apply.
					</p>
				</AlertDescription>
			</Alert>
		</div>
	);
}
