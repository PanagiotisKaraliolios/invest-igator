/**
 * Normalize a Yahoo-reported currency to an ISO-4217 code + a price scale factor.
 * Yahoo quotes some UK instruments in pence ('GBp'/'GBX' = 1/100 GBP); we relabel to
 * 'GBP' and return scale 0.01 so callers convert pence prices to pounds. All other
 * codes pass through uppercased with scale 1. Empty input defaults to USD.
 */
export function normalizeYahooCurrency(raw?: string): { currency: string; scale: number } {
	if (!raw) return { currency: 'USD', scale: 1 };
	if (raw === 'GBp' || raw.toUpperCase() === 'GBX') return { currency: 'GBP', scale: 0.01 };
	return { currency: raw.toUpperCase(), scale: 1 };
}
