import { accountRouter } from '@/server/api/routers/account';
import { authRouter } from '@/server/api/routers/auth';
import { postRouter } from '@/server/api/routers/post';
import { watchlistRouter } from '@/server/api/routers/watchlist';
import { createCallerFactory, createTRPCRouter } from '@/server/api/trpc';
import { portfolioRouter } from './routers/portfolio';
import { themeProcedures } from './routers/theme';
import { transactionsRouter } from './routers/transactions';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
	account: accountRouter,
	auth: authRouter,
	portfolio: portfolioRouter,
	post: postRouter,
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
