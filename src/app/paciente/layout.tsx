import { DashboardShell } from "@/components/DashboardShell";
import { requireRole } from "@/lib/auth";

const NAV = [
  { href: "/paciente", label: "Inicio" },
  { href: "/reservar", label: "Agendar cita" },
  { href: "/paciente/citas", label: "Mis citas" },
  { href: "/paciente/pagos", label: "Pagos y comprobantes" },
  { href: "/membresias", label: "Membresía" },
  { href: "/paciente/perfil", label: "Perfil y direcciones" },
];

export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  await requireRole("patient");
  return <DashboardShell title="Paciente" nav={NAV}>{children}</DashboardShell>;
}
