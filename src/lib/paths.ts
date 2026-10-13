// Site-relative URLs. The site may be served from a sub-path (GitHub Pages
// serves it at /flagapp/), so every internal link and fetch goes through url().

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** `url('/quiz/')` -> '/quiz/' locally, '/flagapp/quiz/' on GitHub Pages. */
export function url(path: string): string {
  return `${BASE}${path}`;
}

/** The current path without the base prefix, for active-nav checks. */
export function stripBase(pathname: string): string {
  return BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) || '/' : pathname;
}
