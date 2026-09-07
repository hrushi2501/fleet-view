/**
 * Everything the driver app reads from the database, in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SHARED LOADER RATHER THAN QUERIES IN EACH PAGE
 *
 * Six pages all answer questions about the same two rows — "who is this driver"
 * and "which vehicle is theirs". If each page wrote its own `findMany`, the
 * scoping would have to be correct six times, and it only has to be wrong once
 * for a driver to see somebody else's fuel bill. Every function here takes the
 * caller's `Access` and starts from `access.driverId`; nothing in this file can
 * be called in a way that returns another person's rows.
 *
 * The one rule that matters: a null `driverId` means an administrator has not
 * assigned this login to a driver. That is an empty state, never a reason to
 * widen the query or create a driver from a login name.
 * `assetScope()` in `lib/access.ts` encodes the same rule with `"__none__"`, and
 * the loaders below mirror it by returning nothing rather than everything.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";
import type { Access } from "@/lib/access";
import { startOfBusinessDay } from "@/lib/business-time";
import { distanceKm } from "@/lib/utils";
import { docState, type DocState } from "@/lib/compliance";
import { pmDue, type ScheduleLite } from "@/lib/maintenance";

/* ------------------------------------------------------------------ basics */

export type MyDriver = {
  id: string;
  name: string;
  empCode: string;
  phone: string;
  type: string;
  licenseNo: string;
  licenseExpiry: Date;
  status: string;
};

export type MyVehicle = {
  id: string;
  code: string;
  registrationNo: string | null;
  name: string;
  assetClass: string;
  category: string;
  primaryMeter: string;
  meterValue: number;
  fuelCapacity: number;
  fuelLevelPct: number | null;
  fuelLevelAt: Date | null;
  status: string;
  lat: number;
  lng: number;
  speed: number;
  lastSeen: Date;
  deviceId: string | null;
  serviceDueDate: Date | null;
  lastServiceDate: Date | null;
  projectId: string | null;
  projectName: string | null;
};

export type MyBasics = { driver: MyDriver | null; vehicle: MyVehicle | null };

export type DriverEmergencyContact = {
  label: string;
  hint: string;
  phone: string;
  tone: "critical" | "normal";
};

type ConfiguredEmergencyContact = { name?: unknown; phone?: unknown };

function configuredEmergencyContact(value: string | undefined, fallbackLabel: string): DriverEmergencyContact | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ConfiguredEmergencyContact;
    const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 80) : fallbackLabel;
    const phone = typeof parsed.phone === "string" ? parsed.phone.trim().replace(/[\s()-]/g, "") : "";
    if (!name || !/^\+?[1-9]\d{6,14}$/.test(phone)) return null;
    return { label: name, hint: "Company emergency contact", phone, tone: "normal" };
  } catch {
    return null;
  }
}

/**
 * The two public emergency services are always available. Company contacts are
 * data, never guessed: administrators may set JSON `{ "name", "phone" }` at
 * `emergency:roadside`, `emergency:incharge`, or the project-specific
 * `emergency:project:<projectId>:incharge` setting.
 */
export async function myEmergencyContacts(projectId: string | null): Promise<{
  contacts: DriverEmergencyContact[];
  missingCompanyContacts: string[];
}> {
  const contacts: DriverEmergencyContact[] = [
    { label: "Emergency response", hint: "Police, fire or medical · 112", phone: "112", tone: "critical" },
    { label: "Ambulance", hint: "Accident / medical emergency · 108", phone: "108", tone: "critical" },
  ];
  const keys = ["emergency:roadside", "emergency:incharge", ...(projectId ? [`emergency:project:${projectId}:incharge`] : [])];
  try {
    const settings = await db.setting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    const byKey = new Map(settings.map((row) => [row.key, row.value]));
    const roadside = configuredEmergencyContact(byKey.get("emergency:roadside"), "Roadside assistance");
    const siteIncharge = configuredEmergencyContact(
      projectId ? byKey.get(`emergency:project:${projectId}:incharge`) ?? byKey.get("emergency:incharge") : byKey.get("emergency:incharge"),
      "Site in-charge",
    );
    if (roadside) contacts.push({ ...roadside, hint: "Roadside assistance" });
    if (siteIncharge) contacts.push({ ...siteIncharge, hint: "Site in-charge / manager" });
    return {
      contacts,
      missingCompanyContacts: [!roadside ? "Roadside assistance" : null, !siteIncharge ? "Site in-charge / manager" : null].filter((v): v is string => v !== null),
    };
  } catch {
    // Emergency calling must still work if the optional settings read fails.
    return { contacts, missingCompanyContacts: ["Roadside assistance", "Site in-charge / manager"] };
  }
}

/**
 * The driver behind this login and the vehicle assigned to them.
 *
 * Both come back null-able on purpose. "No driver assigned to this login" and
 * "driver assigned but no vehicle handed over yet" are two different, ordinary situations on a real
 * site, and each needs its own message rather than a crash or a blank screen.
 *
 * A driver can in principle hold more than one machine. The app shows one,
 * because a driver drives one thing at a time and a picker on a phone screen is
 * a tap in the way; the lowest code wins so the choice is at least stable
 * between page loads.
 */
export async function myBasics(access: Access): Promise<MyBasics> {
  const driverId = access.driverId;
  if (!driverId) return { driver: null, vehicle: null };

  const driver = await db.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true, name: true, empCode: true, phone: true, type: true,
      licenseNo: true, licenseExpiry: true, status: true,
      assets: {
        orderBy: { code: "asc" },
        take: 1,
        select: {
          id: true, code: true, registrationNo: true, name: true, assetClass: true,
          category: true, primaryMeter: true, meterValue: true, fuelCapacity: true,
          fuelLevelPct: true, fuelLevelAt: true, status: true, lat: true, lng: true,
          speed: true, lastSeen: true, deviceId: true, serviceDueDate: true, lastServiceDate: true,
          projectId: true, project: { select: { name: true } },
        },
      },
    },
  });

  if (!driver) return { driver: null, vehicle: null };

  const a = driver.assets[0];
  return {
    driver: {
      id: driver.id, name: driver.name, empCode: driver.empCode, phone: driver.phone,
      type: driver.type, licenseNo: driver.licenseNo, licenseExpiry: driver.licenseExpiry,
      status: driver.status,
    },
    vehicle: a
      ? { ...a, projectName: a.project?.name ?? null }
      : null,
  };
}

/* ----------------------------------------------------------- vehicle state */

export type Tone = "ok" | "warn" | "bad" | "info" | "muted";

export type VehicleState = {
  key: "running" | "idle" | "stopped" | "unknown";
  /** Big word on the screen. */
  label: string;
  /** One line under it, in the driver's own language. */
  hint: string;
  tone: Tone;
};

/**
 * How stale a position has to be before we stop claiming to know anything.
 *
 * The tracker is polled every couple of minutes, so anything older than a few
 * hours means the link is down, the vehicle is parked out of coverage, or the
 * device is off. Presenting the last known reading as the current one in that
 * situation is worse than admitting we do not know — a driver who is told the
 * truck is "stopped" while it is being driven away stops trusting the screen.
 */
const STALE_HOURS = 3;

export function vehicleState(
  v: MyVehicle,
  ignitionOn: boolean | null,
  now: Date = new Date()
): VehicleState {
  const ageHours = (now.getTime() - v.lastSeen.getTime()) / 3600000;

  if (ageHours > STALE_HOURS) {
    return {
      key: "unknown",
      label: "No update",
      hint: "Vehicle ka naya update nahi aaya. Supervisor ko batayein.",
      tone: "muted",
    };
  }
  if (v.speed > 3) {
    return { key: "running", label: "Running", hint: "Vehicle chal rahi hai.", tone: "ok" };
  }
  if (ignitionOn === true) {
    return {
      key: "idle",
      label: "Idle",
      hint: "Engine chalu hai par vehicle khadi hai — diesel jal raha hai.",
      tone: "warn",
    };
  }
  return { key: "stopped", label: "Stopped", hint: "Vehicle abhi stopped hai.", tone: "info" };
}

/** Ignition from the newest reading for this one vehicle. Null when unknown. */
export async function latestIgnition(vehicleId: string): Promise<boolean | null> {
  const r = await db.telemetryReading.findFirst({
    where: { assetId: vehicleId },
    orderBy: { recordedAt: "desc" },
    select: { ignitionOn: true },
  });
  return r?.ignitionOn ?? null;
}

/**
 * Where the vehicle is, said the way a person would say it.
 *
 * A latitude and a longitude are not an answer to "where is my truck" for
 * anybody, and the brief forbids showing them at all. There is no geocoder in
 * this system, so the only honest place names available are the client's own
 * sites — which are exactly the places a driver knows by name anyway. Sites are
 * looked up for this vehicle's project only, so the query stays inside the
 * driver's scope.
 *
 * When nothing matches, the screen says so. A vague guess would be worse.
 */
export async function whereIsIt(v: MyVehicle): Promise<string> {
  const hasFix = v.lat !== 0 || v.lng !== 0;
  if (!hasFix) return "Location abhi record nahi hui";
  if (!v.projectId) return "Location mili hai, par jagah ka naam record nahi hai";

  const sites = await db.site.findMany({
    where: { projectId: v.projectId, active: true },
    select: { name: true, lat: true, lng: true, radiusM: true },
  });

  const near = sites
    .filter((s) => s.lat !== 0 || s.lng !== 0)
    .map((s) => ({ ...s, km: distanceKm(v.lat, v.lng, s.lat, s.lng) }))
    .sort((a, b) => a.km - b.km)[0];

  if (near) {
    if (near.km * 1000 <= near.radiusM) return `${near.name} par`;
    if (near.km <= 25) return `${near.name} se ${near.km.toFixed(0)} km door`;
  }
  return v.projectName ? `${v.projectName} area` : "Jagah ka naam record nahi hai";
}

/* ------------------------------------------------------------------- trips */

export type TripRow = {
  id: string;
  start: Date;
  end: Date | null;
  distanceKm: number;
  /** Null while the trip is still running. */
  hours: number | null;
  running: boolean;
};

/**
 * The driver's own journeys, newest first.
 *
 * Two tables hold a trip in this system and both are the driver's: `Trip` is
 * the finished journey record, `TripSession` is the shift a driver opened by
 * scanning the cabin QR. Showing only one of them would leave a driver looking
 * at a day they know they worked with nothing on it, so both are read — each
 * filtered by `driverId` — and merged into a single list.
 */
export async function myTrips(driverId: string, take = 30): Promise<TripRow[]> {
  const [trips, sessions] = await Promise.all([
    db.trip.findMany({
      where: { driverId },
      orderBy: { startTime: "desc" },
      take,
      select: { id: true, startTime: true, endTime: true, distanceKm: true, status: true },
    }),
    db.tripSession.findMany({
      where: { driverId },
      orderBy: { startedAt: "desc" },
      take,
      select: { id: true, startedAt: true, endedAt: true, distanceKm: true, status: true },
    }),
  ]);

  const rows: TripRow[] = [
    ...trips.map((t) => ({
      id: `trip-${t.id}`,
      start: t.startTime,
      end: t.endTime,
      distanceKm: t.distanceKm,
      hours: t.endTime ? (t.endTime.getTime() - t.startTime.getTime()) / 3600000 : null,
      running: !t.endTime,
    })),
    ...sessions.map((s) => ({
      id: `session-${s.id}`,
      start: s.startedAt,
      end: s.endedAt,
      distanceKm: s.distanceKm,
      hours: s.endedAt ? (s.endedAt.getTime() - s.startedAt.getTime()) / 3600000 : null,
      running: s.status === "ACTIVE",
    })),
  ];

  return rows.sort((a, b) => b.start.getTime() - a.start.getTime()).slice(0, take);
}

/** Trips that started today, in the business's own timezone rather than UTC. */
export function todaysTrips(rows: TripRow[], now: Date = new Date()): TripRow[] {
  const dayStart = startOfBusinessDay(now);
  return rows.filter((r) => r.start >= dayStart);
}

/* --------------------------------------------------------- shift & on-duty */

export type ShiftState = {
  onDuty: boolean;
  /** An actual open QR trip, as distinct from attendance marked present. */
  hasActiveTrip: boolean;
  sessionId?: string;
  label: string;
  detail: string;
  tone: Tone;
};

/**
 * Whether this driver is on duty right now.
 *
 * An open QR session is the strongest evidence — it means somebody scanned a
 * cabin sticker and has not signed off. Attendance marked by a supervisor is the
 * fallback, and "nothing recorded" is reported as exactly that rather than as
 * absence, because an unmarked register is a clerical gap, not a day off.
 */
export async function myShift(driverId: string, userId: string, now: Date = new Date()): Promise<ShiftState> {
  const dayStart = startOfBusinessDay(now);
  const [session, attendance] = await Promise.all([
    db.tripSession.findFirst({
      // A Driver record has one login today, but the live session is still
      // tied to the account that scanned it. Keep the read equally strict so a
      // future relink or an old shared credential cannot show another login's
      // active duty controls.
      where: { driverId, userId, status: "ACTIVE" },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true },
    }),
    db.attendance.findFirst({
      where: { driverId, date: { gte: dayStart } },
      orderBy: { date: "desc" },
      select: { status: true, shift: true, hours: true },
    }),
  ]);

  if (session) {
    const since = session.startedAt.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true,
    });
    return { onDuty: true, hasActiveTrip: true, sessionId: session.id, label: "On duty", detail: `Shift ${since} se chalu hai`, tone: "ok" };
  }

  if (attendance) {
    const present = attendance.status === "PRESENT" || attendance.status === "HALF_DAY";
    const shift = attendance.shift === "NIGHT" ? "Night shift" : "Day shift";
    return {
      onDuty: present,
      hasActiveTrip: false,
      label: present ? "Marked present" : attendance.status.replace("_", " ").toLowerCase(),
      detail: present ? `${shift} · ${attendance.hours} hours` : shift,
      tone: present ? "ok" : "muted",
    };
  }

  return { onDuty: false, hasActiveTrip: false, label: "Not started", detail: "Aaj ki haziri abhi mark nahi hui", tone: "muted" };
}

/* ----------------------------------------------------------------- service */

export type ServiceItem = {
  task: string;
  label: string;
  status: "overdue" | "due" | "upcoming" | "ok";
  assessable: boolean;
};

/**
 * Scheduled work that has fallen due on this vehicle.
 *
 * `pmDue` decides due-ness from whichever of kilometres, engine hours or
 * calendar days trips first, and reports when it cannot decide at all. That last
 * case is passed through rather than swallowed: a schedule with no meter reading
 * behind it is "data incomplete", not "up to date", and telling a driver a
 * service is fine when nobody knows is how brakes get missed.
 */
export async function myServiceDue(vehicle: MyVehicle, now: Date = new Date()): Promise<ServiceItem[]> {
  const schedules = await db.maintenanceSchedule.findMany({
    where: { assetId: vehicle.id, active: true },
    select: {
      id: true, taskName: true, intervalKm: true, intervalHours: true, intervalDays: true,
      lastDoneMeter: true, lastDoneDate: true, estimatedCost: true,
    },
  });

  const meterIsHours = vehicle.primaryMeter === "SMU";
  return schedules
    .map((s) => {
      const due = pmDue(s as ScheduleLite, vehicle.meterValue, meterIsHours, now);
      return {
        task: s.taskName,
        label: due.assessable ? due.label : "Data incomplete hai — supervisor se poochhein",
        status: due.status,
        assessable: due.assessable,
      };
    })
    .sort((a, b) => rank(a.status) - rank(b.status));
}

function rank(s: ServiceItem["status"]): number {
  return { overdue: 0, due: 1, upcoming: 2, ok: 3 }[s];
}

/**
 * The problems a driver can pick from, in the words they would use.
 *
 * A free-text-only form gets "gaadi kharab" and nothing else, which tells the
 * workshop to send a mechanic with no idea what to bring. Six buttons and an
 * optional note gets a fitter who arrives with the right spanner. `blocking`
 * marks the ones that decide priority even when the vehicle is still moving.
 */
export const PROBLEM_KINDS: { value: string; label: string; blocking: boolean }[] = [
  { value: "ACCIDENT", label: "Accident / collision", blocking: true },
  { value: "HINDRANCE", label: "Road blocked / other hindrance", blocking: false },
  { value: "ENGINE", label: "Engine problem", blocking: true },
  { value: "BRAKE", label: "Brake / steering problem", blocking: true },
  { value: "TYRE", label: "Tyre problem", blocking: false },
  { value: "FUEL", label: "Fuel problem", blocking: false },
  { value: "ELECTRIC", label: "Light / electric problem", blocking: false },
  { value: "OTHER", label: "Something else", blocking: false },
];

export type ProblemRow = {
  id: string;
  woNo: string;
  type: string;
  status: string;
  priority: string;
  description: string;
  reportedAt: Date;
  completedAt: Date | null;
};

/** Problems raised against this vehicle — the driver's own report included. */
export async function myProblems(vehicleId: string, take = 15): Promise<ProblemRow[]> {
  return db.workOrder.findMany({
    where: { assetId: vehicleId },
    orderBy: { reportedAt: "desc" },
    take,
    select: {
      id: true, woNo: true, type: true, status: true, priority: true,
      description: true, reportedAt: true, completedAt: true,
    },
  });
}

/* -------------------------------------------------------------------- fuel */

export type FuelRow = {
  id: string;
  date: Date;
  litres: number;
  amount: number;
  meterValue: number;
  source: string;
};

/**
 * Diesel put into this driver's vehicle.
 *
 * Scoped two ways because the data arrives two ways. A fill logged inside an
 * open QR session carries `driverId` through `session`, which is the strongest
 * link; a fill logged through the photo wizard carries only the vehicle. Both
 * are within this driver's scope — the vehicle is theirs by assignment — so
 * both are shown, and a driver never sees a litre poured into somebody else's
 * truck.
 */
export async function myFuelFills(
  driverId: string,
  vehicleId: string | null,
  take = 20
): Promise<FuelRow[]> {
  const rows = await db.fuelTransaction.findMany({
    where: {
      type: "ISSUE",
      OR: [
        { assetId: vehicleId ?? "__none__" },
        { session: { driverId } },
      ],
    },
    orderBy: { date: "desc" },
    take,
    select: { id: true, date: true, quantity: true, amount: true, meterValue: true, source: true },
  });
  return rows.map((r) => ({
    id: r.id, date: r.date, litres: r.quantity, amount: r.amount,
    meterValue: r.meterValue, source: r.source,
  }));
}

/* --------------------------------------------------------------- documents */

export type DocRow = {
  key: string;
  label: string;
  number: string | null;
  expiry: Date | null;
  /** Private proxy URL. It is only present when someone uploaded a scan. */
  documentUrl: string | null;
  state: DocState;
  days: number | null;
};

/** People documents keep their database codes; a driver reads plain words. */
const PERSON_DOC_LABEL: Record<string, string> = {
  LICENSE: "Driving Licence",
  AADHAAR: "Aadhaar Card",
  MEDICAL: "Medical Certificate",
  POLICE_VERIFICATION: "Police Verification",
  TRAINING: "Training Certificate",
  CONTRACT: "Contract Paper",
};

/**
 * The driver's own papers.
 *
 * The licence is read from the `Driver` record when no document row exists for
 * it, because the expiry is held there for every driver on the system whether or
 * not anyone has uploaded a scan. A licence missing from this list because
 * nobody filed the paperwork is precisely the licence that expires unnoticed.
 */
export async function myPersonDocs(driver: MyDriver, now: Date = new Date()): Promise<DocRow[]> {
  const docs = await db.personDocument.findMany({
    where: { driverId: driver.id },
    orderBy: { expiryDate: "asc" },
    select: { id: true, docType: true, number: true, expiryDate: true, documentUrl: true },
  });

  const rows: DocRow[] = docs.map((d) => {
    const st = d.expiryDate ? docState(d.expiryDate, 30, now) : null;
    return {
      key: d.id,
      label: PERSON_DOC_LABEL[d.docType] ?? d.docType,
      number: d.number,
      expiry: d.expiryDate,
      documentUrl: d.documentUrl,
      // No expiry on record is not "valid for ever" — it is a gap in the file.
      state: st ? st.state : "missing",
      days: st ? st.days : null,
    };
  });

  if (!docs.some((d) => d.docType === "LICENSE")) {
    const st = docState(driver.licenseExpiry, 30, now);
    rows.unshift({
      key: "licence-from-driver",
      label: PERSON_DOC_LABEL.LICENSE,
      number: driver.licenseNo,
      expiry: driver.licenseExpiry,
      documentUrl: null,
      state: st.state,
      days: st.days,
    });
  }

  return rows.sort((a, b) => docSort(a) - docSort(b));
}

/** The vehicle's papers — the ones a check post asks for. */
export async function myVehicleDocs(vehicleId: string, now: Date = new Date()): Promise<DocRow[]> {
  const docs = await db.complianceDoc.findMany({
    where: { assetId: vehicleId },
    orderBy: { expiryDate: "asc" },
    select: { id: true, docType: true, number: true, expiryDate: true, reminderDays: true, documentUrl: true },
  });

  // Only the newest of each type counts; a renewal supersedes the copy it replaced.
  const latest = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    const cur = latest.get(d.docType);
    if (!cur || d.expiryDate > cur.expiryDate) latest.set(d.docType, d);
  }

  return [...latest.values()]
    .map((d) => {
      const st = docState(d.expiryDate, d.reminderDays, now);
      return {
        key: d.id,
        label: VEHICLE_DOC_LABEL[d.docType] ?? d.docType,
        number: d.number,
        expiry: d.expiryDate,
        documentUrl: d.documentUrl,
        state: st.state,
        days: st.days,
      };
    })
    .sort((a, b) => docSort(a) - docSort(b));
}

/** Plain wording for the statutory papers, matching what is printed on them. */
const VEHICLE_DOC_LABEL: Record<string, string> = {
  RC: "RC (Registration)",
  Insurance: "Insurance",
  Fitness: "Fitness Certificate",
  Permit: "Permit",
  PUC: "Pollution (PUC)",
  RoadTax: "Road Tax",
};

/** Worst first — expired, then expiring, then the ones nobody needs to act on. */
function docSort(d: DocRow): number {
  return { expired: 0, missing: 1, expiring: 2, valid: 3 }[d.state];
}
