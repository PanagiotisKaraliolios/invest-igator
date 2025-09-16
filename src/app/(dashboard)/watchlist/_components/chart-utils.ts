'use client';

/**
 * Shared chart utilities for the Watchlist views.
 *
 * This module provides:
 * - Lightweight types describing chart data points
 * - Helpers for sampling/formatting and safe CSS key generation
 * - Deterministic pseudo-random series generation for mock data
 * - Simple presentation helpers used in tooltips
 */

import { differenceInCalendarDays } from 'date-fns';

/** Event categories supported for annotations on charts. */
export type EventType = 'dividend' | 'split' | 'capitalGain';

/** Normalized event point used by chart layers to annotate timelines. */
export type EventPoint = {
	/** ISO date (yyyy-MM-dd) to align with series `iso` keys */
	date: string;
	/** Event kind */
	type: EventType;
	/** Optional numeric value (amount or split ratio) to display */
	value?: number;
	/** Optional label override (e.g., "1:5" for splits) */
	label?: string;
};

/**
 * Small helper to pick a glyph/short label for an event type.
 */
export function eventGlyph(type: EventType): string {
	switch (type) {
		case 'dividend':
			return 'D';
		case 'split':
			return 'S';
		case 'capitalGain':
			return 'C';
		default:
			return '?';
	}
}

/**
 * Default color mapping for event types. Consumers can override per chart.
 */
export function eventColor(type: EventType): string {
	switch (type) {
		case 'dividend':
			return '#10B981'; // emerald-500
		case 'split':
			return '#3B82F6'; // blue-500
		case 'capitalGain':
			return '#FBBF24'; // amber-500
		default:
			return '#6B7280'; // gray-500
	}
}

/**
 * Format an event into a concise, readable label for tooltips/legends.
 */
export function formatEventText(ev: EventPoint): string {
	const fmtNum = (n: number) =>
		Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(n);
	switch (ev.type) {
		case 'split':
			return ev.label ? `Split ${ev.label}:1` : 'Split';
		case 'dividend':
			return ev.value != null ? `Dividend: ${fmtNum(ev.value)} units per share` : 'Dividend';
		case 'capitalGain':
			return ev.value != null ? `Capital gain: ${fmtNum(ev.value)}` : 'Capital gain';
		default:
			return ev.label ?? 'Event';
	}
}

/**
 * Row shape for a combined multi-series dataset where each symbol is stored
 * under its own CSS-safe key. Values may be null for gaps to avoid drawing.
 */
export type CombinedDatum = {
	/** Human-friendly date label (e.g., "12 Sep") used by charts */
	date: string;
	/** ISO date (yyyy-MM-dd) used for precise axis alignment */
	iso: string;
	/** Dynamic series values keyed by CSS-safe symbol keys */
	[cssKey: string]: string | number | null | undefined;
};

/**
 * Single-series point with formatted label and optional ISO date.
 */
export type SeriesDatum = { date: string; iso?: string; value: number; events?: EventPoint[] };

/**
 * Downsample an array using a fixed stride to cap the number of points.
 * Keeps the last element to preserve the latest value.
 *
 * Complexity: O(n)
 */
export function downsample<T>(arr: T[], maxPoints: number, opts?: { preserve?: (v: T, idx: number) => boolean }): T[] {
	if (!Array.isArray(arr)) return arr;
	const n = arr.length;
	if (n <= maxPoints) return arr;
	const stride = Math.ceil(n / maxPoints);
	const include = new Set<number>();
	for (let i = 0; i < n; i += stride) include.add(i);
	include.add(n - 1);
	if (opts?.preserve) {
		for (let i = 0; i < n; i++) {
			try {
				if (opts.preserve(arr[i]!, i)) include.add(i);
			} catch {
				// ignore predicate errors
			}
		}
	}
	const idxs = Array.from(include.values()).sort((a, b) => a - b);
	// If we still exceed maxPoints significantly, thin non-preserved indices
	if (idxs.length > maxPoints && !opts?.preserve) {
		const stride2 = Math.ceil(idxs.length / maxPoints);
		const reduced: number[] = [];
		for (let i = 0; i < idxs.length; i += stride2) reduced.push(idxs[i]!);
		if (reduced[reduced.length - 1] !== idxs[idxs.length - 1]) reduced.push(idxs[idxs.length - 1]!);
		return reduced.map((i) => arr[i]!);
	}
	return idxs.map((i) => arr[i]!);
}

/**
 * Simple FNV-1a-like hash to derive a numeric seed from a string.
 */
export function hashStringToSeed(str: string) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * Deterministic 32-bit PRNG returning a function that yields [0,1).
 */
export function mulberry32(seed: number) {
	return function () {
		let s = seed;
		s += 0x6d2b79f5;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Generate a deterministic mock price series for a symbol using the seeded PRNG.
 * Useful as a fallback when real data is unavailable in dev.
 */
export function generateSeries(symbol: string, points = 30): SeriesDatum[] {
	const seed = hashStringToSeed(symbol);
	const rand = mulberry32(seed);
	const start = 50 + Math.floor(rand() * 250);
	const volatility = 0.02 + rand() * 0.03; // ~2%–5%
	const out: SeriesDatum[] = [];
	let price = start;
	for (let i = points - 1; i >= 0; i--) {
		const drift = (rand() - 0.5) * volatility;
		price = Math.max(5, price * (1 + drift));
		const d = new Date();
		d.setDate(d.getDate() - i);
		out.push({
			date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
			iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
			value: Math.round(price * 100) / 100
		});
	}
	return out;
}

/**
 * Predefined series color tokens that map to CSS variables exposed by ChartContainer.
 */
export const colorTokens = Array.from({ length: 12 }, (_, i) => `var(--chart-${i + 1})`);

/**
 * Sanitize a string into a CSS custom property-friendly key.
 */
export function toCssKey(sym: string) {
	return sym.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Compute percent change relative to a non-zero base. Returns null when invalid.
 */
export function percentChange(value?: number, base?: number): number | null {
	if (base === undefined || base === null || base === 0) return null;
	if (value === undefined || value === null || !Number.isFinite(Number(value))) return null;
	return ((Number(value) - base) / base) * 100;
}

/**
 * Map a value's percent delta vs base to a semantic Tailwind color class.
 */
export function changeClassForDelta(value?: number, base?: number) {
	const pct = percentChange(value, base);
	if (pct === null) return 'text-muted-foreground';
	if (pct > 0) return 'text-emerald-500';
	if (pct < 0) return 'text-red-500';
	return 'text-muted-foreground';
}

/**
 * Convert a chosen starting date to a number of days back from now,
 * clamped to a maximum limit for server queries.
 */
export function daysBackFromRange(from: Date, now = new Date(), maxDays = 365 * 50) {
	const computed = Math.max(1, differenceInCalendarDays(now, from) + 1);
	return Math.min(maxDays, computed);
}
