import { fxRatesTool } from './fx-rates';
import { goalsListTool } from './goals-list';
import { marketPriceHistoryTool } from './market-price-history';
import { portfolioPerformanceTool } from './portfolio-performance';
import { portfolioStructureTool } from './portfolio-structure';
import { transactionsSearchTool } from './transactions-search';
import type { AppTool, ToolCtx } from './types';
import { watchlistListTool } from './watchlist-list';

/** The Phase 0 tool surface. Every one is read-only and closed over ctx.userId. */
export const ALL_TOOLS: AppTool[] = [
	portfolioStructureTool,
	portfolioPerformanceTool,
	transactionsSearchTool,
	watchlistListTool,
	marketPriceHistoryTool,
	goalsListTool,
	fxRatesTool
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
