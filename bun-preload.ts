// Bun test preload (see bunfig.toml's [test].preload).
//
// 'server-only' is a marker package whose entire mechanism is an unconditional
// throw in its default export, made a no-op only when a bundler resolves
// package.json's "react-server" export condition (Next.js sets this condition
// when building server-component bundles, and deliberately leaves it unset for
// client bundles — that's what makes the marker work as a build-time guard).
//
// Plain `bun test` does none of that conditional-exports resolution, so any
// module under test that does `import 'server-only'` (e.g.
// src/server/ai/crypto.ts) would otherwise throw and abort every test file
// that imports it, even though the import itself is completely legitimate.
//
// This shims 'server-only' to a no-op *for the Bun test runner only*. It has
// no effect on `next build` / `next dev`, which resolve the real package from
// node_modules and still fail loudly if a server-only module is ever pulled
// into a client bundle.
import { plugin } from 'bun';

plugin({
	name: 'server-only-noop-for-bun-test',
	setup(build) {
		build.module('server-only', () => ({ exports: {}, loader: 'object' }));
	}
});
