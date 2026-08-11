import QRCode from "qrcode";
import { headers } from "next/headers";
import Link from "next/link";
import { InstallGuide } from "@/components/InstallGuide";
import { Truck, Fuel, ArrowRight, QrCode } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InstallPage() {
  const h = await headers();
  const host = h.get("host") || "fleetview-erp.vercel.app";
  const proto = h.get("x-forwarded-proto") || "https";
  const appUrl = `${proto}://${host}`;
  const qr = await QRCode.toDataURL(`${appUrl}/install`, { width: 320, margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });

  return (
    <div className="min-h-screen bg-ink-900 px-5 py-8 text-white">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500"><Truck className="h-6 w-6" /></div>
          <div><p className="text-lg font-bold">FleetView</p><p className="text-[10px] uppercase tracking-widest text-slate-400">Mahadev Constructions</p></div>
        </div>

        {/* Platform-aware install guide (auto-detects iPhone vs Android) */}
        <div className="mt-6 text-ink-900">
          <InstallGuide />
        </div>

        {/* One app note */}
        <div className="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <p className="flex items-center gap-2 font-semibold"><Fuel className="h-4 w-4 text-amber-400" /> One app for everyone</p>
          <p className="mt-1 text-sm text-slate-300"><b>Admin</b> sees the full dashboard. <b>Drivers</b> see only the simple fuel &amp; repair screen. Same app — your login decides.</p>
        </div>

        {/* QR to share with the team */}
        <div className="mt-4 rounded-2xl bg-white p-5 text-center text-ink-900">
          <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-500"><QrCode className="h-4 w-4" /> Share with your team · टीम को भेजें</p>
          <div className="mt-3 flex justify-center"><img src={qr} alt="QR code" className="h-44 w-44 rounded-2xl ring-1 ring-slate-200" /></div>
          <p className="mt-2 text-xs text-slate-400">Others scan this to open the install page</p>
          <p className="mt-2 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-500">{appUrl}</p>
        </div>

        <Link href="/login" className="mt-5 flex items-center justify-center gap-1.5 rounded-xl bg-brand-500 py-3.5 text-base font-bold text-white shadow-lg hover:bg-brand-600">
          Go to Login <ArrowRight className="h-5 w-5" />
        </Link>
      </div>
    </div>
  );
}
