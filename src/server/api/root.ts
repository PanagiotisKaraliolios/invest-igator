import { accountRouter } from '@/server/api/routers/account';
import { authRouter } from '@/server/api/routers/auth';
import { watchlistRouter } from '@/server/api/routers/watchlist';
import { createCallerFactory, createTRPCRouter } from '@/server/api/trpc';
import { adminRouter } from './routers/admin';
import { currencyProcedures } from './routers/currency';
import { fxRouter } from './routers/fx';
import { goalsRouter } from './routers/goals';
import { portfolioRouter } from './routers/portfolio';
import { themeProcedures } from './routers/theme';
import { transactionsRouter } from './routers/transactions';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 *
 * ## Available Routers
 *
 * ### account
 * User account management including profile, passwords, 2FA, email changes, and OAuth connections.
 * All procedures require authentication.
 *
 * Key procedures:
 * - `getMe` - Get current user profile
 * - `updateProfile` - Update name and avatar
 * - `changePassword` - Change password with verification
 * - `setPassword` - Set password for OAuth users
 * - `getTwoFactorState` - Check 2FA status
 * - `requestEmailChange` - Initiate email change
 * - `deleteAccount` - Permanently delete account
 *
 * ### admin
 * Admin-only procedures for user management and statistics.
 * All procedures require authentication and admin role.
 *
 * Key procedures:
 * - `listUsers` - List users with search and pagination
 * - `setRole` - Set user role (admin/user)
 * - `banUser` - Ban a user
 * - `unbanUser` - Unban a user
 * - `removeUser` - Delete a user
 * - `getStats` - Get admin statistics
 *
 * ### auth
 * Authentication operations for signup, login, and password reset.
 * All procedures are public.
 *
 * Key procedures:
 * - `signup` - Create new user account
 * - `checkEmail` - Check if email exists
 * - `requestPasswordReset` - Send password reset email
 * - `resetPassword` - Reset password with token
 *
 * ### currency
 * User currency preference management.
 *
 * Procedures:
 * - `getCurrency` - Get user's preferred currency
 * - `setCurrency` - Set user's preferred currency (EUR, USD, GBP, HKD, CHF, RUB)
 *
 * ### fx
 * Foreign exchange rate data.
 *
 * Procedures:
 * - `matrix` - Get FX conversion rates matrix
 *
 * ### goals
 * Financial goals tracking and management.
 *
 * Key procedures:
 * - `create` - Create a new financial goal
 * - `list` - List all user goals
 * - `update` - Update goal details
 * - `remove` - Delete a goal
 *
 * ### portfolio
 * Portfolio analytics and performance calculations.
 *
 * Key procedures:
 * - `structure` - Get current portfolio holdings with weights and values
 * - `performance` - Calculate TWR/MWR returns over date range
 *
 * ### theme
 * User theme (light/dark mode) preferences.
 *
 * Procedures:
 * - `getTheme` - Get user's theme preference
 * - `setTheme` - Set theme to 'light' or 'dark'
 *
 * ### transactions
 * Investment transaction management with CSV import/export.
 *
 * Key procedures:
 * - `create` - Create new transaction
 * - `list` - List with filters and pagination
 * - `update` - Update transaction details
 * - `remove` - Delete single transaction
 * - `bulkRemove` - Delete multiple transactions
 * - `importCsv` - Import transactions from CSV with duplicate detection
 * - `exportCsv` - Export transactions to CSV
 *
 * ### watchlist
 * Watchlist management with market data from InfluxDB.
 *
 * Key procedures:
 * - `add` - Add symbol to watchlist
 * - `list` - Get all watchlist items
 * - `remove` - Remove symbol from watchlist
 * - `search` - Search for symbols via Finnhub
 * - `history` - Get historical price data
 * - `events` - Get corporate events (dividends, splits)
 * - `toggleStar` - Star/unstar symbols (max 5)
 *
 * @example
 * // Server-side usage
 * import { api } from '@/trpc/server';
 * const user = await api.account.getMe.query();
 *
 * @example
 * // Client-side usage
 * import { api } from '@/trpc/react';
 * const { data: user } = api.account.getMe.useQuery();
 */
export const appRouter = createTRPCRouter({
	account: accountRouter,
	admin: adminRouter,
	auth: authRouter,
	currency: currencyProcedures,
	fx: fxRouter,
	goals: goalsRouter,
	portfolio: portfolioRouter,
	theme: themeProcedures,
	transactions: transactionsRouter,
	watchlist: watchlistRouter
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
