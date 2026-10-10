/**
 * Copyright (c) 2025 OpenShort.link Contributors
 * Licensed under the GNU Affero General Public License Version 3 (AGPL-3.0)
 */

// Main Cloudflare Worker entry point

import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types';
import { errorHandler } from './middleware/error';
import { loggerMiddleware } from './middleware/logger';
import { createRateLimit } from './middleware/rateLimit';
import { csrfProtection } from './middleware/csrf';
import { securityHeaders } from './middleware/security';
import { cacheControl } from './middleware/cache-control';
import { handleRedirect } from './services/redirect';
import { getDomainByRoutingPath, normalizeRoutePrefix } from './db/domains';
import { getRootPageSettingsOrDefault } from './db/settings';
import { escapeHtml } from './utils/html';

// Import API routes (static - they're small and needed for functionality)
import { linksRouter } from './api/links';
import { domainsRouter } from './api/domains';
import { analyticsRouter } from './api/analytics';
import { authRouter } from './api/auth';
import { usersRouter } from './api/users';
import { tagsRouter } from './api/tags';
import { pixelsRouter } from './api/pixels';
import { categoriesRouter } from './api/categories';
import { apiKeysRouter } from './api/apiKeys';
import { settingsRouter } from './api/settings';
import { importRouter } from './api/import';
import { staticRouter } from './api/static';
// Dynamic imports only for large dashboard/auth views (reduces bundle size)

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware
app.use('*', loggerMiddleware);
app.use('*', cors({
  // Restrict browser CORS to an allowlist when ALLOWED_ORIGINS is configured
  // (comma-separated). If unset, preserve the previous permissive behavior ('*').
  // We never send credentials, so '*' is never combined with credentials.
  // Server-to-server / API-key clients send no Origin header and are unaffected.
  origin: (origin, c) => {
    // ALLOWED_ORIGINS is documented in env.d.ts; typed locally because the Env
    // interface (src/types/index.ts) is not augmentable from an ambient .d.ts.
    const allowedOrigins = (c.env as { ALLOWED_ORIGINS?: string }).ALLOWED_ORIGINS || '';
    const allowed = allowedOrigins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (allowed.length > 0) {
      // Echo the request Origin only if it is explicitly allowlisted.
      return origin && allowed.includes(origin) ? origin : null;
    }
    // No allowlist configured: fall back to wildcard (unchanged prior behavior).
    return '*';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// Conditional middleware: Skip CSRF and security headers for redirect routes
// Redirects are GET-only and don't return HTML, so these are unnecessary
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  
  // Apply CSRF/security for dashboard and API routes only
  // Everything else is a redirect route
  const isAdminRoute = path.startsWith('/dashboard') || path.startsWith('/api');
  
  // Exclude auth endpoints from CSRF (they create sessions, can't have CSRF token before login)
  const isAuthEndpoint = path === '/api/auth/login' || 
                         path === '/api/auth/register' ||
                         path === '/api/auth/refresh' ||
                         path === '/api/auth/mfa/verify';
  
  if (isAdminRoute && !isAuthEndpoint) {
    // Apply CSRF and security headers for dashboard/API routes
    // Chain them properly: CSRF first, then security headers
    await csrfProtection(c, async () => {
      await securityHeaders(c, next);
    });
  } else if (isAdminRoute && isAuthEndpoint) {
    // Auth endpoints: security headers only, no CSRF
    await securityHeaders(c, next);
  } else {
    // Public routes (redirects + the root/route landing page, which can now return
    // branded or custom HTML): apply security headers. No CSRF — GET-only, no session
    // writes. CSP allows inline styles ('unsafe-inline') so the branded page renders,
    // and blocks unnonced inline scripts in custom-HTML mode.
    await securityHeaders(c, next);
  }
});

// Cache control for API routes
app.use('/api/*', cacheControl);

// ============================================================================
// DASHBOARD ROUTES - All admin functionality under /dashboard/*
// ============================================================================

// Dashboard - Health check (moved under /dashboard)
app.get('/dashboard/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Debug - Returns Cloudflare GeoIP headers for the current visitor
// Useful for users to verify exact city/country names before setting up redirect rules.
// Registered under both /api and /dashboard/api via one shared handler.
function handleMyLocation(c: Context<{ Bindings: Env; Variables: Variables }>) {
  // request.cf is populated by Cloudflare by default; the cf-* headers require the
  // "visitor location headers" Managed Transform, so fall back to them if present.
  const cf = (c.req.raw as { cf?: Record<string, string> }).cf || {};
  const city = cf.city || c.req.header('cf-ipcity') || null;
  const country = cf.country || c.req.header('cf-ipcountry') || null;
  const region = cf.region || c.req.header('cf-region') || null;
  const regionCode = cf.regionCode || c.req.header('cf-region-code') || null;
  const timezone = cf.timezone || c.req.header('cf-timezone') || null;

  return c.json({
    success: true,
    data: {
      city,
      country,
      region,
      region_code: regionCode,
      timezone,
      note: 'Use these exact values when setting up city/country redirect rules. City matching is case-insensitive.',
      docs: 'https://developers.cloudflare.com/fundamentals/reference/http-request-headers/#cf-ipcity',
    },
  });
}

app.get('/api/v1/debug/my-location', handleMyLocation);
app.get('/dashboard/api/v1/debug/my-location', handleMyLocation);

// Dashboard - Validation endpoint (moved under /dashboard)
app.get('/dashboard/__validate__', (c) => {
  return c.json({
    valid: true,
    script: 'openshortlink',
    timestamp: Date.now()
  });
});

// Dashboard - Login page (moved from /login to /dashboard/login)
app.get('/dashboard/login', async (c) => {
  const { loginHtml } = await import('./views/auth');
  const csrfToken = c.get('csrfToken') || '';
  const nonce = c.get('nonce') || '';
  return c.html(loginHtml(csrfToken, nonce));
});

// Dashboard - Setup page (moved from /setup to /dashboard/setup)
app.get('/dashboard/setup', async (c) => {
  // Check if users already exist
  const existingUsers = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  const userCount = existingUsers?.count || 0;

  if (userCount > 0) {
    // Users exist, redirect to login
    return c.redirect('/dashboard/login');
  }

  // Check if SETUP_TOKEN is configured
  if (!c.env.SETUP_TOKEN) {
    const { setupErrorHtml } = await import('./views/auth');
    return c.html(setupErrorHtml);
  }

  const { setupHtml } = await import('./views/auth');
  const csrfToken = c.get('csrfToken') || '';
  const nonce = c.get('nonce') || '';
  return c.html(setupHtml(csrfToken, nonce));
});

// Dashboard - Static assets (moved from /static to /dashboard/static)
app.route('/dashboard/static', staticRouter);

// Dashboard - Main dashboard page
app.get('/dashboard', async (c) => {
  // Dynamic import - only loads dashboard code when accessed
  const { dashboardHtml } = await import('./views/dashboard');
  
  // Check for auth cookie
  const cookieHeader = c.req.header('Cookie');
  const token = cookieHeader?.match(/session_token=([^;]+)/)?.[1];

  if (!token) {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return c.redirect('/dashboard/login');
  }

  // Prevent caching of dashboard
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
  const csrfToken = c.get('csrfToken') || '';
  const nonce = c.get('nonce') || '';
  return c.html(dashboardHtml(csrfToken, nonce));
});

// Dashboard - Catch-all for unmatched dashboard routes (MUST come after more specific /dashboard/* routes)
// Note: Moved to after API routes to allow /dashboard/api/* to be matched first

// ============================================================================
// API ROUTES - Mounted at BOTH /dashboard/api/* (for dashboard) and /api/* (for external)
// ============================================================================

// Dashboard internal API - used by dashboard JavaScript
// These endpoints work with just /dashboard/* Cloudflare route
app.route('/dashboard/api/v1/auth', authRouter);
app.route('/dashboard/api/v1/users', usersRouter);
app.route('/dashboard/api/v1/links/import', importRouter);
app.route('/dashboard/api/v1/links', linksRouter);
app.route('/dashboard/api/v1/domains', domainsRouter);
app.route('/dashboard/api/v1/analytics', analyticsRouter);
app.route('/dashboard/api/v1/tags', tagsRouter);
app.route('/dashboard/api/v1/pixels', pixelsRouter);
app.route('/dashboard/api/v1/categories', categoriesRouter);
app.route('/dashboard/api/v1/api-keys', apiKeysRouter);
app.route('/dashboard/api/v1/settings', settingsRouter);

// Auto-create the first user from environment variables. Shared by the /dashboard/api
// and /api mounts below. Gated by SETUP_TOKEN (consistent with /register) in addition
// to the "no users exist" check, and rate-limited to slow abuse of the unauth endpoint.
async function handleSetupAuto(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const existingUsers = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  const userCount = existingUsers?.count || 0;

  if (userCount > 0) {
    return c.json({ success: false, message: 'Users already exist. Auto-setup is only for first user.' }, 400);
  }

  // Require SETUP_TOKEN to be configured AND supplied (body `setup_token` or `X-Setup-Token`).
  if (!c.env.SETUP_TOKEN) {
    return c.json({
      success: false,
      message: 'Server configuration error: SETUP_TOKEN not configured.'
    }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const providedToken = (body as { setup_token?: string }).setup_token || c.req.header('X-Setup-Token');
  if (!providedToken || providedToken !== c.env.SETUP_TOKEN) {
    return c.json({ success: false, message: 'Invalid or missing setup token.' }, 403);
  }

  if (!c.env.FIRST_USER_USERNAME || !c.env.FIRST_USER_PASSWORD) {
    return c.json({
      success: false,
      message: 'Auto-setup requires FIRST_USER_USERNAME and FIRST_USER_PASSWORD environment variables.'
    }, 400);
  }

  const { getUserByUsername } = await import('./db/users');
  const existingUser = await getUserByUsername(c.env, c.env.FIRST_USER_USERNAME);
  if (existingUser) {
    return c.json({ success: false, message: 'User already exists.' }, 400);
  }

  const { hashPassword } = await import('./utils/crypto');
  const { createUser } = await import('./db/users');
  const passwordHash = await hashPassword(c.env.FIRST_USER_PASSWORD);

  const user = await createUser(c.env, {
    username: c.env.FIRST_USER_USERNAME,
    email: c.env.FIRST_USER_EMAIL || undefined,
    password_hash: passwordHash,
    role: 'owner',
  });

  return c.json({
    success: true,
    message: 'First user created successfully from environment variables.',
    data: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  }, 201);
}

const setupAutoRateLimit = createRateLimit({
  window: 60,
  max: 5,
  key: (c) => `setup-auto:${c.req.header('CF-Connecting-IP') || 'unknown'}`,
});

// Auto-create first user - also available under /dashboard/api
app.post('/dashboard/api/v1/auth/setup-auto', setupAutoRateLimit, handleSetupAuto);

// Dashboard catch-all - AFTER API routes
app.get('/dashboard/*', async (c) => {
  return c.redirect('/dashboard');
});

// ============================================================================
// EXTERNAL API ROUTES - Optional, enable /api/* route in Cloudflare if needed
// ============================================================================

// External API - for third-party integrations (requires /api/* Cloudflare route)
app.post('/api/v1/auth/setup-auto', setupAutoRateLimit, handleSetupAuto);

app.route('/api/v1/auth', authRouter);
app.route('/api/v1/users', usersRouter);
app.route('/api/v1/links/import', importRouter);
app.route('/api/v1/links', linksRouter);
app.route('/api/v1/domains', domainsRouter);
app.route('/api/v1/analytics', analyticsRouter);
app.route('/api/v1/tags', tagsRouter);
app.route('/api/v1/pixels', pixelsRouter);
app.route('/api/v1/categories', categoriesRouter);
app.route('/api/v1/api-keys', apiKeysRouter);
app.route('/api/v1/settings', settingsRouter);

// ============================================================================
// LINK REDIRECT HANDLER - Catch-all for short link redirects
// ============================================================================

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const domain = url.hostname;
  const path = url.pathname;

  // Handle __validate__ endpoint for domain route validation
  // This allows external domains to validate their Cloudflare Worker routes
  if (path.endsWith('/__validate__')) {
    return c.json({
      valid: true,
      script: 'openshortlink',
      timestamp: Date.now()
    });
  }

  // Try to find domain and routing path
  const result = await getDomainByRoutingPath(c.env, domain, path);

  if (!result) {
    return c.text('Not found', 404);
  }

  const { domain: domainObj, matchedRoute } = result;

  // Extract slug from path by stripping EXACTLY the matched route prefix from the
  // start (not a substring replace anywhere in the path), then trimming slashes.
  const routePrefix = normalizeRoutePrefix(matchedRoute); // e.g. '/go/*' -> '/go', '/*' -> '/'
  let slug = path;
  if (routePrefix !== '' && routePrefix !== '/' &&
      (slug === routePrefix || slug.startsWith(routePrefix + '/'))) {
    slug = slug.slice(routePrefix.length);
  }
  slug = slug.replace(/^\//, '').replace(/\/$/, '');

  if (!slug) {
    // #12: serve the configured default page for the domain root (no slug given).
    const rootPage = await getRootPageSettingsOrDefault(c.env);

    if (rootPage.mode === 'redirect' && rootPage.redirect_url) {
      return Response.redirect(rootPage.redirect_url, 302);
    }

    if (rootPage.mode === 'html' && rootPage.html.trim()) {
      return c.html(rootPage.html);
    }

    // Default: a built-in branded welcome page.
    return c.html(renderBrandedRootPage(domainObj.domain_name));
  }

  // Handle redirect (pass execution context for proper async tracking)
  const redirectResponse = await handleRedirect(c.env, c.req.raw, domainObj, slug, c.executionCtx, matchedRoute);

  return redirectResponse;
});

// Error handler
app.onError(errorHandler);

// Cron trigger for scheduled tasks
async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  const cron = event.cron;

  // Handle different cron triggers
  if (cron === '0 0 * * *') {
    // Daily tasks (midnight UTC)
    ctx.waitUntil((async () => {
      try {
        // Daily analytics aggregation — respect the aggregation-enabled setting
        // (the manual /analytics/aggregate endpoint gates on the same setting).
        const { getAnalyticsAggregationEnabledOrDefault } = await import('./db/settings');
        const aggregationSettings = await getAnalyticsAggregationEnabledOrDefault(env);
        if (aggregationSettings.enabled) {
          const { aggregateYesterday } = await import('./services/analyticsAggregation');
          await aggregateYesterday(env);
        } else {
          console.log('[CRON] Analytics aggregation is disabled in settings; skipping.');
        }
      } catch (error) {
        console.error('[CRON ERROR] Failed to aggregate analytics:', error);
      }

      try {
        // Daily top 100 links status check
        const { processDailyTop100Check } = await import('./services/status-check');
        const result = await processDailyTop100Check(env);
      } catch (error) {
        console.error('[CRON ERROR] Failed to check top 100 links:', error);
      }
    })());
  } else if (cron === '0 */6 * * *') {
    // Status check every 6 hours (batch size read from settings)
    ctx.waitUntil((async () => {
      try {
        const { processScheduledStatusCheck } = await import('./services/status-check');
        const result = await processScheduledStatusCheck(env);
      } catch (error) {
        console.error('[CRON ERROR] Failed to check link statuses:', error);
      }
    })());
  } else {
    // Unrecognized cron string — likely wrangler.toml `crons` was edited without
    // updating this dispatch. Log loudly instead of silently doing nothing.
    console.warn(`[CRON] Unrecognized cron trigger "${cron}"; no scheduled job matched. Update the scheduled() handler in src/index.ts if crons changed.`);
  }
}

// #12: built-in branded welcome page served at a domain root when no custom
// page or redirect is configured. domainName is escaped (it originates from the DB).
function renderBrandedRootPage(domainName: string): string {
  const safeDomain = escapeHtml(domainName);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<title>Kome.top URL Shortener by Kome Studio</title>

<meta name="description" content="Kome.top is a simple URL shortener by Kome Studio. Shorten links, share smarter — clean, branded short links for social media, blogs, products, and campaigns." />
<meta name="keywords" content="kome.top, go.kome.top, komestudio, Kome Studio, URL shortener, short link, branded short links, share smarter, shorten links" />
<meta name="robots" content="index, follow" />
<meta name="theme-color" content="#0b0f17" />
<link rel="canonical" href="https://go.kome.top/" />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:title" content="Kome.top — Simple, Smart &amp; Shareable Links" />
<meta property="og:description" content="Shorten links. Share smarter. A simple URL shortener by Kome Studio." />
<meta property="og:url" content="https://go.kome.top/" />
<meta property="og:site_name" content="Kome Studio" />

<!-- Twitter -->
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="Kome.top — Simple, Smart &amp; Shareable Links" />
<meta name="twitter:description" content="Shorten links. Share smarter. A simple URL shortener by Kome Studio." />

<!-- Favicon -->
<!-- <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%94%97%3C/text%3E%3C/svg%3E" /> -->
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Cpath fill='%23FABB05' d='M511.98 252.94A256 256 0 1 0 480.52 378.98A257 257 0 0 1 228.07 285.98A423 423 0 0 0 511.98 252.94Z'/%3E%3Ccircle cx='281' cy='141' r='49' fill='%23EA4A3B'/%3E%3C/svg%3E" />
<link rel="apple-touch-icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Cpath fill='%23FABB05' d='M511.98 252.94A256 256 0 1 0 480.52 378.98A257 257 0 0 1 228.07 285.98A423 423 0 0 0 511.98 252.94Z'/%3E%3Ccircle cx='281' cy='141' r='49' fill='%23EA4A3B'/%3E%3C/svg%3E" />

<style>
  :root {
    --bg: #0b0f17;
    --bg-soft: #111827;
    --card: #151b26;
    --border: #232b3a;
    --text: #e6e9ef;
    --muted: #9aa4b2;
    --accent: #4f8cff;
    --accent-2: #7c5cff;
    --radius: 14px;
    --max: 900px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #16203a 0%, var(--bg) 60%);
    color: var(--text);
    line-height: 1.65;
    min-height: 100vh;
    padding: 32px 20px 80px;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: var(--max); margin: 0 auto; }

  header.hero {
    text-align: center;
    padding: 40px 0 32px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 40px;
  }
  .badge {
    display: inline-block;
    font-size: 13px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--accent);
    background: rgba(79,140,255,.1);
    border: 1px solid rgba(79,140,255,.3);
    padding: 6px 14px;
    border-radius: 999px;
    margin-bottom: 18px;
    font-weight: 600;
  }
  h1 {
    font-size: clamp(1.7rem, 4.4vw, 2.6rem);
    font-weight: 800;
    line-height: 1.2;
    letter-spacing: -.01em;
    background: linear-gradient(90deg, #fff 0%, #b9c6ff 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    margin-bottom: 12px;
  }
  .tagline {
    font-size: 1.15rem;
    color: #c8d4ff;
    font-weight: 600;
    margin-bottom: 14px;
  }
  .lede {
    font-size: 1.02rem;
    color: var(--muted);
    max-width: 680px;
    margin: 0 auto;
  }
  .lede a { color: var(--accent); text-decoration: none; }
  .lede a:hover { text-decoration: underline; }

  .card {
    background: linear-gradient(180deg, var(--card) 0%, var(--bg-soft) 100%);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 26px 28px;
    margin-bottom: 22px;
  }
  .card h2 {
    font-size: 1.2rem;
    font-weight: 700;
    margin-bottom: 12px;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .card h2 .ico {
    display: inline-flex;
    width: 26px; height: 26px;
    align-items: center; justify-content: center;
    background: rgba(79,140,255,.15);
    border-radius: 8px;
    font-size: 14px;
  }
  .card p { color: var(--muted); margin-bottom: 10px; }
  .card p:last-child { margin-bottom: 0; }
  .card a { color: var(--accent); text-decoration: none; }
  .card a:hover { text-decoration: underline; }

  ol, ul { padding-left: 20px; color: var(--muted); }
  ol li, ul li { margin-bottom: 8px; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    background: rgba(255,255,255,.06);
    border: 1px solid var(--border);
    padding: 2px 6px;
    border-radius: 6px;
    font-size: .9em;
    color: #c8d4ff;
  }
  strong { color: var(--text); }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 16px;
    margin-bottom: 22px;
  }
  .feature {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 20px;
  }
  .feature .emoji { font-size: 22px; display: block; margin-bottom: 8px; }
  .feature h3 { font-size: 1rem; color: #fff; margin-bottom: 6px; font-weight: 700; }
  .feature p { font-size: .92rem; color: var(--muted); margin: 0; }

  .faq details {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 10px;
  }
  .faq details[open] { border-color: rgba(79,140,255,.4); }
  .faq summary {
    cursor: pointer;
    font-weight: 600;
    color: #fff;
    list-style: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after {
    content: "+";
    font-size: 1.3rem;
    color: var(--accent);
    transition: transform .2s;
  }
  .faq details[open] summary::after { content: "−"; }
  .faq details p { margin-top: 10px; color: var(--muted); }

  .cta {
    text-align: center;
    background: linear-gradient(135deg, rgba(79,140,255,.15), rgba(124,92,255,.15));
    border: 1px solid rgba(79,140,255,.35);
    border-radius: var(--radius);
    padding: 34px 24px;
    margin-top: 30px;
  }
  .cta h2 { font-size: 1.3rem; margin-bottom: 8px; color: #fff; }
  .cta p { color: var(--muted); margin-bottom: 18px; }
  .btn {
    display: inline-block;
    padding: 12px 26px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    color: #fff !important;
    font-weight: 700;
    border-radius: 10px;
    text-decoration: none !important;
    transition: transform .15s, box-shadow .15s;
    box-shadow: 0 8px 24px rgba(79,140,255,.25);
  }
  .btn:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(79,140,255,.4); }

  footer {
    text-align: center;
    color: var(--muted);
    font-size: .85rem;
    margin-top: 40px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
  }
  footer a { color: var(--muted); }
  footer a:hover { color: var(--accent); }
</style>

<!-- Structured data: WebSite -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Kome.top",
  "alternateName": ["go.kome.top", "Kome Studio URL Shortener"],
  "url": "https://go.kome.top/",
  "description": "Kome.top is a simple URL shortener by Kome Studio. Shorten links, share smarter with clean, branded short links.",
  "publisher": {
    "@type": "Organization",
    "name": "Kome Studio",
    "url": "https://komestudio.com",
    "sameAs": ["https://komestudio.com", "https://kome.top"]
  }
}
</script>

<!-- Structured data: FAQ -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is Kome.top?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Kome.top is a simple URL shortener by Kome Studio. It turns long URLs into short, clean, and shareable links for social media, blogs, products, and campaigns."
      }
    },
    {
      "@type": "Question",
      "name": "Is Kome.top safe to use?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Kome.top and its subdomain go.kome.top are official Kome Studio services. Short links redirect only to trusted destinations."
      }
    },
    {
      "@type": "Question",
      "name": "Who is Kome.top for?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Kome.top is useful for content creators, bloggers, marketers, entrepreneurs, and anyone who wants to share long URLs in a cleaner format."
      }
    },
    {
      "@type": "Question",
      "name": "What other domains does Kome Studio use?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Kome Studio operates komestudio.com and kome.top, along with subdomains such as go.kome.top, go.kome.top, and dl.kome.top."
      }
    }
  ]
}
</script>
</head>

<body>
<div class="wrap">

  <header class="hero">
    <span class="badge">🔗 URL Shortener by Kome Studio</span>
    <h1>Kome.top Simple Smart Shareable Links</h1>
    <p class="tagline">Shorten links. Share smarter.</p>
    <p class="lede">
      <strong>Kome.top</strong> is a simple URL shortener by
      <a href="https://komestudio.com" title="Kome Studio official website">Kome Studio</a>,
      designed to make long URLs shorter, cleaner, and easier to share.
      Whether you're sharing on social media, publishing blog posts,
      promoting products, or managing links for your business, Kome.top helps
      you create concise links that are easier to remember and use.
    </p>
  </header>

  <section class="grid">
    <div class="feature">
      <span class="emoji">✂️</span>
      <h3>Short &amp; Clean Links</h3>
      <p>Turn long URLs into compact links that are easy to share.</p>
    </div>
    <div class="feature">
      <span class="emoji">📤</span>
      <h3>Easy to Share</h3>
      <p>Use short links in posts, messages, emails, and campaigns.</p>
    </div>
    <div class="feature">
      <span class="emoji">🏷️</span>
      <h3>Branded Domain</h3>
      <p>Share links using the Kome.top domain for a consistent presence.</p>
    </div>
    <div class="feature">
      <span class="emoji">⚡</span>
      <h3>Convenient Access</h3>
      <p>Redirect visitors to the original destination through a short link.</p>
    </div>
    <div class="feature">
      <span class="emoji">🛠️</span>
      <h3>Built for Everyday Use</h3>
      <p>Simple and practical for creators, personal projects, and businesses.</p>
    </div>
    <div class="feature">
      <span class="emoji">🛡️</span>
      <h3>Safe &amp; Official</h3>
      <p>Operated by Kome Studio on trusted infrastructure.</p>
    </div>
  </section>

  <section class="card">
    <h2><span class="ico">👥</span> Who Is Kome.top For?</h2>
    <p>
      Kome.top is useful for content creators, bloggers, marketers,
      entrepreneurs, and anyone who wants to share long URLs in a cleaner format.
    </p>
    <p>
      Use short links for social media profiles, articles, product pages,
      campaign materials, and other online resources.
    </p>
  </section>

  <section class="card">
    <h2><span class="ico">⚙️</span> How it works</h2>
    <ol>
      <li>A short link such as <code>go.kome.top/abc123</code> is created.</li>
      <li>When you open it, the service looks up the destination.</li>
      <li>You are redirected instantly to the original page.</li>
    </ol>
  </section>

  <section class="card">
    <h2><span class="ico">🏢</span> Powered by Kome Studio</h2>
    <p>
      Kome.top is part of the <strong>Kome Studio</strong> ecosystem, focused on
      building useful digital tools and products that make everyday online
      tasks simpler.
    </p>
    <p>
      Our goal is to create practical tools that help individuals and businesses
      work smarter, share content more efficiently, and grow their digital
      presence. Visit
      <a href="https://komestudio.com">komestudio.com</a>
      to explore more digital projects and tools.
    </p>
  </section>

  <section class="card faq">
    <h2><span class="ico">❓</span> Frequently asked questions</h2>

    <details open>
      <summary>What is Kome.top?</summary>
      <p>
        Kome.top is a simple URL shortener by Kome Studio. It turns long URLs
        into short, clean, and shareable links for social media, blogs,
        products, and campaigns.
      </p>
    </details>

    <details>
      <summary>Is Kome.top safe to use?</summary>
      <p>
        Yes. Kome.top and its subdomain <strong>go.kome.top</strong> are official
        Kome Studio services. Short links redirect only to trusted destinations.
      </p>
    </details>

    <details>
      <summary>Why did a link send me to go.kome.top?</summary>
      <p>
        You were redirected here because the short link is either being resolved
        or the destination is unavailable. Try again in a moment, or visit
        <a href="https://komestudio.com">komestudio.com</a> directly.
      </p>
    </details>

    <details>
      <summary>Can I create my own short link?</summary>
      <p>
        Short links are managed by Kome Studio. Visit
        <a href="https://komestudio.com">komestudio.com</a> for official
        information and support.
      </p>
    </details>

    <details>
      <summary>What other domains does Kome Studio use?</summary>
      <p>
        Kome Studio operates <strong>komestudio.com</strong> and
        <strong>kome.top</strong>, along with subdomains such as
        <strong>go.kome.top</strong>, and <strong>dl.kome.top</strong>.
      </p>
    </details>
  </section>

  <section class="cta">
    <h2>Make every link easier to share with Kome.top.</h2>
    <p>Visit Kome Studio to explore more digital projects and tools.</p>
    <a class="btn" href="https://komestudio.com">Visit Kome Studio →</a>
  </section>

  <footer>
    <p>
      © Kome Studio. All rights reserved. ·
      <a href="https://komestudio.com">komestudio.com</a> ·
      <a href="https://kome.top">kome.top</a> ·
      <a href="https://go.kome.top/dashboard">go.kome.top</a>
    </p>
    <p style="margin-top:6px;">
      Short links on go.kome.top redirect to their destinations.
    </p>
  </footer>

</div>
</body>
</html>`;
}

// Export default object with both fetch (HTTP handler) and scheduled (cron handler)
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled,
};
