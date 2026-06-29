/**
 * Airbnb property scraper.
 *
 * Strategy:
 *   1. Fetch the listing page with browser-realistic headers.
 *   2. Extract the embedded `__NEXT_DATA__` JSON blob (Airbnb is a Next.js
 *      app and serialises ALL page data into this script tag).
 *   3. Navigate the JSON tree using multiple known structural paths so the
 *      extractor degrades gracefully as Airbnb's front-end evolves.
 *   4. Fall back to deep-search helpers when structural paths miss.
 *
 * Known limitation: Airbnb may serve a CAPTCHA or 403 to automated
 * requests in some regions.  When this happens the extracted data will be
 * empty and the function throws `CrawlError` with a clear message.
 * Rotating residential proxies or a headless browser (Playwright) can
 * overcome this in production; see CLAUDE.md for guidance.
 */

import axios from 'axios';
import { load as cheerioLoad } from 'cheerio';
import type { PropertyData, PropertyImage, PropertyLocation } from './types';
import { createLogger } from '../utils/logger';
import { withRetry } from '../utils/retry';

const log = createLogger('crawler.airbnb');

// ─── Error type ──────────────────────────────────────────────────────────────

export class CrawlError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CrawlError';
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** Browser-like headers that reduce the likelihood of bot detection. */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,' +
    'image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language':    'en-US,en;q=0.9',
  'Accept-Encoding':    'gzip, deflate, br',
  'Cache-Control':      'no-cache',
  'Pragma':             'no-cache',
  'Sec-Fetch-Dest':     'document',
  'Sec-Fetch-Mode':     'navigate',
  'Sec-Fetch-Site':     'none',
  'Sec-Fetch-User':     '?1',
  'Upgrade-Insecure-Requests': '1',
};

async function fetchPage(url: string): Promise<string> {
  // When --render is active, fetch via a real headless browser so Airbnb's
  // JS/CAPTCHA challenge resolves and __NEXT_DATA__ is present in the HTML.
  if (process.env['CRAWL_RENDER']) {
    const { fetchRenderedHtml } = await import('./browser');
    return fetchRenderedHtml(url, 'script#__NEXT_DATA__');
  }

  const response = await withRetry(
    () => axios.get<string>(url, {
      headers:        BROWSER_HEADERS,
      timeout:        30_000,
      maxContentLength: 10 * 1024 * 1024, // 10 MB cap
      decompress:     true,
      validateStatus: (s) => s < 500, // handle 4xx ourselves
    }),
    {
      maxAttempts: 3,
      baseDelayMs: 2_000,
      factor:      2,
      shouldRetry: (_err, _attempt) => true,
      onRetry: (attempt, err, delay) =>
        log.warn('Retrying page fetch', { attempt, error: err.message, delayMs: delay }),
    },
  );

  if (response.status === 403) {
    throw new CrawlError(
      'Airbnb returned 403 Forbidden — the request was likely blocked by bot ' +
      'detection.  Try again from a different IP or use a residential proxy.',
    );
  }
  if (response.status === 404) {
    throw new CrawlError(`Listing not found (404) at: ${url}`);
  }
  if (response.status !== 200) {
    throw new CrawlError(`Unexpected HTTP ${response.status} from Airbnb.`);
  }

  return response.data as string;
}

// ─── JSON extraction helpers ──────────────────────────────────────────────────

/**
 * Recursively searches `obj` for the first value stored under `key`.
 * Used as a fallback when Airbnb restructures their Next.js page props.
 */
function deepFind<T>(obj: unknown, key: string, _depth = 0): T | undefined {
  if (_depth > 20 || typeof obj !== 'object' || obj === null) return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepFind<T>(item, key, _depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const record = obj as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, key)) {
    return record[key] as T;
  }
  for (const v of Object.values(record)) {
    const r = deepFind<T>(v, key, _depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

/**
 * Recursively collects ALL values stored under `key` at any depth.
 * Useful for gathering image arrays scattered across the tree.
 */
function deepFindAll<T>(obj: unknown, key: string, _depth = 0): T[] {
  if (_depth > 20 || typeof obj !== 'object' || obj === null) return [];
  const results: T[] = [];
  if (Array.isArray(obj)) {
    for (const item of obj) results.push(...deepFindAll<T>(item, key, _depth + 1));
    return results;
  }
  const record = obj as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, key)) {
    results.push(record[key] as T);
  }
  for (const v of Object.values(record)) {
    results.push(...deepFindAll<T>(v, key, _depth + 1));
  }
  return results;
}

// ─── Image extraction ─────────────────────────────────────────────────────────

/**
 * Upgrades Airbnb thumbnail URLs to the highest available resolution by
 * replacing sizing parameters.  The `im_w=1440` param requests a 1440-px
 * wide variant; Airbnb CDN serves the closest available size.
 */
function upgradeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip existing size params and request max width
    u.searchParams.delete('im_w');
    u.searchParams.set('im_w', '1440');
    return u.toString();
  } catch {
    return url;
  }
}

function extractImages(data: unknown): PropertyImage[] {
  const images: PropertyImage[] = [];
  const seen   = new Set<string>();

  // Pattern A: photos[] → { picture, caption }
  const photoArrays = deepFindAll<unknown[]>(data, 'photos');
  for (const arr of photoArrays) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      const photo = p as Record<string, unknown>;
      const raw   = (photo['picture'] ?? photo['url'] ?? photo['baseUrl']) as string | undefined;
      if (!raw || typeof raw !== 'string') continue;
      const url = upgradeImageUrl(raw);
      if (!seen.has(url)) {
        seen.add(url);
        images.push({ url, caption: photo['caption'] as string | undefined });
      }
    }
  }

  // Pattern B: mediaItems[] → { baseUrl }
  const mediaArrays = deepFindAll<unknown[]>(data, 'mediaItems');
  for (const arr of mediaArrays) {
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      const item = m as Record<string, unknown>;
      const raw  = item['baseUrl'] as string | undefined;
      if (!raw || typeof raw !== 'string') continue;
      const url = upgradeImageUrl(raw);
      if (!seen.has(url)) {
        seen.add(url);
        images.push({ url });
      }
    }
  }

  // Pattern C: flat imageUrl / pictureUrl fields anywhere in the tree
  const urlFields = ['imageUrl', 'pictureUrl', 'thumbnailUrl', 'xl_picture_url'];
  for (const field of urlFields) {
    const found = deepFindAll<string>(data, field);
    for (const raw of found) {
      if (!raw || typeof raw !== 'string') continue;
      const url = upgradeImageUrl(raw);
      if (!seen.has(url)) {
        seen.add(url);
        images.push({ url });
      }
    }
  }

  return images;
}

// ─── Amenity extraction ───────────────────────────────────────────────────────

function extractAmenities(data: unknown): string[] {
  const flat: string[] = [];

  // Modern Airbnb: every amenity group (seeAllAmenitiesGroups /
  // previewAmenitiesGroups) holds an `amenities` array of { title, available }.
  // Collect every such array at any depth and keep the available ones.
  const amenityArrays = deepFindAll<unknown[]>(data, 'amenities');
  for (const arr of amenityArrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item === 'string') { flat.push(item); continue; }
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if (rec['available'] === false) continue; // skip "not offered" amenities
        const name = (rec['title'] ?? rec['name']) as string | undefined;
        if (name && typeof name === 'string') flat.push(name);
      }
    }
  }

  // Legacy fallback: amenityGroups → items
  if (flat.length === 0) {
    const categories = deepFindAll<unknown>(data, 'amenityGroups');
    for (const group of categories) {
      if (!group || typeof group !== 'object') continue;
      const items = deepFind<unknown[]>(group, 'items') ?? [];
      for (const item of items) {
        const name = typeof item === 'string'
          ? item
          : ((item as Record<string, unknown>)['title'] ??
             (item as Record<string, unknown>)['name']) as string | undefined;
        if (name && typeof name === 'string') flat.push(name);
      }
    }
  }

  return [...new Set(flat)]; // deduplicate
}

// ─── Main extractor ───────────────────────────────────────────────────────────

function extractListingId(url: string): string | undefined {
  const m = url.match(/\/rooms\/(\d+)/);
  return m?.[1];
}

/**
 * Parses the `__NEXT_DATA__` JSON blob embedded in every Airbnb listing page
 * and returns a normalised `PropertyData` object.
 *
 * Tries four structural paths in order of likelihood:
 *   1. props.pageProps.listing              (classic PDP)
 *   2. props.pageProps.bootstrapData paths  (older PDP variant)
 *   3. niobeMinimalClientData deep search   (current PDP as of 2024)
 *   4. Generic deep search on the whole tree (catch-all)
 */
function parseNextData(raw: string, sourceUrl: string): PropertyData {
  let nextData: Record<string, unknown>;
  try {
    nextData = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    throw new CrawlError('Failed to parse __NEXT_DATA__ JSON', e);
  }

  // ── Path 1: props.pageProps.listing ───────────────────────────────────────
  const pageProps = deepFind<Record<string, unknown>>(nextData, 'pageProps');
  let listing     = pageProps?.['listing'] as Record<string, unknown> | undefined;

  // ── Path 2: bootstrapData.reduxData.homePDP.listingInfo.listing ──────────
  if (!listing) {
    const bootstrap = deepFind<Record<string, unknown>>(nextData, 'bootstrapData');
    listing = deepFind<Record<string, unknown>>(bootstrap, 'listing');
  }

  // ── Path 3 / 4: search the whole tree ────────────────────────────────────
  if (!listing) {
    listing = deepFind<Record<string, unknown>>(nextData, 'listing');
  }

  // Use the whole nextData tree as search root if we still didn't isolate a listing
  const root: unknown = listing ?? nextData;

  // ── Title ─────────────────────────────────────────────────────────────────
  const title: string =
    (listing?.['name']                              as string | undefined) ??
    deepFind<string>(root, 'propertyName')          ??
    deepFind<string>(root, 'listingName')           ??
    deepFind<string>(root, 'name')                  ??
    'Untitled Airbnb Listing';

  // ── Description ───────────────────────────────────────────────────────────
  const descObj     = deepFind<Record<string, unknown>>(root, 'description');
  const description: string =
    (typeof descObj === 'string'                    ? descObj : undefined) ??
    (descObj?.['summary']                           as string | undefined) ??
    (descObj?.['space']                             as string | undefined) ??
    deepFind<string>(root, 'summary')               ??
    deepFind<string>(root, 'descriptionHTML')       ??
    (deepFind<Record<string, unknown>>(root, 'htmlDescription')?.['htmlText'] as string | undefined) ??
    '';

  // ── Modern Airbnb summary string (sharingConfig.title) ─────────────────────
  // e.g. "Cottage in Pensacola · ★5.0 · 1 bedroom · 1 bed · 1 bath" — encodes
  // city, bedroom/bath counts, and rating that are otherwise hard to locate.
  const sharingTitle =
    (deepFind<Record<string, unknown>>(root, 'sharingConfig')?.['title'] as string | undefined) ?? '';
  const sCity   = sharingTitle.match(/\bin\s+([^·]+?)\s*·/)?.[1]?.trim();
  const sBeds   = Number(sharingTitle.match(/(\d+)\s+bedroom/)?.[1]) || 0;
  const sBath   = Number(sharingTitle.match(/(\d+(?:\.\d+)?)\s+bath/)?.[1]) || 0;
  const sRating = Number(sharingTitle.match(/★\s*([\d.]+)/)?.[1]) || undefined;

  // ── Numeric fields ────────────────────────────────────────────────────────
  const bedrooms  = Number(deepFind<unknown>(root, 'bedrooms')       ?? deepFind<unknown>(root, 'bedroomCount')  ?? 0) || sBeds;
  const bathrooms = Number(deepFind<unknown>(root, 'bathrooms')      ?? deepFind<unknown>(root, 'bathroomCount') ?? 0) || sBath;
  const capacity  = Number(deepFind<unknown>(root, 'personCapacity') ?? deepFind<unknown>(root, 'maxGuests')     ?? deepFind<unknown>(root, 'accommodates') ?? 0);

  // ── Location ──────────────────────────────────────────────────────────────
  const location: PropertyLocation = {
    city:        deepFind<string>(root, 'city')        ?? deepFind<string>(root, 'cityName') ?? sCity,
    state:       deepFind<string>(root, 'state')       ?? deepFind<string>(root, 'stateName'),
    country:     deepFind<string>(root, 'country')     ?? deepFind<string>(root, 'countryName'),
    countryCode: deepFind<string>(root, 'countryCode') ?? deepFind<string>(root, 'country_code'),
    lat:         Number(deepFind<unknown>(root, 'lat') ?? deepFind<unknown>(root, 'latitude'))  || undefined,
    lng:         Number(deepFind<unknown>(root, 'lng') ?? deepFind<unknown>(root, 'longitude')) || undefined,
  };

  // ── Images ────────────────────────────────────────────────────────────────
  const images = extractImages(root);
  log.info('Extracted images', { count: images.length });

  // ── Amenities ─────────────────────────────────────────────────────────────
  const amenities = extractAmenities(root);
  log.info('Extracted amenities', { count: amenities.length });

  // ── Property / room type ──────────────────────────────────────────────────
  const propertyType = deepFind<string>(root, 'propertyType') ?? deepFind<string>(root, 'property_type');
  const roomType     = deepFind<string>(root, 'roomType')     ?? deepFind<string>(root, 'room_type');

  // ── Rating ────────────────────────────────────────────────────────────────
  const rating      = Number(deepFind<unknown>(root, 'starRating') ?? deepFind<unknown>(root, 'avgRating') ?? deepFind<unknown>(root, 'rating')) || sRating;
  const reviewCount = Number(deepFind<unknown>(root, 'reviewsCount') ?? deepFind<unknown>(root, 'numberOfReviews')) || undefined;

  return {
    sourceUrl,
    platform:    'airbnb',
    externalId:  extractListingId(sourceUrl) ?? deepFind<string>(root, 'id'),
    title:       title.trim(),
    description: description.trim(),
    images,
    amenities,
    bedrooms:    isNaN(bedrooms)  ? 0 : bedrooms,
    bathrooms:   isNaN(bathrooms) ? 0 : bathrooms,
    capacity:    isNaN(capacity)  ? 0 : capacity,
    propertyType,
    roomType,
    location,
    rating,
    reviewCount,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches the Airbnb listing at `url` and returns normalised property data.
 *
 * @throws {CrawlError} on HTTP errors, bot-detection blocks, or parse failures.
 */
export async function scrapeAirbnb(url: string): Promise<PropertyData> {
  log.info('Fetching Airbnb listing page', { url });

  const html = await fetchPage(url);
  const $    = cheerioLoad(html);

  // Airbnb serialises page data into an embedded JSON blob. Historically this
  // was `__NEXT_DATA__`; modern Airbnb (2024+) moved it to a
  // `data-deferred-state-*` script tag (the Apollo/Relay state). Try both so
  // the extractor works across page-structure versions.
  const nextDataRaw =
    $('script#__NEXT_DATA__').html() ??
    $('script#data-deferred-state-0').html() ??
    $('script[id^="data-deferred-state"]').first().html();
  if (!nextDataRaw) {
    throw new CrawlError(
      'Could not locate Airbnb page data (neither __NEXT_DATA__ nor ' +
      'data-deferred-state). Airbnb may have served a CAPTCHA or changed structure.',
    );
  }

  log.debug('__NEXT_DATA__ size', { bytes: nextDataRaw.length });

  const data = parseNextData(nextDataRaw, url);

  if (!data.title || data.title === 'Untitled Airbnb Listing') {
    log.warn('Title not found — page may have been a CAPTCHA or error page');
  }
  if (data.images.length === 0) {
    log.warn('No images extracted — verify the listing URL is publicly accessible');
  }

  log.info('Airbnb extraction complete', {
    title:    data.title,
    images:   data.images.length,
    amenities: data.amenities.length,
    bedrooms: data.bedrooms,
    capacity: data.capacity,
  });

  return data;
}
