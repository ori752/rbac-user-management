/**
 * Slack notifier — posts a Block Kit message to an Incoming Webhook.
 *
 * Required environment variable:
 *   SLACK_WEBHOOK_URL   Full webhook URL from api.slack.com/apps
 *
 * If the variable is not set, this notifier silently skips.
 *
 * Block Kit layout:
 *   - Header (success/failure banner)
 *   - Section with key fields
 *   - Actions section with a button linking to Guesty dashboard
 *   - Context block with timestamp and pipeline label
 */

import axios from 'axios';
import type { NotificationPayload } from './types';
import { createLogger } from '../utils/logger';

const log = createLogger('notifier.slack');

// ─── Slack Block Kit types (minimal) ─────────────────────────────────────────

interface SlackText  { type: 'plain_text' | 'mrkdwn'; text: string; emoji?: boolean }
interface SlackField { type: 'mrkdwn' | 'plain_text'; text: string }

interface SlackHeaderBlock  { type: 'header';  text: SlackText }
interface SlackSectionBlock { type: 'section'; text?: SlackText; fields?: SlackField[] }
interface SlackDividerBlock { type: 'divider' }
interface SlackContextBlock { type: 'context'; elements: SlackText[] }
interface SlackActionsBlock {
  type: 'actions';
  elements: Array<{
    type: 'button';
    text: SlackText;
    url?: string;
    style?: 'primary' | 'danger';
  }>;
}

type SlackBlock =
  | SlackHeaderBlock
  | SlackSectionBlock
  | SlackDividerBlock
  | SlackContextBlock
  | SlackActionsBlock;

interface SlackPayload {
  text:    string; // fallback for notifications
  blocks?: SlackBlock[];
}

// ─── Block Kit builder ────────────────────────────────────────────────────────

function buildSlackPayload(p: NotificationPayload): SlackPayload {
  const icon    = p.success ? ':white_check_mark:' : ':x:';
  const heading = p.success
    ? `${icon} New Guesty listing created`
    : `${icon} Guesty pipeline failed`;

  const fields: SlackField[] = [
    { type: 'mrkdwn', text: `*Property*\n${p.propertyTitle || '—'}` },
    { type: 'mrkdwn', text: `*Platform*\n${p.platform}` },
  ];

  if (p.guestyPropertyId) {
    fields.push({ type: 'mrkdwn', text: `*Guesty ID*\n\`${p.guestyPropertyId}\`` });
  }
  if (p.city || p.country) {
    fields.push({
      type: 'mrkdwn',
      text: `*Location*\n${[p.city, p.country].filter(Boolean).join(', ')}`,
    });
  }
  if (p.bedrooms !== undefined) {
    fields.push({ type: 'mrkdwn', text: `*Bedrooms*\n${p.bedrooms}` });
  }
  if (p.capacity !== undefined) {
    fields.push({ type: 'mrkdwn', text: `*Capacity*\n${p.capacity} guests` });
  }
  if (p.imagesTotal !== undefined) {
    fields.push({
      type: 'mrkdwn',
      text: `*Images*\n${p.imagesUploaded ?? 0} / ${p.imagesTotal} uploaded`,
    });
  }
  if (!p.success && p.errorMessage) {
    fields.push({
      type: 'mrkdwn',
      text: `*Error*\n${p.errorMessage.slice(0, 300)}`,
    });
  }

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: heading, emoji: true } },
    { type: 'section', fields },
    { type: 'divider' },
  ];

  // Action buttons
  const actionButtons: SlackActionsBlock['elements'] = [
    {
      type:  'button',
      text:  { type: 'plain_text', text: 'View Source', emoji: true },
      url:   p.sourceUrl,
      style: 'primary',
    },
  ];
  if (p.guestyListingUrl) {
    actionButtons.push({
      type:  'button',
      text:  { type: 'plain_text', text: 'Open in Guesty', emoji: true },
      url:   p.guestyListingUrl,
    });
  }
  blocks.push({ type: 'actions', elements: actionButtons });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Automated Guesty pipeline • ${p.timestamp}`,
      },
    ],
  });

  return {
    text:   `${heading} — ${p.propertyTitle || p.sourceUrl}`,
    blocks,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Posts a notification to the configured Slack Incoming Webhook.
 * Silently skips when SLACK_WEBHOOK_URL is not set.
 *
 * @returns true if the message was posted, false if skipped or failed.
 */
/**
 * Generic Slack webhook sender — reused by both the Guesty property notifier and
 * the Host Lead report notifier. Silently skips when SLACK_WEBHOOK_URL is unset.
 */
export async function sendSlack(payload: SlackPayload): Promise<boolean> {
  const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
  if (!webhookUrl) {
    log.warn('Slack notification skipped — SLACK_WEBHOOK_URL not set in .env');
    return false;
  }
  try {
    await axios.post(webhookUrl, payload, {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
    log.info('Slack message posted');
    return true;
  } catch (err) {
    log.error('Slack post failed', { error: (err as Error).message });
    return false;
  }
}

/** Posts the Guesty pipeline Slack message (property-shaped payload). */
export async function sendSlackNotification(payload: NotificationPayload): Promise<boolean> {
  return sendSlack(buildSlackPayload(payload));
}
