"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { DEFAULT_ROLES } from "@/lib/rbac";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { nonNegativeNumber, sanitizeString, sanitizeOptionalString } from "@/lib/input-validation";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const sOrNull = (fd: FormData, k: string) => sanitizeOptionalString(fd.get(k), k);

function refresh() {
  revalidatePath("/admin/roles");
  revalidatePath("/admin/audit");
  revalidatePath("/users");
}


/** Installs the shipped role set and links existing users by their legacy role string. */
async function seedRoles__impl() {
  await requireAction("admin.roles");
  for (const r of DEFAULT_ROLES) {
    await db.role.upsert({
      where: { name: r.name },
      create: {
        name: r.name, label: r.label, description: r.description,
        permissions: r.permissions.join("\n"), approvalLimit: r.approvalLimit, isSystem: r.isSystem,
      },
      update: { label: r.label, description: r.description },
    });
  }
  // Link users whose legacy role string matches a role name.
  const roles = await db.role.findMany();
  const byName = new Map(roles.map((r) => [r.name, r.id]));
  const users = await db.user.findMany({ where: { roleId: null } });
  let linked = 0;
  for (const u of users) {
    const id = byName.get(u.role);
    if (id) {
      await db.user.update({ where: { id: u.id }, data: { roleId: id } });
      linked++;
    }
  }
  await audit({ action: "CONFIG", module: "ADMIN", summary: `Installed ${DEFAULT_ROLES.length} roles, linked ${linked} users` });
  refresh();
  return { ok: true as const, roles: DEFAULT_ROLES.length, linked };
}

async function saveRole__impl(id: string | null, fd: FormData) {
  await requireAction("admin.roles");
  const label = s(fd, "label");
  if (!label) throw new ActionError("Role label is required");
  const permissions = fd.getAll("permissions").map((p) => sanitizeString(p, "Permission")).filter(Boolean);
  const data = {
    label,
    description: sOrNull(fd, "description"),
    permissions: permissions.join("\n"),
    approvalLimit: nonNegativeNumber(fd.get("approvalLimit"), "Approval limit", { max: 100_000_000_000, fallback: 0 }),
  };
  if (id) {
    const before = await db.role.findUnique({ where: { id } });
    await db.role.update({ where: { id }, data });
    await audit({
      action: "UPDATE", module: "ADMIN", entity: "Role", entityId: id,
      summary: `Updated role ${data.label}`,
      changes: { before: { permissions: before?.permissions.split("\n").length, limit: before?.approvalLimit }, after: { permissions: permissions.length, limit: data.approvalLimit } },
    });
  } else {
    const name = s(fd, "name");
    if (!name) throw new ActionError("Role name is required");
    const created = await db.role.create({ data: { name, ...data } });
    await audit({ action: "CREATE", module: "ADMIN", entity: "Role", entityId: created.id, summary: `Created role ${data.label}` });
  }
  refresh();
}

async function deleteRole__impl(id: string) {
  await requireAction("admin.roles");
  const r = await db.role.findUnique({ where: { id } });
  if (!r) return;
  if (r.isSystem) throw new ActionError("System roles cannot be deleted");
  await db.user.updateMany({ where: { roleId: id }, data: { roleId: null } });
  await db.role.delete({ where: { id } });
  await audit({ action: "DELETE", module: "ADMIN", entity: "Role", entityId: id, summary: `Deleted role ${r.label}` });
  refresh();
}

async function assignRole__impl(userId: string, roleId: string) {
  await requireAction("admin.roles");
  const [u, r] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    roleId ? db.role.findUnique({ where: { id: roleId } }) : null,
  ]);
  await db.user.update({ where: { id: userId }, data: { roleId: roleId || null, role: r?.name ?? u?.role ?? "Driver" } });
  await audit({
    action: "UPDATE", module: "ADMIN", entity: "User", entityId: userId,
    summary: `${u?.name ?? "User"} assigned role ${r?.label ?? "none"}`,
  });
  refresh();
}

/**
 * Link a login account to a person record. Without this the driver app cannot
 * tell which machine, papers or safety score belong to whoever signed in.
 */
async function linkUserToDriver__impl(userId: string, driverId: string) {
  await requireAction("admin.users");
  if (driverId) {
    // The relation is one-to-one, so free the person from any other login first.
    const held = await db.user.findFirst({ where: { driverId, NOT: { id: userId } } });
    if (held) await db.user.update({ where: { id: held.id }, data: { driverId: null } });
  }
  const [u, d] = await Promise.all([
    db.user.update({ where: { id: userId }, data: { driverId: driverId || null } }),
    driverId ? db.driver.findUnique({ where: { id: driverId } }) : null,
  ]);
  await audit({
    action: "UPDATE", module: "ADMIN", entity: "User", entityId: userId,
    summary: `${u.name} linked to person record ${d?.name ?? "(none)"}`,
  });
  revalidatePath("/admin/roles");
  revalidatePath("/users");
}

async function runDatabaseAuditAction__impl() {
  const auth = await requireAction("admin.settings");
  const { runPeriodicDatabaseAudit } = await import("@/lib/db-audit");
  const result = await runPeriodicDatabaseAudit("MANUAL", {
    id: auth.session.id,
    name: auth.session.name,
    role: auth.session.role,
  });
  revalidatePath("/admin/diagnostics");
  revalidatePath("/admin/audit");
  return { ok: true as const, result };
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const seedRoles = safe(seedRoles__impl);
export const saveRole = safe(saveRole__impl);
export const deleteRole = safe(deleteRole__impl);
export const assignRole = safe(assignRole__impl);
export const linkUserToDriver = safe(linkUserToDriver__impl);
export const runDatabaseAuditAction = safe(runDatabaseAuditAction__impl);

