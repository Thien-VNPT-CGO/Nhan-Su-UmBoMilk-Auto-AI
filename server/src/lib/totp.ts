import { createHmac, randomBytes } from 'crypto';

// ===== TOTP (RFC 6238) tự triển khai — không cần thêm dependency =====
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Tạo secret TOTP mới (160-bit, chuẩn Google Authenticator). */
export function generateTOTPSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Tính mã TOTP tại thời điểm counter (mặc định 30s, 6 chữ số). */
export function generateTOTP(secret: string, timeStepSeconds = 30, digits = 6): string {
  const counter = Math.floor(Date.now() / 1000 / timeStepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Kiểm tra mã 6 số, cho phép lệch ±1 cửa sổ 30s (chống đồng hồ lệch nhẹ). */
export function verifyTOTP(secret: string, token: string, window = 1): boolean {
  const clean = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  for (let w = -window; w <= window; w++) {
    const counter = Math.floor(Date.now() / 1000 / 30) + w;
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    if (String(code % 1_000_000).padStart(6, '0') === clean) return true;
  }
  return false;
}

/** URL otpauth:// cho Google Authenticator / Authy quét QR. */
export function otpauthUrl(secret: string, account: string): string {
  return `otpauth://totp/UMBO%20MILK:${encodeURIComponent(account)}?secret=${secret}&issuer=UMBO%20MILK&algorithm=SHA1&digits=6&period=30`;
}