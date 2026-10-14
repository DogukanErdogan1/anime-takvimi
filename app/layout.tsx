import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anime Takvimi — Keşfet, takip et",
  description: "MyAnimeList sezon kataloğunu keşfet, kendi anime listeni oluştur ve hesabınla takip et.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
