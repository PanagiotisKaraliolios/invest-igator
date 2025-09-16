'use client';

import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type Preset = '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | '10Y' | '20Y' | 'MAX' | null;

export function applyPresetToRange(p: Exclude<Preset, null>, maxDays: number): DateRange {
	const now = new Date();
	let from = new Date(now);
	switch (p) {
		case '5D':
			from.setDate(now.getDate() - 4);
			break;
		case '1M':
			from.setDate(now.getDate() - 29);
			break;
		case '6M':
			from.setDate(now.getDate() - 179);
			break;
		case 'YTD':
			from = new Date(now.getFullYear(), 0, 1);
			break;
		case '1Y':
			from.setDate(now.getDate() - 364);
			break;
		case '5Y':
			from.setDate(now.getDate() - 1824);
			break;
		case '10Y':
			from.setDate(now.getDate() - 3649);
			break;
		case '20Y':
			from.setDate(now.getDate() - 7299);
			break;
		case 'MAX':
			from.setDate(now.getDate() - (maxDays - 1));
			break;
	}
	return { from, to: now };
}

type Props = {
	dateRange: DateRange;
	onChange: (next: DateRange) => void;
	preset: Preset;
	onPresetChange: (p: Preset) => void;
	maxDays: number;
	buttonClassName?: string;
};

export default function DateRangePicker({
	dateRange,
	onChange,
	preset,
	onPresetChange,
	maxDays,
	buttonClassName
}: Props) {
	const presets: Exclude<Preset, null>[] = ['5D', '1M', '6M', 'YTD', '1Y', '5Y', '10Y', '20Y', 'MAX'];
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button className={buttonClassName ?? 'h-8 gap-2'} variant='outline'>
					<CalendarIcon className='h-4 w-4' />
					{dateRange.from && dateRange.to ? (
						<span>
							{format(dateRange.from, 'MMM d, yyyy')} – {format(dateRange.to, 'MMM d, yyyy')}
						</span>
					) : (
						<span>Pick date range</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align='end' className='w-auto p-0'>
				<div className='flex flex-wrap items-center gap-1 p-2 pb-0'>
					{presets.map((p) => (
						<Button
							key={p}
							onClick={() => {
								const r = applyPresetToRange(p, maxDays);
								onChange(r);
								onPresetChange(p);
							}}
							size='sm'
							variant={preset === p ? 'default' : 'ghost'}
						>
							{p}
						</Button>
					))}
				</div>
				<Calendar
					mode='range'
					numberOfMonths={2}
					onSelect={(r) => {
						onChange(r ?? dateRange);
						onPresetChange(null);
					}}
					selected={dateRange}
				/>
			</PopoverContent>
		</Popover>
	);
}
