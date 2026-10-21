import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { getPublicSettings } from "@/lib/data";

export async function SiteFooter() {
  const settings = await getPublicSettings();
  const contact = (settings.support_contact ?? {}) as { email?: string; phone?: string; whatsapp?: string };
  const legal = (settings.legal_entity ?? {}) as { name?: string; nit?: string };
  return (
    <footer className="mt-20 border-t border-slate-100 bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2"><LogoMark className="h-8 w-8" /><span className="font-display font-extrabold">MÉDICO EN CASA PALMIRA</span></div>
          <p className="text-sm text-ink-soft">Plataforma que conecta pacientes con profesionales de la salud verificados que atienden a domicilio en Palmira, Valle del Cauca.</p>
        </div>
        <div>
          <p className="mb-3 text-sm font-bold">Plataforma</p>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li><Link href="/servicios" className="hover:text-brand-700">Servicios</Link></li>
            <li><Link href="/profesionales" className="hover:text-brand-700">Profesionales</Link></li>
            <li><Link href="/membresias" className="hover:text-brand-700">Membresías</Link></li>
            <li><Link href="/auth/registro-profesional" className="hover:text-brand-700">Soy profesional de la salud</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-bold">Legal</p>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li><Link href="/terminos" className="hover:text-brand-700">Términos y condiciones</Link></li>
            <li><Link href="/privacidad" className="hover:text-brand-700">Política de privacidad y tratamiento de datos</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-bold">Contacto</p>
          <ul className="space-y-2 text-sm text-ink-soft">
            {contact.email ? <li><a href={`mailto:${contact.email}`} className="hover:text-brand-700">{contact.email}</a></li> : null}
            {contact.phone ? <li><a href={`tel:${contact.phone}`} className="hover:text-brand-700">{contact.phone}</a></li> : null}
            {contact.whatsapp ? <li><a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`} className="hover:text-brand-700">WhatsApp</a></li> : null}
            {!contact.email && !contact.phone && !contact.whatsapp ? <li>Datos de contacto pendientes de configuración.</li> : null}
            <li className="pt-2 font-semibold text-red-700">Emergencias: línea 123</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200/70">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-ink-soft">
          © {new Date().getFullYear()} {legal.name || "Médico en Casa Palmira"}{legal.nit ? ` · NIT ${legal.nit}` : ""} · Palmira, Valle del Cauca, Colombia · Precios en pesos colombianos (COP).
        </p>
      </div>
    </footer>
  );
}
