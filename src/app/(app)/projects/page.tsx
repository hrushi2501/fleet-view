import { redirect } from "next/navigation";

/**
 * Moved to `/sites`.
 *
 * Projects were a separate menu entry describing the same places as Sites.
 * Both now live in the Sites module.
 *
 * Kept as a redirect rather than deleted so existing bookmarks, and any link
 * already sent to someone, still land somewhere useful.
 */
export default function MovedPage() {
  redirect("/sites");
}
