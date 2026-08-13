/**
 * "Service" — what the workshop owes this vehicle, and what the driver has
 * already told them about it.
 *
 * Two things belong on one screen here because they are one conversation: a
 * driver who sees "brake service overdue" and has already reported a brake
 * noise needs to see both facts together, not on separate pages that each look
 * like nothing is happening.
 */
import Link from "next/link";
import { requirePage } from "@/lib/access";
import { TERMS } from "@/lib/navigation";
import { calendarDaysUntil, fmtDate } from "@/lib/utils";
import { myBasics, myServiceDue, myProblems, type ServiceItem, type ProblemRow, type Tone } from "../_data";
import { MyHeader, NotLinked, NoVehicle, Screen, Hero, Notice, Row, Nothing, Fact } from "../_ui";

export const dynamic = "force-dynamic";

export default async function MyServicePage({
  searchParams,
}: {
  searchParams: Promise<{ reported?: string }>;
}) {
  const access = await requirePage("my.service");
  const [{ driver, vehicle }, { reported }] = await Promise.all([myBasics(access), searchParams]);

  if (!driver) {
    return (
      <Screen>
        <MyHeader href="/my/service" />
        <NotLinked loginName={access.session.name} />
      </Screen>
    );
  }

  if (!vehicle) {
    return (
      <Screen>
        <MyHeader href="/my/service" />
        <NoVehicle />
      </Screen>
    );
  }

  const now = new Date();
  const [service, problems] = await Promise.all([myServiceDue(vehicle, now), myProblems(vehicle.id, 15)]);

  const overdue = service.filter((s) => s.status === "overdue");
  const due = service.filter((s) => s.status === "due");
  const unknown = service.filter((s) => !s.assessable);
  const open = problems.filter((p) => p.status === "Open" || p.status === "In-Progress");

  // The date on the vehicle record is a second, coarser signal than the task
  // schedules — some clients keep only this one, so it is shown either way.
  const nextService = vehicle.serviceDueDate;
  const dueDays = nextService ? calendarDaysUntil(nextService, now) : null;

  const hero =
    overdue.length > 0
      ? { tone: "bad" as Tone, label: "Service overdue", hint: "Service due hai — supervisor ko aaj hi batayein." }
      : due.length > 0 || (dueDays != null && dueDays <= 15)
        ? { tone: "warn" as Tone, label: "Service due", hint: "Service due hai. Workshop se date le lein." }
        : unknown.length > 0 && service.length === unknown.length
          ? { tone: "muted" as Tone, label: "Not known", hint: "Service ka data incomplete hai — office se poochhein." }
          : { tone: "ok" as Tone, label: "All clear", hint: "No service pending on this vehicle." };

  return (
    <Screen>
      <MyHeader href="/my/service" note={vehicle.registrationNo ?? vehicle.code} />

      {reported && (
        <Notice tone="ok" title="Report bhej diya. Workshop dekh lega." />
      )}

      <Hero
        tone={hero.tone}
        label={hero.label}
        hint={hero.hint}
        meta={
          vehicle.lastServiceDate
            ? `Last service ${fmtDate(vehicle.lastServiceDate)}`
            : "Last service date not on record"
        }
      />

      {nextService && dueDays != null && (
        <Fact
          label="Next service date"
          value={fmtDate(nextService)}
          sub={dueDays < 0 ? `${Math.abs(dueDays)} days late` : `${dueDays} days to go`}
          tone={dueDays < 0 ? "bad" : dueDays <= 15 ? "warn" : undefined}
        />
      )}

      <section>
        <h2 className="mb-2 px-1 text-base font-semibold text-slate-600">{TERMS["Maintenance Due"]}</h2>
        {service.length === 0 ? (
          <Nothing>No service schedule set for this vehicle yet.</Nothing>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            {service.map((s) => (
              <Row
                key={s.task}
                title={s.task}
                subtitle={s.label}
                right={statusWord(s)}
                tone={statusTone(s)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <h2 className="text-base font-semibold text-slate-600">Reported problems</h2>
          {open.length > 0 && <span className="text-sm text-slate-400">{open.length} open</span>}
        </div>
        {problems.length === 0 ? (
          <Nothing>Nothing reported on this vehicle.</Nothing>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            {problems.map((p) => (
              <Row
                key={p.id}
                title={shortDescription(p)}
                subtitle={`${typeWord(p.type)} · ${fmtDate(p.reportedAt)}`}
                right={stateWord(p.status)}
                tone={p.status === "Open" ? "bad" : p.status === "In-Progress" ? "warn" : "ok"}
              />
            ))}
          </div>
        )}
      </section>

      <Link
        href="/my/vehicle"
        className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-white text-lg font-bold text-brand-700 ring-1 ring-brand-200 active:scale-[0.99] active:bg-brand-50"
      >
        Report a problem
      </Link>
    </Screen>
  );
}

function statusWord(s: ServiceItem): string {
  if (!s.assessable) return "Unknown";
  return { overdue: "Overdue", due: "Due", upcoming: "Soon", ok: "OK" }[s.status];
}

function statusTone(s: ServiceItem): Tone | undefined {
  if (!s.assessable) return "muted";
  if (s.status === "overdue") return "bad";
  if (s.status === "due") return "warn";
  return undefined;
}

/** Work-order types are database words; these are the ones people say. */
function typeWord(type: string): string {
  return { BREAKDOWN: "Breakdown", REPAIR: "Repair", PM: "Scheduled service" }[type] ?? type;
}

function stateWord(status: string): string {
  return { Open: "Open", "In-Progress": "In workshop", Completed: "Done", Closed: "Done" }[status] ?? status;
}

/**
 * The workshop's description carries the reporter's name and phone tacked on
 * the end, which is right for a job card and noise on a phone. The first clause
 * is the problem itself.
 */
function shortDescription(p: ProblemRow): string {
  const first = p.description.split(" — ")[0].trim();
  return first.length > 0 ? first : p.woNo;
}
