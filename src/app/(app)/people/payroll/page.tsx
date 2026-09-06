import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { Card, SectionTitle, StatCard, EmptyState } from "@/components/ui";
import { inr, num } from "@/lib/utils";
import { periodLabel } from "@/lib/payroll-export";
import { businessMonth } from "@/lib/business-time";
import { PayrollBoard } from "./_sections/PayrollBoard";
import { WageBook } from "./_sections/WageBook";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { IndianRupee, Users, CalendarCheck, Wallet } from "lucide-react";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

const TABS: Tab[] = [
  { key: "sheet", label: "Monthly Pay Sheet" },
  { key: "wages", label: "Wages" },
];

/**
 * Wages worked out from the attendance register.
 *
 * The sheet is deliberately downstream of attendance and has no way to record
 * a day itself — one register, one truth. If a day is wrong here, it is wrong
 * in Attendance, and that is where it gets fixed.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string }>;
}) {
  const access = await requirePage("payroll.view");
  const params = await searchParams;
  const tab = resolveTab(params.tab, TABS);

  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period ?? "")
    ? params.period!
    : businessMonth(new Date());

  const [run, people, latestRuns] = await Promise.all([
    db.payrollRun.findUnique({
      where: { period },
      include: { lines: { orderBy: { empCode: "asc" } } },
    }),
    db.driver.findMany({
      where: { status: "Active" },
      select: {
        id: true,
        name: true,
        empCode: true,
        type: true,
        employmentType: true,
        wageRates: { orderBy: { effectiveFrom: "desc" }, take: 3 },
      },
      orderBy: { empCode: "asc" },
    }),
    db.payrollRun.findMany({
      orderBy: { period: "desc" },
      take: 12,
      select: { id: true, period: true, status: true, _count: { select: { lines: true } } },
    }),
  ]);

  const lines = run?.lines ?? [];
  const totalNet = lines.reduce((s, l) => s + l.net, 0);
  const totalAdvance = lines.reduce((s, l) => s + l.advance, 0);
  const unpaidPeople = people.filter((p) => p.wageRates.length === 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Payroll" /></h1>
        <p className="text-sm text-slate-500">
          Wages worked out from the attendance register — kitna paisa banta hai
        </p>
      </div>

      <PageTabs tabs={TABS} active={tab} basePath="/people/payroll" />

      {tab === "wages" ? (
        <WageBook people={people} canEdit={access.can("payroll.edit")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
            <StatCard
              label="This Month's Pay"
              value={run ? inr(totalNet, { compact: true }) : "—"}
              sub={run ? `${lines.length} people` : "Not prepared yet"}
              accent="brand"
              icon={<IndianRupee className="h-5 w-5" />}
            />
            <StatCard
              label="Advances Taken"
              value={run ? inr(totalAdvance, { compact: true }) : "—"}
              sub="Already given out"
              icon={<Wallet className="h-5 w-5" />}
            />
            <StatCard
              label="People"
              value={num(people.length)}
              sub={unpaidPeople > 0 ? `${unpaidPeople} with no wage set` : "All have a wage"}
              accent={unpaidPeople > 0 ? "amber" : undefined}
              icon={<Users className="h-5 w-5" />}
            />
            <StatCard
              label="Status"
              value={run ? (run.status === "FINALISED" ? "Final" : "Draft") : "Not started"}
              sub={periodLabel(period)}
              accent={run?.status === "FINALISED" ? "emerald" : "amber"}
              icon={<CalendarCheck className="h-5 w-5" />}
            />
          </div>

          {people.length === 0 ? (
            <Card className="p-6">
              <EmptyState
                title="No people to pay yet"
                description="Add drivers and operators under Staff & Drivers first. Payroll reads the attendance register, so mark attendance for them too."
              />
            </Card>
          ) : (
            <PayrollBoard
              period={period}
              run={
                run
                  ? {
                      id: run.id,
                      status: run.status,
                      standardDays: run.standardDays,
                      standardHours: run.standardHours,
                      finalisedAt: run.finalisedAt ? run.finalisedAt.toISOString() : null,
                      finalisedBy: run.finalisedBy,
                    }
                  : null
              }
              lines={lines.map((l) => ({
                id: l.id,
                empCode: l.empCode,
                name: l.name,
                wageKind: l.wageKind,
                wageAmount: l.wageAmount,
                daysPresent: l.daysPresent,
                daysHalf: l.daysHalf,
                daysLeave: l.daysLeave,
                daysRest: l.daysRest,
                daysAbsent: l.daysAbsent,
                daysPaid: l.daysPaid,
                otHours: l.otHours,
                basic: l.basic,
                overtime: l.overtime,
                bonus: l.bonus,
                advance: l.advance,
                deduction: l.deduction,
                net: l.net,
                adjustedNote: l.adjustedNote,
              }))}
              recent={latestRuns.map((r) => ({
                period: r.period,
                status: r.status,
                people: r._count.lines,
              }))}
              canEdit={access.can("payroll.edit")}
              canApprove={access.can("payroll.approve")}
            />
          )}

          <Card className="p-5">
            <SectionTitle
              title="How the days are counted"
              subtitle="So anyone can check the sheet by hand"
            />
            <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
              <li>• <b>Present</b> — one full day&apos;s pay.</li>
              <li>• <b>Half day</b> — half a day&apos;s pay.</li>
              <li>• <b>Absent</b> — no pay.</li>
              <li>
                • <b>Rest day and leave</b> — paid for people on a monthly salary, not paid for
                people on a daily wage. A daily wage is paid for days worked; a monthly salary is
                not docked for the weekly off.
              </li>
              <li>
                • <b>Overtime</b> — hours worked beyond a normal shift, paid only where an overtime
                rate has been set for that person.
              </li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}