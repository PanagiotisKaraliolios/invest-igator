/** Format a Date as a local-time `yyyy-mm-dd` string (uses local getFullYear/getMonth/getDate). */
export function toLocalIsoDate(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
