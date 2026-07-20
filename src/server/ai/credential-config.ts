/**
 * Non-secret BYOK configuration handling.
 *
 * `resourceName` / `baseURL` / `apiVersion` / `deployment` / `defaultModelId` are
 * CONFIGURATION, not secrets — they live in plaintext columns because we need them to
 * build the provider and to render the settings UI. Only the API key is sealed.
 */

/** `••••` + the last four characters. The only representation of a secret we ever return. */
export function maskHint(secret: string): string {
	const last4 = secret.slice(-4);
	return last4.length === 4 ? `••••${last4}` : '••••';
}

/**
 * The Azure SDK appends `/v1{path}` to whatever baseURL it is given. A user who pastes
 * an endpoint ending in `/v1` therefore gets `/v1/v1/responses` -> 404, which is
 * indistinguishable from a bad key. Strip it at save time.
 *
 * This is a generic, provider-agnostic first pass (trim + trailing-slash + trailing-/v1)
 * applied to whatever the user pastes, for every provider. For AZURE specifically the
 * deeper Target-URI/`/openai`-segment handling lives ONE place: Task 6's
 * `normaliseAzureBaseUrl` (`@/server/ai/resolve-model`), reused (not reimplemented) by
 * both the save-time probe and every subsequent `resolveModel()` call.
 */
export function normalizeBaseUrl(raw: string): string {
	let url = raw.trim();
	while (url.endsWith('/')) url = url.slice(0, -1);
	if (url.endsWith('/v1')) url = url.slice(0, -3);
	while (url.endsWith('/')) url = url.slice(0, -1);
	return url;
}

/**
 * `createAzure({ resourceName })` wants `my-resource`, not
 * `https://my-resource.openai.azure.com/`. Users paste the latter every time.
 */
export function normalizeResourceName(raw: string): string {
	let value = raw.trim();
	value = value.replace(/^https?:\/\//, '');
	value = value.replace(/\/.*$/, '');
	value = value.replace(/\.openai\.azure\.com$/, '');
	value = value.replace(/\.cognitiveservices\.azure\.com$/, '');
	return value;
}

/**
 * @ai-sdk/azure@4 defaults `apiVersion` to the literal string 'v1'. A date is the old
 * dialect and yields a 404 on the v1 route. Reject dates at save time.
 */
export function isDateApiVersion(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}/.test(value.trim());
}
