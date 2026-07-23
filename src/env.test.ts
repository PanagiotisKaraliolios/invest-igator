import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');

/**
 * Every non-defaulted, non-AI server var. The app cannot boot without these.
 * All AI vars (BYOK keyring AND Azure platform) are optional: the app must boot with none
 * of them set — AI features degrade, they do not crash the app. `platformModel()` in
 * `src/server/ai/registry.ts` enforces "the platform model must exist" lazily, on first
 * use, not here.
 */
const REQUIRED: Record<string, string> = {
	AUTH_DISCORD_ID: 'test-id',
	AUTH_DISCORD_SECRET: 'test-secret',
	CLOUDFLARE_ACCESS_KEY_ID: 'test-key-id',
	CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
	CLOUDFLARE_BUCKET_NAME: 'test-bucket',
	CLOUDFLARE_SECRET_ACCESS_KEY: 'test-secret-key',
	DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/investigator',
	EMAIL_FROM: 'noreply@test.local',
	EMAIL_SERVER: 'smtp://localhost:25',
	INFLUXDB_BUCKET: 'test-bucket',
	INFLUXDB_ORG: 'test-org',
	INFLUXDB_TOKEN: 'test-token',
	PASSWORD_PEPPER: 'test-pepper',
	POLYGON_API_KEY: 'test-key'
};

const PROBE = `
const { env } = await import('./src/env.js');
console.log(
	JSON.stringify({
		AI_API_KEY_PEPPER: env.AI_API_KEY_PEPPER ?? null,
		AI_CRED_ACTIVE_KID: env.AI_CRED_ACTIVE_KID ?? null,
		AI_CRED_KEYS: env.AI_CRED_KEYS ?? null,
		AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY ?? null,
		AZURE_OPENAI_CHAT_DEPLOYMENT: env.AZURE_OPENAI_CHAT_DEPLOYMENT ?? null,
		AZURE_OPENAI_CHAT_MODEL: env.AZURE_OPENAI_CHAT_MODEL ?? null,
		AZURE_OPENAI_RESOURCE_NAME: env.AZURE_OPENAI_RESOURCE_NAME ?? null,
		ENABLE_MCP: env.ENABLE_MCP,
		POLYGON_API_URL: env.POLYGON_API_URL ?? null
	})
);
`;

/**
 * Evaluates src/env.js in a clean child process.
 * --env-file=/dev/null suppresses Bun's automatic .env load; the env we pass is the
 * ONLY environment the child sees. NODE_ENV=test keeps BETTER_AUTH_SECRET optional.
 */
function probeEnv(vars: Record<string, string>): { exitCode: number; stdout: string; stderr: string } {
	const proc = Bun.spawnSync({
		cmd: ['bun', '--env-file=/dev/null', '-e', PROBE],
		cwd: REPO_ROOT,
		env: { HOME: process.env.HOME ?? '', NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...vars },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	return {
		exitCode: proc.exitCode ?? -1,
		stderr: proc.stderr.toString(),
		stdout: proc.stdout.toString()
	};
}

describe('env', () => {
	test('parses with every AI var absent — the app boots without AI configured', () => {
		const { exitCode, stderr, stdout } = probeEnv(REQUIRED);
		expect(stderr).not.toContain('Invalid environment variables');
		expect(exitCode).toBe(0);

		const env = JSON.parse(stdout.trim()) as Record<string, string | null>;

		// The Azure platform vars stay optional — no Azure config is a valid app, not a crash.
		expect(env.AZURE_OPENAI_RESOURCE_NAME).toBeNull();
		expect(env.AZURE_OPENAI_API_KEY).toBeNull();
		expect(env.AZURE_OPENAI_CHAT_DEPLOYMENT).toBeNull();

		// The BYOK keyring vars stay optional too.
		expect(env.AI_CRED_KEYS).toBeNull();
		expect(env.AI_CRED_ACTIVE_KID).toBeNull();
		expect(env.AI_API_KEY_PEPPER).toBeNull();

		// The one AI var with a default: it is what we PRICE on, so it must never be undefined.
		expect(env.AZURE_OPENAI_CHAT_MODEL).toBe('gpt-5.4-mini');

		// Sanity: the pre-existing defaults still parse.
		expect(env.POLYGON_API_URL).toBe('https://api.polygon.io');
	});

	test('validation is genuinely running — a missing REQUIRED var still fails the parse', () => {
		// Without this, every assertion above would pass vacuously if someone left
		// SKIP_ENV_VALIDATION on, or if the child silently inherited a populated .env.
		const { INFLUXDB_TOKEN: _dropped, ...incomplete } = REQUIRED;
		const { exitCode } = probeEnv(incomplete);
		expect(exitCode).not.toBe(0);
	});

	test('AI_API_KEY_PEPPER is rejected below 32 chars — a weak pepper must not boot', () => {
		const { exitCode } = probeEnv({ ...REQUIRED, AI_API_KEY_PEPPER: 'too-short' });
		expect(exitCode).not.toBe(0);
	});

	// `ENABLE_MCP` is deliberately `z.enum(['true','false']).transform(...)`, NOT
	// `z.coerce.boolean()` — the latter would make the *string* "false" truthy (any non-empty
	// string coerces to `true`), silently enabling the MCP surface. These three cases guard
	// that choice.
	test('ENABLE_MCP unset defaults to false — the MCP surface is off unless explicitly enabled', () => {
		const { exitCode, stdout } = probeEnv(REQUIRED);
		expect(exitCode).toBe(0);
		const env = JSON.parse(stdout.trim()) as Record<string, unknown>;
		expect(env.ENABLE_MCP).toBe(false);
	});

	test('ENABLE_MCP="false" parses to false — z.coerce.boolean() would get this wrong', () => {
		const { exitCode, stdout } = probeEnv({ ...REQUIRED, ENABLE_MCP: 'false' });
		expect(exitCode).toBe(0);
		const env = JSON.parse(stdout.trim()) as Record<string, unknown>;
		expect(env.ENABLE_MCP).toBe(false);
	});

	test('ENABLE_MCP="true" parses to true', () => {
		const { exitCode, stdout } = probeEnv({ ...REQUIRED, ENABLE_MCP: 'true' });
		expect(exitCode).toBe(0);
		const env = JSON.parse(stdout.trim()) as Record<string, unknown>;
		expect(env.ENABLE_MCP).toBe(true);
	});
});
