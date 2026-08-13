"use server";

/**
 * The one thing a driver can write from this app besides a fuel entry: telling
 * the workshop something is wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ACTION RE-CHECKS EVERYTHING THE PAGE ALREADY CHECKED
 *
 * A server action is a public endpoint. The page that renders the form guards
 * itself with `requirePage`, but nothing stops a request being posted straight
 * at this function with somebody else's `assetId` in the body. So the ownership
 * of the vehicle is proven here, from the caller's session, and the id in the
 * form is treated as a claim to verify rather than as an instruction.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePage, canSeeAsset } from "@/lib/access";
// A "use server" module may only export async functions, so the list of
// problems a driver can pick from lives with the rest of the driver app's data.
import { PROBLEM_KINDS } from "./_data";

export async function reportProblem(fd: FormData) {
  const access = await requirePage("my.vehicle");

  // No person record means no vehicle of their own, so there is nothing this
  // action could legitimately be reporting against.
  if (!access.driverId) redirect("/my");

  const assetId = String(fd.get("assetId") ?? "").trim();
  const kind = String(fd.get("kind") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  const stopped = fd.get("stopped") === "on";

  const chosen = PROBLEM_KINDS.find((p) => p.value === kind);
  if (!assetId || !chosen) redirect("/my/vehicle?error=1");

  // The claim in the form body, checked against what this session may see.
  if (!(await canSeeAsset(access, assetId))) redirect("/my");

  const driver = await db.driver.findUnique({
    where: { id: access.driverId },
    select: { name: true, phone: true },
  });

  // A stuck vehicle is a breakdown and goes to the top of the workshop's list;
  // anything the driver can still drive on is a repair. The driver's own words
  // are kept verbatim — a summary written by the software loses the detail the
  // fitter actually needs.
  const blocking = stopped || chosen.blocking;
  const description = [
    chosen.label,
    stopped ? "Vehicle chal nahi rahi." : null,
    note || null,
    driver ? `Reported by ${driver.name}${driver.phone ? ` (${driver.phone})` : ""} from the driver app.` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  await db.workOrder.create({
    data: {
      // Date plus randomness rather than a counter: two drivers reporting in the
      // same second must not collide on a unique column.
      woNo: `DR-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase(),
      assetId,
      type: stopped ? "BREAKDOWN" : "REPAIR",
      priority: stopped ? "Critical" : blocking ? "High" : "Medium",
      status: "Open",
      description,
      reportedAt: new Date(),
    },
  });

  revalidatePath("/my");
  revalidatePath("/my/vehicle");
  revalidatePath("/my/service");
  // The workshop's own screens are what make this report worth filing.
  revalidatePath("/maintenance");

  redirect("/my/service?reported=1");
}
