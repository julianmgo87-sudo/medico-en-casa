# Modelo financiero

## Precio de una cita (`compute_quote`)
```
tarifa_base      = tarifa/hora aprobada por el administrador × duración / 60   (redondeo a $100)
recargos         = nocturno (+30 %) · festivo (+20 %) o fin de semana (+15 %) · prioritaria (+25 %)   [% sobre tarifa base]
valor_servicio   = tarifa_base + recargos
total_paciente   = valor_servicio + desplazamiento (según la zona) + cargo de servicio − descuento
```
- El recargo nocturno se acumula. Festivo y fin de semana no se acumulan entre sí (aplica el festivo).
- Para reglas del mismo tipo gana la más específica: profesional → especialidad → categoría → general.
- Ejemplo del documento, verificado en las pruebas: $100.000 + 30 % nocturno + $10.000 de desplazamiento = **$140.000**.
- El desglose completo se guarda en la cita (`price_breakdown` y columnas). **Los cambios posteriores de tarifas no modifican citas existentes.** Solo cambian, con aprobación expresa del paciente, al reasignar o reprogramar; si el nuevo valor es menor, la diferencia se devuelve.

## Comisión
```
base_comisión    = valor_servicio            (ajuste commission_base = service_amount; alternativas: base_only, service_and_travel)
comisión         = base_comisión × %        (prioridad: profesional → especialidad → categoría → tipo de atención → general 20 %)
neto_profesional = valor_servicio + desplazamiento − comisión
```
- Desplazamiento: 100 % para el profesional. Cargo de servicio: 100 % para la plataforma.
- Descuentos y comisiones de la pasarela los asume la plataforma.
- Porcentaje, base y monto se congelan en cada cita.
- IVA: los servicios de salud suelen estar excluidos (art. 476 del E.T.). Membresía y comisión podrían estar gravadas. **Validar con contador.**

## Libro contable de partida doble (`financial_ledger`)
| Evento | Débito | Crédito |
|---|---|---|
| Pago de consulta aprobado | cash_gateway | **customer_funds_held** (pasivo, no es ingreso) |
| Pago de membresía | cash_gateway | platform_membership_revenue |
| Servicio completado | customer_funds_held + promotional_discount_expense | professional_payable + platform_commission_revenue + platform_service_fee_revenue |
| Penalidad por cancelación tardía | customer_funds_held | platform_cancellation_revenue |
| Devolución realizada (con comprobante) | customer_funds_held | cash_gateway |
| Liquidación pagada | professional_payable (± payout_adjustments) | cash_gateway |
| Conciliación (comisión pasarela) | gateway_fee_expense | cash_gateway |

Cada asiento valida que débitos = créditos. El tablero separa **recaudo** (dinero recibido) de **ingresos propios** (comisiones + cargos + membresías + penalidades − descuentos − pasarela).

## Liquidaciones
1. El profesional marca la atención completada (solo después de la hora de inicio).
2. El paciente la confirma o el administrador la verifica.
3. El administrador genera las liquidaciones del periodo (semanal por defecto; configurable). Solo entran citas completadas, pagadas, sin disputa, sin reembolso y aún no liquidadas (`payout_items.appointment_id` es único).
4. Aprobar exige que todos los servicios estén verificados y que la cuenta del profesional esté verificada.
5. Registrar el pago exige la referencia de la transferencia (comprobante opcional en almacenamiento privado). El estado pasa a "Pagado".

Las transferencias son **manuales** (banco o Nequi). La tabla está preparada para automatizarlas (p. ej. dispersión bancaria) reemplazando el paso 5.

## Reembolsos
Wompi no ofrece devolución automática para todos los medios. Los reembolsos quedan "Pendientes" y el administrador los registra como realizados **solo** con número de comprobante. Políticas configurables: devolución del 100 % antes de la aceptación; 100 % con 24 h o más de anticipación; 50 % en cancelaciones tardías (validar legalmente).
