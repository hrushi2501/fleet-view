import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const assetClass = searchParams.get("class") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const assets = await db.asset.findMany({
    where: { assetClass, status },
    include: { project: { select: { code: true } }, driver: { select: { name: true } } },
    orderBy: { code: "asc" },
  });
  return NextResponse.json({ count: assets.length, data: assets });
}
