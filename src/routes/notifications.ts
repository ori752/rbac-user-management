import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { listNotifications, markNotificationsRead } from '../controllers/notificationController';

const router = Router();

router.use(authenticate);

// GET /notifications — role-scoped feed { items, unread }
router.get('/', listNotifications);
// POST /notifications/read — mark all current items seen for this user
router.post('/read', markNotificationsRead);

export default router;
