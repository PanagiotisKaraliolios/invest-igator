import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Blanks out line comments, block comments and string/template literals, preserving offsets. */
function blankNonCode(source: string): string {
	const out = source.split('');
	let i = 0;
	while (i < source.length) {
		const two = source.slice(i, i + 2);
		if (two === '//') {
			while (i < source.length && source[i] !== '\n') {
				out[i] = ' ';
				i += 1;
			}
			continue;
		}
		if (two === '/*') {
			const end = source.indexOf('*/', i + 2);
			const stop = end === -1 ? source.length : end + 2;
			for (let j = i; j < stop; j += 1) {
				if (out[j] !== '\n') out[j] = ' ';
			}
			i = stop;
			continue;
		}
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			const quote = ch;
			out[i] = ' ';
			i += 1;
			while (i < source.length) {
				const c = source[i];
				if (c === '\\') {
					out[i] = ' ';
					out[i + 1] = ' ';
					i += 2;
					continue;
				}
				const done = c === quote;
				if (c !== '\n') out[i] = ' ';
				i += 1;
				if (done) break;
			}
			continue;
		}
		i += 1;
	}
	return out.join('');
}

/** Returns the source slice of the balanced `{...}` starting at `open`, or null if unbalanced. */
function matchBraces(source: string, open: number): string | null {
	let depth = 0;
	for (let i = open; i < source.length; i += 1) {
		const c = source[i];
		if (c === '{') depth += 1;
		else if (c === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(open, i + 1);
		}
	}
	return null;
}

const TELEMETRY_KEY = /(?<![\w$.])telemetry\s*:/g;

/**
 * AI SDK v7 telemetry is opt-OUT, and `recordInputs` / `recordOutputs` DEFAULT TO TRUE. A call site
 * that omits them writes the model's full prompt — which is the user's positions, transactions and
 * goals — into the telemetry sink. Every call site must be an inline literal that turns both off.
 */
export function findUnsafeTelemetryCallSites(source: string, file: string): string[] {
	const code = blankNonCode(source);
	const violations: string[] = [];

	for (const match of code.matchAll(TELEMETRY_KEY)) {
		const after = match.index + match[0].length;
		let cursor = after;
		while (cursor < code.length && /\s/.test(code[cursor] ?? '')) cursor += 1;

		if (code[cursor] !== '{') {
			violations.push(
				`${file}: \`telemetry:\` is not an inline object literal — recordInputs/recordOutputs cannot be verified. Inline it.`
			);
			continue;
		}

		// Read the literal from the ORIGINAL source: the blanked copy has no property values.
		const literal = matchBraces(source, cursor);
		if (literal === null) {
			violations.push(`${file}: \`telemetry:\` object literal is unbalanced — cannot verify it.`);
			continue;
		}
		if (!literal.includes('recordInputs: false')) {
			violations.push(`${file}: telemetry call site is missing \`recordInputs: false\` (v7 defaults it to TRUE)`);
		}
		if (!literal.includes('recordOutputs: false')) {
			violations.push(
				`${file}: telemetry call site is missing \`recordOutputs: false\` (v7 defaults it to TRUE)`
			);
		}
	}
	return violations;
}

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listTsFiles(full));
		} else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
			out.push(full);
		}
	}
	return out;
}

/** Walks every non-test source file under `rootDir` and returns every violation found. */
export function scanSourceTree(rootDir: string): string[] {
	const violations: string[] = [];
	for (const file of listTsFiles(rootDir)) {
		// Tests carry deliberately-bad fixture strings.
		if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
		violations.push(...findUnsafeTelemetryCallSites(readFileSync(file, 'utf8'), file));
	}
	return violations;
}
