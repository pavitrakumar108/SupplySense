import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(currentDirectory, '../../../.env');

dotenv.config({ path: process.env.DOTENV_PATH ?? rootEnvPath });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z
    .string()
    .default('postgresql://supplysense:supplysense@localhost:5433/supplysense?schema=public'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default('dev-only-access-secret-change-this-value-123456'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32)
    .default('dev-only-refresh-secret-change-this-value-123456'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  MOCK_PAYMENT_WEBHOOK_SECRET: z
    .string()
    .min(32)
    .default('dev-only-payment-webhook-secret-change-this-value-123456'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;
