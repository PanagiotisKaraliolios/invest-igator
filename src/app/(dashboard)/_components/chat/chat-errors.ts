/**
 * Human copy for the chat route's error codes (`src/app/api/ai/chat/route.ts`, Task 6). Every
 * code the route can emit maps to a specific, actionable sentence — an unrecognized code (a
 * future route change this file hasn't caught up with) still gets a non-empty, honest fallback
 * rather than surfacing raw JSON or a blank state.
 */
const COPY: Record<string, string> = {
	CHAT_FAILED: 'Something went wrong. Please try again.',
	CREDENTIAL_REJECTED: 'Your provider key was rejected — check Settings → AI.',
	NO_PLATFORM_MODEL: 'No platform model is configured. Add your own key in Settings → AI.',
	NO_SUCH_CREDENTIAL: 'That provider is not set up. Add a key in Settings → AI.',
	QUOTA_EXCEEDED: 'You have hit your usage limit.'
};

export function errorCopy(code: string): string {
	return COPY[code] ?? 'Something went wrong. Please try again.';
}
