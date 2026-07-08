'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Currency, isSupportedCurrency } from '@/lib/currency';
import { api } from '@/trpc/react';

export function useCurrencySwitch(isAuthenticated = false) {
	const router = useRouter();
	const [mounted, setMounted] = useState(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const skipNextPersistRef = useRef(false);
	const initializedFromRemoteRef = useRef(false);
	const setMutation = api.currency.setCurrency.useMutation();
	const mutateRef = useRef<(c: Currency) => void>(() => {});
	useEffect(() => {
		mutateRef.current = (c: Currency) => {
			if (isAuthenticated) setMutation.mutate(c);
		};
	}, [setMutation, isAuthenticated]);
	const getQuery = api.currency.getCurrency.useQuery(undefined, {
		enabled: isAuthenticated,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: 5 * 60 * 1000
	});

	const [currency, _setCurrency] = useState<Currency>(() => {
		if (typeof document !== 'undefined') {
			const match = document.cookie.match(/(?:^|; )ui-currency=([^;]+)/);
			const c = match ? decodeURIComponent(match[1]!) : null;
			if (c && isSupportedCurrency(c)) return c;
		}
		return 'USD';
	});

	useEffect(() => {
		setMounted(true);
		if (skipNextPersistRef.current) {
			skipNextPersistRef.current = false;
			return;
		}
		// Re-persist the preference to the backend (idempotent, debounced) on every
		// authenticated mount — this self-heals a cookie that was set while a prior
		// mutation was interrupted. It is fire-and-forget and does not block render.
		if (isAuthenticated) {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => {
				mutateRef.current(currency);
			}, 1000);
		}
		// Only write the cookie + refresh the server tree when the cookie does not
		// already reflect this currency. On a plain mount the cookie matches (state is
		// initialized from it), so navigation no longer triggers an avoidable RSC
		// round-trip; this runs only on a genuine user-initiated currency change.
		const currentCookie =
			typeof document !== 'undefined'
				? (document.cookie.match(/(?:^|; )ui-currency=([^;]+)/)?.[1] ?? null)
				: null;
		const cookieMatches = currentCookie ? decodeURIComponent(currentCookie) === currency : false;
		if (!cookieMatches) {
			try {
				document.cookie = `ui-currency=${currency}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
				// Use rAF to ensure the cookie write is visible to the next render tick
				requestAnimationFrame(() => router.refresh());
			} catch {}
		}
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [currency, isAuthenticated]);

	useEffect(() => {
		if (!isAuthenticated || !getQuery.isSuccess || initializedFromRemoteRef.current) return;
		initializedFromRemoteRef.current = true;
		const rc = getQuery.data?.currency as Currency | null | undefined;
		if (rc && rc !== currency) {
			skipNextPersistRef.current = true;
			_setCurrency(rc);
			try {
				document.cookie = `ui-currency=${rc}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
				requestAnimationFrame(() => router.refresh());
			} catch {}
		}
	}, [isAuthenticated, getQuery.isSuccess, getQuery.data?.currency, currency]);

	const setCurrency = useCallback((c: Currency) => {
		_setCurrency(c);
	}, []);

	const current = useMemo(() => currency, [currency]);

	return { currency: current, mounted, setCurrency } as const;
}
