"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requireAction } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

function refresh() {
  revalidatePath("/weighbridge");
  revalidatePath("/production");
  revalidatePath("/loss-prevention");
}

export async function saveTicket(fd: FormData) {
  await requireAction("weighbridge.edit");
  const ticketNo = s(fd, "ticketNo");
  if (!ticketNo) throw new Error("Ticket number is required");

  const gross = n(fd, "grossKg");
  const tare = n(fd, "tareKg");
  // Trust the explicit net if given; otherwise derive it.
  const net = n(fd, "netKg") || Math.max(0, gross - tare);
  const rate = n(fd, "rate");
  const session = await getSession();

  let photo: string | null = null;
  const file = fd.get("photo");
  if (file && typeof file !== "string") {
    const f = file as File;
    if (f.size) {
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const blob = await put(`weighbridge/${ticketNo}-${Date.now()}.${ext}`, f, { access: "public", addRandomSuffix: true });
      photo = blob.url;
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

export async function deleteTicket(id: string) {
  await requireAction("weighbridge.edit");
  const t = await db.weighbridgeTicket.findUnique({ where: { id } });
  await db.weighbridgeTicket.delete({ where: { id } });
  if (t) await audit({ action: "DELETE", module: "WEIGHBRIDGE", entity: "WeighbridgeTicket", entityId: id, summary: `Deleted ticket ${t.ticketNo}` });
  refresh();
}
