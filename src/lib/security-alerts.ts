/**
 * Optional delivery of security-relevant audit events to an external monitor.
 *
 * The database remains the system of record. This is deliberately best-effort:
 * a slow or unavailable webhook must never turn a refused request, fuel entry,
 * or login into an application outage. Configure a receiver that alerts on a
 * missing heartbeat as well as on the events below; webhook delivery is not a
 * durable queue.
 */

export const SECURITY_ALERT_ACTIONS = new Set(["DENIED", "LOGIN_FAILED"]);

export type SecurityAlertEvent = {
  action: string;
  module: string;
  summary: string;
  entity?: string | null;
  entityId?: string | null;
  actor?: { id: string; name: string; role: string } | null;
};

export function shouldSendSecurityAlert(action: string): boolean {
  return SECURITY_ALERT_ACTIONS.has(action);
}

export function secureWebhookUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function sendSecurityAlert(event: SecurityAlertEvent): Promise<void> {
  if (!shouldSendSecurityAlert(event.action)) return;

  const url = secureWebhookUrl(process.env.SECURITY_AUDIT_WEBHOOK_URL);
  if (!url) {
    if (process.env.SECURITY_AUDIT_WEBHOOK_URL?.trim()) {
      console.error("[security-alert] SECURITY_AUDIT_WEBHOOK_URL must be a valid HTTPS URL");
    }
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "fleetview-erp",
        kind: "security-audit-event",
        at: new Date().toISOString(),
        event,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("[security-alert] receiver rejected event", response.status, event.action, event.module);
    }
  } catch (error) {
    console.error("[security-alert] delivery failed", event.action, event.module, error);
  } finally {
    clearTimeout(timeout);
  }
}
