import type { Metadata } from "next";
import { Notice } from "@/components/ui";
import { getPublicSettings } from "@/lib/data";

export const metadata: Metadata = { title: "Política de privacidad" };
export const dynamic = "force-dynamic";

export default async function PrivacidadPage() {
  const s = await getPublicSettings();
  const legal = (s.legal_entity ?? {}) as { name?: string; nit?: string; address?: string };
  const contact = (s.support_contact ?? {}) as { email?: string; phone?: string };
  const company = legal.name || "[RAZÓN SOCIAL PENDIENTE]";
  return (
    <article className="prose-legal mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Política de tratamiento de datos personales</h1>
      <Notice kind="warning" className="mt-4" title="Borrador para revisión legal">
        Debe revisarse con un abogado, completarse con los datos del responsable y registrarse en el RNBD de la SIC si aplica.
      </Notice>
      <h2>1. Responsable</h2>
      <p>{company}{legal.nit ? `, NIT ${legal.nit}` : ""}{legal.address ? `, ${legal.address}` : ""}. Contacto para asuntos de datos personales: {contact.email || "[CORREO PENDIENTE]"}.</p>
      <h2>2. Marco legal</h2>
      <p>Ley Estatutaria 1581 de 2012, Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y demás normas aplicables.</p>
      <h2>3. Datos que tratamos y finalidades</h2>
      <ul>
        <li><strong>Pacientes:</strong> nombre, correo, teléfono, direcciones de atención y, de forma opcional, un motivo breve de la visita. Finalidades: gestionar la cuenta, la membresía, las reservas, los pagos, las devoluciones, las notificaciones y la atención de PQRS.</li>
        <li><strong>Profesionales:</strong> identificación, datos profesionales y de RETHUS, títulos y certificaciones, fotografía, zonas de atención y datos bancarios. Finalidades: verificación, publicación del perfil (solo datos públicos), asignación de citas y liquidación de pagos.</li>
        <li><strong>Pagos:</strong> la plataforma no almacena números completos de tarjetas; los pagos se procesan a través de la pasarela.</li>
      </ul>
      <h2>4. Datos sensibles</h2>
      <p>Los datos relativos a la salud son sensibles. La plataforma recoge el mínimo necesario (motivo breve y opcional) y <strong>no gestiona historias clínicas</strong>; estas son responsabilidad del profesional o prestador que te atiende. No estás obligado a suministrar datos sensibles. Su tratamiento requiere tu autorización expresa, que otorgas al registrarte.</p>
      <h2>5. Acceso por parte de los profesionales</h2>
      <p>El profesional asignado solo accede a tu nombre, teléfono, dirección y motivo de la visita cuando la cita está confirmada y únicamente para prestar el servicio.</p>
      <h2>6. Encargados y transferencias</h2>
      <p>Utilizamos proveedores tecnológicos (alojamiento, base de datos, correo transaccional y pasarela de pagos) que pueden almacenar información fuera de Colombia, con garantías adecuadas de seguridad y confidencialidad.</p>
      <h2>7. Derechos del titular</h2>
      <p>Puedes conocer, actualizar, rectificar y solicitar la supresión de tus datos, revocar la autorización, solicitar prueba de ella, ser informado sobre el uso de tus datos y presentar quejas ante la Superintendencia de Industria y Comercio.</p>
      <h2>8. Procedimiento</h2>
      <p>Las consultas se atienden en máximo diez (10) días hábiles y los reclamos en máximo quince (15) días hábiles, prorrogables en los términos de la ley.</p>
      <h2>9. Seguridad</h2>
      <p>Aplicamos control de acceso por roles, cifrado en tránsito, políticas de seguridad a nivel de fila en la base de datos, almacenamiento privado de documentos y registros de auditoría.</p>
      <h2>10. Vigencia</h2>
      <p>Esta política rige desde su publicación. Los datos se conservarán mientras sean necesarios para las finalidades descritas y para cumplir obligaciones legales, contables y tributarias.</p>
    </article>
  );
}
