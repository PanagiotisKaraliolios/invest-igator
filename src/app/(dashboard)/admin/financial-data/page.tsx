import type { Metadata } from 'next';
import { FinancialDataDashboard } from '../_components/financial-data-dashboard';

export const metadata: Metadata = {
	description: 'Manage financial data, symbols, and data quality',
	title: 'Financial Data | Admin'
};

export default function FinancialDataPage() {
	return <FinancialDataDashboard />;
}
