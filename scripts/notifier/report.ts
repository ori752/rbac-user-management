/**
 * Generic report notification — a channel-agnostic path that reuses the email
 * and Slack TRANSPORTS without bending the property-shaped NotificationPayload.
 *
 * Console always fires; email/Slack fire only when configured. Used by the Host
 * Lead Intelligence module to send the top-leads report to the manager.
 */
import { sendEmail } from './email';
import { sendSlack } from './slack';
import { createLogger } from '../utils/logger';

const log = createLogger('notifier.report');

export interface ReportNotification {
  subject: string;
  /** Plain-text body — MUST already include the inference disclaimer. */
  text: string;
  html?: string;
}

export async function notifyReport(n: ReportNotification): Promise<void> {
  // Console always
  const sep = '─'.repeat(60);
  log.info(sep);
  log.info(`📋  ${n.subject}`);
  for (const line of n.text.split('\n')) log.info(`    ${line}`);
  log.info(sep);

  const [email, slack] = await Promise.allSettled([
    sendEmail({ subject: n.subject, text: n.text, html: n.html }),
    sendSlack({ text: `*${n.subject}*\n\n${n.text}` }),
  ]);

  log.info('Report notification dispatch complete', {
    email: email.status === 'fulfilled' && email.value,
    slack: slack.status === 'fulfilled' && slack.value,
  });
}
