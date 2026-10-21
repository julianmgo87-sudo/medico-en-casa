import { DashboardShell } from "@/components/DashboardShell";
import { requireRole } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Panel" },
  { href: "/admin/profesionales", label: "Verificación de profesionales" },
  { href: "/admin/pacientes", label: "Pacientes" },
  { href: "/admin/reservas", label: "Reservas" },
  { href: "/admin/pagos", label: "Pagos y reembolsos" },
  { href: "/admin/liquidaciones", label: "Liquidaciones" },
  { href: "/admin/precios", label: "Precios y recargos" },
  { href: "/admin/comisiones", label: "Comisiones" },
  { href: "/admin/membresias", label: "Membresías" },
  { href: "/admin/reportes", label: "Reportes financieros" },
  { href: "/admin/configuracion", label: "Configuración" },
  { href: "/admin/auditoria", label: "Auditoría" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin");
  return <DashboardShell title="Administración" nav={NAV}>{children}</DashboardShell>;
}
