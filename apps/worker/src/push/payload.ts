import type { UrgentContent } from '../mail/templates.js';

/** What the service worker reads in its `push` handler (apps/web/public/sw.js). */
export type PushPayload = { title: string; body: string; path: string; tag: string };

const MAX_BODY = 200;
const MAX_TITLE = 120;

function cut(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/** Built from the urgent content without amounts; the tag makes a retried push replace the first. */
export function renderPushPayload(content: UrgentContent, notificationId: string): PushPayload {
  return {
    title: cut(content.subject, MAX_TITLE),
    body: cut(content.lines.join(' '), MAX_BODY),
    path: content.actionPath,
    tag: `notification:${notificationId}`,
  };
}

/** Topic header: up to 32 URL-safe characters; the push service keeps only the latest per topic. */
export function pushTopic(notificationId: string): string {
  return notificationId.replaceAll('-', '').slice(0, 32);
}
