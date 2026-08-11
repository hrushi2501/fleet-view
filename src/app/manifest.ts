import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FleetView ERP — Mahadev Constructions",
    short_name: "FleetView",
    description: "Vehicle & Fleet Management for Mahadev Constructions",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#1f47e6",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Android home-screen long-press quick actions
    shortcuts: [
      { name: "Add Diesel · डीज़ल भरें", short_name: "Diesel", url: "/driver?action=fuel", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Repair Photos · मरम्मत फोटो", short_name: "Repair", url: "/driver?action=repair", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
