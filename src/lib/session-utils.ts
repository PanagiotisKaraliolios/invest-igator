/**
 * Utility functions for parsing session information like user agents and locations.
 */

/**
 * Parse user agent string to extract device information.
 * This is a simple parser - for production use, consider using a library like ua-parser-js.
 */
export function parseUserAgent(userAgent: string | null | undefined): {
	browser: string;
	device: string;
	os: string;
} {
	if (!userAgent) {
		return {
			browser: 'Unknown',
			device: 'Unknown Device',
			os: 'Unknown OS'
		};
	}

	// Detect browser
	let browser = 'Unknown';
	if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
		browser = 'Chrome';
	} else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
		browser = 'Safari';
	} else if (userAgent.includes('Firefox')) {
		browser = 'Firefox';
	} else if (userAgent.includes('Edg')) {
		browser = 'Edge';
	} else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
		browser = 'Opera';
	}

	// Detect device
	let device = 'Desktop';
	if (userAgent.includes('iPhone')) {
		device = 'iPhone';
		// Try to extract model
		const match = userAgent.match(/iPhone\s?([\d,]+)?/);
		if (match?.[1]) {
			device = `iPhone ${match[1].replace(',', '.')}`;
		}
	} else if (userAgent.includes('iPad')) {
		device = 'iPad';
		const match = userAgent.match(/iPad(\d+,\d+)?/);
		if (match?.[1]) {
			device = `iPad ${match[1]}`;
		}
	} else if (userAgent.includes('Android')) {
		device = 'Android';
		// Try to extract device model
		const match = userAgent.match(/Android.*?;\s*([^;)]+)/);
		if (match?.[1] && !match[1].includes('Linux') && !match[1].includes('Build')) {
			device = match[1].trim();
		}
	} else if (userAgent.includes('Mobile')) {
		device = 'Mobile';
	} else if (userAgent.includes('Tablet')) {
		device = 'Tablet';
	}

	// Detect OS
	let os = 'Unknown OS';
	if (userAgent.includes('Windows NT 10.0')) {
		os = 'Windows 10/11';
	} else if (userAgent.includes('Windows NT')) {
		os = 'Windows';
	} else if (userAgent.includes('Mac OS X')) {
		const match = userAgent.match(/Mac OS X ([\d_]+)/);
		if (match?.[1]) {
			os = `macOS ${match[1].replace(/_/g, '.')}`;
		} else {
			os = 'macOS';
		}
	} else if (userAgent.includes('Linux')) {
		os = 'Linux';
	} else if (userAgent.includes('Android')) {
		const match = userAgent.match(/Android ([\d.]+)/);
		if (match?.[1]) {
			os = `Android ${match[1]}`;
		} else {
			os = 'Android';
		}
	} else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
		const match = userAgent.match(/OS ([\d_]+)/);
		if (match?.[1]) {
			os = `iOS ${match[1].replace(/_/g, '.')}`;
		} else {
			os = 'iOS';
		}
	}

	return { browser, device, os };
}

/**
 * Format device information for display.
 * Combines browser, device, and OS into a readable string.
 */
export function formatDeviceInfo(userAgent: string | null | undefined): string {
	const { browser, device, os } = parseUserAgent(userAgent);

	// Create a concise device string
	if (device !== 'Desktop' && device !== 'Unknown Device') {
		return device; // For mobile devices, the device name is usually sufficient
	}

	return `${browser} on ${os}`;
}

/**
 * Get approximate location from IP address using a free IP geolocation service.
 * For production, consider using a more reliable service or caching results.
 */
export async function getLocationFromIP(ipAddress: string | null | undefined): Promise<string> {
	// Return placeholder for local/invalid IPs
	if (!ipAddress || ipAddress === '::1' || ipAddress === '127.0.0.1' || ipAddress.startsWith('192.168.')) {
		return 'Local Network';
	}

	try {
		// Using ip-api.com free tier (limited to 45 requests per minute)
		// For production, consider using a paid service or your own geolocation database
		const response = await fetch(`http://ip-api.com/json/${ipAddress}?fields=country,city,status`, {
			signal: AbortSignal.timeout(3000) // 3 second timeout
		});

		if (!response.ok) {
			return 'Unknown Location';
		}

		const data = (await response.json()) as {
			city?: string;
			country?: string;
			status: string;
		};

		if (data.status !== 'success') {
			return 'Unknown Location';
		}

		if (data.city && data.country) {
			return `${data.city}, ${data.country}`;
		}

		if (data.country) {
			return data.country;
		}

		return 'Unknown Location';
	} catch (error) {
		console.error('Failed to get location from IP:', error);
		return 'Unknown Location';
	}
}
