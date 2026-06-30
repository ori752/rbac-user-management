/**
 * Email notifier — sends a rich HTML summary to the Engineering Manager
 * via SMTP using nodemailer.
 *
 * Required environment variables (all four must be set; otherwise this
 * notifier silently skips):
 *   SMTP_HOST       e.g. smtp.gmail.com
 *   SMTP_PORT       e.g. 587 (STARTTLS) or 465 (SSL)
 *   SMTP_USER       SMTP account username
 *   SMTP_PASS       SMTP account password / App Password
 *   NOTIFY_EMAIL_TO Recipient address (Engineering Manager)
 *   NOTIFY_EMAIL_FROM Sender address shown in From: header
 */

import nodemailer from 'nodemailer';
import type { NotificationPayload } from './types';
import { createLogger } from '../utils/logger';

const log = createLogger('notifier.email');

// ─── Configuration check ──────────────────────────────────────────────────────

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env['SMTP_HOST'] &&
    process.env['SMTP_PORT'] &&
    process.env['SMTP_USER'] &&
    process.env['SMTP_PASS'] &&
    process.env['NOTIFY_EMAIL_TO'],
  );
}

// ─── HTML template ────────────────────────────────────────────────────────────

function buildEmailHtml(p: NotificationPayload): string {
  const statusColour = p.success ? '#22c55e' : '#ef4444';
  const statusLabel  = p.success ? '✅ SUCCESS' : '❌ FAILED';
  const titleRow     = `<h1 style="color:${statusColour};margin-bottom:4px">${statusLabel}</h1>`;

  const rows: [string, string][] = [
    ['Property Title',   p.propertyTitle || '—'],
    ['Source Platform',  p.platform],
    ['Source URL',       `<a href="${p.sourceUrl}">${p.sourceUrl}</a>`],
    ['Timestamp',        p.timestamp],
  ];

  if (p.success && p.guestyPropertyId) {
    rows.push(['Guesty Property ID', `<code>${p.guestyPropertyId}</code>`]);
  }
  if (p.guestyListingUrl) {
    rows.push(['Guesty Dashboard',   `<a href="${p.guestyListingUrl}">${p.guestyListingUrl}</a>`]);
  }
  if (p.city || p.country) {
    rows.push(['Location', [p.city, p.country].filter(Boolean).join(', ')]);
  }
  if (p.bedrooms !== undefined)    rows.push(['Bedrooms',    String(p.bedrooms)]);
  if (p.bathrooms !== undefined)   rows.push(['Bathrooms',   String(p.bathrooms)]);
  if (p.capacity  !== undefined)   rows.push(['Capacity',    `${p.capacity} guests`]);
  if (p.amenitiesCount !== undefined) rows.push(['Amenities', String(p.amenitiesCount)]);
  if (p.imagesTotal !== undefined) {
    rows.push(['Images', `${p.imagesUploaded ?? 0} / ${p.imagesTotal} uploaded`]);
  }
  if (p.errorMessage) {
    rows.push(['Error', `<span style="color:#ef4444">${escHtml(p.errorMessage)}</span>`]);
  }

  const tableRows = rows
    .map(([k, v]) => `
      <tr>
        <td style="padding:6px 12px;font-weight:600;white-space:nowrap;color:#374151">${k}</td>
        <td style="padding:6px 12px;color:#111827">${v}</td>
      </tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
             background:#f9fafb;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;
              border:1px solid #e5e7eb;padding:32px">
    ${titleRow}
    <p style="color:#6b7280;margin-top:0">Guesty property pipeline report</p>
    <table style="width:100%;border-collapse:collapse;margin:24px 0;
                  border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
      <tbody>${tableRows}</tbody>
    </table>
    ${p.summary ? `<h3 style="color:#374151">Summary</h3><p style="color:#374151;white-space:pre-wrap">${escHtml(p.summary)}</p>` : ''}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af">
      Sent by the automated Guesty integration pipeline.
    </p>
  </div>
</body>
</html>`;
}

function buildEmailText(p: NotificationPayload): string {
  const lines = [
    p.success ? '✅ SUCCESS — Guesty Property Created' : '❌ FAILED — Guesty Pipeline Error',
    '─'.repeat(50),
    `Property Title : ${p.propertyTitle}`,
    `Platform       : ${p.platform}`,
    `Source URL     : ${p.sourceUrl}`,
    `Timestamp      : ${p.timestamp}`,
  ];

  if (p.guestyPropertyId) lines.push(`Guesty ID      : ${p.guestyPropertyId}`);
  if (p.guestyListingUrl) lines.push(`Dashboard      : ${p.guestyListingUrl}`);
  if (p.city || p.country) lines.push(`Location       : ${[p.city, p.country].filter(Boolean).join(', ')}`);
  if (p.imagesTotal !== undefined)
    lines.push(`Images         : ${p.imagesUploaded ?? 0}/${p.imagesTotal} uploaded`);
  if (p.errorMessage) lines.push(`Error          : ${p.errorMessage}`);
  if (p.summary) lines.push('', 'Summary:', p.summary);

  return lines.join('\n');
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends an email notification to the Engineering Manager.
 * Silently skips (logs a warning) when SMTP credentials are not configured.
 *
 * @returns true if the email was sent, false if skipped.
 */
/**
 * Generic SMTP sender — reused by both the Guesty property notifier and the
 * Host Lead report notifier. Builds the transport from the same SMTP_* env vars
 * and silently skips (logs a warning) when email is not configured.
 */
export async function sendEmail(opts: { subject: string; text: string; html?: string }): Promise<boolean> {
  if (!isEmailConfigured()) {
    log.warn(
      'Email notification skipped — SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ' +
      'and NOTIFY_EMAIL_TO must all be set in .env',
    );
    return false;
  }

  const port = parseInt(process.env['SMTP_PORT'] ?? '587', 10);
  const transport = nodemailer.createTransport({
    host:   process.env['SMTP_HOST']!,
    port,
    secure: port === 465, // SSL for 465, STARTTLS for 587
    auth: { user: process.env['SMTP_USER']!, pass: process.env['SMTP_PASS']! },
  });

  try {
    const info = await transport.sendMail({
      from:    process.env['NOTIFY_EMAIL_FROM'] ?? process.env['SMTP_USER']!,
      to:      process.env['NOTIFY_EMAIL_TO']!,
      subject: opts.subject,
      text:    opts.text,
      html:    opts.html,
    });
    log.info('Email sent', { to: process.env['NOTIFY_EMAIL_TO'], messageId: info.messageId });
    return true;
  } catch (err) {
    log.error('Email send failed', { error: (err as Error).message });
    return false;
  }
}

/** Sends the Guesty pipeline email (property-shaped payload). */
export async function sendEmailNotification(payload: NotificationPayload): Promise<boolean> {
  const subject = payload.success
    ? `[Guesty] ✅ New listing created: ${payload.propertyTitle}`
    : `[Guesty] ❌ Pipeline failed: ${payload.propertyTitle || payload.sourceUrl}`;
  return sendEmail({ subject, text: buildEmailText(payload), html: buildEmailHtml(payload) });
}
