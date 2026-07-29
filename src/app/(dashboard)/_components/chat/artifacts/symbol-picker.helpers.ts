/**
 * The user turn a picked candidate produces. Kept as a pure function so the wording is
 * testable without rendering the chat.
 */
export function pickMessage(symbol: string): string {
	return `Use ${symbol.trim()}`;
}
