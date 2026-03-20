import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import ChunkLoadRecovery from "@/components/ChunkLoadRecovery";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://polyworld.app";

export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "PolyWorld — Prediction Market World Monitor",
  description:
    "Real-time world map showing Polymarket prediction markets by region. Track smart money, whale trades, and market signals before the news.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: "PolyWorld — Prediction Market World Monitor",
    description:
      "Real-time world map showing Polymarket prediction markets by region. Track smart money, whale trades, and market signals.",
    url: SITE_URL,
    siteName: "PolyWorld",
    type: "website",
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "PolyWorld — Prediction Market World Map" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PolyWorld — Prediction Market World Monitor",
    description:
      "Real-time world map of Polymarket prediction markets. Smart money tracking, whale alerts, and market signals.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    "color-scheme": "dark",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="dark"
      style={{ colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <ChunkLoadRecovery />
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
