# Arquitectura

## Principio central
**Las reglas de negocio viven en la base de datos.** Precios, disponibilidad, transiciones de estado, pagos, comisiones, liquidaciones y asientos contables son funciones PL/pgSQL (`SECURITY DEFINER`) que validan el rol con `auth.uid()` y corren dentro de una transacción. El navegador nunca envía precios ni estados: solo intenciones (p. ej. "reservar este horario"). Next.js renderiza en el servidor y llama a esas funciones con la sesión del usuario, así que RLS aplica siempre.

```
Navegador ──(formularios / Server Actions)──► Next.js (servidor)
                                              │  sesión del usuario → RLS
                                              ▼
                                   Supabase PostgreSQL ◄── pg_cron (cada minuto)
                                              ▲
Wompi ──(webhook firmado)──► /api/webhooks/wompi (service_role, tras verificar la firma)
```

## Migraciones (`supabase/migrations`)
| Archivo | Contenido |
|---|---|
| 0001 | Extensiones y tipos (estado operativo y financiero separados) |
| 0002 | Las 27 tablas pedidas, más `appointment_rejections`, `holidays` y `professional_payout_accounts` |
| 0003 | Roles, guardas de campos sensibles, auditoría automática, matriz de transiciones, libro contable |
| 0004 | Cobertura geográfica, motor de precios, comisiones y generación de horarios |
| 0005 | Reserva temporal, aceptación o rechazo, alternativas, reasignación, cancelación, reprogramación, prestación, disputas, procesos automáticos |
| 0006 | Membresías, aplicación idempotente de pagos, reembolsos y conciliación |
| 0007 | Liquidaciones, ganancias, aprobación de profesionales, tablero |
| 0008 | RLS en todas las tablas, vistas públicas seguras y permisos de ejecución |
| 0009 | Datos base: roles, ajustes, 4 categorías (no reservables), zonas de Palmira, planes, recargos, comisión 20 %, festivos 2026-2027 |
| 0010 | Buckets de Storage y sus políticas |
| 0011 | pg_cron: `run_scheduled_jobs()` cada minuto |

## Anti-doble reserva y condiciones de carrera
- `EXCLUDE USING gist (professional_id WITH =, blocked_range WITH &&) WHERE (blocks_slot)`, donde `blocked_range = [inicio, fin + desplazamiento)`. Lo garantiza PostgreSQL incluso con solicitudes simultáneas.
- Una segunda restricción impide que un paciente tenga dos citas activas solapadas.
- `blocks_slot` se deriva del estado: el horario se libera automáticamente al expirar, rechazarse o cancelarse.
- Índices únicos: un solo pago aprobado por cita o membresía; un solo `payout_item` por cita.

## Estados de la cita
El estado operativo (16 estados, en `appointment_status`) es independiente del estado financiero (`payment_state`). La función `appointment_transition_allowed` define las transiciones válidas y un trigger rechaza las demás. Cada cambio queda en `appointment_status_history` con fecha, actor, rol y motivo.

```
pending_payment → payment_processing → pending_acceptance → confirmed → en_route → arrived → in_progress → completed
                       │                    │  (rechazo / sin respuesta)
                       ▼                    ▼
                    expired           rejected/expired → pending_reassignment → professional_assigned → confirmed
                                                              └──► refund_pending → refunded
confirmed/… → disputed → completed | refund_pending          cancelled → refund_pending
```

## Procesos automáticos (`run_scheduled_jobs`, cada minuto)
1. Reservas sin pago vencidas → Expirada (libera el horario).
2. Solicitudes sin respuesta (30 min programada / 15 min prioritaria, configurables) → Expirada → Pendiente de reasignación.
3. Sin decisión del paciente en N horas → devolución automática.
4. Membresías vencidas y avisos de vencimiento próximo.
5. Recordatorios 24 h y 2 h antes, con clave de deduplicación.

## Seguridad
- RLS en todas las tablas. Los profesionales **no** leen la tabla de citas; usan `professional_appointments()`, que oculta nombre, teléfono y dirección hasta que la cita está confirmada.
- Vistas públicas (`public_professionals`, `public_reviews`, `category_catalog`) con solo campos seguros: nunca documentos, cuentas bancarias ni archivos.
- Triggers que impiden auto-asignarse rol, aprobarse, fijar la tarifa final o modificar credenciales ya revisadas. Si un profesional cambia su cuenta bancaria, vuelve a requerir verificación.
- `apply_payment_result` solo la puede ejecutar `service_role`. El webhook verifica la firma SHA-256 en tiempo constante, registra el evento con clave única (idempotencia) y vuelve a consultar la transacción en Wompi.
- El retorno del checkout (`/pago/resultado`) **no confía en la URL**: consulta la transacción a Wompi.
- La llave service_role y los secretos de Wompi y Resend solo existen en el servidor (`import "server-only"`).
- Encabezados de seguridad (HSTS, X-Frame-Options, nosniff, Referrer-Policy). Exportaciones CSV protegidas contra inyección de fórmulas.
- Auditoría automática de cambios en perfiles, credenciales, cuentas (enmascaradas), precios, comisiones, planes, membresías, reembolsos, liquidaciones, ajustes y zonas.
