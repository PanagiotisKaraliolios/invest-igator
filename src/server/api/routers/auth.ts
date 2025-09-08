import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
	createTRPCRouter,
	publicProcedure,
	protectedProcedure,
} from "@/server/api/trpc";
import { env } from "@/env";
import * as bcrypt from "bcryptjs";

export const authRouter = createTRPCRouter({
	checkEmail: publicProcedure
		.input(z.email())
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({ where: { email: input } });
			return { exists: Boolean(user) } as const;
		}),

	signup: publicProcedure
		.input(
			z.object({
				name: z.string().min(1),
				email: z.email(),
				password: z.string().min(1),
				// accept but ignore confirmPassword to keep client compatibility
				confirmPassword: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const name = input.name.trim();
			const email = input.email.trim().toLowerCase();
			const password = input.password;

			const existing = await ctx.db.user.findUnique({ where: { email } });
			if (existing) {
				// Throw a TRPC error so clients can catch it in mutateAsync
				throw new TRPCError({
					code: "CONFLICT",
					message: "A user with this email already exists",
				});
			}

			const pepper = env.PASSWORD_PEPPER ?? "";
			const passwordHash = await bcrypt.hash(`${password}${pepper}`, 12);
			await ctx.db.user.create({ data: { name, email, passwordHash } });
			return { ok: true } as const;
		}),
});
