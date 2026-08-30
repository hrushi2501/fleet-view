import webpush from "web-push";
import { db } from "./db";

export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function configure() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@mahadev.com", pub, priv);
  configured = true;
  return true;
}

export async function sendPushToAll(payload: { title: string; body: string; url?: string }) {
  if (!configure()) {
    return { total: 0, sent: 0, removed: 0, skipped: "Web push unconfigured" };
  }
  const subs = await db.pushSubscription.findMany();
  let sent = 0, removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) { await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {}); removed++; }
      }
    })
  );
  return { total: subs.length, sent, removed };
}

/** Send a priority push only to the already-authorised recipients. In-app
 * notifications remain the source of truth; this function must never broaden
 * their audience by broadcasting a project or incident event to every phone. */
export async function sendPushToUsers(userIds: string[], payload: { title: string; body: string; url?: string }) {
  if (!configure()) {
    return { total: 0, sent: 0, removed: 0, skipped: "Web push unconfigured" };
  }
  if (userIds.length === 0) return { total: 0, sent: 0, removed: 0 };

  const uniqueUserIds = [...new Set(userIds)];
  const subs = await db.pushSubscription.findMany({ where: { userId: { in: uniqueUserIds } } });
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
        );
        sent++;
      } catch (error) {
        const code = (error as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await db.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
          removed++;
        }
      }
    }),
  );
  return { total: subs.length, sent, removed };
}
