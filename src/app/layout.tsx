import type { Metadata, Viewport } from "next"
import { Geist } from "next/font/google"
import Script from "next/script"
import "./globals.css"

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "PesoWise — Business Finance & Operations ERP",
  description: "Sales, logistics, inventory, ad spend, and bookkeeping in one ERP. Built for Philippine COD e-commerce sellers.",
  keywords: "business ERP, e-commerce, COD, logistics, inventory, bookkeeping, Philippines, peso",
  openGraph: {
    title: "PesoWise — Business Finance & Operations ERP",
    description: "Sales, logistics, inventory, and ad spend in one ERP for Filipino sellers",
    type: "website",
  },
  // Kinukuha ng Chrome/Edge ang mga ito para sa "Install app" (desktop + mobile).
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "PesoWise", statusBarStyle: "default" },
}

// Kulay ng title bar ng installed app at ng mobile browser chrome.
export const viewport: Viewport = { themeColor: "#16a34a" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID

  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <head>
        <meta charSet="utf-8" />
        {/* Inilalapat ang naka-save na tema BAGO ang unang paint. Kung sa React
            effect ito gagawin, kikislap ang puti bago magdilim sa bawat load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("pesowise_theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        {children}
        {pixelId && (
          <Script id="fb-pixel" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
              n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
              document,'script','https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${pixelId}');
              fbq('track', 'PageView');
            `}
          </Script>
        )}
      </body>
    </html>
  )
}
