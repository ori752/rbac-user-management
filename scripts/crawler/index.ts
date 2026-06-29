/**
 * Crawler factory — detects the source platform from the URL and dispatches
 * to the appropriate platform-specific scraper.
 *
 * Usage:
 *   const data = await crawlProperty('https://www.airbnb.com/rooms/12345678');
 *   const data = await crawlProperty('https://www.booking.com/hotel/es/...');
 */

import type { PropertyData } from './types';
import { scrapeAirbnb, CrawlError }  from './airbnb';
import { scrapeBooking }             from './booking';
import { createLogger }              from '../utils/logger';

export { CrawlError } from './airbnb';
export type { PropertyData }         from './types';

const log = createLogger('crawler');

type Platform = 'airbnb' | 'booking';

/**
 * Detects the source platform from the property URL.
 *
 * @throws {CrawlError} when the URL does not match a supported platform.
 */
function detectPlatform(url: string): Platform {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CrawlError(`Invalid URL: "${url}"`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname.includes('airbnb.')) return 'airbnb';
  if (hostname.includes('booking.com')) return 'booking';

  throw new CrawlError(
    `Unsupported platform hostname: "${hostname}". ` +
    'Supported platforms: airbnb.com, booking.com',
  );
}

/**
 * Fetches and extracts property data from any supported platform URL.
 *
 * @param url  Full URL of the Airbnb or Booking.com property page.
 * @returns    Normalised `PropertyData` object.
 * @throws     `CrawlError` on unsupported URLs, HTTP errors, or parse failures.
 */
export async function crawlProperty(url: string): Promise<PropertyData> {
  const platform = detectPlatform(url);
  log.info('Platform detected', { platform, url });

  switch (platform) {
    case 'airbnb':  return scrapeAirbnb(url);
    case 'booking': return scrapeBooking(url);
  }
}
