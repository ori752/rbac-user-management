/**
 * Top-leads report builder.
 *
 * Applies a QUALIFIED-LEAD distress floor — the report is never padded to 5 with
 * low-distress (healthy) hosts. It returns up to 5 leads above the floor, and
 * states plainly when fewer qualify. The LEADS_DISCLAIMER rides the JSON report,
 * the human-readable summary, and (via run.ts) the manager notification.
 */
import type { DistressScore, HostLead, LeadsReport, ReviewDiagnosis, SourceListing } from './types';
import { LEADS_DISCLAIMER } from './types';

export interface AnalyzedListing {
  listing: SourceListing;
  diagnosis: ReviewDiagnosis;
  distress: DistressScore;
}

export const DEFAULT_MAX_LEADS = 5;

/** Resolves the distress floor: explicit opt → LEADS_MIN_DISTRESS env → 40. */
function resolveMinDistress(explicit?: number): number {
  if (typeof explicit === 'number') return explicit;
  const env = process.env['LEADS_MIN_DISTRESS'];
  const n = env !== undefined ? Number(env) : NaN;
  return Number.isFinite(n) ? n : 40;
}

export function buildLeadsReport(
  analyzed: AnalyzedListing[],
  opts: { source: string; minDistress?: number; max?: number; disclaimer?: string },
): LeadsReport {
  const minDistress = resolveMinDistress(opts.minDistress);
  const max = opts.max ?? DEFAULT_MAX_LEADS;

  const leads: HostLead[] = analyzed
    .filter((a) => a.distress.score >= minDistress)
    .sort((a, b) => b.distress.score - a.distress.score)
    .slice(0, max)
    .map((a) => ({
      listingId:    a.listing.id,
      listingTitle: a.listing.title,
      listingUrl:   a.listing.url,
      platform:     a.listing.platform,
      location:     [a.listing.city, a.listing.country].filter(Boolean).join(', ') || undefined,
      diagnosis:    a.diagnosis,
      distress:     a.distress,
      contact:      a.listing.host,
    }));

  return {
    generatedAt: new Date().toISOString(),
    source:      opts.source,
    evaluated:   analyzed.length,
    minDistress,
    leads,
    disclaimer:  opts.disclaimer ?? LEADS_DISCLAIMER,
  };
}

function contactLine(c: HostLead['contact']): string {
  const bits = [
    c.managementCompany && `Company: ${c.managementCompany}`,
    !c.managementCompany && c.hostName ? `Host: ${c.hostName}` : '',
    c.businessEmail   && `Email: ${c.businessEmail}`,
    c.businessPhone   && `Phone: ${c.businessPhone}`,
    c.businessWebsite && `Web: ${c.businessWebsite}`,
    c.companyLinkedIn && `LinkedIn: ${c.companyLinkedIn}`,
  ].filter(Boolean);
  return bits.join(' · ') || '—';
}

/** Human-readable summary — carries the disclaimer and the under-5 note. */
export function formatReportText(report: LeadsReport): string {
  const lines: string[] = [];
  lines.push('HOST LEAD INTELLIGENCE — TOP HOT LEADS');
  lines.push(`Source: ${report.source}    Generated: ${report.generatedAt}`);

  const n = report.leads.length;
  if (n === 0) {
    lines.push(`\nNo hosts met the qualified-lead threshold (distress ≥ ${report.minDistress}) of ${report.evaluated} evaluated.`);
  } else {
    const note = n < DEFAULT_MAX_LEADS
      ? ` — fewer than ${DEFAULT_MAX_LEADS} hosts qualified; the report is NOT padded with low-distress listings.`
      : '.';
    lines.push(`\n${n} qualified hot lead${n === 1 ? '' : 's'} (distress ≥ ${report.minDistress}) of ${report.evaluated} evaluated${note}`);
  }

  report.leads.forEach((l, i) => {
    lines.push('');
    lines.push(`${i + 1}. ${l.listingTitle}  [${l.platform}${l.location ? ', ' + l.location : ''}]  — distress ${l.distress.score}/100`);
    lines.push(`   Problem : ${l.diagnosis.category} (severity ${l.diagnosis.severity}/5) — ${l.diagnosis.summary}`);
    lines.push(`   Evidence: ${l.distress.signals.join('; ')}`);
    lines.push(`   Contact : ${contactLine(l.contact)}`);
  });

  lines.push('');
  lines.push(report.disclaimer);
  return lines.join('\n');
}
