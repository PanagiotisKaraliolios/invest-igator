/**
 * Persistent, non-dismissible AI disclosure (EU AI Act Art. 50: users interacting with an AI
 * system must be informed they are doing so). Intentionally has no close/hide affordance.
 */
export function Disclosure() {
	return (
		<p className='px-4 py-2 text-muted-foreground text-xs' role='note'>
			AI assistant — informational only, not financial advice.
		</p>
	);
}
