import { test as base, expect } from '@playwright/test';

// Shared test that pre-seeds consent so the banner never blocks elements
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('consent.ads', 'granted');
      } catch {}
    });
    await use(context);
  },
});

export { expect } from '@playwright/test';

// Secondary fixture with no consent seeding for tests that
// need to verify the banner/consent flow from a clean state.
export const testNoConsent = base;
