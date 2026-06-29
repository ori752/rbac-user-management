/**
 * Headless-browser page fetcher (Playwright + Chromium).
 *
 * Airbnb and Booking.com block plain HTTP scraping (CAPTCHA / Cloudflare JS
 * challenge). A real browser executes the page's JavaScript — including any
 * anti-bot challenge — so it can reach the rendered HTML that the cheerio
 * extractors expect. This is the production-recommended path referenced in
 * CLAUDE.md, activated with the `--render` CLI flag (sets CRAWL_RENDER=1).
 *
 * Note: from a datacenter IP advanced bot-detection may still challenge even a
 * real browser; a residential proxy is the next escalation if so.
 */

import { chromium } from 'playwright';
import { createLogger } from '../utils/logger';

const log = createLogger('crawler.browser');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Loads `url` in a headless Chromium browser and returns the fully-rendered
 * HTML. When `waitSelector` is supplied, waits for that element to appear
 * (giving JS challenges / hydration time to complete) before snapshotting.
 */
export async function fetchRenderedHtml(url: string, waitSelector?: string): Promise<string> {
  log.info('Launching headless Chromium', { url });

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:        USER_AGENT,
      locale:           'en-US',
      timezoneId:       'America/New_York',
      viewport:         { width: 1366, height: 900 },
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    // Mask the most common automation fingerprints before any page script runs.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
    });

    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const status = resp?.status();
    log.info('Navigation complete', { status });

    if (waitSelector) {
      try {
        await page.waitForSelector(waitSelector, { timeout: 12_000 });
      } catch {
        log.warn('Target selector not found within timeout — page may be a challenge/CAPTCHA', { waitSelector });
      }
    } else {
      await page.waitForTimeout(3_500);
    }

    const html = await page.content();
    log.info('Rendered HTML retrieved', { bytes: html.length, status });
    return html;
  } finally {
    await browser.close();
  }
}
