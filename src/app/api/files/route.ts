import { withApiErrors } from "@/lib/api-error";
import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { canSeeAsset, getAccess, requireApi, type Access } from "@/lib/access";
import { db } from "@/lib/db";
import { privateFileUrl } from "@/lib/private-upload";
import { recordScope } from "@/lib/record-access";

export const dynamic = "force-dynamic";

const INLINE_CONTENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "audio/webm", "audio/ogg", "audio/mp4",
]);

function isPrivateBlobUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function canSeeProject(access: Access, projectId: string | null) {
  if (access.group === "ADMIN") return true;
  if (access.group === "DRIVER") return false;
  return access.projectIds === null || (projectId != null && access.projectIds.includes(projectId));
}

async function canReadAssetFile(access: Access, assetId: string | null) {
  return assetId != null && canSeeAsset(access, assetId);
}

/**
 * Streams a private Blob only after proving that its exact proxy URL belongs to
 * a record the requester may see. The caller never supplies a filesystem path,
 * token, or arbitrary fetch target; an unknown or unauthorized reference is a
 * uniform 404 to avoid record enumeration.
 */
async function handleGET(req: Request) {
  const blobUrl = new URL(req.url).searchParams.get("blob");
  if (!blobUrl || !isPrivateBlobUrl(blobUrl)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const storedUrl = privateFileUrl(blobUrl);

  // Resolve the resource before its permission so a caller needs both a real
  // database reference and the appropriate module/row scope to receive it.
  const [compliance, personDocument, transaction, receipt, dip, gauge, workOrder, ticket] = await Promise.all([
    db.complianceDoc.findFirst({ where: { documentUrl: storedUrl }, select: { assetId: true } }),
    db.personDocument.findFirst({ where: { documentUrl: storedUrl }, select: { driverId: true } }),
    db.fuelTransaction.findFirst({
      where: { OR: [{ odometerPhoto: storedUrl }, { pumpPhoto: storedUrl }, { afterOdometerPhoto: storedUrl }] },
      select: { assetId: true, projectId: true },
    }),
    db.fuelReceipt.findFirst({ where: { invoicePhoto: storedUrl }, select: { tank: { select: { projectId: true } } } }),
    db.tankDip.findFirst({ where: { photo: storedUrl }, select: { tank: { select: { projectId: true } } } }),
    db.fuelLevelReading.findFirst({ where: { imageUrl: storedUrl }, select: { assetId: true } }),
    db.workOrder.findFirst({ where: { partPhotos: { contains: storedUrl } }, select: { assetId: true } }),
    db.weighbridgeTicket.findFirst({ where: { photo: storedUrl }, select: { assetId: true, projectId: true } }),
  ]);

  let permitted = false;
  if (compliance) {
    const access = await getAccess();
    // The driver document screen shows the papers for the driver's assigned
    // vehicle. It is safe to open those files only when the same asset scope
    // confirms that the vehicle is still theirs; office users retain the
    // normal compliance permission and project scope check.
    if (access?.group === "DRIVER") {
      permitted = await canReadAssetFile(access, compliance.assetId);
    } else {
      const auth = await requireApi("compliance.view");
      permitted = auth.ok && await canReadAssetFile(auth.access, compliance.assetId);
    }
  } else if (personDocument) {
    const access = await getAccess();
    // Drivers have no broad people permission. Their one permitted exception
    // is the document attached to their own linked driver record.
    if (access?.group === "DRIVER") {
      permitted = access.driverId === personDocument.driverId;
    } else {
      const auth = await requireApi("people.view");
      permitted = !!auth.ok && !!await db.driver.findFirst({
        where: { id: personDocument.driverId, ...recordScope("driver", auth.access) },
        select: { id: true },
      });
    }
  } else if (transaction) {
    const auth = await requireApi("fuel.view");
    permitted = auth.ok && (
      await canReadAssetFile(auth.access, transaction.assetId) ||
      (transaction.assetId == null && canSeeProject(auth.access, transaction.projectId))
    );
  } else if (receipt || dip) {
    const auth = await requireApi("fuel.view");
    const projectId = receipt?.tank.projectId ?? dip?.tank.projectId ?? null;
    permitted = auth.ok && canSeeProject(auth.access, projectId);
  } else if (gauge) {
    const auth = await requireApi("fuel.view");
    permitted = auth.ok && await canReadAssetFile(auth.access, gauge.assetId);
  } else if (workOrder) {
    const auth = await requireApi("maintenance.view");
    permitted = auth.ok && await canReadAssetFile(auth.access, workOrder.assetId);
  } else if (ticket) {
    const auth = await requireApi("weighbridge.view");
    permitted = auth.ok && (
      await canReadAssetFile(auth.access, ticket.assetId) ||
      (ticket.assetId == null && canSeeProject(auth.access, ticket.projectId))
    );
  }

  if (!permitted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await get(blobUrl, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new Response(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType,
        // New uploads have one of the allowlisted types. Legacy files that are
        // migrated with an unknown extension are deliberately forced to a
        // download, never rendered as executable HTML under this origin.
        "Content-Disposition": INLINE_CONTENT_TYPES.has(result.blob.contentType)
          ? result.blob.contentDisposition
          : "attachment",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[files] private blob read failed", error);
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}

export const GET = withApiErrors(handleGET);
