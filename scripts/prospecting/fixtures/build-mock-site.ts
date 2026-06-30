/**
 * Generates a small, realistic "rental marketplace" website (static HTML) from
 * sample-listings.json, so the Playwright scraper (sources/mockScrape.ts) has a
 * LEGAL target to scrape that is structurally similar to a real listing page
 * (title, rating, reviews, host block). Run:
 *
 *   npx ts-node --transpile-only --project tsconfig.scripts.json \
 *     scripts/prospecting/fixtures/build-mock-site.ts
 */
import * as fs from 'fs';
import * as path from 'path';

interface Review { text: string; rating?: number; date?: string }
interface Host {
  hostName?: string; managementCompany?: string; businessWebsite?: string;
  businessEmail?: string; businessPhone?: string; companyLinkedIn?: string;
}
interface Listing {
  id: string; platform: string; title: string; city?: string; country?: string;
  rating?: number; reviewsCount?: number; isSuperhost?: boolean; host: Host; reviews: Review[];
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const FIX = path.resolve(__dirname, 'sample-listings.json');
const OUT = path.resolve(__dirname, 'mock-site');

const listings: Listing[] = JSON.parse(fs.readFileSync(FIX, 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

function listingPage(l: Listing): string {
  const h = l.host;
  const reviews = l.reviews
    .map((r) =>
      `      <article class="review" data-rating="${esc(r.rating)}" data-date="${esc(r.date)}">` +
      `<p class="review-text">${esc(r.text)}</p></article>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${esc(l.title)}</title></head>
<body>
  <main class="listing" data-id="${esc(l.id)}" data-platform="mock">
    <h1 class="title">${esc(l.title)}</h1>
    <div class="location" data-city="${esc(l.city)}" data-country="${esc(l.country)}">${esc(l.city)}, ${esc(l.country)}</div>
    <div class="rating" data-rating="${esc(l.rating)}" data-reviews-count="${esc(l.reviewsCount)}">${esc(l.rating)} stars from ${esc(l.reviewsCount)} reviews</div>
    <div class="superhost" data-superhost="${l.isSuperhost ? 'true' : 'false'}">${l.isSuperhost ? 'Superhost' : 'Not a Superhost'}</div>
    <section class="host">
      <span class="host-name">${esc(h.hostName)}</span>
      <span class="host-company">${esc(h.managementCompany)}</span>
      <a class="host-website" href="${esc(h.businessWebsite)}">website</a>
      <span class="host-email">${esc(h.businessEmail)}</span>
      <span class="host-phone">${esc(h.businessPhone)}</span>
      <a class="host-linkedin" href="${esc(h.companyLinkedIn)}">company linkedin</a>
    </section>
    <section class="reviews">
${reviews}
    </section>
  </main>
</body>
</html>`;
}

const index = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Mock Rental Marketplace (demo)</title></head>
<body>
  <h1>Mock Rental Marketplace — demo target for the Playwright scraper</h1>
  <ul class="listings">
${listings.map((l) => `    <li><a class="listing-link" href="${esc(l.id)}.html">${esc(l.title)}</a></li>`).join('\n')}
  </ul>
</body>
</html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), index);
for (const l of listings) fs.writeFileSync(path.join(OUT, `${l.id}.html`), listingPage(l));
console.log(`Generated ${listings.length} mock listing pages + index.html in ${OUT}`);
