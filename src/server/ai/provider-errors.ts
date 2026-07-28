/**
 * Provider SDK and HTTP errors embed the request config, INCLUDING the auth header.
 * Serialising one into a tRPC error body leaks the user's key straight back to the
 * browser (and into any log that captures it). Pick fields explicitly, redact the
 * plaintext defensively, and truncate.
 *
 * Applied at every boundary a provider error can cross on its way to the browser: the
 * save-time probe (`probe.ts`), model listing (`list-models.ts`, which wraps its own
 * provider-contacting work in this redactor before rethrowing), and the tRPC layer that
 * formats whatever error escapes into the response sent to the client. One redaction
 * implementation, audited once.
 */
export function safeProviderErrorMessage(error: unknown, secretPlaintext: string): string {
	const raw = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown provider error';
	return raw.replaceAll(secretPlaintext, '[redacted]').slice(0, 300);
}
