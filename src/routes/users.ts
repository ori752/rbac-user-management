import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} from '../controllers/userController';

const router = Router();

router.use(authenticate);

router.get('/',    requirePermission('users:read_all'),  listUsers);
router.get('/:id', requirePermission('users:read_own'),  getUser);
router.post('/',   requirePermission('users:create'),    createUser);
router.put('/:id', requirePermission('users:update_own'), updateUser);
router.delete('/:id', requirePermission('users:delete'), deleteUser);

export default router;
