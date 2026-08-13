import { redirect } from "next/navigation";

/**
 * Moved to `/sites`.
 *
 * Sites & Operations — geofences, allocation and mobilisation — is now the Sites
 * module, where it sits beside the projects and work it belongs to.
 *
 * Kept as a redirect rather than deleted so existing bookmarks, and any link
 * already sent to someone, still land somewhere useful.
 */
export default function MovedPage() {
  redirect("/sites");
}
