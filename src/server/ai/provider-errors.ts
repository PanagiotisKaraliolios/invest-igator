/**
 * Provider SDK and HTTP errors embed the request config, INCLUDING the auth header.
 * Serialising one into a tRPC error body leaks the user's key straight back to the
 * browser (and into any log that captures it). Pick fields explicitly, redact the
 * plaintext defensively, and truncate.
 *
 * Shared by the save-time probe (`probe.ts`) and model listing (`list-models.ts`) so
 * there is exactly one redaction implementation to audit.
 */
export function safeProviderErrorMessage(error: unknown, secretPlaintext: string): string {
	const raw = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown provider error';
	return raw.replaceAll(secretPlaintext, '[redacted]').slice(0, 300);
}
