import React from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { VehicleProductionDetails } from "@/components/VehicleProductionDetails";
import { requirePage, canSeeAsset } from "@/lib/access";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Machine Output Details | FleetView ERP",
  description: "Output, cycle times, mileage and trends for one machine.",
};

export default async function VehicleProductionDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await requirePage("production.view");
  const { id } = await params;

  if (!(await canSeeAsset(access, id))) {
    notFound();
  }

  const asset = await db.asset.findUnique({
    where: { id },
    include: {
      project: { select: { code: true, name: true } },
      driver: { select: { name: true } },
    },
  });

  if (!asset) {
    notFound();
  }

  const since90d = new Date();
  since90d.setDate(since90d.getDate() - 90);

  const [logs, fuelTxns, norm] = await Promise.all([
    db.productionLog.findMany({
      where: { assetId: id, date: { gte: since90d } },
      orderBy: { date: "desc" },
      take: 300,
    }),
    db.fuelTransaction.findMany({
      where: { assetId: id, type: "ISSUE", date: { gte: since90d } },
      select: { id: true, date: true, quantity: true, amount: true, rate: true },
      orderBy: { date: "desc" },
      take: 100,
    }),
    db.productionNorm.findFirst({
      where: { assetClass: asset.assetClass },
    }),
  ]);

  const serializedAsset = {
    id: asset.id,
    code: asset.code,
    name: asset.name,
    registrationNo: asset.registrationNo,
    assetClass: asset.assetClass,
    category: asset.category,
    fuelCapacity: asset.fuelCapacity,
    meterValue: asset.meterValue,
    hourMeterValue: asset.hourMeterValue,
    status: asset.status,
    project: asset.project,
    driver: asset.driver,
  };

  const serializedLogs = logs.map((l) => ({
    id: l.id,
    date: l.date.toISOString().slice(0, 10),
    shift: l.shift,
    trips: l.trips,
    tonnage: l.tonnage,
    volumeM3: l.volumeM3,
    cycles: l.cycles,
    workedHours: l.workedHours,
    idleHours: l.idleHours,
    distanceKm: l.distanceKm,
    leadKm: l.leadKm,
    material: l.material,
    source: l.source,
    note: l.note,
  }));

  const serializedFuel = fuelTxns.map((f) => ({
    id: f.id,
    date: f.date.toISOString().slice(0, 10),
    quantity: f.quantity,
    amount: f.amount,
    rate: f.rate,
  }));

  const serializedNorm = norm
    ? { targetLow: norm.targetLow, targetHigh: norm.targetHigh, unit: norm.unit }
    : null;

  return (
    <VehicleProductionDetails
      asset={serializedAsset}
      logs={serializedLogs}
      fuelTxns={serializedFuel}
      norm={serializedNorm}
    />
  );
}
