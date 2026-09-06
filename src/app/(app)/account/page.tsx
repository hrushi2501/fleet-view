import { getSession, ROLE_LABEL } from "@/lib/auth";
import { Card, SectionTitle } from "@/components/ui";
import { ChangePasswordForm } from "@/components/AccountForms";
import { FileText, UserCircle } from "lucide-react";
import Link from "next/link";
import { requirePage } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  await requirePage(null);
  const user = await getSession();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">My Account</h1>
        <p className="text-sm text-slate-500">Manage your login &amp; password</p>
      </div>

      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500 text-white"><UserCircle className="h-7 w-7" /></div>
          <div>
            <p className="font-semibold text-ink-900">{user?.name}</p>
            <p className="text-sm text-slate-500">{user?.email} · {ROLE_LABEL[user?.role ?? ""] ?? user?.role}</p>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Change Password" subtitle="Use a strong password you don't use elsewhere" />
        <ChangePasswordForm />
      </Card>

      <Card>
        <Link href="/policies" className="flex min-h-12 items-center gap-3 rounded-xl -m-2 p-2 hover:bg-slate-50">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><FileText className="h-5 w-5" aria-hidden /></span>
          <span className="min-w-0 flex-1"><span className="block font-semibold text-ink-900">Policies &amp; privacy</span><span className="block text-sm text-slate-500">Mahadev FleetView rules and workforce data notice</span></span>
        </Link>
      </Card>
    </div>
  );
}
