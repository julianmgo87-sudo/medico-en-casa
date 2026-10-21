# Cumplimiento normativo: pendientes antes de operar con pacientes reales

> Este documento identifica riesgos y tareas. No es asesoría legal: valídalo con un abogado y un consultor en habilitación de servicios de salud en Colombia.

## Ya incorporado en el sistema
- **Ley 1581 de 2012:** autorización previa, expresa e informada (con mención de datos sensibles) obligatoria al registrarse, con fecha guardada (`data_consent_at`). Hay un borrador de política de tratamiento y se recolecta el mínimo de datos: no se gestionan historias clínicas, solo un motivo breve y opcional.
- **Acceso mínimo:** el profesional solo ve los datos del paciente necesarios y únicamente mientras la cita está confirmada.
- **Verificación profesional:** documentos revisados por el administrador, verificación manual en RETHUS obligatoria (configurable) antes de aprobar, y cambios sensibles bloqueados tras la aprobación.
- **Habilitación por servicio:** ninguna categoría es reservable hasta que el administrador registre la verificación regulatoria. Las 4 categorías iniciales están en "Próximamente". Odontología lleva una advertencia explícita sobre procedimientos no aptos para domicilio.
- **Emergencias:** aviso permanente de la línea 123. La atención prioritaria se presenta como visita agendada, nunca como urgencia.
- **Consumidor (Ley 1480 de 2011):** precio total antes de pagar, políticas de cancelación y devolución visibles, comprobantes y canal de reclamos (disputas).

## Pendiente (bloquea el lanzamiento)
1. **Definir el prestador responsable** de cada servicio: profesional independiente inscrito en REPS o IPS aliada. Verificar que tenga habilitada la **modalidad domiciliaria** (Resolución 3100 de 2019) para cada servicio ofrecido.
2. **Rol jurídico de la plataforma:** el recaudo del 100 % por cuenta de terceros puede implicar obligaciones como mandatario o agente de recaudo. Definir contratos con profesionales (independencia, responsabilidad, tratamiento de datos como encargado) y revisar su tratamiento tributario.
3. **Facturación electrónica (DIAN):** definir quién factura la consulta (profesional o IPS) y quién la comisión y la membresía. El comprobante de la app no es factura.
4. **Historia clínica:** asegurar que cada prestador lleve la suya (Res. 1995 de 1999, Ley 2015 de 2020); la plataforma no la custodia.
5. **Pólizas** de responsabilidad civil profesional vigentes (registrables como credencial).
6. **Registro de bases de datos (RNBD) ante la SIC**, si aplica según activos o naturaleza; designar al oficial de protección de datos y definir el procedimiento de consultas y reclamos.
7. **Términos y políticas definitivas:** completar razón social, NIT, domicilio y contactos (Configuración → `legal_entity`, `support_contact`) y revisar los porcentajes de cancelación tardía.
8. **Transferencia internacional de datos** (Supabase, Vercel, Resend): documentarla en la política.
9. **Verificación RETHUS:** hoy es manual (enlace a SISPRO). Se puede automatizar si se obtiene acceso a un servicio oficial.
