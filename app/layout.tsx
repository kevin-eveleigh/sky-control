import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PROJECT } from "@/lib/project";

export const metadata: Metadata = {
  title: PROJECT.name,
  description: "Unofficial, local-first control for air conditioners using the SWM100 protocol.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: PROJECT.name,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#071310",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
