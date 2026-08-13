import { redirect } from "next/navigation";

/**
 * Moved to `/my`.
 *
 * Duty check-in is part of a driver's day, not a destination of its own, so it
 * lives inside the driver app alongside their vehicle, trips and documents.
 *
 * Kept as a redirect because this address was linked from the old attendance
 * screen and may be saved on a driver's phone.
 */
export default function MovedCheckInPage() {
  redirect("/my");
}
