// Local/Render dev entry point - the actual Express app + routes live in
// app.js so the same app can also be wrapped as a Vercel serverless function
// (see ../api/index.js) without duplicating any route logic.
import app from './app.js';

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n✅ Masjid Management API running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  GET    /api/auth/status`);
  console.log(`  POST   /api/auth/setup`);
  console.log(`  POST   /api/auth/login`);
  console.log(`  POST   /api/auth/change-password`);
  console.log(`  GET    /api/transactions`);
  console.log(`  GET    /api/transactions/type/:type`);
  console.log(`  GET    /api/summary`);
  console.log(`  GET    /api/transactions/category/stats`);
  console.log(`  POST   /api/transactions`);
  console.log(`  POST   /api/transactions/seed`);
  console.log(`  PUT    /api/transactions/:id`);
  console.log(`  DELETE /api/transactions/:id`);
  console.log(`  GET    /api/members`);
  console.log(`  POST   /api/members`);
  console.log(`  PUT    /api/members/:id`);
  console.log(`  GET    /api/members/today`);
  console.log(`  GET    /api/members/schedule`);
  console.log(`  GET    /api/members/yearly-schedule`);
  console.log(`  POST   /api/members/swap`);
  console.log(`  DELETE /api/members/swap/:date`);
  console.log(`  POST   /api/members/set-current`);
  console.log(`  GET    /api/push/vapid-public-key`);
  console.log(`  POST   /api/push/subscribe`);
  console.log(`  POST   /api/push/unsubscribe`);
  console.log(`  POST   /api/push/run-daily-check`);
  console.log(`  POST   /api/push/run-monthly-dues-check`);
  console.log(`  GET    /api/admin/pending-dues`);
  console.log(`  POST   /api/push/remind/:memberId`);
  console.log(`  POST   /api/push/remind-all-pending`);
  console.log(`  POST   /api/push/announce`);
  console.log(`  GET    /api/contacts`);
  console.log(`  PUT    /api/contacts/:id`);
  console.log(`  POST   /api/activity/log`);
  console.log(`  GET    /api/activity`);
  console.log(`  DELETE /api/activity/clear`);
  console.log(`  POST   /api/activity/delete`);
});
