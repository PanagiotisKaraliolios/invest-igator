import { env } from '@/env';
import { isValidSymbol, normalizeSymbol } from '@/lib/validation';
import { fluxStringLiteral, influxQueryApi, measurement } from '@/server/influx';

/**
 * Daily-bar price history straight out of Influx.
 * The Flux query is authored here and NOWHERE else — the caller supplies only a symbol
 * (normalised + format-validated against SYMBOL_REGEX, then emitted as a quoted literal)
 * and a closed union of field names.
 */

export type PricePoint = { date: string; value: number };

/** What collectRows hands back. `_value` is `number | string | null`; `_time` is RFC3339. */
export type InfluxPriceRow = { _time?: unknown; _value?: unknown };

export const MAX_HISTORY_DAYS = 3650;

export function clampHistoryDays(days: number): number {
	if (!Number.isFinite(days)) return 1;
	return Math.min(Math.max(Math.trunc(days), 1), MAX_HISTORY_DAYS);
}

export function toPricePoints(rows: readonly InfluxPriceRow[]): PricePoint[] {
	const points: PricePoint[] = [];
	for (const r of rows) {
		if (typeof r._time !== 'string' || r._time.length < 10) continue;
		if (r._value === null || r._value === undefined || r._value === '') continue;
		if (typeof r._value !== 'number' && typeof r._value !== 'string') continue;
		const value = Number(r._value);
		if (!Number.isFinite(value)) continue;
		points.push({ date: r._time.slice(0, 10), value });
	}
	points.sort((a, b) => a.date.localeCompare(b.date));
	return points;
}

export async function getPriceHistory(
	symbol: string,
	days: number,
	field: 'open' | 'high' | 'low' | 'close'
): Promise<PricePoint[]> {
	const normalized = normalizeSymbol(symbol);
	if (!isValidSymbol(normalized)) return [];

	const range = clampHistoryDays(days);
	// +3d of slack so a weekend/holiday at the window edge still yields `range` trading points.
	const flux = `from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
  |> range(start: -${range + 3}d)
  |> filter(fn: (r) => r._measurement == ${fluxStringLiteral(measurement)} and r._field == ${fluxStringLiteral(field)} and r.symbol == ${fluxStringLiteral(normalized)})
  |> keep(columns: ["_time", "_value"])
  |> sort(columns: ["_time"])`;

	const rows = await influxQueryApi.collectRows<InfluxPriceRow>(flux);
	return toPricePoints(rows).slice(-range);
}
