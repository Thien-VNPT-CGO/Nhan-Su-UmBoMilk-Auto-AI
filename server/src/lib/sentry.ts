import { createHash, randomBytes } from 'crypto';
import { env } from '../config/env';

/** Gửi lỗi lên Sentry (nếu SENTRY_DSN được cấu hình) — triển khai tối giản bằng fetch, không cần SDK. */
export async function captureError(error: unknown, extra?: Record<string, unknown>): Promise<void> {
  if (!env.sentryDsn) return;
  try {
    const dsn = new URL(env.sentryDsn);
    const projectId = dsn.pathname.replace(/^\//, '');
    const key = dsn.username;
    const host = dsn.hostname;
    const endpoint = `https://${host}/api/${projectId}/envelope/`;

    const eventId = createHash('md5').update(randomBytes(8)).digest('hex');
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? message) : message;
    const timestamp = new Date().toISOString();

    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: timestamp }),
      JSON.stringify({ type: 'event', content_type: 'application/json' }),
      JSON.stringify({
        event_id: eventId,
        timestamp,
        platform: 'node',
        level: 'error',
        message: { formatted: message },
        exception: {
          values: [{ type: error instanceof Error ? error.constructor.name : 'Error', value: message, stacktrace: { frames: [] } }],
        },
        extra: { ...(extra ?? {}), requestUrl: extra?.requestUrl, stack },
        release: '1.1.0',
        environment: env.nodeEnv,
        server_name: host,
      }),
    ].join('\n');

    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}`,
      },
      body: envelope,
    });
  } catch {
    // Sentry không được phép phá luồng chính
  }
}