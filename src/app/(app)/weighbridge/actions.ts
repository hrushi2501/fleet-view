"use server";

import { db } from "@/lib/db";
import { formNumber } from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { uploadPrivateFile } from "@/lib/private-upload";
import { validateWeighbridgeWeights } from "@/lib/weighbridge";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = formNumber;

function refresh() {
  revalidatePath("/weighbridge");
  revalidatePath("/production");
  revalidatePath("/loss-prevention");
}

async function saveTicket__impl(fd: FormData) {
  const scopeAccess = await requireAction("weighbridge.edit");
  await assertFormAccess(scopeAccess, fd);
  const ticketNo = s(fd, "ticketNo");
  if (!ticketNo) throw new ActionError("Ticket number is required");

  // Prevent duplicate ticket entry crashes
  const existing = await db.weighbridgeTicket.findFirst({ where: { ticketNo } });
  if (existing) throw new ActionError(`Weighbridge ticket ${ticketNo} already exists.`);

  const gross = n(fd, "grossKg");
  const tare = n(fd, "tareKg");
  const explicitNet = n(fd, "netKg");

  // Validate physical boundaries: gross >= tare, non-negative, max 150 tonnes
  const weightVal = validateWeighbridgeWeights({
    grossKg: gross,
    tareKg: tare,
    netKg: s(fd, "netKg") ? explicitNet : undefined,
  });
  if (!weightVal.valid) throw new ActionError(weightVal.error!);
  const net = weightVal.computedNetKg;

  const rate = n(fd, "rate");
  if (rate < 0) throw new ActionError("Rate per tonne cannot be negative.");
  const billedKg = n(fd, "billedKg");
  if (billedKg < 0) throw new ActionError("Billed weight cannot be negative.");

  const session = await getSession();

  let photo: string | null = null;
  const file = fd.get("photo");
  if (file && typeof file !== "string") {
    const f = file as File;
    if (f.size) {
      photo = await uploadPrivateFile(f, { folder: "weighbridge", kind: "image" });
    }
  }

  await db.weighbridgeTicket.create({
    data: {
      ticketNo,
      kind: s(fd, "kind") || "DISPATCH",
      date: s(fd, "date") ? new Date(s(fd, "date")) : new Date(),
      assetId: s(fd, "assetId") || null,
      driverId: s(fd, "driverId") || null,
      projectId: s(fd, "projectId") || null,
      material: s(fd, "material") || "Other",
      grossKg: gross,
      tareKg: tare,
      netKg: net,
      fromLocation: s(fd, "fromLocation") || null,
      toLocation: s(fd, "toLocation") || null,
      vendor: s(fd, "vendor") || null,
      pairedTicketNo: s(fd, "pairedTicketNo") || null,
      billedKg: n(fd, "billedKg"),
      rate,
      amount: n(fd, "amount") || (net / 1000) * rate,
      photo,
      recordedBy: session?.name ?? null,
      notes: s(fd, "notes") || null,
    },
  });

  await audit({
    action: "CREATE", module: "WEIGHBRIDGE", entity: "WeighbridgeTicket",
    summary: `${s(fd, "kind")} ticket ${ticketNo} — ${(net / 1000).toFixed(2)} t ${s(fd, "material")}`,
  });
  refresh();
}

async function deleteTicket__impl(id: string) {
  const scopeAccess = await requireAction("weighbridge.edit");
  await assertRecordAccess(scopeAccess, "weighbridgeTicket", id);
  const t = await db.weighbridgeTicket.findUnique({ where: { id } });
  await db.weighbridgeTicket.delete({ where: { id } });
  if (t) await audit({ action: "DELETE", module: "WEIGHBRIDGE", entity: "WeighbridgeTicket", entityId: id, summary: `Deleted ticket ${t.ticketNo}` });
  refresh();
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const saveTicket = safe(saveTicket__impl);
export const deleteTicket = safe(deleteTicket__impl);
