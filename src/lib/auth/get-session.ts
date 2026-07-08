import { headers } from 'next/headers';
import { cache } from 'react';

import { auth } from '@/lib/auth';

/**
 * Per-request memoized session lookup. React cache() dedupes all calls within a
 * single RSC render pass to one DB round-trip (e.g. root layout + dashboard layout),
 * instead of each caller hitting Postgres separately (cookieCache is disabled).
 */
export const getServerSession = cache(async () => auth.api.getSession({ headers: await headers() }));
