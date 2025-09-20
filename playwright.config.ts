import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
	expect: { timeout: 5_000 },
	fullyParallel: true,
	projects: [
		{ name: 'Chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'Firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'WebKit', use: { ...devices['Desktop Safari'] } }
	],
	reporter: [['list'], ['html', { open: 'never' }]],
	testDir: './tests/e2e',
	timeout: 50_000,
	use: {
		baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
		video: 'retain-on-failure'
	},
	webServer: process.env.PW_SKIP_WEBSERVER
		? undefined
		: {
				command: process.env.E2E_USE_PREVIEW ? 'bun run preview' : 'bun run dev',
				env: {
					NEXT_PUBLIC_ADSENSE_CLIENT_ID: 'ca-pub-TEST',
					NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD: '234567',
					NEXT_PUBLIC_ADSENSE_SLOT_LANDING: '123456',
					NEXT_PUBLIC_ADSENSE_SLOT_WATCHLIST: '345678',
					NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
					NEXT_TELEMETRY_DISABLED: '1',
					SKIP_ENV_VALIDATION: '1'
				},
				reuseExistingServer: !process.env.CI,
				timeout: process.env.E2E_USE_PREVIEW ? 240_000 : 120_000,
				url: 'http://localhost:3000'
			}
});
