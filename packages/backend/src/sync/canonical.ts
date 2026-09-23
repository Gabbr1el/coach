import { createHash } from 'node:crypto';

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function order(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(order);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareUtf8(left, right)).map(([key, item]) => [key, order(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(order(value));
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}
