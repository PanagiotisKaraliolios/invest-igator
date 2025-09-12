import { HttpError, InfluxDB, Point, type WriteOptions } from '@influxdata/influxdb-client';
import { env } from '@/env';

// Influx client + helpers
export const influx = new InfluxDB({ token: env.INFLUXDB_TOKEN, url: env.INFLUXDB_URL });
// Configure write options: larger retry timeouts and backoff to avoid transient timeouts
const writeOptions: Partial<WriteOptions> = {
	batchSize: 5_000,
	defaultTags: undefined,
	maxBufferLines: 50_000,
	maxRetries: 5,
	// max retry time 60s, retry interval base 1s, exponential backoff factor 2
	maxRetryTime: 60_000
};
export const influxWriteApi = influx.getWriteApi(env.INFLUXDB_ORG, env.INFLUXDB_BUCKET, 'ns', writeOptions);
export const influxQueryApi = influx.getQueryApi(env.INFLUXDB_ORG);
export { Point, HttpError };

export type DailyBar = {
	time: string; // YYYY-MM-DD
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
};

export const measurement = 'daily_bars'; // measurement name in Influx

// Query if a symbol already has any data points
export async function symbolHasAnyData(symbol: string): Promise<boolean> {
	const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: -50y)
  |> filter(fn: (r) => r._measurement == "${measurement}" and r.symbol == "${symbol}" )
  |> limit(n: 1)`;

	let has = false;
	for await (const _ of influxQueryApi.iterateRows(flux)) {
		has = true;
		break;
	}
	return has;
}

export function buildPoint(symbol: string, bar: DailyBar): Point {
	// InfluxDB expects an RFC3339 timestamp; alpha gives YYYY-MM-DD in exchange tz (US/Eastern).
	// We'll treat it as date-only at 00:00:00Z for simplicity.
	const ts = new Date(bar.time + 'T00:00:00Z');
	return new Point(measurement)
		.tag('symbol', symbol)
		.floatField('open', bar.open)
		.floatField('high', bar.high)
		.floatField('low', bar.low)
		.floatField('close', bar.close)
		.intField('volume', bar.volume)
		.timestamp(ts);
}
