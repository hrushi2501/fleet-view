"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Loader2 } from "lucide-react";

/**
 * DriverCheckInWizard — Legacy component.
 *
 * Driver duty check-in, QR cabin scanning, and live trip binding are now
 * unified under `/my` using `DriverQrScanner` and `DriverQuickHub`.
 * This component automatically redirects to `/my`.
 */
export function DriverCheckInWizard() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/my");
  }, [router]);

  return (
    <Card className="p-8 text-center my-8 max-w-md mx-auto">
      <Loader2 className="h-8 w-8 animate-spin mx-auto text-brand-600 mb-3" />
      <p className="text-base font-bold text-slate-800">Redirecting to Driver Hub...</p>
      <p className="text-xs text-slate-500 mt-1">Opening your personal mobile driver workspace at /my</p>
    </Card>
  );
}
