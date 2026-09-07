import type { Metadata, Viewport } from "next";
// Leaflet maps are loaded with `next/dynamic({ ssr: false })`. Its stylesheet
// must not be imported by those dynamically mounted components: on route
// changes React 19 can dispose the generated `<link>` after Leaflet has already
// detached it, producing `finishedRoot.parentNode.removeChild`. Load it once
// from the root layout so Next owns one persistent stylesheet resource.
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { PWARegister } from "@/components/PWARegister";

export const metadata: Metadata = {
  title: "FleetView ERP — Mahadev Constructions",
  description: "Vehicle & Fleet Management ERP for Road Construction & Infrastructure",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "FleetView" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#1f47e6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
