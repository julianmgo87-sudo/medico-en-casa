import { DashboardShell } from "@/components/DashboardShell";
import { requireRole } from "@/lib/auth";

const NAV = [
  { href: "/profesional", label: "Solicitudes" },
  { href: "/profesional/citas", label: "Mis citas" },
  { href: "/profesional/agenda", label: "Agenda y disponibilidad" },
  { href: "/profesional/ganancias", label: "Ganancias y liquidaciones" },
  { href: "/profesional/perfil", label: "Perfil y documentos" },
];

export default async function ProfessionalLayout({ children }: { children: React.ReactNode }) {
  await requireRole("professional");
  return <DashboardShell title="Profesional" nav={NAV}>{children}</DashboardShell>;
}
