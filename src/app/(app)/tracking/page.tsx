import { redirect } from "next/navigation";

/**
 * Moved to `/fleet/tracking`.
 *
 * Live Tracking is now Vehicle Tracking inside Fleet — "gaadi kahan hai" is a
 * question about a vehicle, so it belongs with the vehicles.
 *
 * Kept as a redirect rather than deleted so existing bookmarks, and any link
 * already sent to someone, still land somewhere useful.
 */
export default function MovedPage() {
  redirect("/fleet/tracking");
}
