'use client';

import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type DateRangePreset = {
	label: string;
	getValue: () => DateRange;
};

type DateRangePickerProps = {
	value: DateRange | undefined;
	onChange: (range: DateRange | undefined) => void;
	presets?: DateRangePreset[];
	placeholder?: string;
	className?: string;
	align?: 'start' | 'end' | 'center';
	numberOfMonths?: 1 | 2;
	disabledDays?: (date: Date) => boolean;
	maxDate?: Date;
	minDate?: Date;
	/** If true, dates after maxDate will be disabled. If false (default), maxDate is just a hint. */
	strictMaxDate?: boolean;
};

export function DateRangePicker({
	value,
	onChange,
	presets,
	placeholder = 'Pick a date range',
	className,
	align = 'start',
	numberOfMonths = 2,
	disabledDays,
	maxDate,
	minDate,
	strictMaxDate = false
}: DateRangePickerProps) {
	const [open, setOpen] = React.useState(false);
	const [tempRange, setTempRange] = React.useState<DateRange | undefined>(value);

	React.useEffect(() => {
		if (open) {
			setTempRange(value);
		}
	}, [open, value]);

	// Combine custom disabledDays with maxDate enforcement
	const combinedDisabledDays = React.useMemo(() => {
		if (!strictMaxDate || !maxDate) return disabledDays;
		return (date: Date) => {
			if (disabledDays && disabledDays(date)) return true;
			return date > maxDate;
		};
	}, [disabledDays, maxDate, strictMaxDate]);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button className={cn('justify-start text-left font-normal', className)} variant='outline'>
					<CalendarIcon className='mr-2 h-4 w-4' />
					{value?.from ? (
						value.to ? (
							<>
								{format(value.from, 'MMM d, yyyy')} - {format(value.to, 'MMM d, yyyy')}
							</>
						) : (
							format(value.from, 'MMM d, yyyy')
						)
					) : (
						<span>{placeholder}</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align={align} className='w-auto p-0'>
				<div className='flex'>
					<div>
						<Calendar
							autoFocus
							defaultMonth={tempRange?.from}
							disabled={combinedDisabledDays}
							fromDate={minDate}
							initialFocus
							mode='range'
							numberOfMonths={numberOfMonths}
							onSelect={(range) => {
								setTempRange(range);
							}}
							selected={tempRange}
							toDate={maxDate}
						/>
						<div className='flex items-center justify-between gap-2 border-t p-3'>
							<p className='text-xs text-muted-foreground'>
								{tempRange?.from && tempRange?.to
									? `${format(tempRange.from, 'MMM d, yyyy')} - ${format(tempRange.to, 'MMM d, yyyy')}`
									: 'Select a date range'}
							</p>
							<div className='flex gap-2'>
								<Button
									disabled={!tempRange?.from && !tempRange?.to}
									onClick={() => {
										setTempRange(undefined);
									}}
									size='sm'
									variant='ghost'
								>
									Clear
								</Button>
								<Button
									onClick={() => {
										onChange(tempRange);
										setOpen(false);
									}}
									size='sm'
								>
									Apply
								</Button>
							</div>
						</div>
					</div>
					{presets && presets.length > 0 && (
						<div className='flex flex-col gap-1 border-l p-3'>
							{presets.map((preset, index) => (
								<Button
									className='justify-start'
									key={index}
									onClick={() => {
										const range = preset.getValue();
										setTempRange(range);
									}}
									size='sm'
									variant='ghost'
								>
									{preset.label}
								</Button>
							))}
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

// Common preset factories
export const createDateRangePresets = {
	last7Days: (): DateRangePreset => ({
		getValue: () => {
			const end = new Date();
			const start = new Date();
			start.setDate(end.getDate() - 6);
			return { from: start, to: end };
		},
		label: 'Last 7 days'
	}),

	last30Days: (): DateRangePreset => ({
		getValue: () => {
			const end = new Date();
			const start = new Date();
			start.setDate(end.getDate() - 29);
			return { from: start, to: end };
		},
		label: 'Last 30 days'
	}),

	last90Days: (): DateRangePreset => ({
		getValue: () => {
			const end = new Date();
			const start = new Date();
			start.setDate(end.getDate() - 89);
			return { from: start, to: end };
		},
		label: 'Last 90 days'
	}),

	lastMonth: (): DateRangePreset => ({
		getValue: () => {
			const now = new Date();
			const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const end = new Date(now.getFullYear(), now.getMonth(), 0);
			return { from: start, to: end };
		},
		label: 'Last month'
	}),

	lastYear: (): DateRangePreset => ({
		getValue: () => {
			const now = new Date();
			const start = new Date(now.getFullYear() - 1, 0, 1);
			const end = new Date(now.getFullYear() - 1, 11, 31);
			return { from: start, to: end };
		},
		label: 'Last year'
	}),

	thisMonth: (): DateRangePreset => ({
		getValue: () => {
			const now = new Date();
			const start = new Date(now.getFullYear(), now.getMonth(), 1);
			const end = new Date();
			return { from: start, to: end };
		},
		label: 'This month'
	}),

	thisYear: (): DateRangePreset => ({
		getValue: () => {
			const now = new Date();
			const start = new Date(now.getFullYear(), 0, 1);
			const end = new Date();
			return { from: start, to: end };
		},
		label: 'This year'
	})
};
