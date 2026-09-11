import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { ToastProvider } from "@/components/Toast";
import { getAccess } from "@/lib/access";
import { navFor } from "@/lib/navigation";
import { redirect } from "next/navigation";
import { getLang } from "@/lib/lang-server";
import { isLang } from "@/lib/i18n";
import { LanguageProvider } from "@/components/LanguageProvider";
import { QueryProvider } from "@/components/QueryProvider";
import { quickActionsFor } from "@/lib/quick-actions";

/**
 * Resolves who the caller is once, and hands the navigation their own menu.
 *
 * The menu is computed on the server from the same `Access` the page guards
 * use, so it can only ever offer what the server would allow. It is a
 * convenience, not the control: every page underneath calls `requirePage`
 * for itself, because a menu that omits a link does nothing to stop someone
 * typing the URL.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  if (!access) redirect("/login");

  const items = navFor(access);
  const isDriver = access.group === "DRIVER";

  // Resolved once here and handed down, so thirty client components do not each
  // need their own lookup.
  // `getAccess` already reads this user's record. Reuse the language selected
  // in that query instead of issuing a second user lookup on every navigation.
  // The cookie-backed helper remains the safe fallback for legacy/invalid data.
  const lang = isLang(access.language) ? access.language : await getLang();

  return (
    <LanguageProvider lang={lang}>
      <QueryProvider key={JSON.stringify([access.session.id, access.driverId, access.projectIds, access.codes])}>
        <ToastProvider>
      <div className="min-h-screen">
        <Sidebar items={items} isDriver={isDriver} />
        <div className={isDriver ? "" : "lg:pl-64"}>
          <Topbar
            user={access.session}
            notificationLogHref={access.can("reports.view") ? "/reports/notifications" : null}
            quickActions={quickActionsFor(access)}
            isDriver={isDriver}
          />
          <main className={isDriver ? "mx-auto max-w-xl px-4 py-4 pb-24" : "mx-auto max-w-[1500px] px-4 py-6 lg:px-8"}>{children}</main>
        </div>
      </div>
        </ToastProvider>
      </QueryProvider>
    </LanguageProvider>
  );
}
