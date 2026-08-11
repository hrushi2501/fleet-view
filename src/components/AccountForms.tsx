"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import { changeOwnPassword, adminResetUserPassword } from "@/app/(app)/entry-actions";

const inp = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export function ChangePasswordForm() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setErr(""); setDone(false);
    start(async () => {
      try { await changeOwnPassword(fd); setDone(true); form.reset(); }
      catch (e) { setErr(e instanceof Error ? e.message : "Could not change password."); }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Current password</label>
        <input name="current" type="password" required className={inp} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
        <input name="next" type="password" required minLength={6} placeholder="at least 6 characters" className={inp} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Confirm new password</label>
        <input name="confirm" type="password" required minLength={6} className={inp} />
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {done && <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Password changed successfully.</p>}
      <button disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Update password
      </button>
    </form>
  );
}

export function ResetPwButton({ userId, name }: { userId: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function go() {
    const pw = window.prompt(`Set a new password for ${name} (min 6 characters):`);
    if (!pw) return;
    start(async () => {
      try { await adminResetUserPassword(userId, pw); router.refresh(); alert("Password updated."); }
      catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    });
  }
  return (
    <button onClick={go} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} Reset PW
    </button>
  );
}
