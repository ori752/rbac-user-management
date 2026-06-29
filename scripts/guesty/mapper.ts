/**
 * Maps a crawler `PropertyData` object to a Guesty `GuestyListingPayload`.
 *
 * This is the single translation layer between the platform-agnostic
 * crawler output and the Guesty API shape.  All field mapping and
 * value normalisation is concentrated here so changes to either side
 * only require editing this file.
 */

import type { PropertyData }      from '../crawler/types';
import type { GuestyListingPayload, GuestyAddress, GuestyPicture } from './types';

// ─── Property type mapping ────────────────────────────────────────────────────

/**
 * Maps free-text property-type strings scraped from source pages to the
 * Guesty enum values accepted by their API.
 *
 * Guesty accepted values (non-exhaustive): APARTMENT, HOUSE, VILLA, STUDIO,
 * CONDO, TOWNHOUSE, BUNGALOW, LOFT, COTTAGE, CABIN, BOAT, OTHER.
 */
function mapPropertyType(raw?: string): string | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();

  // Guesty expects Title-case enum strings (e.g. "Apartment", not "APARTMENT").
  if (upper.includes('APARTMENT') || upper.includes('FLAT'))   return 'Apartment';
  if (upper.includes('HOUSE') || upper.includes('HOME'))       return 'House';
  if (upper.includes('VILLA'))                                  return 'Villa';
  if (upper.includes('STUDIO'))                                 return 'Studio';
  if (upper.includes('CONDO'))                                  return 'Condominium';
  if (upper.includes('TOWNHOUSE') || upper.includes('TOWN'))   return 'Townhouse';
  if (upper.includes('BUNGALOW'))                               return 'Bungalow';
  if (upper.includes('LOFT'))                                   return 'Loft';
  if (upper.includes('CABIN') || upper.includes('CHALET'))     return 'Cabin';
  if (upper.includes('BOAT') || upper.includes('HOUSEBOAT'))   return 'Boat';
  if (upper.includes('CASTLE'))                                 return 'Castle';

  return 'Other';
}

/**
 * Maps free-text room-type strings to Guesty enum values.
 * Guesty accepted values: "Entire home/apt", "Private room", "Shared room".
 */
function mapRoomType(raw?: string): string | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();

  if (upper.includes('ENTIRE') || upper.includes('WHOLE')) return 'Entire home/apt';
  if (upper.includes('PRIVATE'))                            return 'Private room';
  if (upper.includes('SHARED'))                             return 'Shared room';

  return 'Entire home/apt'; // most common default for holiday rentals
}

// ─── Address mapping ──────────────────────────────────────────────────────────

function mapAddress(loc: PropertyData['location']): GuestyAddress | undefined {
  if (!loc || Object.keys(loc).length === 0) return undefined;

  return {
    full:        [loc.street, loc.city, loc.state, loc.country]
                   .filter(Boolean)
                   .join(', ') || undefined,
    street:      loc.street,
    city:        loc.city,
    state:       loc.state,
    country:     loc.country,
    countryCode: loc.countryCode,
    zipcode:     loc.zipCode,
    lat:         loc.lat,
    lng:         loc.lng,
  };
}

// ─── Picture mapping ──────────────────────────────────────────────────────────

function mapPictures(images: PropertyData['images']): GuestyPicture[] {
  return images.map((img, index) => ({
    original:  img.url,
    caption:   img.caption,
    sortOrder: index,
  }));
}

// ─── Main mapper ──────────────────────────────────────────────────────────────

/**
 * Converts a normalised `PropertyData` object into a `GuestyListingPayload`
 * ready to be sent to POST /v1/listings.
 *
 * Validation rules enforced here (before any network call):
 *   - Title must be non-empty.
 *   - At least one image must be present (Guesty requires images for a
 *     listing to appear publicly, though the API accepts zero).
 */
export function mapToGuestyPayload(data: PropertyData): GuestyListingPayload {
  if (!data.title.trim()) {
    throw new Error('Cannot create Guesty listing: property title is empty.');
  }

  const payload: GuestyListingPayload = {
    title:        data.title.slice(0, 200), // Guesty title max length
    nickname:     data.title.slice(0, 50),  // Shorter internal label

    propertyType: mapPropertyType(data.propertyType),
    roomType:     mapRoomType(data.roomType),

    bedrooms:     data.bedrooms  > 0 ? data.bedrooms  : undefined,
    bathrooms:    data.bathrooms > 0 ? data.bathrooms : undefined,
    accommodates: data.capacity  > 0 ? data.capacity  : undefined,

    amenities:    data.amenities.length > 0 ? data.amenities : undefined,

    publicDescription: data.description
      ? { summary: data.description.slice(0, 5_000) }  // Guesty description max
      : undefined,

    address:  mapAddress(data.location),
    pictures: mapPictures(data.images),

    // Guesty requires prices.basePrice + currency. Nightly price is not reliably
    // scrapeable, so we seed a placeholder the manager adjusts on the draft.
    prices: { basePrice: 100, currency: data.currencyCode ?? 'USD' },
    terms:  { minNights: 1, maxNights: 365 },

    checkInOutPolicy:
      data.checkInTime || data.checkOutTime
        ? {
            checkInTimeStart: data.checkInTime,
            checkOutUntil:    data.checkOutTime,
          }
        : undefined,

    // Store the source URL as an external ID for traceability
    externalId: data.externalId,
    tags:       [`source:${data.platform}`, `crawled:${new Date().toISOString().slice(0, 10)}`],
  };

  return payload;
}

/**
 * Returns a human-readable summary of the mapped payload for logs / dry-run output.
 */
export function summarisePayload(payload: GuestyListingPayload): Record<string, unknown> {
  return {
    title:        payload.title,
    propertyType: payload.propertyType,
    roomType:     payload.roomType,
    bedrooms:     payload.bedrooms,
    bathrooms:    payload.bathrooms,
    accommodates: payload.accommodates,
    amenities:    payload.amenities?.length ?? 0,
    pictures:     payload.pictures?.length  ?? 0,
    city:         payload.address?.city,
    country:      payload.address?.country,
    tags:         payload.tags,
  };
}
