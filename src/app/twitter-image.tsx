import { ImageResponse } from 'next/og';
import { env } from '@/env';

export const runtime = 'edge';
export const size = { height: 630, width: 1200 };
export const contentType = 'image/png';

export default async function Image() {
	const title = env.APP_NAME ?? 'Invest-igator';
	const subtitle = 'Open-source investment portfolio tracker';

	return new ImageResponse(
		<div
			style={{
				alignItems: 'flex-start',
				background: 'linear-gradient(135deg, #0a0f1e 0%, #111827 40%, #0b0f1a 100%)',
				color: 'white',
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				justifyContent: 'center',
				padding: 64,
				width: '100%'
			}}
		>
			<div style={{ alignItems: 'center', display: 'flex', gap: 16, opacity: 0.92 }}>
				<div
					style={{
						background: 'linear-gradient(135deg, #fb923c 0%, #f59e0b 50%, #f97316 100%)',
						borderRadius: 14,
						boxShadow: '0 10px 30px rgba(251,146,60,0.35)',
						height: 56,
						width: 56
					}}
				/>
				<span style={{ fontSize: 28, fontWeight: 600, letterSpacing: 1 }}>invest-igator.karaliolios.dev</span>
			</div>

			<div style={{ height: 28 }} />

			<h1 style={{ fontSize: 78, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05, margin: 0 }}>{title}</h1>

			<div style={{ height: 12 }} />

			<p
				style={{
					color: 'rgba(255,255,255,0.85)',
					fontSize: 32,
					fontWeight: 500,
					lineHeight: 1.3,
					margin: 0,
					maxWidth: 1000
				}}
			>
				{subtitle}
			</p>

			<div style={{ bottom: 64, fontSize: 22, opacity: 0.9, position: 'absolute', right: 64 }}>
				Invest smarter. Track better.
			</div>
		</div>,
		{
			...size
		}
	);
}
