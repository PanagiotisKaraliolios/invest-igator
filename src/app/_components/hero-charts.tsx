'use client';

import { motion } from 'framer-motion';
import React from 'react';
import { Area, Bar, BarChart, Line, LineChart, AreaChart as RCAreaChart } from 'recharts';
import { type ChartConfig, ChartContainer } from '@/components/ui/chart';

const sparkData = [
	{ i: 0, v: 10 },
	{ i: 1, v: 14 },
	{ i: 2, v: 12 },
	{ i: 3, v: 18 },
	{ i: 4, v: 16 },
	{ i: 5, v: 22 },
	{ i: 6, v: 19 },
	{ i: 7, v: 24 },
	{ i: 8, v: 21 }
];

const sparkDataAlt = [
	{ i: 0, v: 24 },
	{ i: 1, v: 22 },
	{ i: 2, v: 23 },
	{ i: 3, v: 19 },
	{ i: 4, v: 17 },
	{ i: 5, v: 20 },
	{ i: 6, v: 18 },
	{ i: 7, v: 21 },
	{ i: 8, v: 20 }
];

const barsData = [
	{ n: 'M', v: 6 },
	{ n: 'T', v: 10 },
	{ n: 'W', v: 8 },
	{ n: 'T', v: 12 },
	{ n: 'F', v: 9 },
	{ n: 'S', v: 13 },
	{ n: 'S', v: 10 }
];

const areaData = Array.from({ length: 14 }, (_, i) => ({ i, v: 20 + Math.round(6 * Math.sin(i / 2) + i * 1.4) }));

const colors: ChartConfig = {
	accent: { color: 'var(--color-chart-4)', label: 'Accent' },
	area: { color: 'var(--color-chart-3)', label: 'Trend' },
	bars: { color: 'var(--color-chart-2)', label: 'Volume' },
	line: { color: 'var(--color-chart-1)', label: 'Price' }
};

export function HeroCharts() {
	return (
		<div className='relative'>
			{/* shimmer handled by Framer Motion below */}

			<div className='grid grid-cols-3 gap-4'>
				<div className='h-28 rounded-lg border bg-background/60 p-3'>
					<ChartContainer
						className='h-full w-full aspect-auto'
						config={colors}
						id='hero-spark-1'
						style={{ color: 'var(--color-chart-1)' }}
					>
						<LineChart data={sparkData} margin={{ bottom: 0, left: 4, right: 4, top: 4 }}>
							<Line
								dataKey='v'
								dot={false}
								isAnimationActive
								stroke='currentColor'
								strokeWidth={2}
								type='monotone'
							/>
						</LineChart>
					</ChartContainer>
				</div>
				<div className='h-28 rounded-lg border bg-background/60 p-3'>
					<ChartContainer
						className='h-full w-full aspect-auto'
						config={colors}
						id='hero-bars'
						style={{ color: 'var(--color-chart-2)' }}
					>
						<BarChart data={barsData} margin={{ bottom: 0, left: 2, right: 2, top: 2 }}>
							<Bar dataKey='v' fill='currentColor' isAnimationActive radius={[3, 3, 0, 0]} />
						</BarChart>
					</ChartContainer>
				</div>
				<div className='h-28 rounded-lg border bg-background/60 p-3'>
					<ChartContainer
						className='h-full w-full aspect-auto'
						config={colors}
						id='hero-spark-2'
						style={{ color: 'var(--color-chart-4)' }}
					>
						<LineChart data={sparkDataAlt} margin={{ bottom: 0, left: 4, right: 4, top: 4 }}>
							<Line
								dataKey='v'
								dot={false}
								isAnimationActive
								stroke='currentColor'
								strokeDasharray='4 4'
								strokeWidth={2}
								type='monotone'
							/>
						</LineChart>
					</ChartContainer>
				</div>
				<div className='relative col-span-3 h-40 rounded-lg border bg-background/60 p-4 group'>
					<ChartContainer
						className='h-full w-full aspect-auto'
						config={colors}
						id='hero-area'
						style={{ color: 'var(--color-chart-3)' }}
					>
						<RCAreaChart data={areaData} margin={{ bottom: 0, left: 8, right: 8, top: 6 }}>
							<defs>
								<linearGradient id='hero-area-fill' x1='0' x2='0' y1='0' y2='1'>
									<stop offset='0%' stopColor='currentColor' stopOpacity={0.35} />
									<stop offset='100%' stopColor='currentColor' stopOpacity={0.05} />
								</linearGradient>
							</defs>
							<Area
								dataKey='v'
								fill='url(#hero-area-fill)'
								isAnimationActive
								stroke='currentColor'
								strokeWidth={2}
								type='monotone'
							/>
						</RCAreaChart>
					</ChartContainer>
					<div className='pointer-events-none absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-700 group-hover:opacity-100'>
						<motion.div
							animate={{ x: '120%' }}
							className='absolute inset-y-0 -left-1 w-1/3 [background:linear-gradient(90deg,transparent,hsl(var(--primary)/0.12),transparent)] blur-[6px]'
							initial={{ x: '-60%' }}
							transition={{ duration: 2.8, ease: 'linear', repeat: Number.POSITIVE_INFINITY }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

export default HeroCharts;
