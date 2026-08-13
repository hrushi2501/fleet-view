import { redirect } from "next/navigation";

/** Moved under `/fuel/problems`. Redirects the individual record to its new home. */
export default async function MovedDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/fuel/problems/${id}`);
}
