import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

// pgvector ships no alpine image. Moving musl -> glibc changes the libc collation
// provider, which silently corrupts btree indexes on text columns. We do it once,
// now, while the data is small — and we never let the pin drift back.
const PG_IMAGE = 'pgvector/pgvector:0.8.5-pg16';
const BANNED_IMAGE = 'postgres:16-alpine';

const REPO_ROOT = join(import.meta.dir, '..', '..');

// CI's e2e and migration-check jobs each `docker run` Postgres directly. If either
// drifts, CI tests a different Postgres than production runs.
const FILES = ['docker-compose.yml', '.github/workflows/ci.yml'];

/** YAML comments explain WHY we banned the old image — they must not trip the ban check. */
function stripYamlComments(source: string): string {
	return source
		.split('\n')
		.map((line) => line.replace(/#.*$/, ''))
		.join('\n');
}

/** Prisma migrations are SQL; `--` starts a line comment. Same reasoning. */
function stripSqlComments(source: string): string {
	return source
		.split('\n')
		.map((line) => line.replace(/--.*$/, ''))
		.join('\n');
}

describe('postgres image pin', () => {
	for (const relativePath of FILES) {
		test(`${relativePath} pins ${PG_IMAGE}`, async () => {
			const contents = await Bun.file(join(REPO_ROOT, relativePath)).text();
			expect(stripYamlComments(contents)).toContain(PG_IMAGE);
		});

		test(`${relativePath} runs no musl postgres image`, async () => {
			const contents = await Bun.file(join(REPO_ROOT, relativePath)).text();
			expect(stripYamlComments(contents)).not.toContain(BANNED_IMAGE);
		});
	}
});

describe('pgvector migration', () => {
	test('creates the extension idempotently and does not REINDEX inside the migration', async () => {
		const raw = await Bun.file(
			join(REPO_ROOT, 'prisma/migrations/20260713120000_enable_pgvector/migration.sql')
		).text();
		const sql = stripSqlComments(raw);

		expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector');

		// REINDEX cannot run inside a transaction block, and Prisma wraps each migration
		// in one. A REINDEX here aborts the whole migration. It is an operator step.
		expect(sql.toUpperCase()).not.toContain('REINDEX');
	});
});

describe('CI actually runs these tests', () => {
	// A pin-drift guard that CI never executes guards nothing. Task 2 adds the `unit`
	// job to ci.yml; this keeps someone from quietly deleting it.
	test('ci.yml has a unit job that runs bun run test:unit and all-checks depends on it', async () => {
		const ci = await Bun.file(join(REPO_ROOT, '.github/workflows/ci.yml')).text();
		expect(ci).toContain('bun run test:unit');
		expect(ci).toContain('needs: [lint, typecheck, unit, build, e2e]');
	});
});
