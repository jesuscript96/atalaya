import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const display = Archivo({ variable: "--f-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const body = IBM_Plex_Sans({ variable: "--f-body", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--f-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Atalaya", template: "%s · Atalaya" },
  description: "Control de avance de obra sobre plano, certificaciones e informes",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#14202a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
