import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { height: 180, width: 180 };
export const contentType = 'image/png';

export default async function Icon() {
	return new ImageResponse(
		<div
			style={{
				alignItems: 'center',
				background: 'linear-gradient(135deg, #0b0f1a 0%, #111827 100%)',
				display: 'flex',
				height: '100%',
				justifyContent: 'center',
				width: '100%'
			}}
		>
			<div
				style={{
					background: 'linear-gradient(135deg, #fb923c 0%, #f59e0b 50%, #f97316 100%)',
					borderRadius: 24,
					boxShadow: '0 12px 30px rgba(251,146,60,0.35), inset 0 0 28px rgba(255,255,255,0.12)',
					height: 108,
					width: 108
				}}
			/>
		</div>,
		{ ...size }
	);
}
