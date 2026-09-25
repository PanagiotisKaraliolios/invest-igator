import { describe, expect, test } from 'bun:test';
import { generateText, isStepCount, type ToolSet, tool } from 'ai';
import { PORTFOLIO_ANALYST } from '../../prompts/portfolio-analyst';
import { platformModel } from '../../registry';
import { ALL_TOOLS } from '../../tools/registry';
import { judgeToolChoices, sampleToolChoices } from './eval-harness';

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
 * Determinism comes from asserting on tool names, never on prose, and from asking each prompt
 * `TOOL_CHOICE_SAMPLES` (3) times and passing on a 2-of-3 majority: one sample failed the
 * 2026-09-25 nightly on model noise alone. See `./eval-harness.ts`, tested hermetically in
 * `eval-harness.test.ts`, for the sampling, the vote, and why invalid tool calls are not voted on.
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

/**
 * `expected`: the tool `prompt` must call, or `null` for no tool at all. On failure the message
 * lists every sample's tool calls, finish reason and the start of its reply.
 */
async function expectToolChoice(prompt: string, expected: string | null): Promise<void> {
	const { model } = platformModel();
	const samples = await sampleToolChoices(() =>
		generateText({
			instructions: PORTFOLIO_ANALYST.text,
			model,
			prompt,
			stopWhen: isStepCount(1),
			telemetry: { functionId: 'eval.tool-choice', recordInputs: false, recordOutputs: false },
			tools: SELECTION_TOOLS
		})
	);
	const verdict = judgeToolChoices(samples, expected);
	expect(verdict.pass, `${JSON.stringify(prompt)}: ${verdict.report}`).toBe(true);
}

describe.skipIf(!LIVE)(
	'Tier 1 — golden tool-selection set (nightly; best of 3 per prompt, ~$0.15/run; alerts, does not gate a merge)',
	() => {
		test('"what is in my portfolio?" -> portfolio_structure', async () => {
			await expectToolChoice('What is in my portfolio right now?', 'portfolio_structure');
		});

		test('"how have I done this year?" -> portfolio_performance', async () => {
			await expectToolChoice('How has my portfolio performed this year?', 'portfolio_performance');
		});

		test('"what did I buy in March?" -> transactions_search', async () => {
			await expectToolChoice('What did I buy in March 2026?', 'transactions_search');
		});

		test('"show my watchlist" -> watchlist_list', async () => {
			await expectToolChoice('Show me my watchlist.', 'watchlist_list');
		});

		test('"AAPL last 30 days" -> market_priceHistory', async () => {
			await expectToolChoice("What has AAPL's close done over the last 30 days?", 'market_priceHistory');
		});

		test('NEGATIVE: "who are you?" calls no tool at all', async () => {
			await expectToolChoice('Who are you?', null);
		});

		test('NEGATIVE: "what is a stock split?" calls no tool at all', async () => {
			await expectToolChoice('What is a stock split?', null);
		});
	}
);
