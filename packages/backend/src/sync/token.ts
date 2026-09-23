import { createHmac, timingSafeEqual } from 'node:crypto';

export class SyncTokenCodec {
  constructor(private readonly secret: string) {}

  encode(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  decode<T extends object>(token: string): T {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) throw new Error('invalid_cursor');
    const expected = createHmac('sha256', this.secret).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('invalid_cursor');
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  }
}
