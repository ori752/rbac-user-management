/**
 * Import controller — bridges the web app to the standalone crawl-to-Guesty
 * pipeline (scripts/crawl-to-guesty.ts).
 *
 * The pipeline lives under scripts/ with its own tsconfig (separate from the
 * server's src/ build), so rather than import it directly we run it as a child
 * process — exactly as `npm run crawl` does — and parse the single
 * `__PIPELINE_RESULT__` JSON line it prints with --json.
 *
 * POST /import  body: { url: string, preview?: boolean }
 *   preview=true → adds --dry-run (crawl + extract + map, NO Guesty call).
 */

import { Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import { propertyStore } from '../data/propertyStore';
import { notificationStore } from '../data/notificationStore';
import { store } from '../data/store';

// scripts/crawl-to-guesty.ts uses these exit codes; surfaced for the UI.
const RESULT_MARKER = '__PIPELINE_RESULT__';
const PIPELINE_TIMEOUT_MS = 150_000; // Playwright launch + crawl + upload headroom

const SUPPORTED_HOST = /(^|\.)airbnb\.[a-z.]+$|(^|\.)booking\.com$/i;

interface PipelineResult {
  success: boolean;
  failedAt?: string;
  error?: string;
  [k: string]: unknown;
}

function validateUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'A property URL is required.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'URL must start with http(s)://.' };
  }
  if (!SUPPORTED_HOST.test(parsed.hostname)) {
    return { ok: false, error: 'Only Airbnb and Booking.com URLs are supported.' };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * Runs the pipeline child process and resolves with the parsed result.
 * Rejects only on spawn/timeout failures; pipeline-level failures resolve
 * with { success: false, ... } so the caller can return a clean error.
 */
function runPipeline(url: string, preview: boolean): Promise<PipelineResult> {
  return new Promise((resolve, reject) => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const tsNodeBin   = path.join(projectRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');

    // Args mirror `npm run crawl`: ts-node --project tsconfig.scripts.json <script> …
    const args = [
      tsNodeBin,
      '--transpile-only',                 // skip type-checking on each run (faster, prod-safe)
      '--project', 'tsconfig.scripts.json',
      'scripts/crawl-to-guesty.ts',
      '--url', url,
      '--render', // headless browser — required to get past Airbnb/Booking bot-detection
      '--json',
      '--log-level', 'warn',
    ];
    if (preview) args.push('--dry-run');

    // Args are passed as an array (no shell) → the URL cannot inject commands.
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Pipeline timed out.'));
    }, PIPELINE_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => { clearTimeout(timer); reject(err); });

    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((l) => l.includes(RESULT_MARKER));
      if (!line) {
        reject(new Error(
          'Pipeline produced no result. ' +
          (stderr.trim().slice(-400) || stdout.trim().slice(-400) || 'no output'),
        ));
        return;
      }
      try {
        resolve(JSON.parse(line.slice(line.indexOf(RESULT_MARKER) + RESULT_MARKER.length)) as PipelineResult);
      } catch {
        reject(new Error('Could not parse pipeline result.'));
      }
    });
  });
}

export async function importProperty(req: Request, res: Response): Promise<void> {
  const check = validateUrl(req.body?.url);
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return;
  }
  const preview = req.body?.preview === true;

  try {
    const result = await runPipeline(check.url, preview);
    if (result.success) {
      // Record real (non-preview) imports so they appear in the Properties view.
      if (!preview && result.guestyPropertyId) {
        const importer = req.currentUser ? store.findById(req.currentUser.userId) : undefined;
        propertyStore.add({
          guestyId:   String(result.guestyPropertyId),
          guestyUrl:  result.guestyListingUrl as string | undefined,
          title:      String(result.propertyTitle ?? 'Untitled property'),
          platform:   String(result.platform ?? ''),
          sourceUrl:  String(result.sourceUrl ?? check.url),
          thumbnail:  result.thumbnail as string | undefined,
          images:     Number(result.imagesUploaded ?? result.imagesTotal ?? 0),
          amenities:  Number(result.amenitiesCount ?? 0),
          houseRules: Number(result.houseRulesCount ?? 0),
          bedrooms:   result.bedrooms  as number | undefined,
          bathrooms:  result.bathrooms as number | undefined,
          capacity:   result.capacity  as number | undefined,
          city:       result.city      as string | undefined,
          country:    result.country   as string | undefined,
          importedBy: importer?.name ?? importer?.email ?? 'unknown',
          createdAt:  new Date().toISOString(),
        });
        // Self-contained "notify the manager" — in-app notification feed.
        notificationStore.add({
          message:    `New ${String(result.platform ?? 'property')} listing imported: ` +
                      `"${String(result.propertyTitle ?? 'Untitled')}" ` +
                      `(${Number(result.imagesUploaded ?? result.imagesTotal ?? 0)} photos)`,
          propertyId: String(result.guestyPropertyId),
          guestyUrl:  result.guestyListingUrl as string | undefined,
        });
      }
      res.status(200).json(result);
    } else {
      // Pipeline ran but a stage failed (crawl/auth/create) — 422 with detail.
      res.status(422).json(result);
    }
  } catch (err) {
    res.status(502).json({
      success: false,
      error: (err as Error).message || 'Pipeline execution failed.',
    });
  }
}
