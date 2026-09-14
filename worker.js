/**
 * The deployed site's single entry point. Cloudflare Workers serves everything
 * here — the HTML and every static file — via the ASSETS binding configured in
 * wrangler.jsonc.
 *
 * The Worker exists for one job: fixing the absolute URLs in the SEO metadata.
 *
 * index.html, robots.txt and sitemap.xml all have to state the site's own
 * address — a canonical link, og:url, the Open Graph/Twitter image URLs, the
 * JSON-LD url, the sitemap <loc>, and the Sitemap: line. Those must be absolute
 * (relative og:image URLs frequently fail to unfurl), and they must match the
 * host actually serving the page. A canonical tag naming a different origin
 * tells crawlers to index that one instead, so a hardcoded URL that drifts is
 * worse than no canonical at all.
 *
 * A workers.dev address includes the account's own subdomain, which isn't
 * knowable from the repo, and the site may later move to a custom domain. So
 * rather than committing a guess, the placeholder below is swapped for the
 * real request origin on the way out. The result is correct on workers.dev, on
 * a custom domain, and on preview deployments, with nothing to remember to
 * update.
 *
 * Only the three files that contain the placeholder are routed through here
 * (see run_worker_first in wrangler.jsonc). CSS, JS, images and icons are
 * served straight from Cloudflare's asset storage and never invoke the Worker.
 */

// Must match the origin written into index.html, robots.txt and sitemap.xml.
const PLACEHOLDER_ORIGIN = 'https://snake-ladder-love-edition.workers.dev';

const REWRITTEN_PATHS = new Set(['/', '/index.html', '/robots.txt', '/sitemap.xml']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await env.ASSETS.fetch(request);

    if (!REWRITTEN_PATHS.has(url.pathname) || !response.ok) return response;

    const body = await response.text();
    if (!body.includes(PLACEHOLDER_ORIGIN)) return response;

    // Content-Length is dropped rather than recalculated: the replacement
    // changes the byte count, and a stale length truncates the response.
    const headers = new Headers(response.headers);
    headers.delete('content-length');

    return new Response(body.replaceAll(PLACEHOLDER_ORIGIN, url.origin), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
