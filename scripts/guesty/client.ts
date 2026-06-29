/**
 * Guesty Open API client.
 *
 * Handles:
 *   - OAuth 2.0 client-credentials authentication with automatic token refresh.
 *   - Listing creation (POST /v1/listings).
 *   - Picture batch upload (PUT /v1/listings/:id — partial update).
 *   - Exponential-backoff retry on transient 5xx / 429 errors.
 *
 * Credentials are read exclusively from environment variables — never
 * hardcoded.  Missing credentials cause an early, descriptive failure rather
 * than a cryptic 401 from the API.
 *
 * Usage:
 *   const client = new GuestyClient();
 *   await client.authenticate();
 *   const listing = await client.createListing(payload);
 *   await client.uploadPictures(listing._id, pictures);
 */

import axios, { AxiosInstance } from 'axios';
import type {
  GuestyTokenResponse,
  GuestyListingPayload,
  GuestyListingResponse,
  GuestyPicture,
} from './types';
import { GuestyApiError } from './types';
import { createLogger }  from '../utils/logger';
import { withRetry }     from '../utils/retry';

const log = createLogger('guesty.client');

// ─── Configuration ────────────────────────────────────────────────────────────

// Guesty sandbox and production share the same base URL; sandbox behaviour
// is determined by the credentials used (sandbox client_id / client_secret).
const DEFAULT_API_BASE = 'https://open-api.guesty.com';

/** Max pictures per PATCH call to stay inside Guesty's payload size limits. */
const PICTURE_BATCH_SIZE = 10;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true for error codes that are worth retrying automatically.
 * 4xx errors (except 429 rate-limit) indicate a caller bug and should
 * surface immediately without wasting retry budget.
 */
function isTransient(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

// ─── Client class ─────────────────────────────────────────────────────────────

export class GuestyClient {
  private readonly apiBase: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  private accessToken?: string;
  /** Unix epoch ms when the current token expires. */
  private tokenExpiresAt = 0;

  private readonly http: AxiosInstance;

  constructor() {
    this.clientId     = this.requireEnv('GUESTY_CLIENT_ID');
    this.clientSecret = this.requireEnv('GUESTY_CLIENT_SECRET');
    this.apiBase      = process.env['GUESTY_API_BASE'] ?? DEFAULT_API_BASE;

    this.http = axios.create({
      baseURL: this.apiBase,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });

    log.debug('GuestyClient initialised', { apiBase: this.apiBase });
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  /**
   * Fetches (or reuses) a Bearer token via OAuth 2.0 client-credentials.
   * Automatically called by all request methods; callers may also call it
   * explicitly to validate credentials at startup.
   */
  async authenticate(): Promise<void> {
    // Token is still valid (with a 60-second buffer for clock skew)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      log.debug('Reusing cached Guesty token');
      return;
    }

    log.info('Fetching Guesty access token');

    const response = await withRetry(
      () => axios.post<GuestyTokenResponse>(
        `${this.apiBase}/oauth2/token`,
        new URLSearchParams({
          grant_type:    'client_credentials',
          client_id:     this.clientId,
          client_secret: this.clientSecret,
          scope:         'open-api',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15_000,
        },
      ),
      {
        maxAttempts: 3,
        baseDelayMs: 1_000,
        factor:      2,
        shouldRetry: (_, attempt) => attempt < 3,
        onRetry: (attempt, err, delay) =>
          log.warn('Retrying token fetch', { attempt, error: err.message, delayMs: delay }),
      },
    );

    if (response.status !== 200 || !response.data.access_token) {
      throw new GuestyApiError(
        'Authentication failed — check GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET',
        response.status,
        response.data,
      );
    }

    this.accessToken    = response.data.access_token;
    this.tokenExpiresAt = Date.now() + response.data.expires_in * 1_000;

    log.info('Guesty token acquired', {
      expiresInSeconds: response.data.expires_in,
    });
  }

  // ── Listing creation ───────────────────────────────────────────────────────

  /**
   * Creates a new listing draft in Guesty and returns the full response object.
   *
   * Pictures are stripped from the initial payload and uploaded in a separate
   * step so that a partial image failure doesn't prevent listing creation.
   */
  async createListing(payload: GuestyListingPayload): Promise<GuestyListingResponse> {
    await this.authenticate();

    // Separate pictures out for a dedicated upload step
    const { pictures, ...corePayload } = payload;
    void pictures; // will be used in uploadPictures

    log.info('Creating Guesty listing', { title: corePayload.title });
    log.debug('Listing payload (no pictures)', { payload: corePayload });

    const response = await withRetry(
      () => this.http.post<GuestyListingResponse>('/v1/listings', corePayload, {
        headers: { Authorization: `Bearer ${this.accessToken!}` },
      }),
      {
        maxAttempts: 3,
        baseDelayMs: 2_000,
        factor:      2,
        shouldRetry: (err) => {
          const status = (err as { response?: { status: number } }).response?.status ?? 0;
          return isTransient(status);
        },
        onRetry: (attempt, err, delay) =>
          log.warn('Retrying listing creation', { attempt, error: err.message, delayMs: delay }),
      },
    );

    this.assertSuccess(response.status, response.data, 'createListing');
    log.info('Listing created', { id: response.data._id });
    return response.data;
  }

  // ── Picture upload ─────────────────────────────────────────────────────────

  /**
   * Uploads pictures to an existing listing in batches to avoid payload size
   * limits.  Returns the count of pictures that were successfully uploaded.
   *
   * Partial failures (a batch fails while others succeed) are logged as
   * warnings but do not throw — the listing is still usable without all
   * images.
   */
  async uploadPictures(
    listingId: string,
    pictures:  GuestyPicture[],
  ): Promise<{ succeeded: number; failed: number }> {
    if (pictures.length === 0) return { succeeded: 0, failed: 0 };

    await this.authenticate();

    let succeeded = 0;
    let failed    = 0;

    const batches = chunk(pictures, PICTURE_BATCH_SIZE);
    log.info('Uploading pictures', { total: pictures.length, batches: batches.length });

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      try {
        await withRetry(
          () => this.http.put(
            `/v1/listings/${listingId}`,
            { pictures: batch },
            { headers: { Authorization: `Bearer ${this.accessToken!}` } },
          ),
          {
            maxAttempts: 3,
            baseDelayMs: 1_500,
            factor:      2,
            shouldRetry: (err) => {
              const status = (err as { response?: { status: number } }).response?.status ?? 0;
              return isTransient(status);
            },
            onRetry: (attempt, err, delay) =>
              log.warn('Retrying picture batch upload', {
                batch: i + 1, attempt, error: err.message, delayMs: delay,
              }),
          },
        );
        succeeded += batch.length;
        log.debug('Picture batch uploaded', { batch: i + 1, count: batch.length });
      } catch (err) {
        failed += batch.length;
        log.warn('Picture batch upload failed', {
          batch: i + 1,
          count: batch.length,
          error: (err as Error).message,
        });
      }
    }

    log.info('Picture upload complete', { succeeded, failed });
    return { succeeded, failed };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `Missing required environment variable: ${name}. ` +
        'Copy .env.example to .env and fill in your Guesty sandbox credentials.',
      );
    }
    return value;
  }

  private assertSuccess(status: number, body: unknown, operation: string): void {
    if (status >= 400) {
      throw new GuestyApiError(
        `Guesty API error during ${operation} (HTTP ${status})`,
        status,
        body,
      );
    }
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
