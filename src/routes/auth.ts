import { Router } from 'express';
import { login, me } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// Rate limit login to 10 attempts per 15 minutes per IP to mitigate brute-force
const loginRateLimit = rateLimit(
  15 * 60 * 1000,  // 15 minutes
  10,
  'Too many login attempts — please wait before trying again.',
);

router.post('/login', loginRateLimit, login);
router.get('/me',     authenticate,   me);

export default router;
