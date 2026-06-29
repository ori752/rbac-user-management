/**
 * Notification dispatcher.
 *
 * Fires all configured notifiers in parallel and logs a summary.
 * Individual notifier failures are caught and logged — a broken SMTP
 * server should never cause the pipeline to report an error.
 *
 * Channels fired:
 *   1. Console (always)    — structured JSON log line
 *   2. Email               — when SMTP_* and NOTIFY_EMAIL_TO are set
 *   3. Slack               — when SLACK_WEBHOOK_URL is set
 */

import type { NotificationPayload }        from './types';
import { sendEmailNotification }           from './email';
import { sendSlackNotification }           from './slack';
import { createLogger }                    from '../utils/logger';

export type { NotificationPayload } from './types';

const log = createLogger('notifier');

// ─── Console summary ──────────────────────────────────────────────────────────

function logToConsole(p: NotificationPayload): void {
  const separator = '─'.repeat(60);

  if (p.success) {
    log.info(separator);
    log.info('🎉  PIPELINE SUCCEEDED');
    log.info(`    Property : ${p.propertyTitle}`);
    log.info(`    Guesty ID: ${p.guestyPropertyId ?? '—'}`);
    if (p.guestyListingUrl) log.info(`    Dashboard: ${p.guestyListingUrl}`);
    if (p.imagesTotal !== undefined) {
      log.info(`    Images   : ${p.imagesUploaded ?? 0} / ${p.imagesTotal} uploaded`);
    }
    log.info(`    Time     : ${p.timestamp}`);
    log.info(separator);
  } else {
    log.error(separator);
    log.error('💥  PIPELINE FAILED');
    log.error(`    Stage    : ${p.failedAt ?? 'unknown'}`);
    log.error(`    Error    : ${p.errorMessage ?? 'no details'}`);
    log.error(`    Source   : ${p.sourceUrl}`);
    log.error(`    Time     : ${p.timestamp}`);
    log.error(separator);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Dispatches the notification payload to all configured channels.
 * Never throws — all channel errors are caught internally.
 */
export async function notify(payload: NotificationPayload): Promise<void> {
  // Console is synchronous and always runs
  logToConsole(payload);

  // Fire email and Slack in parallel; ignore individual failures
  const [emailSent, slackSent] = await Promise.allSettled([
    sendEmailNotification(payload),
    sendSlackNotification(payload),
  ]);

  const emailOk = emailSent.status === 'fulfilled' && emailSent.value;
  const slackOk = slackSent.status === 'fulfilled' && slackSent.value;

  log.info('Notification dispatch complete', { email: emailOk, slack: slackOk });
}
