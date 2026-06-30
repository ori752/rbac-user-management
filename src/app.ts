import express from 'express';
import path from 'path';

import authRoutes         from './routes/auth';
import userRoutes         from './routes/users';
import importRoutes       from './routes/import';
import propertyRoutes     from './routes/properties';
import notificationRoutes from './routes/notifications';
import { securityHeaders, cors } from './middleware/security';
import { errorHandler } from './middleware/errorHandler';

// ─── Application factory ──────────────────────────────────────────────────────
//
// Deliberately does NOT call app.listen() so that the same Express instance
// can be imported by the test suite (supertest starts its own ephemeral server).

const app = express();

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(cors);
app.use(securityHeaders);

// Limit request body to 50 KB to mitigate DoS via large payloads
app.use(express.json({ limit: '50kb' }));

// Serve the single-page application from the public/ directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth',          authRoutes);
app.use('/users',         userRoutes);
app.use('/import',        importRoutes);
app.use('/properties',    propertyRoutes);
app.use('/notifications', notificationRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

export default app;
