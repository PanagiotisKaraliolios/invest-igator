'use client';

/**
 * Collapsible "used <toolName>" affordance. Always rendered by `renderArtifact` regardless of
 * `part.state`, so the user can see which tool ran even before/without a rendered artifact
 * (e.g. `input-streaming`, `input-available`, or a tool with no renderer).
 */
export function ToolCallChip(props: { toolName: string; state?: string }) {
	return (
		<span className='inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-muted-foreground text-xs'>
			used {props.toolName}
			{props.state && props.state !== 'output-available' ? ` (${props.state})` : ''}
		</span>
	);
}
