/** Client-side expiry check (the server remains authoritative). Malformed input ⇒ expired. */
export function isExpired(expiresAt: string, now: number = Date.now()): boolean {
	const t = Date.parse(expiresAt);
	if (Number.isNaN(t)) return true;
	return now > t;
}
