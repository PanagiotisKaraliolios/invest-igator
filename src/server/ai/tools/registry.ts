import { fxRatesTool } from './fx-rates';
import { goalsListTool } from './goals-list';
import { marketPriceHistoryTool } from './market-price-history';
import { portfolioPerformanceTool } from './portfolio-performance';
import { portfolioStructureTool } from './portfolio-structure';
import { transactionsCreateTool } from './transactions-create';
import { transactionsSearchTool } from './transactions-search';
import type { AppTool, ToolCtx } from './types';
import { watchlistListTool } from './watchlist-list';

/**
 * The tool surface. All are closed over ctx.userId. The seven Phase 0 tools are read-only;
 * `transactionsCreateTool` (Phase 3a) is the one mutating tool — it only previews + signs, and
 * `buildToolset` gates it to callers holding `transactions:write` and drops it on the MCP surface.
 */
export const ALL_TOOLS: AppTool[] = [
	portfolioStructureTool,
	portfolioPerformanceTool,
	transactionsSearchTool,
	watchlistListTool,
	marketPriceHistoryTool,
	goalsListTool,
	fxRatesTool,
	transactionsCreateTool
];

/**
 * The single authorization point, shared by chat, MCP and cron.
 * MCP annotations are hints; THIS is the enforcement.
 */
export function buildToolset(ctx: ToolCtx): AppTool[] {
	return ALL_TOOLS.filter((t) => {
		if (!ctx.scopes.has(t.requiredScope)) return false;
		// Phase 0: MCP is read-only, full stop.
		if (t.mutates && ctx.surface === 'mcp') return false;
		return true;
	});
}
