import type { Metadata, Viewport } from "next";
import "./globals.css";
import "../public/site/schedule-map.css";
import "../public/site/season-library.css";
import "../components/experience/experience.css";
import ThemePreference from '@/components/experience/theme-preference';

export const metadata: Metadata = {
  title: "Anime Takvimi — Keşfet, takip et",
  description: "MyAnimeList sezon kataloğunu keşfet, kendi anime listeni oluştur ve hesabınla takip et.",
  manifest: '/manifest.webmanifest',
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: '/icon-192.png',
  },
};
export const viewport: Viewport = {width:'device-width',initialScale:1,themeColor:'#142b39'};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body><ThemePreference/>{children}</body>
    </html>
  );
}
