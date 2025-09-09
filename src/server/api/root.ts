import { authRouter } from '@/server/api/routers/auth';
import { postRouter } from '@/server/api/routers/post';
import { watchlistRouter } from '@/server/api/routers/watchlist';
import { createCallerFactory, createTRPCRouter } from '@/server/api/trpc';
import { themeProcedures } from './routers/theme';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
	auth: authRouter,
	post: postRouter,
	theme: themeProcedures,
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
