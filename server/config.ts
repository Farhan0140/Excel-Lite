import path from 'node:path';
import type { HashParams } from './security';

export interface Config {
  prod: boolean;
  port: number;
  databaseUrl?: string; // Neon (or any Postgres). Missing in development = in-process Postgres (PGlite)
  pgliteDir?: string; // where the development database lives (undefined = memory only)
  jwtSecret: string;
  recoveryPepper: string;
  sessionDays: number;
  cookieSecure: boolean;
  trustProxy: number | false;
  staticDir: string;
  rateLimit: boolean;
  hash: HashParams | undefined; // undefined = production strength
}

const DEV_JWT = 'dev-only-jwt-secret-change-me-0123456789abcdef';
const DEV_PEPPER = 'dev-only-recovery-pepper-change-me-0123456789';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const prod = env.NODE_ENV === 'production';
  const problems: string[] = [];
  const need = (name: string, min: number, devDefault: string) => {
    const v = env[name];
    if (v && v.length >= min) return v;
    if (prod) problems.push(`${name} must be set (at least ${min} characters)`);
    else if (!v) console.warn(`[config] ${name} not set: using an INSECURE development value`);
    return v && v.length >= min ? v : devDefault;
  };
  const jwtSecret = need('JWT_SECRET', 32, DEV_JWT);
  const recoveryPepper = need('RECOVERY_PEPPER', 32, DEV_PEPPER);
  if (prod && !env.DATABASE_URL) problems.push('DATABASE_URL must be set (your Neon connection string)');
  if (problems.length) throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));

  const dev = env.PGLITE_DIR;
  return {
    prod,
    port: Number(env.PORT) || 3001,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: dev === 'memory' ? undefined : dev || path.resolve('.data/dev-db'),
    jwtSecret,
    recoveryPepper,
    sessionDays: Number(env.SESSION_DAYS) || 7,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== 'false' : prod,
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || false : false,
    staticDir: path.resolve(env.STATIC_DIR || 'dist'),
    rateLimit: env.RATE_LIMIT !== 'off',
    hash: undefined,
  };
}
