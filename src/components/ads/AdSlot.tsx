'use client';

import { useEffect } from 'react';
import { env } from '@/env';

/**
 * Usage:
 * <AdSlot
 *   slot="1234567890"
 *   layout="in-article"
 *   format="fluid"
 *   className="my-4 block"
 * />
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
			// @ts-expect-error adsbygoogle is injected by the AdSense script
			(window.adsbygoogle = window.adsbygoogle || []).push({});
		} catch (e) {
			// no-op
		}
	}, []);

	if (!env.NEXT_PUBLIC_ADSENSE_CLIENT_ID) return null;

	return (
		<ins
			className={`adsbygoogle ${className ?? ''}`.trim()}
			data-ad-client={env.NEXT_PUBLIC_ADSENSE_CLIENT_ID}
			data-ad-format={format}
			data-ad-layout={layout}
			data-ad-slot={slot}
			data-adtest={process.env.NODE_ENV !== 'production' ? 'on' : undefined}
			data-full-width-responsive={responsive ? 'true' : 'false'}
			style={style ?? { display: 'block' }}
		/>
	);
}
