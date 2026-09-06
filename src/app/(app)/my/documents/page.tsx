/**
 * "My Documents" — the papers a driver gets stopped for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY MISSING IS TREATED AS BADLY AS EXPIRED
 *
 * A screen that only colours expired documents red gives a clean bill of health
 * to a vehicle with no PUC on file at all — the absence has nothing to go red.
 * That is exactly the vehicle that gets held at a check post. So a document with
 * no record, or a record with no expiry date, is shown in the same red band as
 * one that ran out last week, and says so in words.
 *
 * The driver's own papers come first because they are the ones the driver can
 * actually do something about.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { requirePage } from "@/lib/access";
import { fmtDate } from "@/lib/utils";
import { myBasics, myPersonDocs, myVehicleDocs, type DocRow, type Tone } from "../_data";
import { MyHeader, Screen, Hero, Group, Nothing, NotLinked } from "../_ui";
import { DriverDocumentVault } from "@/components/DriverDocumentVault";

export const dynamic = "force-dynamic";

export default async function MyDocumentsPage() {
  const access = await requirePage("my.documents");
  const { driver, vehicle } = await myBasics(access);

  if (!driver) {
    return (
      <Screen>
        <MyHeader href="/my/documents" />
        <NotLinked loginName={access.session.email} />
      </Screen>
    );
  }

  const now = new Date();
  const [mine, theirs] = await Promise.all([
    myPersonDocs(driver, now),
    vehicle ? myVehicleDocs(vehicle.id, now) : Promise.resolve([]),
  ]);

  const all = [...mine, ...theirs];
  const bad = all.filter((d) => d.state === "expired" || d.state === "missing");
  const soon = all.filter((d) => d.state === "expiring");

  const hero =
    bad.length > 0
      ? {
          tone: "bad" as Tone,
          label: `${bad.length} problem${bad.length === 1 ? "" : "s"}`,
          hint: "Papers pura nahi hai. Office ko aaj batayein.",
        }
      : soon.length > 0
        ? {
            tone: "warn" as Tone,
            label: `${soon.length} expiring`,
            hint: "Document jaldi expire hoga — renew karwa lein.",
          }
        : { tone: "ok" as Tone, label: "All in order", hint: "Every document on record is valid." };

  return (
    <Screen>
      <MyHeader href="/my/documents" />

      <Hero tone={hero.tone} label={hero.label} hint={hero.hint} />

      <section>
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <h2 className="text-base font-semibold text-slate-600">My papers</h2>
          <DriverDocumentVault />
        </div>
        {mine.length === 0 ? (
          <Nothing>No documents on record for you yet. Add your licence or Aadhaar scan.</Nothing>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            {mine.map((d) => <DocLine key={d.key} doc={d} />)}
          </div>
        )}
      </section>

      {!vehicle ? (
        <Nothing>No vehicle assigned to you.</Nothing>
      ) : theirs.length === 0 ? (
        <Nothing>No papers on record for {vehicle.registrationNo ?? vehicle.code}.</Nothing>
      ) : (
        <Group title={`Vehicle papers · ${vehicle.registrationNo ?? vehicle.code}`}>
          {theirs.map((d) => <DocLine key={d.key} doc={d} />)}
        </Group>
      )}

      <p className="px-1 text-sm leading-relaxed text-slate-400">
        Renewals are handled by the office. Show this screen to your supervisor
        if anything here is red.
      </p>
    </Screen>
  );
}

function DocLine({ doc }: { doc: DocRow }) {
  return (
    <div className="flex min-h-[72px] items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-ink-900">{doc.label}</p>
        <p className="truncate text-sm text-slate-500">
          {doc.expiry
            ? `${doc.number ? `${doc.number} · ` : ""}${fmtDate(doc.expiry)}`
            : doc.number
              ? `${doc.number} · no expiry date recorded`
              : "nothing on record"}
        </p>
        {doc.documentUrl ? (
          <a href={doc.documentUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-8 items-center text-sm font-bold text-brand-700 underline underline-offset-2">
            View document
          </a>
        ) : (
          <p className="mt-1 text-xs font-medium text-slate-400">No scan uploaded</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-base font-bold ${stateToneClass(doc.state)}`}>{stateWord(doc)}</p>
        {doc.state === "expiring" && doc.days != null && <p className="text-sm text-slate-400">{doc.days} days</p>}
      </div>
    </div>
  );
}

/**
 * The state as a word, with the number of days folded in where it changes what
 * a driver would do — "Expired 40 days" is a very different morning from
 * "Expired 1 day".
 */
function stateWord(d: DocRow): string {
  if (d.state === "missing") return "Not on record";
  if (d.state === "expired") return `Expired ${Math.abs(d.days ?? 0)}d`;
  if (d.state === "expiring") return "Expiring soon";
  return "Valid";
}

function stateTone(state: DocRow["state"]): Tone | undefined {
  if (state === "expired" || state === "missing") return "bad";
  if (state === "expiring") return "warn";
  return "ok";
}

function stateToneClass(state: DocRow["state"]): string {
  const tone = stateTone(state);
  return tone === "bad" ? "text-rose-800" : tone === "warn" ? "text-amber-900" : "text-emerald-800";
}
