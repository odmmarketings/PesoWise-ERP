import type { MetadataRoute } from "next"

// PWA manifest — ito ang nagpapa-"Install app" sa Chrome/Edge (desktop at mobile)
// kaysa sa payak na "Create shortcut" na walang tamang icon.
//
// `start_url: "/business/dashboard"` — sadya: kapag binuksan ang installed app,
// diretso na sa ERP. Kung hindi pa naka-login, ang middleware ang magpapadala sa
// /login, kaya walang mawawala.
//
// `display: "standalone"` — walang address bar, mukhang tunay na desktop app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PesoWise — Business Finance & Operations ERP",
    short_name: "PesoWise",
    description: "Sales, logistics, inventory, ad spend, and bookkeeping in one ERP. Built for Philippine COD e-commerce sellers.",
    start_url: "/business/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#16a34a",
    orientation: "any",
    lang: "en",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable = may padding, para hindi maputol ang "P" sa round/squircle masks
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
