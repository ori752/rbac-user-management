import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { propertyStore } from '../data/propertyStore';

const router = Router();

// Any authenticated user can view imported properties.
router.use(authenticate);

// GET /properties — list properties imported through the app (newest first).
router.get('/', (_req, res) => {
  res.json(propertyStore.list());
});

export default router;
