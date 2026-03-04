import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PolyWorld - Prediction Market World Monitor",
  description:
    "Real-time world map showing Polymarket prediction market events by region. Spot market signals before the news.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
