/**
 * "My Trips" — a list, and nothing but a list.
 *
 * The office has a trips screen with GPS verification, tonnage and idle hours
 * on it. A driver checking whether yesterday's run was recorded needs three
 * things — the day, how far, how long — so that is all this shows. Anything
 * else on the screen is something to scroll past.
 */
import { requirePage } from "@/lib/access";
import { businessDay } from "@/lib/business-time";
import { fmtDate, num } from "@/lib/utils";
import { myBasics, myTrips, todaysTrips, type TripRow } from "../_data";
import { MyHeader, NotLinked, Screen, Fact, Group, Row, Nothing } from "../_ui";

export const dynamic = "force-dynamic";

export default async function MyTripsPage() {
  const access = await requirePage("my.trips");
  const { driver } = await myBasics(access);

  if (!driver) {
    return (
      <Screen>
        <MyHeader href="/my/trips" />
        <NotLinked loginName={access.session.name} />
      </Screen>
    );
  }

  const now = new Date();
  const trips = await myTrips(driver.id, 30);
  const today = todaysTrips(trips, now);
  const todayKm = today.reduce((s, t) => s + t.distanceKm, 0);
  const totalKm = trips.reduce((s, t) => s + t.distanceKm, 0);

  // Grouped by the day the trip started, in the business's timezone. A run that
  // begins at 01:00 IST belongs to that night's work, not to the previous UTC
  // day, and a driver comparing this screen with their own diary will notice.
  const days = new Map<string, TripRow[]>();
  for (const t of trips) {
    const key = businessDay(t.start);
    const list = days.get(key);
    if (list) list.push(t);
    else days.set(key, [t]);
  }

  return (
    <Screen>
      <MyHeader href="/my/trips" />

      <div className="grid grid-cols-2 gap-3">
        <Fact label="Trips today" value={String(today.length)} sub={`${Math.round(todayKm)} km`} />
        <Fact label="Last 30 trips" value={`${num(totalKm)} km`} sub="total distance" />
      </div>

      {trips.length === 0 && <Nothing>Abhi tak koi trip record nahi hua.</Nothing>}

      {[...days.entries()].map(([day, rows]) => (
        <Group key={day} title={dayHeading(day, now)}>
          {rows.map((t) => (
            <Row
              key={t.id}
              title={`${Math.round(t.distanceKm)} km`}
              subtitle={startedAt(t.start)}
              right={t.running ? "Running" : duration(t.hours)}
              rightSub={t.running ? "abhi chalu" : "on the road"}
              tone={t.running ? "ok" : undefined}
            />
          ))}
        </Group>
      ))}
    </Screen>
  );
}

/** "Today" and "Yesterday" beat a date a driver has to work out for themselves. */
function dayHeading(day: string, now: Date): string {
  const today = businessDay(now);
  const yesterday = businessDay(new Date(now.getTime() - 86400000));
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return fmtDate(new Date(`${day}T00:00:00Z`));
}

function startedAt(d: Date): string {
  return `Started ${d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true,
  })}`;
}

/**
 * Duration in hours and minutes. "2h 15m" is read at a glance; "2.25 hours"
 * has to be converted in the reader's head before it means anything.
 */
function duration(hours: number | null): string {
  if (hours == null) return "—";
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
