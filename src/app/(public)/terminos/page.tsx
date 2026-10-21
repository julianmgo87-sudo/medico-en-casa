import type { Metadata } from "next";
import { Notice } from "@/components/ui";
import { getPublicSettings, settingNumber } from "@/lib/data";

export const metadata: Metadata = { title: "Términos y condiciones" };
export const dynamic = "force-dynamic";

export default async function TerminosPage() {
  const s = await getPublicSettings();
  const legal = (s.legal_entity ?? {}) as { name?: string; nit?: string; address?: string };
  const freeH = settingNumber(s, "free_cancellation_hours", 24);
  const latePct = settingNumber(s, "late_cancellation_refund_percent", 50);
  const tSched = settingNumber(s, "response_timeout_scheduled_min", 30);
  const tPrio = settingNumber(s, "response_timeout_priority_min", 15);
  const company = legal.name || "[RAZÓN SOCIAL PENDIENTE]";
  return (
    <article className="prose-legal mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Términos y condiciones de uso</h1>
      <Notice kind="warning" className="mt-4" title="Borrador para revisión legal">
        Este documento es una base de trabajo y debe ser revisado por un abogado en Colombia antes de operar con pacientes reales.
      </Notice>
      <h2>1. Quiénes somos</h2>
      <p>{company}{legal.nit ? `, NIT ${legal.nit}` : ""}{legal.address ? `, domiciliada en ${legal.address}` : ""} (en adelante, “Médico en Casa Palmira” o “la plataforma”) opera un servicio digital que conecta pacientes con profesionales de la salud independientes o prestadores que ofrecen atención domiciliaria en Palmira, Valle del Cauca.</p>
      <h2>2. Naturaleza del servicio</h2>
      <p>La plataforma facilita la búsqueda, reserva, pago y seguimiento de citas. La atención en salud es prestada por el profesional o prestador asignado, quien es responsable del acto profesional, de la historia clínica y del cumplimiento de los requisitos de habilitación que le correspondan. La plataforma verifica documentación y registro en RETHUS antes de publicar un perfil, pero dicha verificación no sustituye el juicio clínico del profesional.</p>
      <h2>3. No es un servicio de urgencias</h2>
      <p>La plataforma <strong>no atiende emergencias vitales</strong>. La “atención prioritaria a domicilio” es una visita agendada lo antes posible según disponibilidad, no un servicio de urgencias ni de traslado asistencial. Ante una emergencia llama a la línea 123 o acude al servicio de urgencias más cercano.</p>
      <h2>4. Cuentas y membresía</h2>
      <p>Para solicitar citas debes tener una cuenta y una membresía activa, salvo que la plataforma habilite otra modalidad. La membresía da acceso al sistema de reservas durante su vigencia y <strong>no incluye el valor de las consultas</strong>. Su precio y vigencia se informan antes del pago.</p>
      <h2>5. Precios y pago</h2>
      <ul>
        <li>Antes de pagar verás el precio total con su desglose: tarifa base, recargos (nocturno, fin de semana, festivo, atención prioritaria), desplazamiento, cargos y descuentos.</li>
        <li>Pagas el 100 % del valor a Médico en Casa Palmira a través de la pasarela de pagos. Los profesionales no deben cobrarte directamente por servicios reservados en la plataforma.</li>
        <li>El precio de una cita queda fijo al momento de la reserva; cambios posteriores de tarifas no la afectan.</li>
      </ul>
      <h2>6. Aceptación por parte del profesional</h2>
      <p>El pago <strong>no garantiza la aceptación inmediata</strong>. El profesional tiene {tSched} minutos (consulta programada) o {tPrio} minutos (atención prioritaria) para aceptar. Si rechaza o no responde, podrás elegir otro profesional disponible —con tu aprobación expresa si el valor cambia— o recibir la devolución completa del valor de la consulta.</p>
      <h2>7. Cancelaciones, reprogramaciones y devoluciones</h2>
      <ul>
        <li>Si cancelas antes de que el profesional acepte, la devolución es del 100 %.</li>
        <li>Si la cita está confirmada y cancelas o reprogramas con al menos {freeH} horas de anticipación, la devolución es del 100 %.</li>
        <li>Si cancelas una cita confirmada con menos de {freeH} horas de anticipación, se devolverá el {latePct} % del valor pagado.</li>
        <li>Si el servicio no se presta por causas atribuibles al profesional o a la plataforma, la devolución es del 100 %.</li>
        <li>Las devoluciones se realizan al medio de pago o por transferencia, y se notifican con su comprobante. Los tiempos de abono dependen de la entidad financiera.</li>
      </ul>
      <p>Lo anterior no limita los derechos que te reconoce el Estatuto del Consumidor (Ley 1480 de 2011), incluido el derecho de retracto cuando sea aplicable.</p>
      <h2>8. Calificaciones y conducta</h2>
      <p>Puedes calificar los servicios completados. Las opiniones deben ser veraces y respetuosas; la plataforma puede ocultar contenido ofensivo o que exponga datos personales.</p>
      <h2>9. Peticiones, quejas, reclamos y disputas</h2>
      <p>Puedes abrir una disputa desde el detalle de la cita o escribir a los canales de soporte. Las responderemos en los términos de ley.</p>
      <h2>10. Ley aplicable</h2>
      <p>Estos términos se rigen por las leyes de la República de Colombia.</p>
    </article>
  );
}
