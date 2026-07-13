/**
 * Vendors a pruned models.dev price snapshot.
 *
 *   bun run prices:fetch
 *
 * models.dev (MIT) publishes cost in USD per MILLION tokens.
 * LiteLLM's catalogue is USD per TOKEN. Mixing them is a 1e6 error.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SOURCE = 'https://models.dev/api.json';
/** Resolved from the repo root (this file lives in scripts/), never from the caller's cwd. */
const OUT = resolve(import.meta.dirname, '..', 'src/server/ai/pricing/models.snapshot.json');

/**
 * provider id -> model ids we price. Duplicates across providers must agree.
 *
 * If the script dies with `missing cost for <provider>/<model>`, that id is not (or is no
 * longer) in models.dev. DO NOT invent one: fetch https://models.dev/api.json, find the real
 * id under that provider, and edit this list. Whatever ends up here must be a superset of
 * every value AZURE_OPENAI_CHAT_MODEL / AiProviderCredential.defaultModelId can take,
 * otherwise price() returns null and the call is recorded UNKNOWN_MODEL.
 */
const WANTED: ReadonlyArray<readonly [string, string]> = [
	['azure', 'gpt-5.4'],
	['azure', 'gpt-5.4-mini'],
	['azure', 'gpt-5.4-nano'],
	['openai', 'gpt-5.4'],
	['openai', 'gpt-5.4-mini'],
	['openai', 'gpt-5.4-nano'],
	['anthropic', 'claude-opus-4-8'],
	['anthropic', 'claude-sonnet-4-5'],
	['anthropic', 'claude-haiku-4-5'],
	['google', 'gemini-3.5-flash'],
	['google', 'gemini-2.5-pro'],
	['google', 'gemini-3.1-flash-lite']
];

type RawCost = {
	input: number;
	output: number;
	cache_read?: number;
	cache_write?: number;
};
type RawApi = Record<string, { models?: Record<string, { cost?: RawCost }> }>;

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`models.dev returned ${res.status}`);
const api = (await res.json()) as RawApi;

const models: Record<string, Record<string, number>> = {};

for (const [providerId, modelId] of WANTED) {
	const cost = api[providerId]?.models?.[modelId]?.cost;
	if (cost === undefined) throw new Error(`missing cost for ${providerId}/${modelId}`);

	const entry: Record<string, number> = { input: cost.input, output: cost.output };
	if (cost.cache_read !== undefined) entry.cacheRead = cost.cache_read;
	if (cost.cache_write !== undefined) entry.cacheWrite = cost.cache_write;

	const previous = models[modelId];
	if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(entry)) {
		throw new Error(`price conflict for ${modelId} across providers`);
	}
	models[modelId] = entry;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function canonicalise(value: JsonValue): JsonValue {
	if (Array.isArray(value)) return value.map(canonicalise);
	if (value !== null && typeof value === 'object') {
		const out: { [k: string]: JsonValue } = {};
		for (const key of Object.keys(value).sort()) {
			const child = value[key];
			if (child !== undefined) out[key] = canonicalise(child);
		}
		return out;
	}
	return value;
}

const snapshot = canonicalise({
	license: 'MIT',
	models,
	source: SOURCE,
	unit: 'usd-per-million-tokens'
} as JsonValue);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(snapshot, null, '\t')}\n`, 'utf8');

const id = `sha256:${createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex')}`;
process.stdout.write(`wrote ${OUT}\nPRICE_SNAPSHOT_ID = ${id}\n`);
