import { generateObject, type LanguageModel } from 'ai';
import { type ColumnMapping, columnMappingSchema } from './schema';

export const SAMPLE_ROWS = 8;

export function buildMapPrompt(rawHeader: string[], sampleRows: string[][]): string {
	const header = rawHeader.map((h, i) => `${i}: ${JSON.stringify(h)}`).join('\n');
	const samples = sampleRows.map((r) => JSON.stringify(r)).join('\n');
	return [
		'You map a brokerage transaction CSV onto a fixed schema. You are given the header columns',
		'(with their 0-based indices) and a few sample data rows. Return, for each target field, the',
		'index of the source column, or null if the CSV has no such column.',
		'',
		'Target fields: date, symbol, side, quantity, price (REQUIRED); priceCurrency, fee, feeCurrency, note (optional).',
		'- side: the buy/sell direction. Provide `sideMap` translating each distinct raw side token',
		'  (uppercased) to "BUY" or "SELL" (e.g. {from:"B",to:"BUY"}). Leave empty if values are already BUY/SELL.',
		'- dateFormat: one of ISO (YYYY-MM-DD), MDY_SLASH (MM/DD/YYYY), DMY_SLASH (DD/MM/YYYY), DMY_DOT (DD.MM.YYYY).',
		'- Do NOT invent columns; use null for anything absent. Return ONLY the mapping.',
		'',
		`HEADER:\n${header}`,
		'',
		`SAMPLE ROWS:\n${samples}`
	].join('\n');
}

/**
 * Maps arbitrary broker columns → our schema. Sends ONLY the header + a small sample to the model.
 * Telemetry recording is OFF (recordInputs/recordOutputs=false): the CSV must never reach the sink.
 */
export async function mapColumns(
	model: LanguageModel,
	rawHeader: string[],
	sampleRows: string[][]
): Promise<ColumnMapping> {
	const { object } = await generateObject({
		model,
		prompt: buildMapPrompt(rawHeader, sampleRows.slice(0, SAMPLE_ROWS)),
		schema: columnMappingSchema,
		telemetry: { functionId: 'ai.import.map-columns', recordInputs: false, recordOutputs: false }
	});
	return object;
}
