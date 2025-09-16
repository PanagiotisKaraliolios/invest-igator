"use client";

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
export type SeriesDatum = { date: string; iso?: string; value: number };

/**
 * Downsample an array using a fixed stride to cap the number of points.
 * Keeps the last element to preserve the latest value.
 *
 * Complexity: O(n)
 */
export function downsample<T>(arr: T[], maxPoints: number): T[] {
	if (!Array.isArray(arr)) return arr;
	const n = arr.length;
	if (n <= maxPoints) return arr;
	const stride = Math.ceil(n / maxPoints);
	const out: T[] = [];
	for (let i = 0; i < n; i += stride) out.push(arr[i]!);
	// ensure the last original item is included
	if (out[out.length - 1] !== arr[n - 1]) out.push(arr[n - 1]!);
	return out;
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
			date: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
			iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
			value: Math.round(price * 100) / 100,
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
	return sym.replace(/[^a-zA-Z0-9_-]/g, "_");
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
	if (pct === null) return "text-muted-foreground";
	if (pct > 0) return "text-emerald-500";
	if (pct < 0) return "text-red-500";
	return "text-muted-foreground";
}

/**
 * Convert a chosen starting date to a number of days back from now,
 * clamped to a maximum limit for server queries.
 */
export function daysBackFromRange(from: Date, now = new Date(), maxDays = 365 * 50) {
	const computed = Math.max(1, differenceInCalendarDays(now, from) + 1);
	return Math.min(maxDays, computed);
}
