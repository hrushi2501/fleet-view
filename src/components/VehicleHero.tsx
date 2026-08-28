import Image from "next/image";
import { Cog, CircleDot, Gauge } from "lucide-react";

/**
 * The vehicle page's opening band, built to the supplied design.
 *
 * Measurements are the design's own: a 425px band, the photograph bled to all
 * four edges, a four-stop navy gradient running left to right so the type sits
 * on solid colour while the machine stays readable, and the blue angle notched
 * into the bottom-right corner.
 *
 * The gradient is doing accessibility work, not decoration. White text over a
 * photograph is unreadable wherever the photograph happens to be bright; the
 * .96 opacity at the left edge means the headline is always on near-solid
 * navy regardless of which vehicle photo is loaded.
 */

export type HeroSpec = { label: string; value: string | null; icon: "engine" | "power" | "torque" };

const SPEC_ICON = {
  engine: Cog,
  power: CircleDot,
  torque: Gauge,
} as const;

export function VehicleHero({
  status,
  statusTone,
  titleTop,
  titleBottom,
  description,
  specs,
  image,
  compact = false,
}: {
  status: string;
  statusTone: "live" | "down" | "idle";
  titleTop: string;
  titleBottom: string;
  description: string;
  specs: HeroSpec[];
  /** Null when we have no photograph that is honestly this machine. */
  image: string | null;
  /** The floating card's version: same band, less of it. */
  compact?: boolean;
}) {
  const dot =
    statusTone === "live" ? "#23d17d" : statusTone === "down" ? "#f97066" : "#fdb022";

  return (
    <section
      className={
        "relative overflow-hidden bg-[#081b3a] text-white " +
        (compact ? "min-h-[196px]" : "min-h-[425px]")
      }
    >
      {/* A photograph only when it is actually this kind of machine. A stock
          tipper behind an excavator's name is a small lie that makes every
          other number on the page look decorative. Without one, the band keeps
          its shape and drops to plain navy. */}
      {image ? (
        <Image src={image} alt="" fill priority sizes="100vw" className="object-cover object-center" />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 140% at 85% 20%, #16346b 0%, #081b3a 60%)" }}
        />
      )}

      {/* The design's four-stop wash. Kept as an explicit gradient rather than
          a Tailwind two-stop, because the 30% and 55% stops are what keep the
          headline on solid colour without blacking out the machine. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(3,19,48,.96) 0%, rgba(3,19,48,.78) 30%, rgba(3,19,48,.18) 55%, rgba(3,19,48,.03) 100%)",
        }}
      />

      <div
        className={
          "relative z-[2] w-full sm:w-[60%] sm:min-w-[420px] lg:w-[47%] lg:min-w-[480px] " +
          (compact
            ? "px-6 py-6 lg:pl-8 lg:pr-0"
            : "px-7 pb-11 pt-14 lg:py-14 lg:pl-[58px] lg:pr-0")
        }
      >
        <div
          className="inline-flex items-center gap-[7px] rounded-lg border px-[13px] py-2 text-xs font-bold tracking-[.2px]"
          style={{ background: "rgba(9,43,91,.88)", borderColor: "rgba(83,142,255,.25)" }}
        >
          <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: dot }} />
          {status}
        </div>

        <h1
          className={
            "font-extrabold leading-[.98] tracking-[-1.5px] " +
            (compact
              ? "mb-2 mt-3 text-[28px]"
              : "mb-5 mt-[26px] text-[38px] tracking-[-2px] lg:text-[54px]")
          }
        >
          {titleTop}
          {compact ? " " : <br />}
          <span className="text-[#4c8dff]">{titleBottom}</span>
        </h1>

        {/* The short rule under the title, as in the design. */}
        <div className={"h-[3px] w-[62px] rounded-full bg-[#2f6df6] " + (compact ? "mb-4" : "mb-6")} />

        {!compact && (
          <p className="mb-[30px] max-w-[480px] text-[15px] leading-[1.6] text-[#f0f4fb] lg:text-base">
            {description}
          </p>
        )}

        <div className={"flex flex-wrap " + (compact ? "gap-x-7 gap-y-3" : "gap-x-10 gap-y-5")}>
          {specs.map((s) => {
            const Icon = SPEC_ICON[s.icon];
            return (
              <div key={s.label} className="flex items-start gap-2.5">
                <Icon className="h-[22px] w-[22px] shrink-0 text-[#9dbcf5]" strokeWidth={1.75} />
                <div>
                  <b className="mb-1 block text-[11px] font-bold tracking-[.6px] text-white">{s.label}</b>
                  {/* An unrecorded spec says so. The alternative is a plausible
                      figure that gets quoted into a tender. */}
                  <small className={s.value ? "text-xs text-[#dbe5f6]" : "text-xs italic text-[#8ba3cc]"}>
                    {s.value ?? "Not recorded"}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* The blue angle notched into the bottom-right corner. */}
      <div
        className={
          "absolute -bottom-px -right-px z-[3] hidden opacity-[.98] sm:block " +
          (compact ? "h-[48px] w-[110px]" : "h-[76px] w-[170px]")
        }
        style={{ background: "#2468ed", clipPath: "polygon(100% 0, 100% 100%, 0 100%, 35% 45%)" }}
        aria-hidden
      />
    </section>
  );
}
