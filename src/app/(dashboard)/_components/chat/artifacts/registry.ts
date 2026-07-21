import { createElement, type ReactNode } from 'react';
// Client-safe: ai-sdk.ts imports only `tool` from 'ai' + types (no server/db). This is the
// single source of truth for the canonical<->SDK name mapping.
import { fromAiSdkToolName } from '@/server/ai/tools/adapters/ai-sdk';
import { DataTableArtifact } from './data-table-artifact';
import { PortfolioAllocation } from './portfolio-allocation';
import { TimeSeries } from './time-series';
import { ToolCallChip } from './tool-call-chip';

/**
 * Deterministic renderer registry (Approach A): one entry per Phase 0 tool, keyed by its
 * canonical dot name. Each renderer draws its chart/table from the tool's own typed output —
 * never from model-generated prose — so the model cannot hallucinate a number into a chart.
 *
 * Plain `.ts` (not `.tsx`): built with `createElement` instead of JSX so this module carries no
 * JSX-transform requirement of its own; it only wires together the `'use client'` renderer
 * components below, which is why it needs no directive itself.
 *
 * IMPORTANT: this module must NOT import `ALL_TOOLS` from '@/server/ai/tools/registry' (a
 * runtime import would pull server code — including `@/server/db` — into the client bundle).
 * The keys below are hardcoded strings; registry.test.ts (bun, not the client bundle) is what
 * checks them against `ALL_TOOLS` for completeness.
 */
export const ARTIFACT_RENDERERS: Record<string, (output: unknown) => ReactNode> = {
	'fx.rates': (o) => createElement(DataTableArtifact, { kind: 'fx.rates', output: o as never }),
	'goals.list': (o) => createElement(DataTableArtifact, { kind: 'goals.list', output: o as never }),
	'market.priceHistory': (o) => createElement(TimeSeries, { kind: 'market.priceHistory', output: o as never }),
	'portfolio.performance': (o) => createElement(TimeSeries, { kind: 'portfolio.performance', output: o as never }),
	'portfolio.structure': (o) => createElement(PortfolioAllocation, { output: o as never }),
	'transactions.search': (o) => createElement(DataTableArtifact, { kind: 'transactions.search', output: o as never }),
	'watchlist.list': (o) => createElement(DataTableArtifact, { kind: 'watchlist.list', output: o as never })
};

/**
 * Renders one tool-call message part. A `<ToolCallChip/>` is ALWAYS shown — including while the
 * call is streaming/pending or if it has no registered renderer — and the deterministic
 * chart/table is rendered ONLY once `part.state === 'output-available'`, from `part.output`.
 *
 * `toolName` arrives from the message part in AI SDK (underscore) form — the SDK forbids dots in
 * tool names, so the adapter registered every tool under `toAiSdkToolName(name)`. We reverse that
 * with `fromAiSdkToolName` BEFORE the lookup (and for the chip label) so the underscore runtime
 * name resolves to its canonical dot-keyed renderer. Without this, all 7 lookups miss.
 */
export function renderArtifact(toolName: string, part: { state?: string; output?: unknown }): ReactNode {
	const canonical = fromAiSdkToolName(toolName);
	const renderer = ARTIFACT_RENDERERS[canonical];
	const artifact = part.state === 'output-available' && renderer ? renderer(part.output) : null;
	return createElement(
		'div',
		{ className: 'space-y-1.5' },
		createElement(ToolCallChip, { state: part.state, toolName: canonical }),
		artifact
			? createElement('div', { className: 'overflow-hidden rounded-xl border bg-card/60 p-3' }, artifact)
			: null
	);
}
