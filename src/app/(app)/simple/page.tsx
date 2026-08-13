import { redirect } from "next/navigation";

/**
 * Moved to `/`.
 *
 * The "Owner View (Simple)" and the Dashboard answered the same question from
 * two menu entries. The Dashboard is now the single answer.
 *
 * Kept as a redirect rather than deleted so existing bookmarks, and any link
 * already sent to someone, still land somewhere useful.
 */
export default function MovedPage() {
  redirect("/");
}
