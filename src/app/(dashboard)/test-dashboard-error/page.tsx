'use client';

export default function TestDashboardErrorPage() {
	// This will trigger the dashboard error.tsx boundary
	throw new Error('🧪 Dashboard error: This is a simulated error within the dashboard context');
}
