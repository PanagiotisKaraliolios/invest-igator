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
	if (!(error instanceof Error)) return 'Unknown provider error';

	// A plain `Error` carries no useful type information in `name` — showing "Error: " is
	// pure noise, and `list-models.ts` already routes its own throw through THIS function
	// before rethrowing, so a second pass here (e.g. in the tRPC layer) would otherwise
	// double the prefix into "Error: Error: ...". Named subclasses (TypeError,
	// InvalidCredentialError, ...) DO carry information — keep the prefix for those.
	const raw = error.name === 'Error' ? error.message : `${error.name}: ${error.message}`;

	// GOOGLE URL-encodes the secret into the query string (`encodeURIComponent(secret)`),
	// so a plaintext-only replace leaves the percent-encoded form (which differs whenever
	// the secret contains `+ / = & :` etc.) sitting in the message, trivially decodable.
	// Redact both forms whenever they differ.
	const encoded = encodeURIComponent(secretPlaintext);
	let redacted = raw.replaceAll(secretPlaintext, '[redacted]');
	if (encoded !== secretPlaintext) {
		redacted = redacted.replaceAll(encoded, '[redacted]');
	}

	// Truncate AFTER every replacement: truncating first could cut a match in half and
	// leave a live fragment of the secret (or its encoded form) in the final message.
	return redacted.slice(0, 300);
}
