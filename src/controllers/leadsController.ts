/**
 * Leads controller — Host Lead Intelligence (B2B prospecting) web surface.
 *
 * GET  /leads      → returns the latest generated report (read from the JSON file
 *                    the CLI writes), or a 200 empty-state when none exists yet.
 * POST /leads/run  → triggers the prospecting pipeline as a child process (exactly
 *                    like `npm run leads`; fixture source + heuristic analyzer by
 *                    default → zero scraping, zero token cost), then returns the
 *                    fresh report.
 *
 * Authorization lives entirely in routes/leads.ts via requirePermission
 * ('leads:read' for GET, 'leads:run' for POST) — nothing here gates on a role
 * string. A single in-process lock prevents concurrent runs; it is ALWAYS
 * released in a finally block so a failed/crashed run can never wedge the
 * endpoint at HTTP 409.
 */
import { Request, Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REPORT_PATH  = path.join(PROJECT_ROOT, 'scripts', 'prospecting', 'output', 'leads-latest.json');
const RUN_TIMEOUT_MS = 120_000; // fixture+heuristic is fast; headroom for ts-node startup

// ─── Concurrency lock (always released in finally) ─────────────────────────────

let leadsRunning = false;

/** Exposed for tests: is a prospecting run currently holding the lock? */
export function leadsRunInProgress(): boolean {
  return leadsRunning;
}

/**
 * Runs `fn` while holding the single-run lock, releasing it in a finally block.
 * A throwing `fn` propagates its error AND leaves the lock released, so the next
 * POST /leads/run is never blocked by a previous failed/crashed run.
 */
export async function runWithLeadsLock<T>(fn: () => Promise<T>): Promise<T> {
  leadsRunning = true;
  try {
    return await fn();
  } finally {
    leadsRunning = false;
  }
}

// ─── CLI runner ────────────────────────────────────────────────────────────────

/** Spawns the prospecting CLI, then reads back the report JSON it writes. */
function spawnLeadsRun(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tsNodeBin = path.join(PROJECT_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
    const args = [
      tsNodeBin,
      '--transpile-only',
      '--project', 'tsconfig.scripts.json',
      'scripts/prospecting/run.ts',
    ];

    const child = spawn(process.execPath, args, { cwd: PROJECT_ROOT, env: process.env });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Leads run timed out.'));
    }, RUN_TIMEOUT_MS);

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Leads run exited with code ${code}. ${stderr.trim().slice(-400)}`));
        return;
      }
      try {
        resolve(JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')));
      } catch {
        reject(new Error('Leads run completed but produced no readable report.'));
      }
    });
  });
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

export function getLeads(_req: Request, res: Response): void {
  if (!fs.existsSync(REPORT_PATH)) {
    res.status(200).json({
      empty:   true,
      message: 'No leads report has been generated yet. Run the prospecting pipeline to create one.',
    });
    return;
  }
  try {
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    res.status(200).json(report);
  } catch {
    res.status(500).json({ error: 'Failed to read the leads report.' });
  }
}

export async function runLeads(_req: Request, res: Response): Promise<void> {
  if (leadsRunInProgress()) {
    res.status(409).json({ error: 'A leads run is already in progress. Try again shortly.' });
    return;
  }
  try {
    const report = await runWithLeadsLock(spawnLeadsRun);
    res.status(200).json(report);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message || 'Leads run failed.' });
  }
}
