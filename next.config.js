/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import './src/env.js';

/** @type {import("next").NextConfig} */
const config = {
	images: {
		remotePatterns: [
			{
				// Cloudflare R2 storage
				hostname: '**.r2.cloudflarestorage.com',
				protocol: 'https'
			},
			{
				// Custom R2 public domain (if configured)
				hostname: 'storage.invest-igator.karaliolios.dev',
				protocol: 'https'
			}
		]
	}
	// reactCompiler: true // Disabled for Docker builds - Turbopack has issues with babel plugin resolution
};

export default config;
