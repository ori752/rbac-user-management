/**
 * Leads routes — Host Lead Intelligence (B2B prospecting).
 *
 * Authorization is purely permission-based (no role strings):
 *   GET  /leads      → leads:read   (admin + manager)
 *   POST /leads/run  → leads:run    (admin only — stricter than read)
 *
 * A manager therefore reads the report (200) but cannot trigger a run (403);
 * users and guests are forbidden from both. requirePermission resolves the
 * caller's live role from the store, so the decision can't be forged via a token.
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { getLeads, runLeads } from '../controllers/leadsController';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('leads:read'), getLeads);
router.post('/run', requirePermission('leads:run'), runLeads);

export default router;
