/**
 * Which photograph illustrates a given machine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT JUST A CLASS LOOKUP
 *
 * A class lookup would put the same SUV behind a Fortuner, a Scorpio, a KIA and
 * a Bolero. The register names the model, so where a photograph of that actual
 * model exists it is used, and the class picture is only the fallback.
 *
 * The rule underneath is the one that matters: a photograph is a claim about
 * what the machine *is*. An earlier version handed a Tata tipper to every class
 * with wheels, so seven staff SUVs and two water tankers opened onto a picture
 * of a completely different vehicle above their own registration number. A class
 * with no honest picture returns null and the page draws its plain navy band —
 * which says nothing, and is therefore better than saying something false.
 *
 * These are representative photographs of the model, not photographs of the
 * specific vehicle. When per-vehicle photos exist, an `Asset.heroImageUrl` takes
 * precedence over everything here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const P = (n: string) => `/vehicles/${n}.jpg`;

/**
 * Model text to photograph, most specific first.
 *
 * Ordered: "GRADER TRACTOR" must be tested before "TRACTOR", and the Tata
 * Hitachi before the generic excavator, or the general rule swallows the
 * specific one.
 */
const BY_MODEL: [RegExp, string][] = [
  // Staff and site vehicles — each of these is a distinct, recognisable model.
  [/fortuner/i, P("suv-fortuner")],
  [/scorpio/i, P("suv-scorpio")],
  [/\bkia\b/i, P("suv-kia")],
  [/endeavour|ford/i, P("suv-endeavour")],
  [/pik\s*up|pick\s*up/i, P("pickup-bolero")],
  [/bolero/i, P("suv-bolero")],
  [/scooter|activa/i, P("scooter-activa")],
  [/hf\s*deluxe|honda|bike/i, P("bike-hero")],

  // Plant. The WMM and the asphalt batch mix are different machines.
  // No photograph of a crusher was supplied, and an asphalt batch mix plant is
  // a visibly different machine. Null here, so the page draws its navy band
  // rather than captioning the wrong plant with this one's name.
  [/crusher/i, ""],
  [/wmm|wet\s*mix|macadam/i, P("plant-wmm")],
  [/asphalt|batch\s*mix|bathing|batching|concrete/i, P("plant-asphalt")],

  // Earthmoving.
  [/hitachi|ex\s*200/i, P("excavator-hitachi")],
  [/j215|jcb\s*215|xcmg/i, P("excavator-jcb")],
  [/excavator/i, P("excavator-volvo")],
  [/3dx/i, P("backhoe-jcb3dx")],
  [/436zx|437zx|loader/i, P("loader-jcb")],
  [/grader/i, P("grader-jcb")],
  [/\bvmt\b|vm\s*116/i, P("roller-jcb")],
  [/sd110|roller|compactor/i, P("roller-volvo")],
  [/swaraj|tractor/i, P("tractor-swaraj")],
  [/new\s*holland/i, P("tractor-newholland")],

  // Bodied trucks.
  [/tankaer|tankar|tanker/i, P("water-tanker")],
  [/mixer|transit/i, P("transit-mixer")],
  [/crane|hyva/i, P("crane")],
  [/lpk|912/i, P("truck-haul")],
];

/** The picture for a class when the model tells us nothing more specific. */
const BY_CLASS: Record<string, string> = {
  TRUCK: P("truck-tipper"),
  TIPPER: P("truck-tipper"),
  DUMPER: P("truck-tipper-alt"),
  WATER_TANKER: P("water-tanker"),
  TRANSIT_MIXER: P("transit-mixer"),
  CRANE: P("crane"),
  BACKHOE: P("backhoe-jcb3dx"),
  EXCAVATOR: P("excavator-volvo"),
  ROLLER: P("roller-volvo"),
  GRADER: P("grader-jcb"),
  TRACTOR: P("tractor-swaraj"),
  PLANT: P("plant-asphalt"),
  BIKE: P("bike-hero"),
  PICKUP: P("suv-bolero"),
  CAR: P("suv-bolero"),
};

/**
 * @param heroImageUrl a photograph of this exact vehicle, when one has been
 *        uploaded. Always wins — it is the only one that is actually this
 *        machine rather than one like it.
 */
export function vehiclePhoto(
  assetClass: string,
  model?: string | null,
  heroImageUrl?: string | null,
): string | null {
  if (heroImageUrl) return heroImageUrl;
  if (model) {
    for (const [re, src] of BY_MODEL) {
      // An empty string is a deliberate "we have no honest picture of this" —
      // it stops the class fallback rather than falling through to it.
      if (re.test(model)) return src || null;
    }
  }
  return BY_CLASS[assetClass] ?? null;
}

/** True when the picture is of the model rather than of this exact vehicle. */
export const isRepresentative = (heroImageUrl?: string | null) => !heroImageUrl;
