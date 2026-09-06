import { getSession, ROLE_LABEL } from "@/lib/auth";
import { Card, SectionTitle } from "@/components/ui";
import { ChangePasswordForm } from "@/components/AccountForms";
import { UserCircle } from "lucide-react";
import { requirePage } from "@/lib/access";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  await requirePage(null);
  const user = await getSession();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="My Account" /></h1>
        <p className="text-sm text-slate-500"><Txt text="Manage your login &amp; password" /></p>
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
    </div>
  );
}