/**
 * crawl-to-guesty — CLI entry point for the property pipeline.
 *
 * Pipeline stages:
 *   1. Parse CLI arguments and validate required environment variables.
 *   2. Crawl the provided Airbnb / Booking.com URL → PropertyData.
 *   3. Map PropertyData → GuestyListingPayload.
 *   4. [--dry-run skips steps 4-5] Authenticate with Guesty API.
 *   5. Create the listing draft in Guesty.
 *   6. Upload images in batches to the new listing.
 *   7. Dispatch success / failure notification to all configured channels.
 *
 * Usage:
 *   npm run crawl -- --url "https://www.airbnb.com/rooms/12345"
 *   npm run crawl -- --url "https://www.airbnb.com/rooms/12345" --dry-run
 *   npm run crawl -- --url "https://www.airbnb.com/rooms/12345" --log-level debug
 *
 * Exit codes:
 *   0  Pipeline succeeded (or dry-run completed)
 *   1  Crawl failure
 *   2  Guesty authentication failure
 *   3  Guesty listing creation failure
 *   4  Missing required arguments or environment variables
 */

import * as dotenv from 'dotenv';
import * as path   from 'path';

// Load .env from the project root before any other import reads process.env
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { crawlProperty, CrawlError }       from './crawler/index';
import { GuestyClient }                    from './guesty/client';
import { GuestyApiError }                  from './guesty/types';
import { mapToGuestyPayload, summarisePayload } from './guesty/mapper';
import { notify }                          from './notifier/index';
import type { NotificationPayload }        from './notifier/types';
import { createLogger, resolveLogLevel }   from './utils/logger';

const log = createLogger('pipeline', resolveLogLevel());

// ─── CLI argument parsing ─────────────────────────────────────────────────────

interface CliArgs {
  url:      string;
  dryRun:   boolean;
  logLevel: string;
  json:     boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get  = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const url = get('--url');
  if (!url) {
    printUsage();
    process.exit(4);
  }

  // --render routes page fetches through a headless browser (Playwright) to
  // get past Airbnb/Booking bot-detection. Signalled to the crawlers via env.
  if (has('--render')) process.env['CRAWL_RENDER'] = '1';

  return {
    url,
    dryRun:   has('--dry-run'),
    logLevel: get('--log-level') ?? resolveLogLevel(),
    json:     has('--json'),
  };
}

function printUsage(): void {
  console.log(`
Usage:
  npm run crawl -- --url <property-url> [options]

Options:
  --url <url>           Airbnb or Booking.com property URL  (required)
  --dry-run             Extract and map data but do NOT call Guesty API
  --render              Fetch via headless browser (Playwright) to bypass bot-detection
  --log-level <level>   debug | info | warn | error  (default: info)

Examples:
  npm run crawl -- --url "https://www.airbnb.com/rooms/12345678"
  npm run crawl -- --url "https://www.booking.com/hotel/es/..." --dry-run
  npm run crawl -- --url "https://www.airbnb.com/rooms/12345678" --log-level debug
`.trim());
}

// ─── Dry-run output ───────────────────────────────────────────────────────────

function printDryRunSummary(
  url:     string,
  crawled: Awaited<ReturnType<typeof crawlProperty>>,
  payload: ReturnType<typeof mapToGuestyPayload>,
): void {
  const DIVIDER = '═'.repeat(60);
  const sub     = '─'.repeat(60);

  console.log(`\n${DIVIDER}`);
  console.log('DRY RUN — no Guesty API calls will be made');
  console.log(DIVIDER);

  console.log('\n📄  CRAWLED PROPERTY DATA');
  console.log(sub);
  console.log(`  Title       : ${crawled.title}`);
  console.log(`  Platform    : ${crawled.platform}`);
  console.log(`  External ID : ${crawled.externalId ?? '—'}`);
  console.log(`  Bedrooms    : ${crawled.bedrooms}`);
  console.log(`  Bathrooms   : ${crawled.bathrooms}`);
  console.log(`  Capacity    : ${crawled.capacity}`);
  console.log(`  Images      : ${crawled.images.length}`);
  console.log(`  Amenities   : ${crawled.amenities.length}`);
  console.log(`  House Rules : ${crawled.houseRules?.length ?? 0}`);
  console.log(`  Location    : ${[crawled.location.city, crawled.location.country].filter(Boolean).join(', ') || '—'}`);
  console.log(`  Description : ${crawled.description.slice(0, 120)}${crawled.description.length > 120 ? '…' : ''}`);

  if (crawled.images.length > 0) {
    console.log('\n  First 5 image URLs:');
    crawled.images.slice(0, 5).forEach((img, i) => {
      console.log(`    ${i + 1}. ${img.url}`);
    });
    if (crawled.images.length > 5) {
      console.log(`    … and ${crawled.images.length - 5} more`);
    }
  }

  console.log('\n🏨  GUESTY PAYLOAD (core fields)');
  console.log(sub);
  const summary = summarisePayload(payload);
  Object.entries(summary).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(14)}: ${JSON.stringify(v)}`);
  });

  console.log(`\n${DIVIDER}`);
  console.log('Dry run complete.  Remove --dry-run to execute the pipeline.');
  console.log(`${DIVIDER}\n`);
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const { url, dryRun, json } = parseArgs();

  log.info('Pipeline starting', { url, dryRun });

  const timestamp = new Date().toISOString();
  let notifPayload: NotificationPayload = {
    success:       false,
    propertyTitle: '',
    sourceUrl:     url,
    platform:      'airbnb',  // will be overwritten after crawl
    summary:       '',
    timestamp,
  };

  // Emits a single machine-readable result line (consumed by the web app's
  // /import route). No-op unless --json is passed.
  const emitJson = (extra: Record<string, unknown> = {}): void => {
    if (!json) return;
    console.log('__PIPELINE_RESULT__' + JSON.stringify({
      success:          notifPayload.success,
      failedAt:         notifPayload.failedAt,
      error:            notifPayload.errorMessage,
      platform:         notifPayload.platform,
      propertyTitle:    notifPayload.propertyTitle,
      sourceUrl:        notifPayload.sourceUrl,
      guestyPropertyId: notifPayload.guestyPropertyId,
      guestyListingUrl: notifPayload.guestyListingUrl,
      imagesTotal:      notifPayload.imagesTotal,
      imagesUploaded:   notifPayload.imagesUploaded,
      amenitiesCount:   notifPayload.amenitiesCount,
      bedrooms:         notifPayload.bedrooms,
      bathrooms:        notifPayload.bathrooms,
      capacity:         notifPayload.capacity,
      city:             notifPayload.city,
      country:          notifPayload.country,
      ...extra,
    }));
  };

  // ── Stage 1: Crawl ──────────────────────────────────────────────────────────
  log.info('Stage 1/3 — Crawling property page');

  let crawled: Awaited<ReturnType<typeof crawlProperty>>;
  try {
    crawled = await crawlProperty(url);
  } catch (err) {
    const message = err instanceof CrawlError
      ? err.message
      : `Unexpected crawl error: ${(err as Error).message}`;

    log.error('Crawl failed', { error: message });

    notifPayload = { ...notifPayload, errorMessage: message, failedAt: 'crawl' };
    emitJson();
    await notify(notifPayload);
    process.exit(1);
  }

  notifPayload = {
    ...notifPayload,
    propertyTitle:  crawled.title,
    platform:       crawled.platform,
    bedrooms:       crawled.bedrooms,
    bathrooms:      crawled.bathrooms,
    capacity:       crawled.capacity,
    amenitiesCount: crawled.amenities.length,
    imagesTotal:    crawled.images.length,
    city:           crawled.location.city,
    country:        crawled.location.country,
  };

  // ── Stage 2: Map payload ────────────────────────────────────────────────────
  log.info('Stage 2/3 — Mapping to Guesty payload');

  let guestyPayload: ReturnType<typeof mapToGuestyPayload>;
  try {
    guestyPayload = mapToGuestyPayload(crawled);
  } catch (err) {
    const message = (err as Error).message;
    log.error('Payload mapping failed', { error: message });
    notifPayload = { ...notifPayload, errorMessage: message, failedAt: 'unknown' };
    emitJson();
    await notify(notifPayload);
    process.exit(1);
  }

  // ── Dry-run exit ────────────────────────────────────────────────────────────
  if (dryRun) {
    printDryRunSummary(url, crawled, guestyPayload);
    emitJson({ success: true, dryRun: true, picturesMapped: guestyPayload.pictures?.length ?? 0, houseRulesCount: crawled.houseRules?.length ?? 0, thumbnail: crawled.images[0]?.url });
    process.exit(0);
  }

  // ── Stage 3: Guesty API ─────────────────────────────────────────────────────
  log.info('Stage 3/3 — Creating Guesty listing draft');

  const client = new GuestyClient();

  try {
    await client.authenticate();
  } catch (err) {
    const message = (err as Error).message;
    log.error('Guesty authentication failed', { error: message });
    notifPayload = { ...notifPayload, errorMessage: message, failedAt: 'guesty_auth' };
    emitJson();
    await notify(notifPayload);
    process.exit(2);
  }

  let listing: Awaited<ReturnType<typeof client.createListing>>;
  try {
    listing = await client.createListing(guestyPayload);
  } catch (err) {
    const message = err instanceof GuestyApiError
      ? `Guesty API error (${err.statusCode}): ${err.message}`
      : (err as Error).message;

    log.error('Listing creation failed', { error: message });
    notifPayload = { ...notifPayload, errorMessage: message, failedAt: 'guesty_create' };
    emitJson();
    await notify(notifPayload);
    process.exit(3);
  }

  // Construct the dashboard URL using Guesty's known deep-link pattern
  const guestyListingUrl =
    `https://app.guesty.com/properties/${listing._id}/overview`;

  notifPayload = {
    ...notifPayload,
    guestyPropertyId: listing._id,
    guestyListingUrl,
  };

  // ── Image upload (partial failures are non-fatal) ─────────────────────────
  if (guestyPayload.pictures && guestyPayload.pictures.length > 0) {
    log.info('Uploading pictures', { total: guestyPayload.pictures.length });
    try {
      const result = await client.uploadPictures(listing._id, guestyPayload.pictures);
      notifPayload = { ...notifPayload, imagesUploaded: result.succeeded };

      if (result.failed > 0) {
        log.warn('Some pictures failed to upload', {
          failed:    result.failed,
          succeeded: result.succeeded,
        });
      }
    } catch (err) {
      // Upload failure is non-fatal — listing exists, just without all images
      log.warn('Picture upload threw an unexpected error', {
        error: (err as Error).message,
      });
    }
  }

  // ── Notify success ────────────────────────────────────────────────────────
  const summary = [
    `Successfully created Guesty listing draft for: ${crawled.title}`,
    `Guesty ID:    ${listing._id}`,
    `Dashboard:    ${guestyListingUrl}`,
    `Source:       ${url}`,
    `Images:       ${notifPayload.imagesUploaded ?? 0} / ${crawled.images.length} uploaded`,
    `Amenities:    ${crawled.amenities.length}`,
    `Bedrooms:     ${crawled.bedrooms}  Bathrooms: ${crawled.bathrooms}  Capacity: ${crawled.capacity}`,
  ].join('\n');

  notifPayload = { ...notifPayload, success: true, summary };

  emitJson({ thumbnail: crawled.images[0]?.url, houseRulesCount: crawled.houseRules?.length ?? 0 });
  await notify(notifPayload);
  process.exit(0);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

run().catch((err: unknown) => {
  // Should not reach here — all code paths inside run() handle their own errors.
  // This is a last-resort safety net.
  console.error('Unhandled pipeline error:', (err as Error)?.message ?? err);
  process.exit(1);
});
