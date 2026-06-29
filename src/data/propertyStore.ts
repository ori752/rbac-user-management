/**
 * In-memory store of properties imported through the app (via POST /import).
 * Mirrors the user store's pattern — data resets on server restart.
 */
import { randomUUID } from 'crypto';

export interface ImportedProperty {
  id:         string;
  guestyId?:  string;
  guestyUrl?: string;
  title:      string;
  platform:   string;
  sourceUrl:  string;
  thumbnail?: string;
  images:     number;
  amenities:  number;
  houseRules: number;
  bedrooms?:  number;
  bathrooms?: number;
  capacity?:  number;
  city?:      string;
  country?:   string;
  importedBy: string;
  createdAt:  string;
}

const properties: ImportedProperty[] = [];

export const propertyStore = {
  /** Adds a property and returns it (newest first). */
  add(input: Omit<ImportedProperty, 'id'>): ImportedProperty {
    const rec: ImportedProperty = { id: randomUUID(), ...input };
    properties.unshift(rec);
    return rec;
  },
  list(): ImportedProperty[] {
    return properties;
  },
};

// Seed with the listing already imported through the pipeline, so the
// Properties view is populated out of the box (resets on restart).
propertyStore.add({
  guestyId:   '6a42c9b8e1fee300116ac7bd',
  guestyUrl:  'https://app.guesty.com/properties/6a42c9b8e1fee300116ac7bd/overview',
  title:      '*Magical Priv Cottage* — Pensacola',
  platform:   'airbnb',
  sourceUrl:  'https://www.airbnb.com/rooms/18711133',
  thumbnail:  'https://a0.muscache.com/im/pictures/airflow/Hosting-18711133/original/29881638-86ad-421e-baee-e7e4ad23a2c9.jpg?im_w=1440',
  images:     49,
  amenities:  47,
  houseRules: 12,
  bedrooms:   1,
  bathrooms:  1,
  capacity:   2,
  city:       'Pensacola',
  importedBy: 'admin@example.com',
  createdAt:  new Date().toISOString(),
});
