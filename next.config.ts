import type { NextConfig } from "next";
import path from "path";

/**
 * Production security headers.
 *
 * This app holds a client's commercial data — fuel spend, vendor invoices, staff
 * records — so the defaults matter. CSP allows inline styles (Tailwind needs
 * them) and blob/data images (the driver app's camera captures and Vercel Blob
 * uploads), but nothing else off-origin.
 */
const securityHeaders = [
  // Force HTTPS for two years, including subdomains.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Stop the app being framed — clickjacking protection for the approval buttons.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // Don't leak internal paths to third parties when a user follows a link out.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Geolocation and camera are needed by the driver app; everything else is off.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["lucide-react"],
  // PDFKit reads its font metrics (.afm) from disk at runtime, and ExcelJS
  // pulls in Node built-ins. Bundling either produces a build that compiles
  // cleanly and then fails on the first payroll download in production, which
  // is the worst place to find out. Left external so both resolve from
  // node_modules with their data files intact.
  serverExternalPackages: ["pdfkit", "exceljs"],
  // A driver may attach up to three optional refuelling verification images. The
  // wizard compresses each to at most 2 MB (6 MB total); leave room for multipart
  // boundaries while retaining a firm limit against oversized action bodies.
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
  turbopack: {
    root: path.join(__dirname),
  },
  allowedDevOrigins: ["*.loca.lt", "localhost:3000", "127.0.0.1:3000"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      { source: "/projects", destination: "/sites", permanent: true },
      { source: "/operations", destination: "/sites", permanent: true },
      { source: "/hire/invoices", destination: "/hire", permanent: true },
    ];
  },
};

export default nextConfig;
