import { type ToolSet, tool } from 'ai';
import type { AppTool, ToolCtx } from '../types';

/**
 * AppTool[] -> the AI SDK's ToolSet (chat, Phase 1).
 *
 * ai@7: tool({ description, inputSchema, outputSchema, execute }) — `inputSchema`, NOT `parameters`.
 *
 * Tool names: the AI SDK requires /^[a-zA-Z0-9_-]{1,64}$/ — a dot is illegal — so the canonical
 * dot form is mapped to underscores here and only here. The canonical names contain no underscore
 * of their own (registry.test.ts enforces that), which is what makes the mapping reversible; the
 * guard below turns any future violation into a build-time throw instead of a wrong reverse lookup.
 */

const AI_SDK_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function toAiSdkToolName(name: string): string {
	return name.replaceAll('.', '_');
}

export function fromAiSdkToolName(name: string): string {
	return name.replaceAll('_', '.');
}

export function toAiSdkTools(defs: AppTool[], ctx: ToolCtx): ToolSet {
	const set: ToolSet = {};
	for (const def of defs) {
		const key = toAiSdkToolName(def.name);
		if (!AI_SDK_TOOL_NAME.test(key) || key.includes('_') !== def.name.includes('.')) {
			throw new Error(`Illegal AI SDK tool name: ${def.name} -> ${key}`);
		}
		set[key] = tool({
			description: def.description,
			// ctx is closed over here. The model supplies `input` and nothing else —
			// it has no way to reach userId. The SDK's abortSignal is threaded in so a
			// cancelled stream cancels the tool's I/O.
			execute: async (input: unknown, options: { abortSignal?: AbortSignal }) =>
				def.execute(input, options.abortSignal ? { ...ctx, abortSignal: options.abortSignal } : ctx),
			inputSchema: def.inputSchema,
			outputSchema: def.outputSchema
		});
	}
	return set;
}
