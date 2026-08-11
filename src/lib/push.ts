import webpush from "web-push";
import { db } from "./db";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("VAPID keys missing");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@mahadev.com", pub, priv);
  configured = true;
}

export async function sendPushToAll(payload: { title: string; body: string; url?: string }) {
  configure();
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
