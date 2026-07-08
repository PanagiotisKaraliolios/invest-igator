import { env } from '@/env';
import { assembleFxByDate, buildFxMatrixFromUsdLegs, type FxMatrix } from '@/server/fx';
import { fluxStringLiteral, influxQueryApi, influxWriteApi, Point } from '@/server/influx';

const FX_MEASUREMENT = 'fx_rates';

function sleep(ms: number) {
	return new Promise((res) => setTimeout(res, ms));
}

function isoKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Write one currency's USD-leg daily closes to the fx_rates measurement (idempotent by timestamp). */
export async function writeFxRates(currency: string, bars: { close: number; time: string }[]): Promise<void> {
	if (bars.length === 0) return;
	const BATCH = 1000;
	for (let i = 0; i < bars.length; i += BATCH) {
		const points = bars.slice(i, i + BATCH).map((bar) =>
			new Point(FX_MEASUREMENT)
				.tag('currency', currency)
				.floatField('rate', bar.close)
				.timestamp(new Date(`${bar.time}T00:00:00Z`))
		);
		let attempt = 1;
		const maxAttempts = 5;
		while (true) {
			try {
				influxWriteApi.writePoints(points);
				await influxWriteApi.flush();
				break;
			} catch (err) {
				if (attempt >= maxAttempts) throw err;
				await sleep(Math.min(30_000, 2_000 * attempt));
				attempt += 1;
			}
		}
	}
}

/** Latest USD-per-unit rate per currency, plus the newest bar timestamp seen (matrix as-of date). */
export async function getLatestFxBars(): Promise<{ asOf: Date | null; legs: Map<string, number> }> {
	const flux = `from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
	|> range(start: -50y)
	|> filter(fn: (r) => r._measurement == ${fluxStringLiteral(FX_MEASUREMENT)} and r._field == ${fluxStringLiteral('rate')})
	|> group(columns: ["currency"])
	|> last()`;
	const rows = await influxQueryApi.collectRows<{ currency: string; _value: number | string; _time: string }>(flux);
	const legs = new Map<string, number>();
	let asOf: Date | null = null;
	for (const r of rows) {
		const v = typeof r._value === 'number' ? r._value : Number(r._value);
		if (!Number.isFinite(v)) continue;
		legs.set(String(r.currency), v);
		const t = new Date(r._time);
		if (!asOf || t > asOf) asOf = t;
	}
	return { asOf, legs };
}

/** Current FX matrix from the latest bar per currency. */
export async function getFxMatrix(): Promise<FxMatrix> {
	const { legs } = await getLatestFxBars();
	return buildFxMatrixFromUsdLegs(legs);
}

/**
 * Forward-filled per-date FxMatrix map over the inclusive [fromIso, toIso] calendar. Seeds each
 * currency from the latest bar in a 7-day window before fromIso, then carries forward across gaps.
 */
export async function buildFxByDate(fromIso: string, toIso: string): Promise<Map<string, FxMatrix>> {
	// Parse as LOCAL midnight (no 'Z') so isoKey() round-trips the inputs and the produced date keys
	// match the local-formatted day keys portfolio.performance uses for fxByDate.get(dateIso) lookups.
	const fromDate = new Date(`${fromIso}T00:00:00`);
	const toDate = new Date(`${toIso}T00:00:00`);
	if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
		return new Map();
	}
	const seedStart = new Date(fromDate);
	seedStart.setDate(seedStart.getDate() - 7);
	const stop = new Date(toDate);
	stop.setDate(stop.getDate() + 1);

	const flux = `from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
	|> range(start: ${seedStart.toISOString()}, stop: ${stop.toISOString()})
	|> filter(fn: (r) => r._measurement == ${fluxStringLiteral(FX_MEASUREMENT)} and r._field == ${fluxStringLiteral('rate')})
	|> group(columns: ["currency"])`;
	const rows = await influxQueryApi.collectRows<{ currency: string; _value: number | string; _time: string }>(flux);

	const rawByCurrency = new Map<string, Map<string, number>>();
	for (const r of rows) {
		const v = typeof r._value === 'number' ? r._value : Number(r._value);
		if (!Number.isFinite(v)) continue;
		const c = String(r.currency);
		const day = String(r._time).slice(0, 10);
		if (!rawByCurrency.has(c)) rawByCurrency.set(c, new Map());
		rawByCurrency.get(c)!.set(day, v);
	}

	const dateKeys: string[] = [];
	for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) dateKeys.push(isoKey(d));

	return assembleFxByDate(rawByCurrency, dateKeys);
}
