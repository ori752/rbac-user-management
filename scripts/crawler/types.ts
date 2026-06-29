/**
 * Canonical data model produced by every platform-specific crawler.
 *
 * All crawlers MUST populate the required fields.  Optional fields are
 * populated on a best-effort basis; downstream code should treat them
 * as advisory rather than guaranteed.
 */

export interface PropertyImage {
  /** Full URL of the high-resolution image. */
  url: string;
  /** Human-readable caption, if present on the source page. */
  caption?: string;
}

export interface PropertyLocation {
  /** Combined single-line address as displayed on the source page. */
  address?: string;
  street?:     string;
  city?:       string;
  state?:      string;
  /** Full country name, e.g. "Spain". */
  country?:    string;
  /** ISO 3166-1 alpha-2 code, e.g. "ES". */
  countryCode?: string;
  zipCode?:    string;
  /** WGS-84 latitude. */
  lat?: number;
  /** WGS-84 longitude. */
  lng?: number;
}

export interface PropertyData {
  /** Canonical URL of the scraped page. */
  sourceUrl: string;
  /** Source platform identifier. */
  platform: 'airbnb' | 'booking';
  /** Platform-native listing ID (e.g. "12345678" for Airbnb). */
  externalId?: string;

  // ── Core listing fields ───────────────────────────────────────────────────

  title:       string;
  description: string;

  /** All images found, ordered as they appear on the source page. */
  images: PropertyImage[];

  /** Amenity names as plain strings (e.g. "WiFi", "Kitchen", "Pool"). */
  amenities: string[];

  bedrooms:  number;
  bathrooms: number;
  /** Maximum number of guests the property accommodates. */
  capacity:  number;

  // ── Optional enrichment fields ────────────────────────────────────────────

  /** e.g. "Entire apartment", "Private room", "Villa". */
  propertyType?: string;
  /** e.g. "Entire home/apt", "Private room", "Shared room". */
  roomType?: string;

  location: PropertyLocation;

  /** ISO time string like "15:00". */
  checkInTime?:  string;
  checkOutTime?: string;

  /** Average rating out of 5. */
  rating?: number;
  reviewCount?: number;
  currencyCode?: string;
}
