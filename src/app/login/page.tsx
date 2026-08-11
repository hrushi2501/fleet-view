import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // If a *valid* session exists, skip the login screen. A present-but-invalid
  // cookie (e.g. after a reseed) falls through and the form is shown — no loop.
  const session = await getSession();
  if (session) redirect("/");
  return <LoginForm />;
}
