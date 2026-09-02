import { db } from "@/lib/db";
import { Card } from "@/components/ui";
import { IssueQrButton } from "@/components/TrackingForms";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { assetScope, requirePage } from "@/lib/access";

/**
 * Printable cabin stickers. Rendered server-side as data URIs so the sheet
 * prints identically from any machine with no client-side rendering step.
 *
 * This was its own route (`/tracking/qr`) and is now a tab on Vehicle
 * Tracking. Keeping it a tab rather than a stacked section matters here: the
 * sheet is meant to be printed, and a print that also carried the live map
 * would waste the first page of every run.
 */
export async function QrStickers() {
  const access = await requirePage("fleet.view");
  const assets = await db.asset.findMany({
    where: { qrToken: { not: null }, ...assetScope(access) },
    orderBy: { code: "asc" },
  });
  const unissuedCount = await db.asset.count({ where: { qrToken: null, ...assetScope(access) } });

  const codes = await Promise.all(
    assets.map(async (a) => ({
      code: a.code,
      reg: a.registrationNo,
      token: a.qrToken!,
      png: await QRCode.toDataURL(a.qrToken!, { width: 340, margin: 1, errorCorrectionLevel: "H" }),
    }))
  );

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink-900">Cabin QR Stickers</h2>
            <p className="text-sm text-slate-500">Make the codes once, print this sheet, laminate it, and stick one code inside each cab. Drivers scan this sticker to start duty.</p>
          </div>
          <div className="flex gap-2">
            {unissuedCount > 0 && access.can("fleet.edit") && <IssueQrButton />}
            <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">
              <Printer className="h-4 w-4" /> Use your browser&apos;s Print
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-slate-700 print:hidden sm:grid-cols-3">
        <p><strong className="block text-brand-800">1. Issue & print</strong>{unissuedCount ? `${unissuedCount} vehicle${unissuedCount === 1 ? "" : "s"} still need a permanent QR code.` : "All visible vehicles have a QR code."}</p>
        <p><strong className="block text-brand-800">2. Fit the sticker</strong>Place it inside the cabin, reachable by the driver and away from glare.</p>
        <p><strong className="block text-brand-800">3. Driver check-in</strong>Driver logs in, scans the sticker, reads any safety warning, then starts duty.</p>
      </div>

      {codes.length === 0 ? (
        <Card className="print:hidden">
          <p className="py-12 text-center text-sm text-slate-500">
            No QR stickers issued yet. A fleet editor can press <strong>Issue QR Codes</strong> above, then print this sheet.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
          {codes.map((c) => (
            <div key={c.token} className="break-inside-avoid rounded-xl border-2 border-slate-900 bg-white p-3 text-center">
              <p className="text-lg font-black tracking-tight text-slate-900">{c.code}</p>
              {c.reg && <p className="-mt-0.5 text-xs font-medium text-slate-600">{c.reg}</p>}
              <img src={c.png} alt={c.code} className="mx-auto my-2 w-full max-w-[150px]" />
              <p className="font-mono text-[10px] leading-tight text-slate-500">{c.token}</p>
              <p className="mt-1 text-[9px] leading-tight text-slate-500">ट्रिप शुरू करने के लिए स्कैन करें<br />Scan to start your trip</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
