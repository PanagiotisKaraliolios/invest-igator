const REDACTED = '[redacted]';

/**
 * Credential-SHAPED substrings, stripped whether or not the exact plaintext is known. This is the
 * whole defence when a caller has no plaintext in scope (see `secretPlaintext` below), and a
 * backstop when it does. It cannot recognise an unlabelled key of an unknown shape — which is why
 * a caller that HAS the plaintext must still pass it.
 *
 * Header/query labels REQUIRE an explicit `:`/`=` separator, so ordinary provider prose
 * ("Incorrect API key provided") survives for the user to read.
 */
const CREDENTIAL_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
	// `Authorization: Bearer <t>`, `"x-api-key":"<t>"`, `api-key=<t>`, `x-goog-api-key: <t>` —
	// the header forms OpenAI, Anthropic, Azure and Google send, in raw, JSON and inspect()
	// spellings. The optional `Bearer`/`Basic` scheme word is consumed so the token after it goes.
	[
		/(\b(?:authorization|(?:x-(?:goog-)?)?api[-_]?key)["']?\s*[:=]\s*["']?)(?:(?:bearer|basic)\s+)?[^\s"',;}&]+/gi,
		`$1${REDACTED}`
	],
	// A bearer token whose header name is not in the message.
	[/\b(bearer\s+)[\w.~+/=-]{8,}/gi, `$1${REDACTED}`],
	// Google's REST API takes the key as a query parameter.
	[/([?&](?:key|api[-_]?key)=)[^&#\s"']+/gi, `$1${REDACTED}`],
	// Known key prefixes: OpenAI and Anthropic (`sk-…`), Google (`AIza…`).
	[/\bsk-[\w-]{8,}/g, REDACTED],
	[/\bAIza[\w-]{35,}/g, REDACTED]
];

/**
 * Provider SDK and HTTP errors embed the request config, INCLUDING the auth header.
 * Serialising one into a tRPC error body leaks the user's key straight back to the
 * browser (and into any log that captures it). Pick fields explicitly, redact the
 * plaintext defensively, and truncate.
 *
 * Applied at every boundary a provider error can cross on its way to the browser: the
 * save-time probe (`probe.ts`), model listing (`list-models.ts`, which wraps its own
 * provider-contacting work in this redactor before rethrowing), and the tRPC layer that
 * formats whatever error escapes into the response sent to the client. Also applied where
 * a provider error is LOGGED server-side (`aiImport.preview`): a log line is a leak route
 * too. One redaction implementation, audited once.
 *
 * `secretPlaintext` is the key the failing request carried. Pass `null` ONLY when it is
 * genuinely not in scope — e.g. `aiImport.preview`, where `resolveModel` keeps the decrypted
 * key inside the provider it builds — and the credential-shaped pattern pass above is then
 * the only redaction. An empty string is treated as `null`: `replaceAll('', ...)` would
 * splice `[redacted]` between every character of the message.
 */
export function safeProviderErrorMessage(error: unknown, secretPlaintext: string | null): string {
	if (!(error instanceof Error)) return 'Unknown provider error';

	// A plain `Error` carries no useful type information in `name` — showing "Error: " is
	// pure noise, and `list-models.ts` already routes its own throw through THIS function
	// before rethrowing, so a second pass here (e.g. in the tRPC layer) would otherwise
	// double the prefix into "Error: Error: ...". Named subclasses (TypeError,
	// InvalidCredentialError, ...) DO carry information — keep the prefix for those.
	const raw = error.name === 'Error' ? error.message : `${error.name}: ${error.message}`;

	let redacted = raw;
	if (secretPlaintext) {
		// GOOGLE URL-encodes the secret into the query string (`encodeURIComponent(secret)`),
		// so a plaintext-only replace leaves the percent-encoded form (which differs whenever
		// the secret contains `+ / = & :` etc.) sitting in the message, trivially decodable.
		// Redact both forms whenever they differ.
		const encoded = encodeURIComponent(secretPlaintext);
		redacted = redacted.replaceAll(secretPlaintext, REDACTED);
		if (encoded !== secretPlaintext) {
			redacted = redacted.replaceAll(encoded, REDACTED);
		}
	}
	for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
		redacted = redacted.replace(pattern, replacement);
	}

	// Truncate AFTER every replacement: truncating first could cut a match in half and
	// leave a live fragment of the secret (or its encoded form) in the final message.
	return redacted.slice(0, 300);
}
