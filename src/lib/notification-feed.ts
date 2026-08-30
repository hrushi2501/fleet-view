import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assetScope, type Access } from "@/lib/access";
import type { NotificationFeed, NotificationItem } from "@/lib/notification-types";

/**
 * Alert rows are the durable notification log. This predicate is the delivery
 * policy: it is applied before data leaves the database, not filtered in the
 * browser after every employee has already received the whole fleet's events.
 */
export function notificationScope(access: Access): Prisma.AlertWhereInput {
  if (access.group === "ADMIN") return {};

  const visibleAssets = assetScope(access) as Prisma.AssetWhereInput;
  if (access.group === "DRIVER") {
    // A driver may see alerts about their own person or their assigned machine,
    // never another driver's incident, fuel fill, or document status.
    return {
      OR: [
        { driverId: access.driverId ?? "__none__" },
        { asset: visibleAssets },
      ],
    };
  }

  // Contractors and supervisors receive all operational events for assets in
  // their permitted projects. Alerts without an asset (for example, a site tank
  // or a driver licence) require the related module permission explicitly.
  const globalCategories: string[] = [];
  if (access.can("fuel.view")) globalCategories.push("Fuel");
  if (access.can("maintenance.view")) globalCategories.push("Maintenance");
  if (access.can("compliance.view")) globalCategories.push("Compliance");
  if (access.can("people.view")) globalCategories.push("Driver");
  if (access.can("loss.view")) globalCategories.push("Loss");
  if (access.can("fleet.view")) globalCategories.push("Operations", "Geofence", "Idle");

  return {
    OR: [
      { asset: visibleAssets },
      ...(globalCategories.length > 0
        ? [{ assetId: null, category: { in: globalCategories } }]
        : []),
    ],
  };
}

function actionFor(access: Access, item: { category: string; actionUrl: string | null }): string | null {
  // Driver pages are intentionally separate from office modules. Rewriting
  // their links here prevents a valid personal alert from leading to a denied
  // administrative route.
  if (access.group === "DRIVER") {
    if (item.category === "Fuel") return "/my/fuel";
    if (item.category === "Compliance") return "/my/documents";
    if (item.category === "Maintenance" || item.category === "Driver") return "/my/service";
    return "/my";
  }
  return item.actionUrl;
}

export async function getNotificationFeed(access: Access, take = 8): Promise<NotificationFeed> {
  const scope = notificationScope(access);
  const limit = Math.max(1, Math.min(take, 25));
  const attentionWhere: Prisma.AlertWhereInput = {
    AND: [scope, { status: "Open", severity: { in: ["Warning", "Critical"] } }],
  };

  const [alerts, attentionCount] = await db.$transaction([
    db.alert.findMany({
      where: scope,
      include: {
        asset: { select: { code: true } },
        driver: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: limit,
    }),
    db.alert.count({ where: attentionWhere }),
  ]);

  const items: NotificationItem[] = alerts.map((alert) => ({
    id: alert.id,
    category: alert.category,
    severity: alert.severity,
    status: alert.status,
    title: alert.title,
    message: alert.message,
    createdAt: alert.createdAt.toISOString(),
    assetCode: alert.asset?.code ?? null,
    driverName: alert.driver?.name ?? null,
    actionUrl: actionFor(access, alert),
  }));

  return { items, attentionCount };
}
