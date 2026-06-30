import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { notificationStore } from '../data/notificationStore';

const router = Router();

router.use(authenticate);

// GET /notifications — manager notification feed (newest first).
router.get('/', (_req, res) => {
  res.json(notificationStore.list());
});

// POST /notifications/read — mark all as read.
router.post('/read', (_req, res) => {
  notificationStore.markAllRead();
  res.status(204).end();
});

export default router;
