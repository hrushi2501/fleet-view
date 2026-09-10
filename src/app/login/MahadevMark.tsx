/**
 * The Mahadev Constructions building mark.
 *
 * Drawn rather than loaded as an image so it stays crisp at every size, inherits
 * `currentColor`, and costs no extra request on the one screen every user sees
 * before anything else has loaded.
 */
export function MahadevMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className={className}>
      {/* Three ascending towers, tallest in the middle, as on the signage. */}
      <path d="M6 58V30l11-7v35z" fill="currentColor" opacity="0.75" />
      <path d="M22 58V14l11-8v52z" fill="currentColor" />
      <path d="M38 58V23l11 7v28z" fill="currentColor" opacity="0.75" />
      <path d="M51 58V33l7 5v20z" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Mark plus wordmark, the arrangement used on the sign-in screen. */
export function MahadevLogo({
  className,
  markClass = "h-12 w-12",
  align = "left",
}: {
  className?: string;
  markClass?: string;
  align?: "left" | "center";
}) {
  const centered = align === "center";
  return (
    <div className={`flex ${centered ? "flex-col items-center" : "items-center gap-4"} ${className ?? ""}`}>
      <MahadevMark className={`${markClass} text-gold-500`} />
      <div className={centered ? "mt-3 text-center" : ""}>
        <p className="text-xl font-semibold uppercase leading-none tracking-[0.18em] sm:text-2xl">
          Mahadev
        </p>
        <p className="mt-1.5 text-[10px] font-medium uppercase leading-none tracking-[0.38em] opacity-70">
          Constructions
        </p>
      </div>
    </div>
  );
}
