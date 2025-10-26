import { TRPCError } from '@trpc/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

/**
 * Admin Router
 *
 * Provides admin-only procedures for user management and statistics.
 * All procedures require authentication and admin role.
 *
 * Role Hierarchy:
 * - superadmin: Can manage all users including other admins
 * - admin: Can manage regular users but not superadmins or other admins
 * - user: Regular user with no admin privileges
 */

/**
 * Middleware to check if user is an admin (admin or superadmin)
 */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const userRole = ctx.session.user.role;

	console.log('🚀 ~ admin.ts:24 ~ userRole:', userRole);

	if (userRole !== 'superadmin' && userRole !== 'admin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Admin access required'
		});
	}
	return next({ ctx });
});

/**
 * Middleware to check if user is a superadmin
 */
const superadminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	if (ctx.session.user.role !== 'superadmin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Superadmin access required'
		});
	}
	return next({ ctx });
});

export const adminRouter = createTRPCRouter({
	/**
	 * Ban a user
	 * - Admins can ban regular users
	 * - Only superadmins can ban admins
	 * - No one can ban a superadmin
	 * - Cannot ban yourself
	 */
	banUser: adminProcedure
		.input(
			z.object({
				banReason: z.string().optional(),
				userId: z.string()
			})
		)
		.mutation(async ({ input, ctx }) => {
			const currentUserRole = ctx.session.user.role;

			// Prevent users from banning themselves
			if (input.userId === ctx.session.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You cannot ban yourself'
				});
			}

			// Get the target user to check their role
			const targetUser = await ctx.db.user.findUnique({
				select: { role: true },
				where: { id: input.userId }
			});

			if (!targetUser) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'User not found'
				});
			}

			// Cannot ban superadmins
			if (targetUser.role === 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Superadmin accounts cannot be banned'
				});
			}

			// Only superadmins can ban admins
			if (targetUser.role === 'admin' && currentUserRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can ban admin accounts'
				});
			}

			const response = await auth.api.banUser({
				body: {
					banReason: input.banReason,
					userId: input.userId
				},
				headers: ctx.headers
			});

			if (!response) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Failed to ban user'
				});
			}

			return { success: true };
		}),

	/**
	 * Get admin statistics
	 */
	getStats: adminProcedure.query(async ({ ctx }) => {
		const [totalUsers, activeUsers, recentSignups, bannedUsers] = await Promise.all([
			// Total users
			ctx.db.user.count(),

			// Active users (users with at least one session in last 30 days)
			ctx.db.session
				.findMany({
					distinct: ['userId'],
					where: {
						createdAt: {
							gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
						}
					}
				})
				.then((sessions) => sessions.length),

			// Users signed up in last 7 days
			ctx.db.user.count({
				where: {
					createdAt: {
						gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
					}
				}
			}),

			// Banned users
			ctx.db.user.count({
				where: {
					banned: true
				}
			})
		]);

		return {
			activeUsers,
			bannedUsers,
			recentSignups,
			totalUsers
		};
	}),

	/**
	 * List users with optional search and pagination
	 */
	listUsers: adminProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(10),
				offset: z.number().min(0).default(0),
				searchField: z.enum(['email', 'name']).optional(),
				searchOperator: z.enum(['contains', 'starts_with', 'ends_with']).optional(),
				searchValue: z.string().optional()
			})
		)
		.query(async ({ input, ctx }) => {
			const response = await auth.api.listUsers({
				headers: ctx.headers,
				query: {
					limit: input.limit,
					offset: input.offset,
					searchField: input.searchField,
					searchOperator: input.searchOperator,
					searchValue: input.searchValue
				}
			});

			if (!response) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Failed to fetch users'
				});
			}

			return {
				limit: input.limit,
				offset: input.offset,
				total: response.total,
				users: response.users.map((u) => ({
					banned: u.banned ?? false,
					banReason: u.banReason,
					createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
					email: u.email,
					emailVerified: u.emailVerified,
					id: u.id,
					name: u.name,
					role: u.role ?? 'user'
				}))
			};
		}),

	/**
	 * Delete a user
	 * - Admins can delete regular users
	 * - Only superadmins can delete admins
	 * - No one can delete a superadmin
	 * - Cannot delete yourself
	 */
	removeUser: adminProcedure
		.input(
			z.object({
				userId: z.string()
			})
		)
		.mutation(async ({ input, ctx }) => {
			const currentUserRole = ctx.session.user.role;

			// Get the target user to check their role
			const targetUser = await ctx.db.user.findUnique({
				select: { id: true, role: true },
				where: { id: input.userId }
			});

			if (!targetUser) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'User not found'
				});
			}

			// Prevent users from deleting themselves
			if (targetUser.id === ctx.session.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You cannot delete your own account through admin panel'
				});
			}

			// Cannot delete superadmins
			if (targetUser.role === 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Superadmin accounts cannot be deleted'
				});
			}

			// Only superadmins can delete admins
			if (targetUser.role === 'admin' && currentUserRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can delete admin accounts'
				});
			}

			const response = await auth.api.removeUser({
				body: {
					userId: input.userId
				},
				headers: ctx.headers
			});

			if (!response) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Failed to delete user'
				});
			}

			return { success: true };
		}),

	/**
	 * Set user role (admin, superadmin, or user)
	 * - Users cannot change their own role
	 * - Only superadmins can set the superadmin role
	 * - Only superadmins can change admin roles
	 * - Admins can only change regular user roles
	 */
	setRole: adminProcedure
		.input(
			z.object({
				role: z.enum(['superadmin', 'admin', 'user']),
				userId: z.string()
			})
		)
		.mutation(async ({ input, ctx }) => {
			const currentUserRole = ctx.session.user.role;

			// Prevent users from changing their own role
			if (input.userId === ctx.session.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You cannot change your own role'
				});
			}

			// Get the target user to check their current role
			const targetUser = await ctx.db.user.findUnique({
				select: { id: true, role: true },
				where: { id: input.userId }
			});

			if (!targetUser) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'User not found'
				});
			}

			// Prevent users from changing their own role
			if (targetUser.id === ctx.session.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You cannot change your own role'
				});
			}

			// Only superadmins can set the superadmin role
			if (input.role === 'superadmin' && currentUserRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can assign the superadmin role'
				});
			}

			// Only superadmins can modify superadmin accounts
			if (targetUser.role === 'superadmin' && currentUserRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can modify superadmin accounts'
				});
			}

			// Only superadmins can modify admin accounts
			if (targetUser.role === 'admin' && currentUserRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can modify admin accounts'
				});
			}

			// Only superadmins can change users to admin role
			if (input.role === 'admin' && currentUserRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can assign the admin role'
				});
			}

			const response = await auth.api.setRole({
				body: {
					role: input.role as 'admin' | 'user',
					userId: input.userId
				},
				headers: ctx.headers
			});

			if (!response) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Failed to update user role'
				});
			}

			return { success: true };
		}),

	/**
	 * Unban a user
	 * - Admins can unban regular users
	 * - Only superadmins can unban admins
	 * - Cannot unban yourself (should never be banned)
	 */
	unbanUser: adminProcedure
		.input(
			z.object({
				userId: z.string()
			})
		)
		.mutation(async ({ input, ctx }) => {
			const currentUserRole = ctx.session.user.role;

			// Prevent users from unbanning themselves (should not be possible, but add check for safety)
			if (input.userId === ctx.session.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You cannot unban yourself'
				});
			}

			// Get the target user to check their role
			const targetUser = await ctx.db.user.findUnique({
				select: { role: true },
				where: { id: input.userId }
			});

			if (!targetUser) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'User not found'
				});
			}

			// Only superadmins can unban admins
			if (targetUser.role === 'admin' && currentUserRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can unban admin accounts'
				});
			}

			const response = await auth.api.unbanUser({
				body: {
					userId: input.userId
				},
				headers: ctx.headers
			});

			if (!response) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Failed to unban user'
				});
			}

			return { success: true };
		})
});
