# Lista de pendientes

Estado al 22/10/2026. La app está completa y probada en local. Lo que falta depende de cuentas, credenciales o decisiones del negocio.

## A. Puesta en línea (bloquea tener un enlace público)
- [ ] **Instalar la base de datos** en el proyecto Supabase `xpvqihhkhricebrcgbti`: SQL Editor → pegar `supabase/instalacion-produccion.sql` → Run (una sola vez).
- [ ] Supabase → Database → Extensions: confirmar que **pg_cron** está activo. Si no lo estaba, activarlo y volver a ejecutar el bloque final del archivo (migración 0011).
- [ ] Supabase → Authentication → URL Configuration: Site URL = dominio de Vercel; Redirect URL = `https://<dominio>/auth/callback`.
- [ ] Supabase → Authentication → Email Templates: copiar las plantillas de `supabase/templates/` (confirmación, recuperación, cambio de correo).
- [ ] Supabase → Authentication → SMTP: configurar un SMTP propio (el de Supabase permite muy pocos correos por hora).
- [ ] **Vercel**: importar el repositorio `julianmgo87-sudo/medico-en-casa` y cargar las variables de entorno (ver `.env.example`):
  - `NEXT_PUBLIC_SUPABASE_URL=https://xpvqihhkhricebrcgbti.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API)
  - `NEXT_PUBLIC_APP_URL` (dominio final) y `CRON_SECRET` (valor aleatorio)
- [ ] Fusionar el pull request #1 a `main` (Vercel despliega `main`).
- [ ] Crear el primer administrador: registrarse y luego `update public.users set role='admin' where email='…';` en el SQL Editor.

## B. Pagos (bloquea cobrar)
- [ ] Crear la cuenta de comercio en Wompi y **confirmar que aceptan la actividad** (intermediación de servicios de salud a domicilio).
- [ ] Cargar en Vercel `NEXT_PUBLIC_WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET` y `WOMPI_EVENTS_SECRET` (primero sandbox, `WOMPI_ENV=sandbox`).
- [ ] Wompi → URL de eventos: `https://<dominio>/api/webhooks/wompi`.
- [ ] Probar en sandbox: membresía, cita, pago rechazado, PSE pendiente y devolución.
- [ ] Pasar a producción (`WOMPI_ENV=production`, llaves de producción).

## C. Notificaciones
- [ ] Resend: verificar el dominio (SPF/DKIM) y cargar `RESEND_API_KEY` y `EMAIL_FROM`.
- [ ] Programar `GET /api/cron/notifications` cada 1–5 min con `Authorization: Bearer $CRON_SECRET` (Vercel Pro, pg_net o un monitor externo).
- [ ] (Futuro) WhatsApp Business API y notificaciones push: no implementados; el modelo de datos ya tiene el canal.

## D. Legal y regulatorio (bloquea atender pacientes reales)
- [ ] Definir el prestador responsable de cada servicio (profesional independiente o IPS) e inscripción en **REPS** con modalidad domiciliaria (Res. 3100 de 2019).
- [ ] Habilitar en Admin → Configuración solo las categorías verificadas (hoy todas están en "Próximamente").
- [ ] Revisión legal de Términos y Política de datos (`/terminos`, `/privacidad`); definir el porcentaje de cancelación tardía (hoy 50 %).
- [ ] Completar razón social, NIT, dirección y contactos en Admin → Configuración (`legal_entity`, `support_contact`).
- [ ] Facturación electrónica DIAN: quién factura consulta, comisión y membresía. Validar IVA con contador.
- [ ] Contratos con profesionales (independencia, recaudo por cuenta de terceros, tratamiento de datos).
- [ ] Registro de bases de datos ante la SIC (RNBD), si aplica.
- [ ] Pólizas de responsabilidad civil de los profesionales.

## E. Operación
- [ ] Revisar y ajustar zonas de Palmira y tarifas de desplazamiento (Admin → Configuración).
- [ ] Revisar recargos (nocturno 30 %, fin de semana 15 %, festivo 20 %, prioritaria 25 %) y comisión (20 %).
- [ ] Revisar los precios de membresía ($9.900 mensual, $99.000 anual).
- [ ] Vincular y aprobar los primeros profesionales reales (verificación RETHUS manual en SISPRO).
- [ ] Activar backups y PITR en Supabase y probar una restauración.

## F. Mejoras técnicas opcionales
- [ ] Automatizar las transferencias a profesionales (dispersión bancaria) en lugar del registro manual.
- [ ] Verificación RETHUS automática, si se obtiene acceso a un servicio oficial.
- [ ] Monitoreo de errores (p. ej. Sentry) y alertas de webhooks fallidos.
- [ ] Prueba de carga del flujo de reservas.
