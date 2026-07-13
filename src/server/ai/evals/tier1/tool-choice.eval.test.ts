import { describe, expect, test } from 'bun:test';
import { generateText, isStepCount, type ToolSet, tool } from 'ai';
import { PORTFOLIO_ANALYST } from '../../prompts/portfolio-analyst';
import { platformModel } from '../../registry';
import { ALL_TOOLS } from '../../tools/registry';

const LIVE = process.env.AI_EVAL_LIVE === '1';

/**
 * Tools declared WITHOUT `execute` make generateText halt with finishReason
 * 'tool-calls' and populate result.toolCalls. That is the tool-selection primitive:
 * no data is read, no tool runs, and we assert on the SELECTION.
 *
 * The dot -> underscore mapping is the same one `toAiSdkTools` applies
 * ('portfolio.structure' -> 'portfolio_structure'); dots are illegal in AI SDK tool keys.
 *
 * NOTE: no `temperature`, no `seed`. Azure GPT-5.x returns 400 on both.
 * Determinism comes from asserting on tool names, never on prose.
 *
 * `describe.skipIf(!LIVE)` below means this whole suite is SKIPPED (not run, not a network
 * call) whenever AI_EVAL_LIVE is unset — which is every merge-gate run of `bun test src`.
 */
const SELECTION_TOOLS: ToolSet = Object.fromEntries(
	ALL_TOOLS.map((t) => [
		t.name.replaceAll('.', '_'),
		tool({ description: t.description, inputSchema: t.inputSchema })
	])
);

async function chosenTools(prompt: string): Promise<string[]> {
	const { model } = platformModel();
	const result = await generateText({
		instructions: PORTFOLIO_ANALYST.text,
		model,
		prompt,
		stopWhen: isStepCount(1),
		telemetry: { functionId: 'eval.tool-choice', recordInputs: false, recordOutputs: false },
		tools: SELECTION_TOOLS
	});
	// A hallucinated tool name (or unparsable input, with no `repairToolCall` configured) is
	// swallowed by the AI SDK into `dynamicToolCalls` as `{ dynamic: true, invalid: true }`
	// rather than thrown — verified directly against node_modules/ai/dist/index.js
	// (`parseToolCall`'s outer catch), NOT assumed. It never appears in `result.toolCalls`, so a
	// suite that only reads `toolCalls` would never notice the model naming a tool that does
	// not exist. Assert it on every call, not just the golden-set ones — a hallucination can
	// show up right alongside a correct pick.
	expect(result.dynamicToolCalls.filter((c) => c.invalid)).toEqual([]);
	return result.toolCalls.map((c) => c.toolName).sort();
}

describe.skipIf(!LIVE)(
	'Tier 1 — golden tool-selection set (nightly; ~$0.05/run; alerts, does not gate a merge)',
	() => {
		test('"what is in my portfolio?" -> portfolio_structure', async () => {
			expect(await chosenTools('What is in my portfolio right now?')).toContain('portfolio_structure');
		});

		test('"how have I done this year?" -> portfolio_performance', async () => {
			expect(await chosenTools('How has my portfolio performed this year?')).toContain('portfolio_performance');
		});

		test('"what did I buy in March?" -> transactions_search', async () => {
			expect(await chosenTools('What did I buy in March 2026?')).toContain('transactions_search');
		});

		test('"show my watchlist" -> watchlist_list', async () => {
			expect(await chosenTools('Show me my watchlist.')).toContain('watchlist_list');
		});

		test('"AAPL last 30 days" -> market_priceHistory', async () => {
			expect(await chosenTools("What has AAPL's close done over the last 30 days?")).toContain(
				'market_priceHistory'
			);
		});

		test('NEGATIVE: "who are you?" calls no tool at all', async () => {
			expect(await chosenTools('Who are you?')).toEqual([]);
		});

		test('NEGATIVE: "what is a stock split?" calls no tool at all', async () => {
			expect(await chosenTools('What is a stock split?')).toEqual([]);
		});
	}
);
