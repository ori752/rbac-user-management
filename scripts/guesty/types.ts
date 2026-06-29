/**
 * TypeScript types for the Guesty Open API (v1).
 *
 * Reference: https://open-api.guesty.com
 *
 * Only fields relevant to listing creation and image upload are modelled here.
 * Extend as needed when integrating additional Guesty endpoints.
 */

// ─── Authentication ───────────────────────────────────────────────────────────

export interface GuestyTokenResponse {
  access_token: string;
  token_type:   string;
  /** Lifetime of the token in seconds (typically 86400 = 24 h). */
  expires_in:   number;
  scope:        string;
}

// ─── Listing payload (POST /v1/listings) ─────────────────────────────────────

export interface GuestyAddress {
  full?:        string;
  street?:      string;
  city?:        string;
  state?:       string;
  country?:     string;
  countryCode?: string;
  zipcode?:     string;
  lat?:         number;
  lng?:         number;
}

export interface GuestyPicture {
  /** Publicly accessible URL that Guesty will fetch and store. */
  original: string;
  caption?: string;
  /** Zero-based sort order within the listing gallery. */
  sortOrder?: number;
}

export interface GuestyPublicDescription {
  summary?:     string;
  space?:       string;
  access?:      string;
  interaction?: string;
  houseRules?:  string;
  transit?:     string;
}

export interface GuestyCheckInOutPolicy {
  /** 24-h time string, e.g. "15:00". */
  checkInTimeStart?:  string;
  checkInTimeEnd?:    string;
  checkOutUntil?:     string;
}

/** Required by POST /v1/listings — basePrice + currency are mandatory. */
export interface GuestyPrices {
  basePrice:    number;
  currency:     string;
  cleaningFee?: number;
}

export interface GuestyTerms {
  minNights?: number;
  maxNights?: number;
}

/**
 * Payload sent to POST /v1/listings to create a new listing draft.
 *
 * Guesty will accept partial payloads; only `title` is strictly required
 * by their API but we validate more fields before submission.
 */
export interface GuestyListingPayload {
  title:        string;
  /** Short internal label — defaults to title if omitted. */
  nickname?:    string;
  /** Guesty property type enum.  Common values: APARTMENT, HOUSE, VILLA, STUDIO. */
  propertyType?: string;
  /** Guesty room type enum.  Common values: ENTIRE_HOME, PRIVATE_ROOM, SHARED_ROOM. */
  roomType?:    string;

  bedrooms?:    number;
  bathrooms?:   number;
  /** Maximum number of guests the property accommodates. */
  accommodates?: number;

  amenities?:          string[];
  publicDescription?:  GuestyPublicDescription;
  address?:            GuestyAddress;
  pictures?:           GuestyPicture[];
  checkInOutPolicy?:   GuestyCheckInOutPolicy;
  /** Mandatory for listing creation. */
  prices?:             GuestyPrices;
  terms?:              GuestyTerms;

  /** Source platform URL (stored as a tag/note for traceability). */
  externalId?: string;
  tags?:       string[];
}

// ─── API responses ────────────────────────────────────────────────────────────

/**
 * Minimal shape of a Guesty listing as returned by POST /v1/listings.
 * The full object has ~100+ fields; we only need the ID immediately.
 */
export interface GuestyListingResponse {
  /** Guesty's internal unique ID for the listing. */
  _id:          string;
  title:        string;
  nickname?:    string;
  status?:      string;
  createdAt?:   string;
  pictures?:    GuestyPicture[];
}

/**
 * Wraps every Guesty API error so callers can distinguish API-level failures
 * from network failures.
 */
export class GuestyApiError extends Error {
  constructor(
    message:             string,
    public statusCode:   number,
    public responseBody: unknown,
  ) {
    super(message);
    this.name = 'GuestyApiError';
  }
}
