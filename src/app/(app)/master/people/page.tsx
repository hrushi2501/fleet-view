import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { AttendanceForm, PersonDocForm, PersonMasterForm, DeleteRow } from "@/components/MasterForms";
import { attendanceSummary, personDocStatus, PERSON_DOC_LABEL, REQUIRED_PERSON_DOCS, type AttendanceLite, type PersonDocLite } from "@/lib/master";
import { num, fmtDate } from "@/lib/utils";
import { Users, CalendarCheck, FileX2, TriangleAlert, UserCheck } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATE_DOT: Record<string, string> = {
  valid: "bg-emerald-500", expiring: "bg-amber-500", expired: "bg-rose-500", missing: "bg-slate-400", "no-expiry": "bg-brand-400",
};
const ATT_BADGE: Record<string, string> = {
  PRESENT: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  HALF_DAY: "bg-amber-100 text-amber-700 ring-amber-600/20",
  ABSENT: "bg-rose-100 text-rose-700 ring-rose-600/20",
  LEAVE: "bg-brand-100 text-brand-700 ring-brand-600/20",
  REST: "bg-slate-100 text-slate-500 ring-slate-400/20",
};

export default async function PeopleMasterPage() {
  const since = new Date(); since.setDate(since.getDate() - 30);

  const [drivers, attendance, docs, projects] = await Promise.all([
    db.driver.findMany({ orderBy: { name: "asc" } }),
    db.attendance.findMany({ where: { date: { gte: since } }, include: { driver: true, project: true }, orderBy: { date: "desc" }, take: 400 }),
    db.personDocument.findMany({ include: { driver: true }, orderBy: { expiryDate: "asc" } }),
    db.project.findMany({ orderBy: { code: "asc" } }),
  ]);

  const driverOpts = drivers.map((d) => ({ id: d.id, label: `${d.empCode} — ${d.name}` }));
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));

  const attByDriver = new Map<string, AttendanceLite[]>();
  for (const a of attendance) {
    const arr = attByDriver.get(a.driverId) ?? [];
    arr.push({ date: a.date, status: a.status, hours: a.hours });
    attByDriver.set(a.driverId, arr);
  }
  const docsByDriver = new Map<string, PersonDocLite[]>();
  for (const d of docs) {
    const arr = docsByDriver.get(d.driverId) ?? [];
    arr.push({ docType: d.docType, expiryDate: d.expiryDate });
    docsByDriver.set(d.driverId, arr);
  }

  const rows = drivers.map((d) => ({
    person: d,
    att: attendanceSummary(attByDriver.get(d.id) ?? []),
    docs: personDocStatus(docsByDriver.get(d.id) ?? []),
  }));

  const totalMissing = rows.reduce((s, r) => s + r.docs.missing, 0);
  const totalExpired = rows.reduce((s, r) => s + r.docs.expired, 0);
  const contractors = drivers.filter((d) => d.employmentType === "CONTRACTOR").length;
  const withAtt = rows.filter((r) => r.att.days > 0);
  const avgAtt = withAtt.length ? withAtt.reduce((s, r) => s + r.att.attendancePct, 0) / withAtt.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Personnel Master</h1>
          <p className="text-sm text-slate-500">
            Attendance, personal documents and employment details — the people equivalent of the vehicle papers
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PersonDocForm drivers={driverOpts} />
          <AttendanceForm drivers={driverOpts} projects={projOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="People" value={num(drivers.length)} sub={`${num(contractors)} contractor-supplied`} accent="brand" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Attendance" value={`${avgAtt.toFixed(0)}%`} sub="last 30 days" accent={avgAtt >= 90 ? "emerald" : "amber"} icon={<CalendarCheck className="h-5 w-5" />} />
        <StatCard label="Missing Documents" value={num(totalMissing)} sub="never recorded" accent={totalMissing > 0 ? "rose" : "emerald"} icon={<FileX2 className="h-5 w-5" />} />
        <StatCard label="Expired Documents" value={num(totalExpired)} sub="need renewal" accent={totalExpired > 0 ? "rose" : "emerald"} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Attendance Records" value={num(attendance.length)} sub="last 30 days" accent="violet" icon={<UserCheck className="h-5 w-5" />} />
      </div>

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="People" subtitle={`Required documents: ${REQUIRED_PERSON_DOCS.map((d) => PERSON_DOC_LABEL[d]).join(", ")} — grey means never recorded`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Person</th>
                <th className="px-5 py-3 font-medium">Employment</th>
                <th className="px-5 py-3 font-medium">Attendance (30d)</th>
                {REQUIRED_PERSON_DOCS.map((t) => <th key={t} className="px-3 py-3 text-center font-medium">{PERSON_DOC_LABEL[t]}</th>)}
                <th className="px-5 py-3 font-medium">Emergency</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ person: p, att, docs: dd }) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3">
                    <span className="font-semibold text-ink-900">{p.name}</span>
                    <p className="text-xs text-slate-400">{p.empCode} · {p.type}</p>
                  </td>
                  <td className="px-5 py-3">
                    <Badge color={p.employmentType === "CONTRACTOR" ? "bg-amber-100 text-amber-700 ring-amber-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>
                      {p.employmentType === "CONTRACTOR" ? "Contractor" : "Own"}
                    </Badge>
                    {p.contractorName && <p className="mt-0.5 text-xs text-slate-400">{p.contractorName}</p>}
                  </td>
                  <td className="px-5 py-3">
                    {att.days > 0 ? (
                      <div className="w-24">
                        <Progress value={att.attendancePct} />
                        <p className="mt-0.5 text-xs text-slate-400">{att.attendancePct.toFixed(0)}% · {att.present}P {att.absent}A</p>
                      </div>
                    ) : <span className="text-xs text-slate-400">not marked</span>}
                  </td>
                  {REQUIRED_PERSON_DOCS.map((t) => {
                    const f = dd.findings.find((x) => x.docType === t)!;
                    return (
                      <td key={t} className="px-3 py-3 text-center">
                        <span className={`inline-block h-3 w-3 rounded-full ${STATE_DOT[f.state]}`} title={f.state} />
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {f.state === "missing" ? "none" : f.days == null ? "no expiry" : f.days < 0 ? `${Math.abs(f.days)}d ago` : `${f.days}d`}
                        </p>
                      </td>
                    );
                  })}
                  <td className="px-5 py-3 text-xs text-slate-500">{p.emergencyContact ?? <span className="text-slate-300">not set</span>}</td>
                  <td className="px-5 py-3 text-right">
                    <PersonMasterForm person={{ id: p.id, name: p.name, employmentType: p.employmentType, contractorName: p.contractorName, joinDate: p.joinDate, bloodGroup: p.bloodGroup, emergencyContact: p.emergencyContact }} />
                  </td>
                </tr>
              ))}
              {drivers.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-400">No people on record.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="p-5 pb-3"><SectionTitle title="Attendance Log" subtitle="Last 30 days" /></div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Person</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Shift</th>
                  <th className="px-5 py-2.5 text-right font-medium">Hours</th>
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {attendance.slice(0, 60).map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-5 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(a.date)}</td>
                    <td className="px-5 py-2.5 font-medium text-ink-900">{a.driver.name}</td>
                    <td className="px-5 py-2.5"><Badge color={ATT_BADGE[a.status] ?? ATT_BADGE.REST}>{a.status.replace("_", " ")}</Badge></td>
                    <td className="px-5 py-2.5 text-slate-500">{a.shift}</td>
                    <td className="px-5 py-2.5 text-right text-slate-600">{a.hours || "—"}</td>
                    <td className="px-5 py-2.5 text-slate-600">{a.project?.code ?? "—"}</td>
                    <td className="px-5 py-2.5 text-right"><DeleteRow id={a.id} kind="attendance" /></td>
                  </tr>
                ))}
                {attendance.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">No attendance marked in the last 30 days.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0">
          <div className="p-5 pb-3"><SectionTitle title="Personal Documents" subtitle="Soonest expiry first" /></div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Person</th>
                  <th className="px-5 py-2.5 font-medium">Document</th>
                  <th className="px-5 py-2.5 font-medium">Number</th>
                  <th className="px-5 py-2.5 font-medium">Expiry</th>
                  <th className="px-5 py-2.5 font-medium">Scan</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {docs.slice(0, 60).map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-5 py-2.5 font-medium text-ink-900">{d.driver.name}</td>
                    <td className="px-5 py-2.5 text-slate-600">{PERSON_DOC_LABEL[d.docType] ?? d.docType}</td>
                    <td className="px-5 py-2.5 text-slate-500">{d.number ?? "—"}</td>
                    <td className="px-5 py-2.5 text-slate-600">{d.expiryDate ? fmtDate(d.expiryDate) : <span className="text-slate-300">no expiry</span>}</td>
                    <td className="px-5 py-2.5">
                      {d.documentUrl ? <a href={d.documentUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">open</a> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right"><DeleteRow id={d.id} kind="persondoc" /></td>
                  </tr>
                ))}
                {docs.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No personal documents on record.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
