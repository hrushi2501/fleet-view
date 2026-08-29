/**
 * One-time migration for records written before uploads became private.
 *
 * Default mode is a dry run. `--apply` copies each public Blob to a private
 * object, updates the database reference to the authenticated `/api/files`
 * proxy, then deletes the original public object. Run only after deploying the
 * proxy route and after backing up the production database.
 *
 *   node --env-file=.env.local scripts/migrate-public-blobs.mjs
 *   node --env-file=.env.local scripts/migrate-public-blobs.mjs --apply
 */
import { PrismaClient } from "@prisma/client";
import { copy, del } from "@vercel/blob";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");

function isLegacyPublicBlob(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function proxyUrl(blobUrl) {
  return `/api/files?blob=${encodeURIComponent(blobUrl)}`;
}

function extension(url) {
  const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]{1,8})(?:$|\/)/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function safeContentType(url) {
  switch (extension(url)) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".pdf": return "application/pdf";
    // Old uploads were not type-checked. Preserve them as a private download
    // rather than serving a legacy HTML/SVG payload inline under this origin.
    default: return "application/octet-stream";
  }
}

async function migrateOne({ model, id, field, url }) {
  if (!isLegacyPublicBlob(url)) return false;
  const destination = `migrated-private/${model}/${id}${extension(url)}`;
  if (!apply) {
    console.info(`[dry-run] ${model}.${field} ${id}`);
    return true;
  }

  const replacement = await copy(url, destination, {
    access: "private", addRandomSuffix: true, contentType: safeContentType(url),
  });
  const protectedUrl = proxyUrl(replacement.url);
  await db[model].update({ where: { id }, data: { [field]: protectedUrl } });
  // The database now points at a verified private copy. Removing the old public
  // object is intentionally last, so a failed copy/update never loses evidence.
  await del(url);
  console.info(`[migrated] ${model}.${field} ${id}`);
  return true;
}

async function main() {
  const [compliance, people, transactions, receipts, dips, gauges, tickets, workOrders] = await Promise.all([
    db.complianceDoc.findMany({ where: { documentUrl: { not: null } }, select: { id: true, documentUrl: true } }),
    db.personDocument.findMany({ where: { documentUrl: { not: null } }, select: { id: true, documentUrl: true } }),
    db.fuelTransaction.findMany({ select: { id: true, odometerPhoto: true, pumpPhoto: true } }),
    db.fuelReceipt.findMany({ where: { invoicePhoto: { not: null } }, select: { id: true, invoicePhoto: true } }),
    db.tankDip.findMany({ where: { photo: { not: null } }, select: { id: true, photo: true } }),
    db.fuelLevelReading.findMany({ where: { imageUrl: { not: null } }, select: { id: true, imageUrl: true } }),
    db.weighbridgeTicket.findMany({ where: { photo: { not: null } }, select: { id: true, photo: true } }),
    db.workOrder.findMany({ where: { partPhotos: { not: null } }, select: { id: true, partPhotos: true } }),
  ]);

  let count = 0;
  for (const row of compliance) count += Number(await migrateOne({ model: "complianceDoc", id: row.id, field: "documentUrl", url: row.documentUrl }));
  for (const row of people) count += Number(await migrateOne({ model: "personDocument", id: row.id, field: "documentUrl", url: row.documentUrl }));
  for (const row of transactions) {
    if (row.odometerPhoto) count += Number(await migrateOne({ model: "fuelTransaction", id: row.id, field: "odometerPhoto", url: row.odometerPhoto }));
    if (row.pumpPhoto) count += Number(await migrateOne({ model: "fuelTransaction", id: row.id, field: "pumpPhoto", url: row.pumpPhoto }));
  }
  for (const row of receipts) count += Number(await migrateOne({ model: "fuelReceipt", id: row.id, field: "invoicePhoto", url: row.invoicePhoto }));
  for (const row of dips) count += Number(await migrateOne({ model: "tankDip", id: row.id, field: "photo", url: row.photo }));
  for (const row of gauges) count += Number(await migrateOne({ model: "fuelLevelReading", id: row.id, field: "imageUrl", url: row.imageUrl }));
  for (const row of tickets) count += Number(await migrateOne({ model: "weighbridgeTicket", id: row.id, field: "photo", url: row.photo }));

  // Work-order part photos are a JSON object of old/new arrays, so update the
  // entire field atomically after every referenced object has copied.
  for (const row of workOrders) {
    try {
      const parsed = JSON.parse(row.partPhotos);
      const urls = [...(Array.isArray(parsed.old) ? parsed.old : []), ...(Array.isArray(parsed.new) ? parsed.new : [])]
        .filter((value) => typeof value === "string" && isLegacyPublicBlob(value));
      if (!urls.length) continue;
      count += urls.length;
      if (!apply) {
        console.info(`[dry-run] workOrder.partPhotos ${row.id} (${urls.length} file(s))`);
        continue;
      }
      const replacements = new Map();
      for (const url of urls) {
        const copied = await copy(url, `migrated-private/workOrder/${row.id}${extension(url)}`, {
          access: "private", addRandomSuffix: true, contentType: safeContentType(url),
        });
        replacements.set(url, proxyUrl(copied.url));
      }
      const replace = (values) => Array.isArray(values) ? values.map((value) => replacements.get(value) ?? value) : [];
      await db.workOrder.update({ where: { id: row.id }, data: { partPhotos: JSON.stringify({ ...parsed, old: replace(parsed.old), new: replace(parsed.new) }) } });
      await del(urls);
      console.info(`[migrated] workOrder.partPhotos ${row.id}`);
    } catch (error) {
      console.error(`[skipped] invalid workOrder.partPhotos ${row.id}`, error);
    }
  }

  console.info(`${apply ? "Migrated" : "Would migrate"} ${count} public Blob reference(s).`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => db.$disconnect());
