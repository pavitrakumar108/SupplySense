import { createHash } from 'node:crypto';
import { AppError } from '../utils/app-error.js';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function requestHash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function getIdempotencyKey(request) {
  const key = request.get('Idempotency-Key')?.trim();
  if (!key || key.length > 160) {
    throw new AppError('A valid Idempotency-Key header is required.', { statusCode: 422, code: 'INVALID_IDEMPOTENCY_KEY' });
  }
  return key;
}

function replay(existing) {
  return { statusCode: existing.responseStatus, data: existing.responseBody, replayed: true };
}

export async function executeIdempotent({ db, userId, key, operation, payload, handler, ttlSeconds = 86400 }) {
  const hash = requestHash(payload);
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.idempotencyKey.findUnique({
        where: { userId_key_operation: { userId, key, operation } },
      });
      if (existing && existing.expiresAt > new Date()) {
        if (existing.requestHash !== hash) {
          throw new AppError('This Idempotency-Key was already used with different input.', { statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
        }
        if (existing.responseBody !== null && existing.responseStatus !== null) return replay(existing);
        throw new AppError('An identical operation is already in progress.', { statusCode: 409, code: 'IDEMPOTENCY_IN_PROGRESS' });
      }
      if (existing) await tx.idempotencyKey.delete({ where: { id: existing.id } });

      const record = await tx.idempotencyKey.create({
        data: {
          userId,
          key,
          operation,
          requestHash: hash,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        },
      });
      const result = await handler(tx);
      await tx.idempotencyKey.update({
        where: { id: record.id },
        data: { responseStatus: result.statusCode, responseBody: result.data },
      });
      return { ...result, replayed: false };
    });
  } catch (error) {
    const target = Array.isArray(error?.meta?.target) ? error.meta.target.join(',') : String(error?.meta?.target ?? '');
    const isIdempotencyConflict = target.includes('user_id') && target.includes('key') && target.includes('operation')
      || String(error?.message ?? '').includes('IdempotencyKey_user_id_key_operation');
    if (error?.code !== 'P2002' || !isIdempotencyConflict) throw error;
    const existing = await db.idempotencyKey.findUnique({
      where: { userId_key_operation: { userId, key, operation } },
    });
    if (existing?.requestHash === hash && existing.responseBody !== null && existing.responseStatus !== null) return replay(existing);
    throw new AppError('An identical operation is already in progress.', { statusCode: 409, code: 'IDEMPOTENCY_IN_PROGRESS' });
  }
}
