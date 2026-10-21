# Médico en Casa Palmira

Plataforma web (PWA) que conecta pacientes con profesionales de la salud verificados que atienden a domicilio en Palmira, Valle del Cauca. Interfaz en español, montos en COP y zona horaria America/Bogota.

**Flujo implementado y probado de punta a punta:**
Registro → Membresía → Selección de profesional → Reserva → Pago del 100 % → Aceptación del profesional → Consulta completada → Comisión → Liquidación al profesional.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend y servidor | Next.js 15 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS |
| Base de datos | PostgreSQL en Supabase, con RLS, restricciones de exclusión y funciones transaccionales |
| Autenticación | Supabase Auth (correo y contraseña, confirmación de correo, recuperación) |
| Archivos | Supabase Storage (fotos públicas; documentos y comprobantes privados) |
| Pagos | Wompi (Web Checkout + webhooks firmados) |
| Correo | Resend (bandeja de salida en la base de datos) |
| Procesos automáticos | pg_cron (cada minuto) + respaldo HTTP `/api/cron/jobs` |
| Hosting | Vercel |

## Puesta en marcha local

```bash
npm install
npx supabase start             # requiere Docker; aplica supabase/migrations
cp .env.example .env.local     # completar con las llaves que imprime `supabase start`
npm run build && npm start     # o npm run dev
```

**Primer administrador.** Por seguridad, el registro nunca crea administradores. Regístrate como paciente, confirma el correo (en local: Mailpit en http://127.0.0.1:54324) y ejecuta:

```sql
update public.users set role = 'admin' where email = 'tu-correo@dominio.co';
```

## Pruebas

| Prueba | Comando | Qué cubre |
|---|---|---|
| Unitarias (firma Wompi, formatos, formularios) | `npm test` | 13 pruebas |
| Base de datos (PostgreSQL 16 limpio) | `PGHOST=… PGPORT=… npm run db:test` | Motor de precios, anti-doble reserva, pagos idempotentes, monto alterado, rechazo, reasignación, vencimientos, reembolsos, liquidación sin duplicados, libro cuadrado, RLS por rol |
| Navegador de punta a punta | `node tests/e2e/flujo-completo.mjs` | El flujo completo en Chromium contra Supabase local: registros con confirmación de correo, carga de documentos, aprobación, membresía, reserva, webhook firmado (incluye firma inválida y evento duplicado), aceptación, servicio, calificación y liquidación |

La prueba de navegador usa llaves Wompi **ficticias** en `.env.local` (`WOMPI_EVENTS_SECRET=test_events_LOCAL_FAKE`, `WOMPI_INTEGRITY_SECRET=test_integrity_LOCAL_FAKE`, etc.). Intercepta la redirección a checkout.wompi.co, valida la firma de integridad y envía al webhook real un evento firmado, igual que Wompi. No usa dinero real.

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): componentes, modelo de datos, estados y seguridad.
- [docs/FINANZAS.md](docs/FINANZAS.md): precios, comisiones, libro contable, liquidaciones y reembolsos.
- [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md): Supabase, Vercel, Wompi, correo y credenciales pendientes.
- [docs/CUMPLIMIENTO.md](docs/CUMPLIMIENTO.md): pendientes regulatorios antes de operar.
- [docs/PENDIENTES.md](docs/PENDIENTES.md): **lista de pendientes para lanzar**.
