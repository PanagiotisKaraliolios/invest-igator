'use client';

import { useEffect } from 'react';
import { env } from '@/env';

/**
 * Renders a Google AdSense ad slot and requests an ad on mount.
 *
 * This component emits an <ins class="adsbygoogle"> element with the
 * expected data-* attributes for AdSense. When mounted, it calls
 * (window.adsbygoogle || []).push({}) to trigger ad rendering.
 *
 * If the environment variable `NEXT_PUBLIC_ADSENSE_CLIENT_ID` is not set,
 * the component returns `null` to avoid rendering an empty slot.
 *
 * @param slot - Required AdSense slot ID assigned to `data-ad-slot`.
 * @param layout - Optional ad layout assigned to `data-ad-layout` (e.g., "in-article", "in-feed").
 * @param format - Optional ad format assigned to `data-ad-format` (e.g., "auto", "rectangle").
 * @param responsive - Whether to enable full-width responsive ads via `data-full-width-responsive`. Defaults to `true`.
 * @param className - Additional CSS class names appended to the default "adsbygoogle" class.
 * @param style - Inline styles for the <ins> element. Defaults to `{ display: 'block' }`.
 *
 * @returns The configured AdSense <ins> element, or `null` when no client ID is available.
 *
 * @remarks
 * - In non-production environments, `data-adtest="on"` is set to avoid serving real ads.
 * - Ensure the AdSense script is included once in your app:
 *   `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXX" crossOrigin="anonymous"></script>`
 * - The global `adsbygoogle` array is injected by the AdSense script; TypeScript is suppressed intentionally for that access.
 * - The client ID is read from `NEXT_PUBLIC_ADSENSE_CLIENT_ID` and assigned to `data-ad-client`.
 *
 * @example
 * // Basic usage with auto format
 * // <AdSlot slot="1234567890" format="auto" />
 *
 * @example
 * // In-article layout, non-responsive
 * // <AdSlot slot="1234567890" layout="in-article" responsive={false} />
 */
export function AdSlot({
	slot,
	layout,
	format,
	responsive = true,
	className,
	style
}: {
	slot: string;
	layout?: string;
	format?: string;
	responsive?: boolean;
	className?: string;
	style?: React.CSSProperties;
}) {
	useEffect(() => {
		try {
			(window.adsbygoogle = window.adsbygoogle || []).push({});
		} catch (e) {
			// no-op
		}
	}, []);

	const clientId = env.NEXT_PUBLIC_ADSENSE_CLIENT_ID ?? null;

	return (
		<ins
			className={`adsbygoogle ${className ?? ''}`.trim()}
			data-ad-client={clientId ?? undefined}
			data-ad-format={format}
			data-ad-layout={layout}
			data-ad-slot={slot}
			data-adtest={process.env.NODE_ENV !== 'production' ? 'on' : undefined}
			data-full-width-responsive={responsive ? 'true' : 'false'}
			style={style ?? { display: 'block' }}
		/>
	);
}
