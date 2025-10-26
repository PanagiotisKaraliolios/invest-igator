#!/usr/bin/env bun
/**
 * Database seeder for production deployments.
 * Creates a superadmin user if one doesn't exist and ADMIN_EMAIL is set.
 * 
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=securepass bun prisma/seed.ts
 * 
 * Or set environment variables in Docker:
 *   ADMIN_EMAIL, ADMIN_PASSWORD (optional), ADMIN_NAME (optional)
 */

import * as bcrypt from 'bcryptjs';
import { env } from '../src/env';
import { db } from '../src/server/db';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_NAME = process.env.ADMIN_NAME;

async function seed() {
	console.log('🌱 Starting database seed...');

	// Check if admin email is provided
	if (!ADMIN_EMAIL) {
		console.log('ℹ️  ADMIN_EMAIL not set. Skipping admin user creation.');
		console.log('   Set ADMIN_EMAIL environment variable to create an admin user.');
		return;
	}

	try {
		// Check if user already exists
		const existingUser = await db.user.findUnique({
			where: { email: ADMIN_EMAIL }
		});

		if (existingUser) {
			// User exists - ensure they have superadmin role
			if (existingUser.role !== 'superadmin') {
				await db.user.update({
					data: { role: 'superadmin' },
					where: { email: ADMIN_EMAIL }
				});
				console.log(`✓ Updated existing user "${ADMIN_EMAIL}" to superadmin role`);
			} else {
				console.log(`✓ Superadmin user "${ADMIN_EMAIL}" already exists with superadmin role`);
			}
			return;
		}

		// Create new superadmin user
		if (!ADMIN_PASSWORD) {
			console.error('❌ ADMIN_PASSWORD is required when creating a new superadmin user');
			process.exit(1);
		}

		// Hash password with pepper (same as Better Auth)
		const pepper = env.PASSWORD_PEPPER ?? '';
		const passwordHash = await bcrypt.hash(`${ADMIN_PASSWORD}${pepper}`, 12);

		// Create user
		const user = await db.user.create({
			data: {
				email: ADMIN_EMAIL,
				emailVerified: true,
				emailVerifiedAt: new Date(),
				name: ADMIN_NAME || 'Superadmin',
				role: 'superadmin'
			}
		});

		// Create credential account for password login
		await db.account.create({
			data: {
				accountId: user.id,
				password: passwordHash,
				providerId: 'credential',
				userId: user.id
			}
		});

		console.log(`✓ Created superadmin user: ${ADMIN_EMAIL}`);
		console.log(`  User ID: ${user.id}`);
		console.log(`  Name: ${user.name}`);
		console.log(`  Email verified: ${user.emailVerified}`);
	} catch (error) {
		console.error('❌ Error creating superadmin user:', error);
		throw error;
	} finally {
		await db.$disconnect();
	}
}

seed()
	.then(() => {
		console.log('✓ Seed completed successfully');
		process.exit(0);
	})
	.catch((error) => {
		console.error('Seed failed:', error);
		process.exit(1);
	});
