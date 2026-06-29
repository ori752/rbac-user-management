import app from './app';

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`RBAC server running on http://localhost:${PORT}`);
  console.log(
    'Seed accounts: admin@example.com(admin123) | manager@example.com(manager123) | ' +
    'user@example.com(user1234) | guest@example.com(guest123)',
  );
  if (!process.env.JWT_SECRET) {
    console.warn(
      '[WARNING] JWT_SECRET is not set — using insecure development default. ' +
      'Set JWT_SECRET in production.',
    );
  }
});
