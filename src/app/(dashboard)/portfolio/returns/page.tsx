import { cookies } from 'next/headers';
import { type Currency, supportedCurrencies } from '@/lib/currency';
import { toLocalIsoDate } from '@/lib/date';
import { api, HydrateClient } from '@/trpc/server';
import ReturnsView from './_components/returns-view';

export default async function PortfolioReturnsPage() {
	const jar = await cookies();
	const c = jar.get('ui-currency')?.value as Currency | undefined;
	const currency: Currency = c && (supportedCurrencies as readonly string[]).includes(c) ? c : 'USD';

	// Prefetch the default (month) view server-side so the first paint hydrates from
	// cache instead of a client mount → fetch → spinner waterfall. The query key must
	// match ReturnsView's initial useQuery (preset='month', same currency). The client
	// view owns all subsequent preset/currency changes. If the server and client disagree
	// on the local day (timezone), the client simply refetches — no worse than before.
	const now = new Date();
	const from = toLocalIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
	const to = toLocalIsoDate(now);
	void api.portfolio.performance.prefetch({ currency, from, to });

	return (
		<HydrateClient>
			<ReturnsView />
		</HydrateClient>
	);
}
