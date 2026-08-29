/**
 * The four specification cards on the vehicle page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A FUNCTION AND NOT FOUR LITERALS IN THE PAGE
 *
 * The design calls for an engine, a transmission, a rated payload and a tank
 * size. Exactly one of those — the tank — has anywhere to live in `Asset`
 * today. The other three would have to be typed into the page as constants,
 * and a constant in a page is the same figure for all fifty-three machines:
 * every excavator, tipper and road roller on the account would report a
 * Cummins ISBe 6.7L and a nine-speed gearbox.
 *
 * That is not a cosmetic problem. A spec sheet is quoted into tenders, ordered
 * against for parts, and used to argue an insurance claim. A wrong figure there
 * outlives the screen it was read from.
 *
 * So each card reports whether it actually knows the answer. A card that does
 * not is drawn as a prompt to record it, which is a true statement and an
 * actionable one. The four `RECORDED_*` branches below are where the real
 * columns plug in — the page does not change when they do.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What a vehicle record can currently tell us. */
export type SpecSource = {
  fuelCapacity: number;
  engineNo: string | null;
  chassisNo: string | null;
  make: string;
  model: string;
  yearMfg: number;
  /** Recorded per vehicle. Null until somebody enters it — never guessed. */
  engineModel?: string | null;
  enginePowerHp?: number | null;
  torqueNm?: number | null;
  transmission?: string | null;
  ladenWeightKg?: number | null;
  unladenWeightKg?: number | null;
  fuelType?: string | null;
};

export type SpecCard = {
  /** Card heading, as designed. */
  label: string;
  /** Lucide icon name, resolved by the page. */
  icon: "engine" | "transmission" | "payload" | "fuel";
  /** The headline value, or null when nothing has been recorded. */
  value: string | null;
  /** The line underneath. */
  sub: string;
};

/**
 * Tank size is the one spec this system has always held, so it is the one card
 * that can state a number. A capacity of zero is the schema default, not a
 * vehicle with no tank — treat it as unrecorded rather than printing "0 L".
 */
function fuelCard(s: SpecSource): SpecCard {
  const known = Number.isFinite(s.fuelCapacity) && s.fuelCapacity > 0;
  return {
    label: "FUEL CAPACITY",
    icon: "fuel",
    value: known ? `${Math.round(s.fuelCapacity)} Litres` : null,
    sub: known ? "Rated tank size on this vehicle" : "Tank size not recorded",
  };
}

export function specCards(s: SpecSource): SpecCard[] {
  return [
    {
      label: "ENGINE",
      icon: "engine",
      // The model when it is recorded; otherwise the serial stamped on the
      // block, clearly labelled as such. They are different claims and saying
      // which is which matters more than filling the space.
      value: s.engineModel ?? (s.engineNo ? `No. ${s.engineNo}` : null),
      sub: s.engineModel
        ? [
            s.enginePowerHp ? `${s.enginePowerHp} HP` : null,
            s.torqueNm ? `${s.torqueNm} Nm` : null,
            s.fuelType ?? null,
          ].filter(Boolean).join(" · ") || "Rating not recorded"
        : s.engineNo
          ? "Engine serial · model and rating not recorded"
          : "Engine details not recorded",
    },
    {
      label: "TRANSMISSION",
      icon: "transmission",
      value: s.transmission ?? null,
      sub: s.transmission ? "As recorded on the vehicle" : "Gearbox details not recorded",
    },
    {
      label: "PAYLOAD CAPACITY",
      icon: "payload",
      // Laden minus unladen is the load it may legally carry. Both are needed:
      // quoting gross weight as payload overstates it by the weight of the
      // truck, which is most of it.
      value: s.ladenWeightKg
        ? `${new Intl.NumberFormat("en-IN").format(s.ladenWeightKg)} kg GVW`
        : null,
      sub: s.ladenWeightKg && s.unladenWeightKg
        ? `${new Intl.NumberFormat("en-IN").format(s.ladenWeightKg - s.unladenWeightKg)} kg payload · ${new Intl.NumberFormat("en-IN").format(s.unladenWeightKg)} kg kerb`
        : s.ladenWeightKg
          ? "Kerb weight not recorded, so payload cannot be derived"
          : "Rated weight not recorded",
    },
    fuelCard(s),
  ];
}

/**
 * Distance the tank can still cover.
 *
 * Only answerable with both a live level and a measured efficiency. Returning
 * null rather than a guess is the point: a range figure is acted on — someone
 * decides whether to send a truck out — and one derived from an assumed km/L
 * is a decision made on a number nobody measured.
 */
export function estimatedRangeKm(
  fuelLevelPct: number | null,
  fuelCapacity: number,
  kmPerLitre: number | null,
): number | null {
  if (fuelLevelPct == null || !Number.isFinite(fuelLevelPct)) return null;
  if (!Number.isFinite(fuelCapacity) || fuelCapacity <= 0) return null;
  if (kmPerLitre == null || !Number.isFinite(kmPerLitre) || kmPerLitre <= 0) return null;
  const litresAboard = (fuelLevelPct / 100) * fuelCapacity;
  return Math.round(litresAboard * kmPerLitre);
}
