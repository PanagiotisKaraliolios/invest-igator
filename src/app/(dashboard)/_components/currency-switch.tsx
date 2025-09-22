'use client';

import { useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrencySwitch } from '@/hooks/use-currency';
import { type Currency, supportedCurrencies } from '@/lib/currency';

export default function CurrencySwitch({ isAuthenticated }: { isAuthenticated: boolean }) {
	const { currency, setCurrency, mounted } = useCurrencySwitch(isAuthenticated);

	useEffect(() => {
		// no-op; ensure hydration alignment
	}, [mounted]);

	return (
		<Select onValueChange={(v) => setCurrency(v as Currency)} value={currency}>
			<SelectTrigger className='w-[110px]' data-testid='currency-switch'>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{supportedCurrencies.map((c) => (
					<SelectItem data-testid={`currency-${c}`} key={c} value={c}>
						{c}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
