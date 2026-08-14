import React from "react";
import { db } from "@/lib/db";
import { todayBusinessDay, startOfBusinessDay } from "@/lib/business-time";
import { AttendanceBatchMatrix, AttendanceDriverItem } from "@/components/AttendanceBatchMatrix";

export async function BatchSignOff() {
  const today = todayBusinessDay();
  const startOfDay = startOfBusinessDay(new Date());

  const [drivers, projects, todayAttendances] = await Promise.all([
    db.driver.findMany({
      where: { status: "Active" },
      include: { assets: { select: { code: true } } },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { status: "Active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.attendance.findMany({
      where: { date: { gte: startOfDay } },
      select: { driverId: true, status: true },
    }),
  ]);

  const markedMap = new Map(todayAttendances.map((a) => [a.driverId, a.status]));

  const driverItems: AttendanceDriverItem[] = drivers.map((d) => ({
    id: d.id,
    name: d.name,
    empCode: d.empCode,
    phone: d.phone,
    type: d.type,
    assignedAsset: d.assets?.[0]?.code ?? null,
    currentStatus: markedMap.get(d.id) ?? "PRESENT",
  }));

  return (
    <AttendanceBatchMatrix
      drivers={driverItems}
      today={today}
      projects={projects}
    />
  );
}

export default BatchSignOff;
