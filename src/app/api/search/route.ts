import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAccess, assetScope, projectScope } from "@/lib/access";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";

export interface SearchResultItem {
  id: string;
  category: "vehicle" | "driver" | "project" | "site" | "workorder" | "tank" | "ticket";
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
  href: string;
}

export async function GET(req: NextRequest) {
  try {
    const access = await getAccess();
    if (!access) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = await reserveRateLimit({
      scope: "search",
      subject: access.session.id,
      limit: 60,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return rateLimitResponse(limit.retryInSeconds, "Too many search requests. Please wait a moment.");
    }

    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("q") || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }
    if (query.length > 100) {
      return NextResponse.json({ error: "Search query exceeds maximum length of 100 characters." }, { status: 400 });
    }


    const q = query.toLowerCase();
    const visibleAssets = assetScope(access);
    const visibleProjects = projectScope(access);

    const [assets, drivers, projects, sites, workOrders, tanks, tickets] = await Promise.all([
      db.asset.findMany({
        where: {
          ...visibleAssets,
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { registrationNo: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { make: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 6,
        include: { project: true },
      }),
      db.driver.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { empCode: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { licenseNo: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
      db.project.findMany({
        where: {
          ...visibleProjects,
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { location: { contains: q, mode: "insensitive" } },
            { client: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 4,
      }),
      db.site.findMany({
        where: {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { type: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 4,
        include: { project: true },
      }),
      db.workOrder.findMany({
        where: {
          asset: visibleAssets,
          OR: [
            { woNo: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { type: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 4,
        include: { asset: true },
      }),
      db.fuelTank.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { location: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 3,
      }),
      db.weighbridgeTicket.findMany({
        where: {
          OR: [
            { ticketNo: { contains: q, mode: "insensitive" } },
            { material: { contains: q, mode: "insensitive" } },
            { vendor: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 4,
        include: { asset: true },
      }),
    ]);

    const results: SearchResultItem[] = [];

    // Map Assets
    for (const a of assets) {
      results.push({
        id: a.id,
        category: "vehicle",
        title: a.code,
        subtitle: `${a.name}${a.registrationNo ? ` · ${a.registrationNo}` : ""}${a.project ? ` · ${a.project.code}` : ""}`,
        badge: a.status,
        badgeColor: a.status === "Active" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-700 ring-slate-500/20",
        href: `/fleet/${a.id}`,
      });
    }

    // Map Drivers
    for (const d of drivers) {
      results.push({
        id: d.id,
        category: "driver",
        title: d.name,
        subtitle: `${d.empCode} · ${d.phone || "No phone"} · ${d.type}`,
        badge: d.status,
        badgeColor: d.status === "Active" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-700 ring-slate-500/20",
        href: `/people?tab=staff`,
      });
    }

    // Map Projects
    for (const p of projects) {
      results.push({
        id: p.id,
        category: "project",
        title: `${p.code} — ${p.name}`,
        subtitle: `${p.location} · Client: ${p.client}`,
        badge: p.status,
        badgeColor: p.status === "Active" ? "bg-brand-100 text-brand-700 ring-brand-600/20" : "bg-slate-100 text-slate-700 ring-slate-500/20",
        href: `/sites`,
      });
    }

    // Map Sites
    for (const s of sites) {
      results.push({
        id: s.id,
        category: "site",
        title: `${s.code} · ${s.name}`,
        subtitle: `Project: ${s.project?.code ?? "—"} · Type: ${s.type}`,
        badge: s.active ? "Active" : "Inactive",
        badgeColor: s.active ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-700 ring-slate-500/20",
        href: `/sites`,
      });
    }

    // Map Work Orders
    for (const w of workOrders) {
      results.push({
        id: w.id,
        category: "workorder",
        title: w.woNo,
        subtitle: `${w.asset?.code ?? "Asset"} · ${w.description} · Priority: ${w.priority}`,
        badge: w.status,
        badgeColor: w.status === "Open" || w.status === "In-Progress" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
        href: `/maintenance`,
      });
    }

    // Map Fuel Tanks
    for (const t of tanks) {
      results.push({
        id: t.id,
        category: "tank",
        title: t.name,
        subtitle: `${t.location} · Level: ${t.currentLevel.toLocaleString("en-IN")} / ${t.capacity.toLocaleString("en-IN")} L`,
        badge: t.status,
        badgeColor: "bg-amber-100 text-amber-800 ring-amber-600/20",
        href: `/fuel/tanks`,
      });
    }

    // Map Weighbridge Tickets
    for (const tk of tickets) {
      results.push({
        id: tk.id,
        category: "ticket",
        title: tk.ticketNo,
        subtitle: `${tk.material} · ${tk.asset?.code ?? "Vehicle"} · ${tk.kind} (${(tk.netKg / 1000).toFixed(2)} t)`,
        badge: tk.kind,
        badgeColor: "bg-violet-100 text-violet-700 ring-violet-600/20",
        href: `/sites/materials`,
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
