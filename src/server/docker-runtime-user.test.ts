import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

// The production image runs the Next.js server, the entrypoint's migrations + seed, and the
// Ofelia cron jobs. None of that needs root, and a root process that escapes the container is
// root on the host. These checks keep the image on an unprivileged user.

const REPO_ROOT = join(import.meta.dir, '..', '..');

const ROOT_USERS = ['root', '0'];

type Instruction = { args: string; keyword: string };

/**
 * Dockerfile → instructions. Comment lines go first (Docker drops them even inside a `\`
 * continuation), then continuations are joined so a multi-line RUN is one instruction.
 */
function parseDockerfile(source: string): Instruction[] {
	return source
		.split('\n')
		.filter((line) => !line.trim().startsWith('#'))
		.join('\n')
		.replace(/\\\r?\n/g, ' ')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.map((line) => {
			const [keyword = '', ...rest] = line.split(/\s+/);
			return { args: rest.join(' '), keyword: keyword.toUpperCase() };
		});
}

/** Splits instructions into build stages, one per `FROM`. The last stage is what `docker build` ships. */
function splitStages(instructions: Instruction[]): Instruction[][] {
	const stages: Instruction[][] = [];
	for (const instruction of instructions) {
		if (instruction.keyword === 'FROM') stages.push([]);
		stages.at(-1)?.push(instruction);
	}
	return stages;
}

/** Positional arguments, with `--flag=value` options removed. */
function positional(instruction: Instruction): string[] {
	return instruction.args.split(/\s+/).filter((token) => !token.startsWith('--'));
}

function flag(instruction: Instruction, name: string): string | undefined {
	const prefix = `--${name}=`;
	return instruction.args
		.split(/\s+/)
		.find((token) => token.startsWith(prefix))
		?.slice(prefix.length);
}

/** `FROM image AS name` → `name`. */
function stageName(stage: Instruction[]): string | undefined {
	const [, as, name] = positional(stage[0] as Instruction);
	return as?.toLowerCase() === 'as' ? name : undefined;
}

/**
 * The user a stage runs as: its last `USER`, else the one inherited from `FROM <earlier stage>`.
 * `undefined` means the base image's default — root, for `oven/bun`.
 */
function effectiveUser(stages: Instruction[][], index: number): string | undefined {
	const stage = stages[index] as Instruction[];
	const user = stage.filter((instruction) => instruction.keyword === 'USER').at(-1);
	if (user) return user.args;

	const [image] = positional(stage[0] as Instruction);
	const parent = stages.findIndex((candidate, i) => i < index && stageName(candidate) === image);
	return parent === -1 ? undefined : effectiveUser(stages, parent);
}

/** `bun:bun` → `bun`. `USER` and `--chown` both accept `user[:group]`. */
function userPart(spec: string): string {
	return spec.split(':')[0] as string;
}

function isNextDir(destination: string): boolean {
	return ['.next', './.next', '/app/.next'].includes(destination.replace(/\/$/, ''));
}

async function loadRunner() {
	const dockerfile = await Bun.file(join(REPO_ROOT, 'Dockerfile')).text();
	const stages = splitStages(parseDockerfile(dockerfile));
	const index = stages.length - 1;
	const user = effectiveUser(stages, index);

	// Every check below is relative to this user, so none of them can pass without one.
	expect(user).toBeDefined();
	return { runner: stages[index] as Instruction[], user: userPart(user as string) };
}

describe('Dockerfile runtime user', () => {
	test('the shipped stage does not run as root', async () => {
		const { user } = await loadRunner();

		expect(ROOT_USERS).not.toContain(user);
	});

	// `next start` caches every /_next/image response under `.next/cache/images` (and would put
	// ISR or fetch-cache entries under `.next` too). A `.next` the runtime user cannot write turns
	// each of those into EACCES plus an unhandled rejection, long after the container reported healthy.
	test('the runtime user owns .next, the only app directory the server writes to', async () => {
		const { runner, user } = await loadRunner();
		const nextCopies = runner.filter(
			(instruction) => instruction.keyword === 'COPY' && isNextDir(positional(instruction).at(-1) ?? '')
		);

		expect(nextCopies.length).toBeGreaterThan(0);
		for (const copy of nextCopies) {
			const chown = flag(copy, 'chown');
			expect(chown).toBeDefined();
			expect(userPart(chown as string)).toBe(user);
		}
	});

	// Least privilege: a compromised server process must not be able to rewrite its own code or
	// dependencies. `RUN chown -R` would also duplicate every layer it touches (node_modules alone
	// is hundreds of MB), which is why ownership is set on COPY instead.
	test('code and dependencies stay root-owned (read-only to the runtime user)', async () => {
		const { runner } = await loadRunner();

		for (const instruction of runner) {
			if (instruction.keyword === 'COPY' && !isNextDir(positional(instruction).at(-1) ?? '')) {
				expect({ chown: flag(instruction, 'chown'), copy: instruction.args }).toStrictEqual({
					chown: undefined,
					copy: instruction.args
				});
			}
			if (instruction.keyword === 'RUN') expect(instruction.args).not.toMatch(/\bchown\b/);
		}
	});
});

describe('docker-compose scheduled jobs', () => {
	// Ofelia's job-exec ignores the image's USER: its `User` field defaults to "root" (ofelia
	// core/execjob.go), so without a `.user` label every cron job execs into the container as root.
	test('every Ofelia job-exec runs as the image runtime user, not root', async () => {
		const { user } = await loadRunner();
		const compose = (await Bun.file(join(REPO_ROOT, 'docker-compose.yml')).text())
			.split('\n')
			.map((line) => line.replace(/#.*$/, ''))
			.join('\n');

		const jobs = [...compose.matchAll(/ofelia\.job-exec\.([\w-]+)\.command:/g)].map((match) => match[1]);
		expect(jobs.length).toBeGreaterThan(0);

		for (const job of jobs) {
			const label = compose.match(new RegExp(`ofelia\\.job-exec\\.${job}\\.user:\\s*['"]?([\\w-]+)`));
			expect({ job, user: label?.[1] }).toStrictEqual({ job, user });
		}
	});

	// Ofelia parses schedules with a leading SECONDS field. A standard 5-field cron spec is read
	// seconds-first, so '*/5 * * * *' fires every 5 seconds and '15 2 * * *' every hour at :02:15.
	// That shipped from July to 2026-09-25; pin the intended times so it cannot drift back.
	test('every Ofelia schedule has the leading seconds field and fires when intended', async () => {
		const compose = (await Bun.file(join(REPO_ROOT, 'docker-compose.yml')).text())
			.split('\n')
			.map((line) => line.replace(/#.*$/, ''))
			.join('\n');
		const schedules = Object.fromEntries(
			[...compose.matchAll(/ofelia\.job-exec\.([\w-]+)\.schedule:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => [
				m[1],
				m[2].trim()
			])
		);

		expect(schedules).toStrictEqual({
			'ingest-fx': '0 0 6,18 * * *',
			'ingest-yahoo': '0 15 2 * * *',
			'sweep-ai-reservations': '0 */5 * * * *'
		});
		for (const spec of Object.values(schedules)) {
			expect(spec.startsWith('@') || spec.split(/\s+/).length === 6).toBe(true);
		}
	});
});
