/**
 * Booking.com property scraper.
 *
 * Strategy:
 *   1. Fetch the property page with browser-realistic headers.
 *   2. Parse JSON-LD (`<script type="application/ld+json">`) — this is the
 *      most stable extraction point because it follows the Schema.org
 *      LodgingBusiness spec and Booking.com rarely changes it.
 *   3. Fall back to Open Graph meta tags for title and description.
 *   4. Fall back to DOM selectors for images and ratings.
 *
 * Known limitation: Booking.com uses heavy Cloudflare protection and will
 * frequently return 403 or a JS-challenge page to non-browser requests.
 * A headless browser is recommended for production use; see CLAUDE.md.
 */

import axios from 'axios';
import { load as cheerioLoad } from 'cheerio';
import type { PropertyData, PropertyImage, PropertyLocation } from './types';
import { CrawlError } from './airbnb';
import { createLogger } from '../utils/logger';
import { withRetry } from '../utils/retry';

const log = createLogger('crawler.booking');

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

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
  'Sec-Fetch-Dest':     'document',
  'Sec-Fetch-Mode':     'navigate',
  'Sec-Fetch-Site':     'none',
  'Upgrade-Insecure-Requests': '1',
};

async function fetchPage(url: string): Promise<string> {
  // When --render is active, fetch via a real headless browser so Booking's
  // Cloudflare JS challenge resolves and the JSON-LD is present in the HTML.
  if (process.env['CRAWL_RENDER']) {
    const { fetchRenderedHtml } = await import('./browser');
    return fetchRenderedHtml(url, 'script[type="application/ld+json"]');
  }

  const response = await withRetry(
    () => axios.get<string>(url, {
      headers:          BROWSER_HEADERS,
      timeout:          30_000,
      maxContentLength: 10 * 1024 * 1024,
      decompress:       true,
      validateStatus:   (s) => s < 500,
    }),
    {
      maxAttempts: 3,
      baseDelayMs: 2_500,
      factor:      2,
      onRetry: (attempt, err, delay) =>
        log.warn('Retrying page fetch', { attempt, error: err.message, delayMs: delay }),
    },
  );

  if (response.status === 403) {
    throw new CrawlError(
      'Booking.com returned 403 — Cloudflare protection is blocking the request. ' +
      'Use a residential proxy or headless browser for reliable extraction.',
    );
  }
  if (response.status === 404) {
    throw new CrawlError(`Property not found (404) at: ${url}`);
  }
  if (response.status !== 200) {
    throw new CrawlError(`Unexpected HTTP ${response.status} from Booking.com.`);
  }

  return response.data as string;
}

// ─── JSON-LD extraction ───────────────────────────────────────────────────────

interface JsonLdLodging {
  '@type'?:       string;
  name?:          string;
  description?:   string;
  image?:         string | string[] | Array<{ url?: string; contentUrl?: string }>;
  address?:       {
    '@type'?:         string;
    streetAddress?:   string;
    addressLocality?: string;
    addressRegion?:   string;
    addressCountry?:  string | { name?: string; '@id'?: string };
    postalCode?:      string;
  };
  geo?: { '@type'?: string; latitude?: number; longitude?: number };
  starRating?: { ratingValue?: number };
  aggregateRating?: { ratingValue?: number; reviewCount?: number };
  amenityFeature?: Array<{ '@type'?: string; name?: string; value?: boolean }>;
  numberOfRooms?: number;
  petsAllowed?:   boolean;
  checkinTime?:   string;
  checkoutTime?:  string;
}

function parseJsonLd(html: string): JsonLdLodging | null {
  const $ = cheerioLoad(html);
  const scripts: string[] = [];

  $('script[type="application/ld+json"]').each((_i, el) => {
    const text = $(el).html();
    if (text) scripts.push(text);
  });

  for (const raw of scripts) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      // Handle both single object and @graph array
      const candidates: unknown[] = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>)['@graph']
          ? ((parsed as Record<string, unknown>)['@graph'] as unknown[])
          : [parsed];

      for (const c of candidates) {
        const obj = c as Record<string, unknown>;
        if (
          obj['@type'] === 'LodgingBusiness' ||
          obj['@type'] === 'Hotel' ||
          obj['@type'] === 'Apartment' ||
          obj['@type'] === 'VacationRental' ||
          obj['@type'] === 'Resort'
        ) {
          return obj as unknown as JsonLdLodging;
        }
      }
    } catch {
      // Malformed JSON-LD — move on
    }
  }
  return null;
}

// ─── Image extraction ─────────────────────────────────────────────────────────

function normaliseImageUrl(raw: string): string {
  // Booking.com uses max_* size params — request the largest available
  try {
    const u = new URL(raw);
    // Some CDN URLs embed dimensions in the path; nothing we can do there
    return u.toString();
  } catch {
    return raw;
  }
}

function extractImages(html: string, jsonLd: JsonLdLodging | null): PropertyImage[] {
  const images: PropertyImage[] = [];
  const seen   = new Set<string>();

  const push = (url: string, caption?: string) => {
    const norm = normaliseImageUrl(url);
    if (!seen.has(norm)) { seen.add(norm); images.push({ url: norm, caption }); }
  };

  // Source 1: JSON-LD image field
  if (jsonLd?.image) {
    const imgs = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
    for (const img of imgs) {
      if (typeof img === 'string') {
        push(img);
      } else if (typeof img === 'object') {
        const url = img.url ?? img.contentUrl;
        if (url) push(url);
      }
    }
  }

  // Source 2: DOM — data-highres-src and standard src attributes on <img>
  const $ = cheerioLoad(html);
  $('img[data-highres-src]').each((_i, el) => {
    const src = $(el).attr('data-highres-src') ?? '';
    if (src) push(src, $(el).attr('alt'));
  });
  $('img[data-src]').each((_i, el) => {
    const src = $(el).attr('data-src') ?? '';
    // Filter out tiny icons (less than 50px indicators in the URL)
    if (src && !src.includes('icons') && !src.includes('favicon')) push(src, $(el).attr('alt'));
  });

  // Source 3: Open Graph image
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) push(ogImage);

  return images;
}

// ─── Amenity extraction ───────────────────────────────────────────────────────

function extractAmenities(html: string, jsonLd: JsonLdLodging | null): string[] {
  const amenities = new Set<string>();

  // Source 1: JSON-LD amenityFeature
  if (jsonLd?.amenityFeature) {
    for (const f of jsonLd.amenityFeature) {
      // Only include features that are actually available (value === true)
      if (f.name && f.value !== false) amenities.add(f.name);
    }
  }

  // Source 2: common Booking.com DOM selectors (fallback)
  const $ = cheerioLoad(html);
  $('[data-testid="facility-item"] span, .hp_desc_important_facilities li').each((_i, el) => {
    const text = $(el).text().trim();
    if (text) amenities.add(text);
  });

  return [...amenities];
}

// ─── Location extraction ──────────────────────────────────────────────────────

function extractLocation(
  html: string,
  jsonLd: JsonLdLodging | null,
): PropertyLocation {
  const location: PropertyLocation = {};

  if (jsonLd?.address) {
    const a = jsonLd.address;
    location.street  = a.streetAddress;
    location.city    = a.addressLocality;
    location.state   = a.addressRegion;
    location.zipCode = a.postalCode;

    if (typeof a.addressCountry === 'string') {
      location.country = a.addressCountry;
    } else if (typeof a.addressCountry === 'object') {
      location.country = a.addressCountry.name;
    }
  }

  if (jsonLd?.geo) {
    if (typeof jsonLd.geo.latitude  === 'number') location.lat = jsonLd.geo.latitude;
    if (typeof jsonLd.geo.longitude === 'number') location.lng = jsonLd.geo.longitude;
  }

  // DOM fallback: Booking.com embeds coordinates in a data attribute
  if (!location.lat) {
    const $ = cheerioLoad(html);
    const mapEl = $('[data-atlas-latlng]').first();
    const latlng = mapEl.attr('data-atlas-latlng') ?? '';
    const parts = latlng.split(',');
    if (parts.length === 2) {
      location.lat = parseFloat(parts[0] ?? '');
      location.lng = parseFloat(parts[1] ?? '');
    }
  }

  return location;
}

// ─── Property ID extraction ───────────────────────────────────────────────────

function extractPropertyId(url: string): string | undefined {
  // Booking.com URLs: /hotel/es/property-name.en-gb.html or ?hotel_id=12345
  const byQuery = new URL(url).searchParams.get('hotel_id');
  if (byQuery) return byQuery;
  const m = url.match(/\/(\d+)\.en/);
  return m?.[1];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches the Booking.com property at `url` and returns normalised property data.
 *
 * @throws {CrawlError} on HTTP errors, Cloudflare blocks, or parse failures.
 */
export async function scrapeBooking(url: string): Promise<PropertyData> {
  log.info('Fetching Booking.com property page', { url });

  const html   = await fetchPage(url);
  const $      = cheerioLoad(html);
  const jsonLd = parseJsonLd(html);

  log.debug('JSON-LD found', { found: jsonLd !== null, type: jsonLd?.['@type'] });

  // ── Title ─────────────────────────────────────────────────────────────────
  const title: string =
    jsonLd?.name ??
    $('meta[property="og:title"]').attr('content') ??
    $('h2[data-testid="title"]').first().text().trim() ??
    $('h2.pp-header__title').first().text().trim() ??
    'Untitled Booking.com Property';

  // ── Description ───────────────────────────────────────────────────────────
  const description: string =
    jsonLd?.description ??
    $('meta[property="og:description"]').attr('content') ??
    $('[data-testid="property-description"]').first().text().trim() ??
    '';

  // ── Images ────────────────────────────────────────────────────────────────
  const images   = extractImages(html, jsonLd);
  log.info('Extracted images', { count: images.length });

  // ── Amenities ─────────────────────────────────────────────────────────────
  const amenities = extractAmenities(html, jsonLd);
  log.info('Extracted amenities', { count: amenities.length });

  // ── Location ──────────────────────────────────────────────────────────────
  const location = extractLocation(html, jsonLd);

  // ── Rating ────────────────────────────────────────────────────────────────
  const ratingRaw  = jsonLd?.aggregateRating?.ratingValue ?? jsonLd?.starRating?.ratingValue;
  const reviewsRaw = jsonLd?.aggregateRating?.reviewCount;

  // ── Bed/bath/capacity — Booking.com rarely exposes these in JSON-LD ────────
  const bedroomsRaw = jsonLd?.numberOfRooms ?? 0;

  // ── Check-in / check-out ──────────────────────────────────────────────────
  const checkInTime  = jsonLd?.checkinTime;
  const checkOutTime = jsonLd?.checkoutTime;

  log.info('Booking.com extraction complete', {
    title,
    images:   images.length,
    amenities: amenities.length,
  });

  return {
    sourceUrl:    url,
    platform:     'booking',
    externalId:   extractPropertyId(url),
    title:        title.trim(),
    description:  description.trim(),
    images,
    amenities,
    bedrooms:     Number(bedroomsRaw) || 0,
    bathrooms:    0,   // not reliably available in JSON-LD
    capacity:     0,   // not reliably available in JSON-LD
    location,
    checkInTime,
    checkOutTime,
    rating:       ratingRaw ? Number(ratingRaw) : undefined,
    reviewCount:  reviewsRaw ? Number(reviewsRaw) : undefined,
  };
}
