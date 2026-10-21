import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Médico en Casa Palmira",
    short_name: "Médico en Casa",
    description: "Atención en salud a domicilio en Palmira, Valle del Cauca.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1648d0",
    lang: "es-CO",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
