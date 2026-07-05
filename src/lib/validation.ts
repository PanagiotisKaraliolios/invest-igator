import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export const passwordSchema = z
	.string()
	.min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
	.max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
	.regex(PASSWORD_REGEX, 'Use letters and numbers');

export const SYMBOL_REGEX = /^[A-Za-z0-9.^=:/_-]{1,32}$/;

export function normalizeSymbol(value: string): string {
	return value.trim().toUpperCase();
}

export function isValidSymbol(value: string): boolean {
	return SYMBOL_REGEX.test(value.trim());
}

export const symbolSchema = z
	.string()
	.trim()
	.min(1, 'Symbol is required')
	.max(32, 'Symbol is too long')
	.regex(SYMBOL_REGEX, 'Symbol contains invalid characters');
