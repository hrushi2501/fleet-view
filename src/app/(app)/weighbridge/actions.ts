"use server";

import { db } from "@/lib/db";
import { formNumber, nonNegativeNumber, oneOf, safeParseDate, sanitizeString, sanitizeOptionalString } from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { uploadPrivateFile } from "@/lib/private-upload";
import { validateWeighbridgeWeights } from "@/lib/weighbridge";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const sOrNull = (fd: FormData, k: string) => sanitizeOptionalString(fd.get(k), k);
const n = formNumber;

const VALID_TICKET_KINDS = ["DISPATCH", "RECEIPT", "INTERNAL"] as const;

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
  if (ticketNo.length > 50) throw new ActionError("Ticket number cannot exceed 50 characters.");

  // Prevent duplicate ticket entry crashes
  const existing = await db.weighbridgeTicket.findFirst({ where: { ticketNo } });
  if (existing) throw new ActionError(`Weighbridge ticket ${ticketNo} already exists.`);

  const kind = oneOf(s(fd, "kind") || "DISPATCH", VALID_TICKET_KINDS, "ticket kind");
  const date = safeParseDate(fd.get("date"), "Ticket date") || new Date();

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

  const rate = nonNegativeNumber(fd.get("rate"), "Rate per tonne", { max: 100_000, fallback: 0 });
  const billedKg = nonNegativeNumber(fd.get("billedKg"), "Billed weight", { max: 500_000, fallback: 0 });
  const explicitAmount = nonNegativeNumber(fd.get("amount"), "Amount", { max: 100_000_000, fallback: 0 });

  const assetId = sOrNull(fd, "assetId");
  if (assetId) {
    const asset = await db.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new ActionError("Selected asset does not exist");
  }

  const driverId = sOrNull(fd, "driverId");
  if (driverId) {
    const driver = await db.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new ActionError("Selected driver does not exist");
  }

  const projectId = sOrNull(fd, "projectId");
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ActionError("Selected project does not exist");
  }

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
      kind,
      date,
      assetId,
      driverId,
      projectId,
      material: s(fd, "material") || "Other",
      grossKg: gross,
      tareKg: tare,
      netKg: net,
      fromLocation: sOrNull(fd, "fromLocation"),
      toLocation: sOrNull(fd, "toLocation"),
      vendor: sOrNull(fd, "vendor"),
      pairedTicketNo: sOrNull(fd, "pairedTicketNo"),
      billedKg,
      rate,
      amount: explicitAmount || (net / 1000) * rate,
      photo,
      recordedBy: session?.name ?? null,
      notes: sOrNull(fd, "notes"),
    },
  });

  await audit({
    action: "CREATE", module: "WEIGHBRIDGE", entity: "WeighbridgeTicket",
    summary: `${kind} ticket ${ticketNo} — ${(net / 1000).toFixed(2)} t ${s(fd, "material")}`,
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
