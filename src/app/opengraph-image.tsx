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
				background: 'linear-gradient(135deg, #0f172a 0%, #111827 40%, #0a0f1e 100%)',
				color: 'white',
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				justifyContent: 'center',
				padding: 64,
				width: '100%'
			}}
		>
			<div
				style={{
					alignItems: 'center',
					display: 'flex',
					gap: 16,
					opacity: 0.92
				}}
			>
				<div
					style={{
						background: 'linear-gradient(135deg, #22d3ee 0%, #a78bfa 100%)',
						borderRadius: 14,
						boxShadow: '0 10px 30px rgba(167,139,250,0.35)',
						height: 56,
						width: 56
					}}
				/>
				<span style={{ fontSize: 28, fontWeight: 600, letterSpacing: 1 }}>invest-igator.karaliolios.dev</span>
			</div>

			<div style={{ height: 28 }} />

			<h1
				style={{
					fontSize: 80,
					fontWeight: 800,
					letterSpacing: -1.5,
					lineHeight: 1.05,
					margin: 0,
					textShadow: '0 10px 30px rgba(0,0,0,0.35)'
				}}
			>
				{title}
			</h1>

			<div style={{ height: 12 }} />

			<p
				style={{
					color: 'rgba(255,255,255,0.85)',
					fontSize: 34,
					fontWeight: 500,
					lineHeight: 1.3,
					margin: 0,
					maxWidth: 1000
				}}
			>
				{subtitle}
			</p>

			<div
				style={{ alignItems: 'center', bottom: 64, display: 'flex', gap: 12, position: 'absolute', right: 64 }}
			>
				<div style={{ backgroundColor: '#22d3ee', borderRadius: 9999, height: 10, width: 10 }} />
				<span style={{ fontSize: 24, opacity: 0.9 }}>Built with Next.js, tRPC, Prisma</span>
			</div>
		</div>,
		{
			...size
		}
	);
}
