/**
 * What the screen shows between clicking a link and the page arriving.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS THE SINGLE BIGGEST SPEED CHANGE IN THE APP
 *
 * Almost every page here is a server component that reads the database on each
 * request. When somebody clicks "Fuel", the browser asks the server to render
 * it and then — with no `loading` boundary — simply keeps showing the *old*
 * page until the answer comes back. Nothing moves. No spinner, no skeleton, not
 * even the heading changing.
 *
 * Half a second of that reads as a fast app. A second and a half reads as a
 * broken one, and people click again, which starts a second render and makes it
 * worse. The server was never the problem: measured from a browser, these pages
 * answer in 200–500 ms. The problem was that the interface said nothing while
 * they did.
 *
 * Next uses the nearest `loading.tsx` up the tree, so this one file covers every
 * screen in the app group that has not written its own. Sixty-eight of the
 * seventy pages had none.
 *
 * The shapes below deliberately match the real furniture — a heading, a row of
 * stat tiles, two panels, a table — so the skeleton settles into the page
 * instead of being replaced by something a different size.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      {/* heading */}
      <div className="space-y-2.5">
        <div className="h-7 w-56 rounded-lg bg-slate-200/90" />
        <div className="h-4 w-80 rounded-md bg-slate-200/60" />
      </div>

      {/* the row of figures most screens open with */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-[13px] border border-[#e9eef5] bg-white p-5">
            <div className="h-3 w-20 rounded bg-slate-200/80" />
            <div className="mt-3 h-7 w-24 rounded-md bg-slate-200/90" />
            <div className="mt-2 h-3 w-16 rounded bg-slate-200/50" />
          </div>
        ))}
      </div>

      {/* two panels side by side */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[13px] border border-[#e9eef5] bg-white p-5 lg:col-span-2">
          <div className="h-3 w-32 rounded bg-slate-200/80" />
          <div className="mt-5 h-56 rounded-lg bg-slate-100/80" />
        </div>
        <div className="rounded-[13px] border border-[#e9eef5] bg-white p-5">
          <div className="h-3 w-24 rounded bg-slate-200/80" />
          <div className="mt-5 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-slate-200/70" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-slate-200/80" />
                  <div className="h-2.5 w-1/2 rounded bg-slate-200/50" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* a table */}
      <div className="rounded-[13px] border border-[#e9eef5] bg-white p-5">
        <div className="h-3 w-40 rounded bg-slate-200/80" />
        <div className="mt-5 space-y-3.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-5 gap-4">
              {[0, 1, 2, 3, 4].map((j) => (
                <div key={j} className="h-3 rounded bg-slate-200/60" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
