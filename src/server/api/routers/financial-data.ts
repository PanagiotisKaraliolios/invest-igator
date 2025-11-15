import type { Currency } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { db } from '@/server/db';
import { influxQueryApi, measurement } from '@/server/influx';
import { fetchYahooDaily, ingestYahooSymbol } from '@/server/jobs/yahoo-lib';

/**
 * Financial Data Management Router
 *
 * Provides admin procedures for managing financial data:
 * - Symbol management across watchlists
 * - Data quality checks (missing OHLCV, failed ingestions)
 * - Manual data triggers (force re-fetch)
 * - FX rate monitoring
 *
 * All procedures require admin role.
 */

const AUDIT_ACTIONS = {
	MANUAL_DATA_FETCH: 'MANUAL_DATA_FETCH',
	SYMBOL_UPDATE: 'SYMBOL_UPDATE',
	VIEW_DATA_QUALITY: 'VIEW_DATA_QUALITY',
	VIEW_FX_RATES: 'VIEW_FX_RATES',
	VIEW_SYMBOLS: 'VIEW_SYMBOLS'
} as const;

/**
 * Middleware to check if user is an admin (admin or superadmin)
 */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const userRole = ctx.session.user.role;

	if (userRole !== 'superadmin' && userRole !== 'admin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Admin access required'
		});
	}
	return next({ ctx });
});

export const financialDataRouter = createTRPCRouter({
	/**
	 * Check data quality for symbols - identify missing OHLCV data
	 */
	checkDataQuality: adminProcedure
		.input(
			z.object({
				endDate: z.date().optional(),
				limit: z.number().min(1).max(100).default(20),
				startDate: z.date().optional(),
				symbol: z.string().optional()
			})
		)
		.query(async ({ input, ctx }) => {
			const { symbol, startDate, endDate, limit } = input;

			// Get distinct symbols to check
			const symbolsToCheck = symbol
				? [symbol]
				: (
						await ctx.db.watchlistItem.findMany({
							distinct: ['symbol'],
							select: { symbol: true },
							take: limit
						})
					).map((s) => s.symbol);

			const results = await Promise.all(
				symbolsToCheck.map(async (sym) => {
					try {
						// Build Flux query to check data availability
						const start = startDate ? startDate.toISOString() : '-1y';
						const end = endDate ? endDate.toISOString() : 'now()';

						const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: ${typeof start === 'string' ? start : `time(v: "${start}")`}, stop: ${typeof end === 'string' ? end : `time(v: "${end}")`})
  |> filter(fn: (r) => r._measurement == "${measurement}" and r._field == "close" and r.symbol == "${sym}")
  |> keep(columns: ["_time", "_value"])
  |> limit(n: 1000)`;

						let dataPointCount = 0;
						for await (const row of influxQueryApi.iterateRows(flux)) {
							let values: unknown;
							let tableMeta: any;
							if (Array.isArray(row)) {
								values = row[0];
								tableMeta = row[1];
							} else if (row && typeof row === 'object' && 'values' in (row as any)) {
								values = (row as any).values;
								tableMeta = (row as any).tableMeta;
							}
							if (!values || !tableMeta || typeof tableMeta.toObject !== 'function') continue;
							const obj = tableMeta.toObject(values as string[]);
							if (obj._time) {
								dataPointCount++;
							}
						}

						// Get user count for this symbol
						const userCount = await ctx.db.watchlistItem.count({
							where: { symbol: sym }
						});

						return {
							dataPointCount,
							hasData: dataPointCount > 0,
							symbol: sym,
							userCount
						};
					} catch (error) {
						console.error(`Error checking data for ${sym}:`, error);
						return {
							dataPointCount: 0,
							error: error instanceof Error ? error.message : 'Unknown error',
							hasData: false,
							symbol: sym,
							userCount: 0
						};
					}
				})
			);

			// Log audit action
			try {
				await ctx.db.auditLog.create({
					data: {
						action: AUDIT_ACTIONS.VIEW_DATA_QUALITY,
						adminEmail: ctx.session.user.email,
						adminId: ctx.session.user.id,
						details: JSON.stringify({ endDate, startDate, symbol })
					}
				});
			} catch (error) {
				console.error('Failed to create audit log entry:', error);
			}

			return {
				results: results.sort((a, b) => a.dataPointCount - b.dataPointCount), // Show symbols with least data first
				totalChecked: results.length
			};
		}),
	/**
	 * Get all unique symbols across all watchlists with usage stats
	 */
	getAllSymbols: adminProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(50),
				page: z.number().min(1).default(1),
				search: z.string().optional(),
				sortBy: z.enum(['symbol', 'users', 'createdAt']).default('symbol'),
				sortDir: z.enum(['asc', 'desc']).default('asc')
			})
		)
		.query(async ({ input, ctx }) => {
			const { search, sortBy, sortDir, page, limit } = input;
			const offset = (page - 1) * limit;

			// Build where clause for search
			const whereClause = search
				? {
						OR: [
							{ symbol: { contains: search, mode: 'insensitive' as const } },
							{ displaySymbol: { contains: search, mode: 'insensitive' as const } },
							{ description: { contains: search, mode: 'insensitive' as const } }
						]
					}
				: {};

			// Get grouped symbols with user count
			const symbols = await ctx.db.watchlistItem.groupBy({
				_count: { userId: true },
				by: ['symbol', 'displaySymbol', 'description', 'type', 'currency'],
				orderBy:
					sortBy === 'users'
						? { _count: { userId: sortDir } }
						: sortBy === 'symbol'
							? { symbol: sortDir }
							: { symbol: sortDir }, // createdAt not available in groupBy
				skip: offset,
				take: limit,
				where: whereClause
			});

			// Get total count
			const totalCount = await ctx.db.watchlistItem.groupBy({
				by: ['symbol'],
				where: whereClause
			});

			// Get earliest creation date for each symbol
			const symbolsWithDates = await Promise.all(
				symbols.map(async (s) => {
					const earliest = await ctx.db.watchlistItem.findFirst({
						orderBy: { createdAt: 'asc' },
						select: { createdAt: true },
						where: { symbol: s.symbol }
					});
					return {
						createdAt: earliest?.createdAt ?? new Date(),
						currency: s.currency,
						description: s.description,
						displaySymbol: s.displaySymbol,
						symbol: s.symbol,
						type: s.type,
						userCount: s._count.userId
					};
				})
			);

			// Log audit action
			try {
				await ctx.db.auditLog.create({
					data: {
						action: AUDIT_ACTIONS.VIEW_SYMBOLS,
						adminEmail: ctx.session.user.email,
						adminId: ctx.session.user.id,
						details: JSON.stringify({ search, sortBy, sortDir })
					}
				});
			} catch (error) {
				console.error('Failed to create audit log entry:', error);
			}

			return {
				hasMore: totalCount.length > offset + limit,
				symbols: symbolsWithDates,
				total: totalCount.length
			};
		}),

	/**
	 * Get FX rates with monitoring data
	 */
	getFxRates: adminProcedure
		.input(
			z.object({
				base: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).optional(),
				quote: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).optional()
			})
		)
		.query(async ({ input, ctx }) => {
			const { base, quote } = input;

			const whereClause: any = {};
			if (base) whereClause.base = base;
			if (quote) whereClause.quote = quote;

			// Get all FX rates with filters
			const rates = await ctx.db.fxRate.findMany({
				orderBy: [{ base: 'asc' }, { quote: 'asc' }],
				where: whereClause
			});

			// Get update frequency statistics
			const now = new Date();
			const stats = {
				averageAgeHours: 0,
				oldestUpdate: null as Date | null,
				recentUpdate: null as Date | null,
				totalRates: rates.length
			};

			if (rates.length > 0) {
				const ages = rates.map((r) => now.getTime() - r.fetchedAt.getTime());
				stats.averageAgeHours = ages.reduce((a, b) => a + b, 0) / ages.length / (1000 * 60 * 60);
				stats.oldestUpdate = new Date(Math.min(...rates.map((r) => r.fetchedAt.getTime())));
				stats.recentUpdate = new Date(Math.max(...rates.map((r) => r.fetchedAt.getTime())));
			}

			// Log audit action
			try {
				await ctx.db.auditLog.create({
					data: {
						action: AUDIT_ACTIONS.VIEW_FX_RATES,
						adminEmail: ctx.session.user.email,
						adminId: ctx.session.user.id,
						details: JSON.stringify({ base, quote })
					}
				});
			} catch (error) {
				console.error('Failed to create audit log entry:', error);
			}

			return {
				rates: rates.map((r) => ({
					base: r.base,
					fetchedAt: r.fetchedAt,
					id: r.id,
					quote: r.quote,
					rate: r.rate
				})),
				stats
			};
		}),

	/**
	 * Get data ingestion history and stats
	 */
	getIngestionStats: adminProcedure.query(async ({ ctx }) => {
		// Get total unique symbols in watchlists
		const totalSymbols = await ctx.db.watchlistItem.groupBy({
			by: ['symbol']
		});

		const watchlistSymbols = new Set(totalSymbols.map((s) => s.symbol));

		// Get symbols with data in InfluxDB
		const allSymbolsInInflux: string[] = [];
		const flux = `import "influxdata/influxdb/schema"
schema.measurementTagValues(
  bucket: "${env.INFLUXDB_BUCKET}",
  measurement: "${measurement}",
  tag: "symbol"
)`;

		try {
			for await (const row of influxQueryApi.iterateRows(flux)) {
				let values: unknown;
				let tableMeta: any;
				if (Array.isArray(row)) {
					values = row[0];
					tableMeta = row[1];
				} else if (row && typeof row === 'object' && 'values' in (row as any)) {
					values = (row as any).values;
					tableMeta = (row as any).tableMeta;
				}
				if (!values || !tableMeta || typeof tableMeta.toObject !== 'function') continue;
				const obj = tableMeta.toObject(values as string[]);
				const val = obj._value;
				if (val && typeof val === 'string') {
					allSymbolsInInflux.push(val);
				}
			}
		} catch (error) {
			console.error('Error querying InfluxDB for symbols:', error);
		}

		// Only count symbols that are BOTH in watchlists AND have data
		const symbolsWithData = allSymbolsInInflux.filter((s) => watchlistSymbols.has(s));

		// Get recent manual fetches from audit log
		const recentFetches = await ctx.db.auditLog.findMany({
			orderBy: { createdAt: 'desc' },
			take: 10,
			where: { action: AUDIT_ACTIONS.MANUAL_DATA_FETCH }
		});

		return {
			coverage: totalSymbols.length > 0 ? (symbolsWithData.length / totalSymbols.length) * 100 : 0,
			recentFetches: recentFetches.map((f) => ({
				adminEmail: f.adminEmail,
				createdAt: f.createdAt,
				details: f.details,
				id: f.id
			})),
			symbolsWithData: symbolsWithData.length,
			totalSymbols: totalSymbols.length
		};
	}),

	/**
	 * Manually trigger data fetch for a specific symbol
	 */
	triggerDataFetch: adminProcedure
		.input(
			z.object({
				force: z.boolean().default(false), // Force re-fetch even if data exists
				symbol: z.string()
			})
		)
		.mutation(async ({ input, ctx }) => {
			const { symbol, force } = input;

			try {
				// Use the existing ingestYahooSymbol function
				const result = await ingestYahooSymbol(symbol);

				// Log audit action
				try {
					await ctx.db.auditLog.create({
						data: {
							action: AUDIT_ACTIONS.MANUAL_DATA_FETCH,
							adminEmail: ctx.session.user.email,
							adminId: ctx.session.user.id,
							details: JSON.stringify({
								bars: result.count,
								force,
								skipped: result.skipped,
								symbol
							})
						}
					});
				} catch (error) {
					console.error('Failed to create audit log entry:', error);
				}

				return {
					barsIngested: result.count,
					skipped: result.skipped,
					success: true,
					symbol
				};
			} catch (error) {
				console.error(`Error fetching data for ${symbol}:`, error);

				// Log failed attempt
				try {
					await ctx.db.auditLog.create({
						data: {
							action: AUDIT_ACTIONS.MANUAL_DATA_FETCH,
							adminEmail: ctx.session.user.email,
							adminId: ctx.session.user.id,
							details: JSON.stringify({
								error: error instanceof Error ? error.message : 'Unknown error',
								force,
								success: false,
								symbol
							})
						}
					});
				} catch (logError) {
					console.error('Failed to create audit log entry:', logError);
				}

				throw new TRPCError({
					cause: error,
					code: 'INTERNAL_SERVER_ERROR',
					message: `Failed to fetch data for ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`
				});
			}
		}),

	/**
	 * Update symbol metadata (displaySymbol, description, type, currency)
	 */
	updateSymbol: adminProcedure
		.input(
			z.object({
				currency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).optional(),
				description: z.string().optional(),
				displaySymbol: z.string().optional(),
				symbol: z.string(),
				type: z.string().optional()
			})
		)
		.mutation(async ({ input, ctx }) => {
			const { symbol, displaySymbol, description, type, currency } = input;

			// Update all watchlist items with this symbol
			const updated = await ctx.db.watchlistItem.updateMany({
				data: {
					currency: currency ?? undefined,
					description: description ?? undefined,
					displaySymbol: displaySymbol ?? undefined,
					type: type ?? undefined
				},
				where: { symbol }
			});

			// Log audit action
			try {
				await ctx.db.auditLog.create({
					data: {
						action: AUDIT_ACTIONS.SYMBOL_UPDATE,
						adminEmail: ctx.session.user.email,
						adminId: ctx.session.user.id,
						details: JSON.stringify({ currency, description, displaySymbol, symbol, type })
					}
				});
			} catch (error) {
				console.error('Failed to create audit log entry:', error);
			}

			return { count: updated.count, success: true };
		})
});
