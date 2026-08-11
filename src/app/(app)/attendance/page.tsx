import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { AttendanceClientTabs } from "@/components/AttendanceClientTabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Driver Attendance | FleetView ERP",
  description: "Management dashboard for daily attendance registers, shift logs & supervisor approvals.",
};

export default async function DriverAttendancePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Role Gate: Drivers cannot access administrator/supervisor attendance management
  if (session.role === "DRIVER") {
    redirect("/driver/checkin");
  }

  // Fetch live Prisma trip sessions with fallback to mock data
  const dbSessions = await db.tripSession.findMany({
    take: 300,
    orderBy: { startedAt: "desc" },
    include: {
      driver: true,
      asset: true,
    },
  });

  const formattedSessions = dbSessions.map((s) => ({
    id: s.id,
    driverId: s.driverId,
    driverName: s.driver?.name ?? "Assigned Driver",
    driverEmpCode: s.driver?.empCode ?? "DRV-1000",
    vehicleCode: s.asset?.code ?? "TRK-01",
    projectName: s.projectId ?? "Jaipur Ring Road Expressway Site",
    siteName: "Main Site Front",
    shift: "DAY" as const,
    date: s.startedAt.toISOString().slice(0, 10),
    checkIn: s.startedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    checkOut: s.endedAt ? s.endedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null,
    workingHours: s.endedAt ? Math.round(((s.endedAt.getTime() - s.startedAt.getTime()) / (1000 * 60 * 60)) * 10) / 10 : 4.5,
    overtimeHours: 0,
    status: s.status === "ACTIVE" ? ("RUNNING" as const) : ("PRESENT" as const),
    supervisor: "Rajeev Saxena",
    geofencePassed: true,
    selfieVerified: true,
    checklistComplete: true,
  }));

  return <AttendanceClientTabs dbSessions={formattedSessions} />;
}
