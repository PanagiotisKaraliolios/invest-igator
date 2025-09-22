import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { getFxMatrix } from '@/server/fx';

export const fxRouter = createTRPCRouter({
	matrix: publicProcedure.input(z.void()).query(async () => {
		const m = await getFxMatrix();
		return m;
	})
});
