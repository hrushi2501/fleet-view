import "server-only";

import { db } from "@/lib/db";

/** Active administrators are the only global recipients for a browser-push
 * summary. Other roles receive scoped in-app notifications from the bell. */
export async function administratorNotificationUserIds(): Promise<string[]> {
  const users = await db.user.findMany({
    where: {
      active: true,
      OR: [
        { role: "Admin" },
        { roleRef: { is: { permissions: { contains: "*" } } } },
      ],
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}
