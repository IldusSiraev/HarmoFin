import { randomBytes } from 'node:crypto';

export function createUuidV7(now = new Date()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now.getTime());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes.set([((bytes.at(6) ?? 0) & 0x0f) | 0x70], 6);
  bytes.set([((bytes.at(8) ?? 0) & 0x3f) | 0x80], 8);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
