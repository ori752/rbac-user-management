import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getUserAuditLog,
  listAuditLog,
} from '../controllers/userController';

const router = Router();

// All user routes require a valid JWT
router.use(authenticate);

// ── User CRUD ────────────────────────────────────────────────────────────────
router.get(   '/',     requirePermission('users:read_all'),  listUsers);
router.get(   '/:id',  requirePermission('users:read_own'),  getUser);
router.post(  '/',     requirePermission('users:create'),    createUser);
router.put(   '/:id',  requirePermission('users:update_own'), updateUser);
router.delete('/:id',  requirePermission('users:delete'),    deleteUser);

// ── Audit log (admin only) ───────────────────────────────────────────────────
router.get('/:id/audit', requirePermission('users:read_all'), getUserAuditLog);
router.get('/audit/log', requirePermission('users:delete'),   listAuditLog);

export default router;
