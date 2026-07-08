import { headers } from 'next/headers';
import { cache } from 'react';

import { auth } from '@/lib/auth';

/**
 * Per-request memoized session lookup. React cache() dedupes all calls within a
 * single RSC render pass (e.g. root layout + dashboard layout) into one lookup.
 *
 * Better Auth's `cookieCache` additionally serves the session from a signed cookie for
 * up to 60s, so most of these resolve without touching Postgres at all. Privilege
 * decisions must NOT rely on this: `adminProcedure`/`superadminProcedure` re-read the
 * current role + ban status straight from the DB (see `api/routers/admin.ts`).
 */
export const getServerSession = cache(async () => auth.api.getSession({ headers: await headers() }));
