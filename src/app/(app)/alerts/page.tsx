import { redirect } from "next/navigation";

/**
 * Moved to `/`.
 *
 * Alerts are what a dashboard is for. They are shown on the Dashboard rather
 * than behind a separate link nobody opened.
 *
 * Kept as a redirect rather than deleted so existing bookmarks, and any link
 * already sent to someone, still land somewhere useful.
 */
export default function MovedPage() {
  redirect("/");
}
