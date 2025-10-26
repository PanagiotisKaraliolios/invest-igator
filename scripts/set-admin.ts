#!/usr/bin/env bun
/**
 * Set a user as admin by email.
 * Usage: bun scripts/set-admin.ts <email>
 */

import { db } from '../src/server/db';

const email = process.argv[2];

if (!email) {
	console.error('Usage: bun scripts/set-admin.ts <email>');
	process.exit(1);
}

async function setAdmin() {
	try {
		const user = await db.user.findUnique({
			where: { email }
		});

		if (!user) {
			console.error(`User with email "${email}" not found.`);
			process.exit(1);
		}

		await db.user.update({
			data: { role: 'admin' },
			where: { email }
		});

		console.log(`✓ User "${email}" is now an admin.`);
		console.log(`  User ID: ${user.id}`);
		console.log(`  Name: ${user.name || 'Not set'}`);
	} catch (error) {
		console.error('Error setting admin:', error);
		process.exit(1);
	} finally {
		await db.$disconnect();
	}
}

setAdmin();
