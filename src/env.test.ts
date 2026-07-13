import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');

/**
 * Every non-defaulted, non-BYOK server var. The app cannot boot without these.
 * AZURE_OPENAI_API_KEY/CHAT_DEPLOYMENT/RESOURCE_NAME are REQUIRED (Task 6): the platform
 * model is not optional, so a missing key must fail at boot. Only the BYOK keyring vars
 * (AI_CRED_*, AI_API_KEY_PEPPER) remain optional.
 */
const REQUIRED: Record<string, string> = {
	AUTH_DISCORD_ID: 'test-id',
	AUTH_DISCORD_SECRET: 'test-secret',
	AZURE_OPENAI_API_KEY: 'test-key',
	AZURE_OPENAI_CHAT_DEPLOYMENT: 'test-deployment',
	AZURE_OPENAI_RESOURCE_NAME: 'test-resource',
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
	test('parses with every BYOK var absent — the app boots without BYOK configured', () => {
		const { exitCode, stderr, stdout } = probeEnv(REQUIRED);
		expect(stderr).not.toContain('Invalid environment variables');
		expect(exitCode).toBe(0);

		const env = JSON.parse(stdout.trim()) as Record<string, string | null>;

		// The BYOK keyring vars stay optional.
		expect(env.AI_CRED_KEYS).toBeNull();
		expect(env.AI_CRED_ACTIVE_KID).toBeNull();
		expect(env.AI_API_KEY_PEPPER).toBeNull();

		// The Azure platform vars are REQUIRED (Task 6): present, not defaulted-away-to-null.
		expect(env.AZURE_OPENAI_RESOURCE_NAME).toBe('test-resource');
		expect(env.AZURE_OPENAI_API_KEY).toBe('test-key');
		expect(env.AZURE_OPENAI_CHAT_DEPLOYMENT).toBe('test-deployment');

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

	// The platform model is not optional: a missing Azure var must fail at boot, not on the
	// first user's first chat message. Each of the three is independently required.
	test.each([
		'AZURE_OPENAI_API_KEY',
		'AZURE_OPENAI_CHAT_DEPLOYMENT',
		'AZURE_OPENAI_RESOURCE_NAME'
	])('%s is required — omitting it fails the parse', (key) => {
		const incomplete = { ...REQUIRED };
		delete incomplete[key];
		const { exitCode, stderr } = probeEnv(incomplete);
		expect(stderr).toContain('Invalid environment variables');
		expect(exitCode).not.toBe(0);
	});

	// AZURE_OPENAI_CHAT_MODEL is the one Azure var that is defaulted, not required — dropping
	// it must NOT fail the parse, unlike the three above.
	test('AZURE_OPENAI_CHAT_MODEL is defaulted, not required', () => {
		const { AZURE_OPENAI_CHAT_MODEL: _dropped, ...withoutModel } = REQUIRED;
		const { exitCode, stdout } = probeEnv(withoutModel);
		expect(exitCode).toBe(0);
		const env = JSON.parse(stdout.trim()) as Record<string, string | null>;
		expect(env.AZURE_OPENAI_CHAT_MODEL).toBe('gpt-5.4-mini');
	});

	test('AI_API_KEY_PEPPER is rejected below 32 chars — a weak pepper must not boot', () => {
		const { exitCode } = probeEnv({ ...REQUIRED, AI_API_KEY_PEPPER: 'too-short' });
		expect(exitCode).not.toBe(0);
	});
});
