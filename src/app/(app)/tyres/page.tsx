import { redirect } from "next/navigation";

/**
 * Moved to `/maintenance/tyres` by the module restructure.
 *
 * Kept as a redirect so bookmarks, links already shared with the team and any
 * shortcut saved on a phone still land on the page that replaced this one,
 * rather than on a 404.
 */
export default function MovedPage() {
  redirect("/maintenance/tyres");
}
