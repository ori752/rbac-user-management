/**
 * Shared types for the notification subsystem.
 *
 * Every notifier (email, Slack, console) receives a `NotificationPayload`
 * and is responsible for formatting it appropriately for its channel.
 */

export interface NotificationPayload {
  /** True when the full pipeline succeeded (crawl + Guesty create + pictures). */
  success: boolean;

  /** Title of the scraped property. */
  propertyTitle: string;

  /** Guesty listing ID assigned by the API.  Undefined on failure. */
  guestyPropertyId?: string;

  /**
   * Deep-link to the listing in the Guesty dashboard.
   * Constructed from the known URL pattern; may require login to access.
   */
  guestyListingUrl?: string;

  /** Source URL that was crawled. */
  sourceUrl: string;

  /** Platform that was scraped. */
  platform: 'airbnb' | 'booking';

  /** Human-readable pipeline summary (markdown-safe). */
  summary: string;

  /** ISO-8601 timestamp of when the pipeline completed. */
  timestamp: string;

  // ── Statistics ─────────────────────────────────────────────────────────────

  imagesTotal?:     number;
  imagesUploaded?:  number;
  bedrooms?:        number;
  bathrooms?:       number;
  capacity?:        number;
  amenitiesCount?:  number;
  city?:            string;
  country?:         string;

  // ── Error details (failure case only) ──────────────────────────────────────

  /** Human-readable error message.  Present when `success === false`. */
  errorMessage?: string;
  /** The error stage where the pipeline failed. */
  failedAt?: 'crawl' | 'guesty_auth' | 'guesty_create' | 'guesty_pictures' | 'unknown';
}
