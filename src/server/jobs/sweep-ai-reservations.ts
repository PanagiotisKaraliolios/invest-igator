#!/usr/bin/env bun
import { sweepOrphanedReservations } from '@/server/ai/quota';
import { db } from '@/server/db';

/**
 * Releases AI quota reservations orphaned by a crashed or redeployed replica — a process that
 * reserved a ceiling and died before settling it. Without this, every crash permanently burns
 * quota the user never spent. Run every 5 minutes by Ofelia. Run: `bun run ai:sweep`.
 *
 * No `import 'server-only'` here: Ofelia execs this file directly as `bun run
 * src/server/jobs/sweep-ai-reservations.ts`, outside any bundler, and that marker throws in a
 * plain Bun runtime.
 */
async function main(): Promise<void> {
	const released = await sweepOrphanedReservations();
	if (released > 0) {
		console.warn(`AI quota sweep — released ${released} orphaned reservation(s).`);
	} else {
		console.log('AI quota sweep — no orphaned reservations.');
	}
}

try {
	await main();
} catch (e) {
	console.error(e);
	process.exitCode = 1;
} finally {
	await db.$disconnect();
}
