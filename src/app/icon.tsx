import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { height: 32, width: 32 };
export const contentType = 'image/png';

export default async function Icon() {
	return new ImageResponse(
		<div
			style={{
				alignItems: 'center',
				background: 'linear-gradient(135deg, #111827 0%, #0b0f1a 100%)',
				borderRadius: 8,
				display: 'flex',
				height: '100%',
				justifyContent: 'center',
				width: '100%'
			}}
		>
			<div
				style={{
					background: 'linear-gradient(135deg, #fb923c 0%, #f59e0b 50%, #f97316 100%)',
					borderRadius: 4,
					boxShadow: '0 2px 6px rgba(251, 146, 60, 0.55)',
					height: 18,
					width: 18
				}}
			/>
		</div>,
		{ ...size }
	);
}
