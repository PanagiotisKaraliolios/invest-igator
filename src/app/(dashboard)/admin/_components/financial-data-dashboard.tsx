'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataQualityPanel } from './data-quality-panel';
import { FxRatesPanel } from './fx-rates-panel';
import { IngestionStatsCard } from './ingestion-stats-card';
import { ManualFetchPanel } from './manual-fetch-panel';
import { SymbolManagementTable } from './symbol-management-table';

export function FinancialDataDashboard() {
	const [activeTab, setActiveTab] = useState('symbols');

	return (
		<div className='space-y-6'>
			<div>
				<h1 className='text-3xl font-bold tracking-tight'>Financial Data Management</h1>
				<p className='text-muted-foreground mt-2'>Manage symbols, monitor data quality, and oversee FX rates</p>
			</div>

			{/* Overview Stats */}
			<IngestionStatsCard />

			{/* Main Tabs */}
			<Tabs onValueChange={setActiveTab} value={activeTab}>
				<TabsList className='grid w-full grid-cols-4'>
					<TabsTrigger value='symbols'>Symbols</TabsTrigger>
					<TabsTrigger value='quality'>Data Quality</TabsTrigger>
					<TabsTrigger value='fetch'>Manual Fetch</TabsTrigger>
					<TabsTrigger value='fx'>FX Rates</TabsTrigger>
				</TabsList>

				<TabsContent className='space-y-4' value='symbols'>
					<Card>
						<CardHeader>
							<CardTitle>Symbol Management</CardTitle>
							<CardDescription>
								View and edit symbols across all user watchlists. Update metadata like display name,
								description, and currency.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<SymbolManagementTable />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent className='space-y-4' value='quality'>
					<Card>
						<CardHeader>
							<CardTitle>Data Quality</CardTitle>
							<CardDescription>
								Identify symbols with missing OHLCV data and monitor ingestion health.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<DataQualityPanel />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent className='space-y-4' value='fetch'>
					<Card>
						<CardHeader>
							<CardTitle>Manual Data Fetch</CardTitle>
							<CardDescription>
								Manually trigger data fetches for specific symbols. Use force option to re-fetch
								existing data.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ManualFetchPanel />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent className='space-y-4' value='fx'>
					<Card>
						<CardHeader>
							<CardTitle>FX Rate Monitoring</CardTitle>
							<CardDescription>
								View currency conversion rates and monitor update frequency.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<FxRatesPanel />
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}
