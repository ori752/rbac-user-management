import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { importProperty } from '../controllers/importController';

const router = Router();

// Must be authenticated …
router.use(authenticate);

// … and an admin (importing creates listings in the connected Guesty account).
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.currentUser?.role !== 'admin') {
    res.status(403).json({
      error:    'Only admins can import properties to Guesty.',
      yourRole: req.currentUser?.role,
    });
    return;
  }
  next();
}

// POST /import  body: { url, preview? }
router.post('/', requireAdmin, importProperty);

export default router;
