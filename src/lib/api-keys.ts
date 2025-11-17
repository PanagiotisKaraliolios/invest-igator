import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Generates a cryptographically secure random API key
 * @param length - Length of the key (default: 64)
 * @param prefix - Optional prefix for the key (e.g., "proj_")
 * @returns Object containing the plain key and the hashed key
 */
export async function generateApiKey(
	length = 64,
	prefix?: string
): Promise<{
	key: string;
	hashedKey: string;
	start: string;
}> {
	// Generate random bytes
	const randomPart = randomBytes(Math.ceil(length / 2))
		.toString('hex')
		.slice(0, length);

	// Construct the full key with optional prefix
	const key = prefix ? `${prefix}${randomPart}` : randomPart;

	// Hash the key for storage
	const hashedKey = await hashApiKey(key);

	// Store first 6 characters (or prefix + 6) for identification
	const start = key.slice(0, 6 + (prefix?.length ?? 0));

	return { hashedKey, key, start };
}

/**
 * Hashes an API key using bcrypt
 * @param key - The plain API key
 * @returns The hashed key
 */
export async function hashApiKey(key: string): Promise<string> {
	// Using cost factor 12 for reasonable security/cost balance
	return bcrypt.hash(key, 12);
}

/**
 * Validates an API key format
 * @param key - The API key to validate
 * @param prefix - Optional expected prefix
 * @returns True if valid format
 */
export function validateApiKeyFormat(key: string, prefix?: string): boolean {
	if (!key || typeof key !== 'string') return false;

	// Check minimum length (prefix + at least 32 chars)
	const minLength = (prefix?.length ?? 0) + 32;
	if (key.length < minLength) return false;

	// If prefix is specified, check it matches
	if (prefix && !key.startsWith(prefix)) return false;

	// Check that the key contains only valid characters (alphanumeric)
	const keyPart = prefix ? key.slice(prefix.length) : key;
	return /^[a-f0-9]+$/.test(keyPart);
}

/**
 * Checks if an API key has expired
 * @param expiresAt - The expiration date
 * @returns True if expired
 */
export function isApiKeyExpired(expiresAt: Date | null): boolean {
	if (!expiresAt) return false;
	return new Date() > expiresAt;
}

/**
 * Checks if rate limit has been exceeded
 * @param requestCount - Current request count
 * @param rateLimitMax - Maximum requests allowed
 * @param lastRequest - Timestamp of last request
 * @param rateLimitTimeWindow - Time window in milliseconds
 * @returns Object with exceeded status and reset time
 */
export function checkRateLimit(
	requestCount: number,
	rateLimitMax: number | null,
	lastRequest: Date | null,
	rateLimitTimeWindow: number | null
): { exceeded: boolean; resetAt: Date | null } {
	if (!rateLimitMax || !rateLimitTimeWindow) {
		return { exceeded: false, resetAt: null };
	}

	if (!lastRequest) {
		return { exceeded: false, resetAt: null };
	}

	const now = new Date();
	const windowStart = new Date(lastRequest.getTime() + rateLimitTimeWindow);

	// If we're past the time window, reset is allowed
	if (now >= windowStart) {
		return { exceeded: false, resetAt: null };
	}

	// Check if limit exceeded
	const exceeded = requestCount >= rateLimitMax;
	return {
		exceeded,
		resetAt: exceeded ? windowStart : null
	};
}

/**
 * Checks if a refill is due
 * @param lastRefillAt - Last refill timestamp
 * @param refillInterval - Refill interval in milliseconds
 * @returns True if refill is due
 */
export function isRefillDue(lastRefillAt: Date | null, refillInterval: number | null): boolean {
	if (!refillInterval || !lastRefillAt) return false;

	const now = new Date();
	const nextRefill = new Date(lastRefillAt.getTime() + refillInterval);
	return now >= nextRefill;
}

/**
 * Validates permissions structure
 * @param permissions - Permissions object
 * @returns True if valid
 */
export function validatePermissions(permissions: Record<string, string[]>): boolean {
	if (!permissions || typeof permissions !== 'object') return false;

	// Check that all values are arrays of strings
	for (const [key, value] of Object.entries(permissions)) {
		if (typeof key !== 'string') return false;
		if (!Array.isArray(value)) return false;
		if (!value.every((v) => typeof v === 'string')) return false;
	}

	return true;
}

/**
 * Checks if an API key has required permissions
 * @param keyPermissions - Permissions stored with the key
 * @param requiredPermissions - Required permissions to check
 * @returns True if key has all required permissions
 */
export function hasPermissions(
	keyPermissions: Record<string, string[]> | null,
	requiredPermissions: Record<string, string[]>
): boolean {
	if (!keyPermissions) return false;

	// Check each required resource type
	for (const [resource, actions] of Object.entries(requiredPermissions)) {
		const keyActions = keyPermissions[resource];
		if (!keyActions) return false;

		// Check if all required actions are present
		if (!actions.every((action) => keyActions.includes(action))) {
			return false;
		}
	}

	return true;
}

/**
 * Calculates expiration date from expiresIn seconds
 * @param expiresIn - Seconds until expiration
 * @returns Expiration date
 */
export function calculateExpirationDate(expiresIn: number): Date {
	return new Date(Date.now() + expiresIn * 1000);
}

/**
 * Verifies a plain API key against a stored bcrypt hash
 * @param plainKey - The plain API key to verify
 * @param hashedKey - The stored bcrypt hash
 * @returns True if the key matches the hash
 */
export async function verifyApiKey(plainKey: string, hashedKey: string): Promise<boolean> {
	return bcrypt.compare(plainKey, hashedKey);
}
