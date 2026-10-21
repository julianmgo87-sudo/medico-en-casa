# Despliegue y credenciales pendientes

## 1. Supabase (producción)
1. Crear el proyecto (región São Paulo, la más cercana a Colombia).
2. Aplicar las migraciones, de una de dos formas:
   - **Sin compartir contraseñas:** SQL Editor → pegar `supabase/instalacion-produccion.sql` (todas las migraciones unidas; se regenera con `bash scripts/build-production-sql.sh`) → Run, una sola vez.
   - Con la CLI: `npx supabase link --project-ref xpvqihhkhricebrcgbti` y `npx supabase db push`.
3. Database → Extensions: verificar **pg_cron** (la migración 0011 programa el job; si no estaba habilitada, habilitarla y reejecutar 0011).
4. Auth → URL configuration: Site URL `https://<dominio>` y redirect `https://<dominio>/auth/callback`.
5. Auth → Email: activar "Confirm email". Configurar SMTP propio, porque el SMTP de Supabase tiene límites muy bajos.
6. Auth → plantillas de correo en español (confirmación, recuperación).
7. Crear el primer administrador (ver README).
8. Backups: activar PITR (plan Pro) o, como mínimo, los backups diarios; probar una restauración.

## 2. Vercel
- Importar el repositorio y configurar las variables de `.env.example` (Production).
- `vercel.json` incluye un cron diario de respaldo a `/api/cron/jobs`. Los vencimientos minuto a minuto los ejecuta **pg_cron** dentro de Supabase.
- **Envío de correos con frecuencia:** el webhook envía correos al instante. Para notificaciones creadas por pg_cron (vencimientos, recordatorios), programar cada 1–5 min una llamada a `GET /api/cron/notifications` con `Authorization: Bearer $CRON_SECRET`. Opciones: plan Pro de Vercel con cron por minuto, `pg_net` desde Supabase o un monitor externo.

## 3. Wompi
1. Crear la cuenta de comercio en comercios.wompi.co y **confirmar con Wompi que la actividad (intermediación de servicios de salud a domicilio) es aceptada** para su MCC.
2. Desarrolladores → copiar llave pública, llave privada, secreto de integridad y secreto de eventos (sandbox y luego producción).
3. URL de eventos: `https://<dominio>/api/webhooks/wompi`.
4. Habilitar los métodos de pago: tarjetas, PSE, Nequi y botón Bancolombia, según el contrato.
5. Probar en sandbox con las tarjetas y datos de prueba de Wompi antes de cambiar `WOMPI_ENV=production`.

## 4. Correo (Resend)
Verificar el dominio (SPF y DKIM) y configurar `RESEND_API_KEY` y `EMAIL_FROM`.

## Credenciales que faltan
| Variable | Para qué | Estado |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Base de datos, autenticación y archivos | Falta el proyecto de producción |
| `NEXT_PUBLIC_WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | Cobros y webhooks | Faltan |
| `RESEND_API_KEY`, `EMAIL_FROM` | Correos transaccionales | Faltan |
| `CRON_SECRET` | Proteger `/api/cron/*` | Generar un valor aleatorio |
| `NEXT_PUBLIC_APP_URL` | URLs absolutas (retorno de pago y correos) | Dominio pendiente |
| WhatsApp Business API / push | Notificaciones adicionales | No implementado (el canal existe en el modelo) |

Sin las llaves de Wompi, la aplicación **no permite pagar**: muestra un aviso y deshabilita los botones. Nunca simula un pago.
