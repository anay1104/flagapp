// @ts-check
import { defineConfig } from 'astro/config';

import preact from '@astrojs/preact';

// GitHub Pages serves the site from /flagdex/; the deploy workflow sets these.
// Locally both are unset and the site runs at the root.
export default defineConfig({
  site: process.env.SITE_URL,
  base: process.env.BASE_PATH ?? '/',
  integrations: [preact()],
});
