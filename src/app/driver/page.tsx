import { redirect } from "next/navigation";

/**
 * The old driver portal, now replaced by `/my`.
 *
 * It is kept as a redirect rather than deleted because it is the address
 * installed on drivers' phones as a home-screen shortcut — removing it would
 * strand exactly the people least able to fix it themselves.
 *
 * It could not stay as a page. It sat outside the `(app)` group, so it never
 * passed through the layout that resolves permissions, and it opened with an
 * unscoped `db.asset.findMany()` — every vehicle in the company, served to
 * whoever held a session. `/my` scopes each query to the signed-in driver's own
 * record and shows an explicit empty state when that link is missing, rather
 * than falling back to the whole fleet.
 */
export default function LegacyDriverPortal() {
  redirect("/my");
}
