/**
 * Next.js instrumentation hook. Runs once per server runtime at boot.
 *
 * `registerTelemetry` is global and additive — a second call means every AiCall row is written
 * twice — so the actual registration is behind the globalThis guard in `registerAiTelemetryOnce`.
 */
export async function register(): Promise<void> {
	// The ledger imports Prisma and node:async_hooks. Neither exists on the edge runtime, and a
	// static import would drag them into the edge bundle and break the build.
	if (process.env.NEXT_RUNTIME !== 'nodejs') return;

	const { registerAiTelemetryOnce } = await import('@/server/ai/telemetry');
	registerAiTelemetryOnce();
}
