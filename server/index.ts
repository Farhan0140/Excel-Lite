import { loadConfig } from './config';
import { connectPglite, connectPostgres, migrate } from './db';
import { createApp } from './app';

try {
  process.loadEnvFile(); // reads .env if it exists
} catch {
  /* no .env file: use the real environment */
}

const cfg = loadConfig();
const db = cfg.databaseUrl ? connectPostgres(cfg.databaseUrl) : await connectPglite(cfg.pgliteDir);
await migrate(db);

const app = createApp(db, cfg);
const server = app.listen(cfg.port, () => {
  console.log(`[server] http://localhost:${cfg.port}  (${cfg.prod ? 'production' : 'development'})`);
  console.log(
    db.kind === 'postgres'
      ? '[server] database: Postgres (Neon)'
      : `[server] database: DEVELOPMENT database at ${cfg.pgliteDir ?? 'memory'} (set DATABASE_URL to use Neon)`,
  );
});

const stop = async () => {
  server.close();
  await db.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
