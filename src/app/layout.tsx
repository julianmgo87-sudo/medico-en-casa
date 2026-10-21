import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "Médico en Casa Palmira — Tu salud, en la comodidad de tu hogar", template: "%s · Médico en Casa Palmira" },
  description: "Agenda atención a domicilio con profesionales de la salud verificados en Palmira, Valle del Cauca: medicina general, fisioterapia, enfermería y más.",
  applicationName: "Médico en Casa Palmira",
  appleWebApp: { capable: true, title: "Médico en Casa", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#1648d0", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
