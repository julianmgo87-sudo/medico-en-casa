// Prueba de punta a punta en navegador real contra Supabase local + Next.js.
//
// Requisitos: `supabase start`, `next start` en :3000 con .env.local que incluya
// llaves Wompi FICTICIAS de prueba (ver README → "Pruebas"). El checkout de Wompi se
// intercepta y el pago se confirma enviando un evento FIRMADO al webhook real,
// exactamente como lo haría Wompi. No se usan credenciales reales.
//
// Uso: node tests/e2e/flujo-completo.mjs  (requiere playwright-core y psql)
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET ?? "test_events_LOCAL_FAKE";
const INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET ?? "test_integrity_LOCAL_FAKE";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/e2e-shots";
const PASSWORD = "Prueba12345";
const run = Date.now().toString(36);
mkdirSync(SHOTS, { recursive: true });

const sha = (s) => createHash("sha256").update(s).digest("hex");
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q)}`).toString().trim();
let step = 0;
const ok = (msg) => console.log(`✔ ${String(++step).padStart(2, "0")} ${msg}`);
const fail = (msg) => { console.error(`✘ ${msg}`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function confirmEmail(page, email) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const msg = list.messages?.[0];
    if (msg) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const link = (full.Text.match(/https?:\/\/\S+verify\S+/) ?? [])[0];
      if (!link) fail("No se encontró el enlace de confirmación");
      await page.goto(link.replace(/[)\]]+$/, ""));
      return;
    }
    await sleep(500);
  }
  fail(`No llegó el correo de confirmación a ${email}`);
}

async function register(page, { name, email, role }) {
  await page.goto(`${APP}/auth/${role === "professional" ? "registro-profesional" : "registro"}`);
  await page.fill('input[name="full_name"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="phone"]', "3001234567");
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="password_confirm"]', PASSWORD);
  await page.check('input[name="terms"]');
  await page.check('input[name="data_consent"]');
  await page.click('button[type="submit"]:has-text("Crear cuenta")');
  await page.waitForURL(/auth\/ingresar/);
  await confirmEmail(page, email);
}

async function login(page, email) {
  await page.context().clearCookies();
  await page.goto(`${APP}/auth/ingresar`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/auth/")), page.click('button:has-text("Ingresar")')]);
}

async function expectFlash(page, text) {
  await page.waitForFunction((t) => document.querySelector("main")?.textContent?.includes(t), text, { timeout: 10000 }).catch(() => {});
  const body = (await page.textContent("main")) ?? "";
  if (!body.includes(text)) {
    await page.screenshot({ path: `${SHOTS}/error-${step}.png`, fullPage: true });
    const err = await page.locator('[role="alert"]').allTextContents();
    fail(`Se esperaba "${text}" en ${page.url()}. Alertas: ${err.join(" | ")} · Texto: ${body.slice(0, 300)}`);
  }
}


/** Envía un formulario (Server Action) y espera el redirect con ?ok= o ?error=. */
async function act(page, selector) {
  await page.evaluate(() => history.replaceState(null, "", location.pathname + location.search.replace(/[?&](ok|error)=[^&]*/g, "")));
  await Promise.all([page.waitForURL(/[?&](ok|error)=/, { timeout: 20000 }), page.click(selector)]);
}

/** Captura la redirección al checkout de Wompi, valida la firma de integridad y devuelve los datos. */
async function captureCheckout(page, click) {
  let url = null;
  await page.route("https://checkout.wompi.co/**", (route) => { url = route.request().url(); route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Checkout Wompi (interceptado en prueba)</h1>" }); });
  await click();
  for (let i = 0; i < 40 && !url; i++) await sleep(250);
  await page.unroute("https://checkout.wompi.co/**");
  if (!url) { await page.screenshot({ path: `${SHOTS}/error-checkout.png`, fullPage: true }); fail(`No hubo redirección al checkout de Wompi (${page.url()}): ${((await page.locator('[role="alert"]').allTextContents()).join(" | "))}`); }
  const p = new URL(url).searchParams;
  const reference = p.get("reference"), cents = p.get("amount-in-cents");
  if (p.get("signature:integrity") !== sha(`${reference}${cents}COP${INTEGRITY_SECRET}`)) fail("Firma de integridad inválida");
  return { reference, cents: Number(cents) };
}

async function sendWebhook({ reference, cents, status = "APPROVED", txId, tamper = false }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const tx = { id: txId, reference, status, amount_in_cents: cents, currency: "COP", payment_method_type: "NEQUI", status_message: null };
  const checksum = sha(`${tx.id}${tx.status}${tx.amount_in_cents}${timestamp}${tamper ? "otro-secreto" : EVENTS_SECRET}`);
  const res = await fetch(`${APP}/api/webhooks/wompi`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "transaction.updated", data: { transaction: tx }, environment: "test", signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum }, timestamp }),
  });
  return { status: res.status, body: await res.json() };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CO", timezoneId: "America/Bogota" })).newPage();
page.on("dialog", (d) => d.accept());

const emails = { admin: `admin-${run}@prueba.local`, pro: `medica-${run}@prueba.local`, pat: `paciente-${run}@prueba.local` };

// ---------------------------------------------------------------- inicio
await page.goto(APP);
await page.screenshot({ path: `${SHOTS}/01-inicio.png`, fullPage: true });
if (!(await page.textContent("h1")).includes("Tu salud, en la comodidad de")) fail("Hero incorrecto");
ok("Página principal carga con el mensaje principal");

// ---------------------------------------------------------------- registros
await register(page, { name: "Administración Prueba", email: emails.admin, role: "patient" });
sql(`update public.users set role='admin' where email='${emails.admin}'`);
ok("Administrador creado (registro + promoción por SQL, como en el arranque real)");
await register(page, { name: "Dra. Laura Prueba", email: emails.pro, role: "professional" });
ok("Profesional registrado y correo confirmado (Mailpit)");
await register(page, { name: "Carlos Paciente", email: emails.pat, role: "patient" });
ok("Paciente registrado y correo confirmado");

// ---------------------------------------------------------------- profesional completa perfil
await login(page, emails.pro);
await page.goto(`${APP}/profesional/perfil`);
await page.fill('input[name="document_number"]', "1113000000");
await page.fill('input[name="profession"]', "Médica general");
await page.selectOption('select[name="specialty_id"]', { label: "Medicina general — Consulta de medicina general" });
await page.fill('input[name="professional_registration"]', "RM-76-0001");
await page.fill('input[name="rethus_number"]', "RETHUS-0001");
await page.fill('input[name="years_experience"]', "8");
await page.fill('input[name="proposed_hourly_rate"]', "100.000");
await page.fill('textarea[name="bio"]', "Médica general con experiencia en atención domiciliaria de adultos mayores. (Perfil de prueba)");
await page.check('input[name="zones"] >> nth=0'); // Palmira (municipio) cubre todas las subzonas
await act(page, 'button:has-text("Guardar perfil")');
await expectFlash(page, "Perfil guardado");
const pdf = "/tmp/titulo-prueba.pdf";
writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
await page.selectOption('select[name="credential_type"]', "title");
await page.fill('input[name="title"]', "Médica y cirujana");
await page.fill('input[name="institution"]', "Universidad de prueba");
await page.setInputFiles('input[name="file"]', pdf);
await act(page, 'button:has-text("Subir documento")');
await expectFlash(page, "Documento cargado");
await page.fill('input[name="bank_name"]', "Bancolombia");
await page.fill('input[name="account_number"]', "12345678901");
await page.fill('input[name="holder_document"]', "1113000000");
await act(page, 'button:has-text("Guardar datos de pago")');
await expectFlash(page, "Datos de pago guardados");
ok("Profesional completa perfil, sube título (almacenamiento privado) y cuenta bancaria");

await page.goto(`${APP}/profesional/agenda`);
for (const d of ["1", "2", "3", "4", "5", "6", "0"]) await page.check(`input[name="weekday"][value="${d}"]`);
await page.fill('input[name="start_time"]', "00:00");
await page.fill('input[name="end_time"]', "23:59");
await act(page, 'button:has-text("Agregar franja")');
await expectFlash(page, "Horario agregado");
await page.goto(`${APP}/profesional/perfil`);
await act(page, 'button:has-text("Enviar perfil a revisión")');
await expectFlash(page, "Perfil enviado a revisión");
await page.goto(`${APP}/profesional`);
await expectFlash(page, "No recibirás solicitudes");
ok("Agenda configurada y perfil enviado a revisión (sin recibir solicitudes aún)");

// ---------------------------------------------------------------- administrador verifica y aprueba
await login(page, emails.admin);
const proId = sql(`select id from public.users where email='${emails.pro}'`);
await page.goto(`${APP}/admin/profesionales/${proId}`);
await act(page, 'button:has-text("Aprobar") >> nth=0');
await expectFlash(page, "Documento aprobado");
await act(page, 'button:has-text("Marcar RETHUS verificado")');
await act(page, 'button:has-text("Marcar cuenta verificada")');
await page.fill('input[name="hourly_rate"]', "100.000");
await act(page, 'button:has-text("Aprobar y habilitar")');
await expectFlash(page, "Profesional aprobado");
await page.goto(`${APP}/admin/configuracion`);
const medCard = page.locator("form", { has: page.locator('input[name="verified"]') }).first();
await medCard.locator('input[name="verified"]').check();
await page.evaluate(() => history.replaceState(null, "", location.pathname));
await Promise.all([page.waitForURL(/[?&](ok|error)=/), medCard.locator('button:has-text("Habilitar reservas")').click()]);
await expectFlash(page, "Reservas habilitadas");
ok("Admin aprueba documento, verifica RETHUS y cuenta, fija tarifa final y habilita Medicina general");

// ---------------------------------------------------------------- paciente: membresía
await login(page, emails.pat);
await page.goto(`${APP}/reservar`);
await expectFlash(page, "Necesitas una membresía activa");
await page.goto(`${APP}/membresias`);
const memb = await captureCheckout(page, () => page.click('button:has-text("Comprar membresía") >> nth=0'));
if (memb.cents !== 990000) fail(`Monto de membresía inesperado: ${memb.cents}`);
let r = await sendWebhook({ ...memb, txId: `tx-m-${run}`, tamper: true });
if (r.status !== 401) fail("El webhook con firma inválida debía rechazarse");
r = await sendWebhook({ ...memb, txId: `tx-m-${run}` });
if (r.body?.result?.result !== "approved") fail(`Webhook membresía: ${JSON.stringify(r.body)}`);
r = await sendWebhook({ ...memb, txId: `tx-m-${run}` });
if (!(r.body?.duplicate || r.body?.result?.result === "already_final")) fail("Evento repetido no fue idempotente");
await page.goto(`${APP}/paciente`);
await expectFlash(page, "Membresía activa");
ok("Membresía $9.900: checkout firmado, firma inválida rechazada (401), evento duplicado idempotente, membresía activa");

// ---------------------------------------------------------------- paciente: reserva
await page.goto(`${APP}/profesionales`);
await Promise.all([page.waitForURL(/profesionales\/[0-9a-f-]{36}/), page.click('a:has-text("Ver perfil")')]);
await page.screenshot({ path: `${SHOTS}/02-perfil-profesional.png`, fullPage: true });
await Promise.all([page.waitForURL(/reservar/), page.click('a:has-text("Agendar cita")')]);
await Promise.all([page.waitForURL(/tipo=scheduled/), page.click('a:has-text("Consulta programada")')]);
let slots = page.locator('a[href*="inicio="]');
if ((await slots.count()) === 0) { await page.locator('a[href*="dia="]').nth(1).click(); await page.waitForLoadState("networkidle"); slots = page.locator('a[href*="inicio="]'); }
await Promise.all([page.waitForURL(/inicio=/), slots.first().click()]);
await page.selectOption('select[name="service_area_id"]', { label: "Comuna 1" });
await page.fill('input[name="address_line"]', "Calle 30 # 28-15");
await page.fill('input[name="neighborhood"]', "Centro");
await Promise.all([page.waitForURL(/direccion=/), page.click('button:has-text("Guardar dirección")')]);
await page.screenshot({ path: `${SHOTS}/03-resumen-precio.png`, fullPage: true });
const totalText = await page.locator("text=Total a pagar").locator("..").textContent();
await page.fill('textarea[name="patient_notes"]', "Control de presión arterial");
await page.check('input[name="ack"]');
const appt = await captureCheckout(page, () => page.click('button:has-text("Pagar")'));
const apptId = sql(`select appointment_id from public.payments where reference='${appt.reference}'`);
if (sql(`select status from public.appointments where id='${apptId}'`) !== "pending_payment") fail("La cita debía quedar Pendiente de pago");
ok(`Reserva creada con horario bloqueado y desglose (${totalText.replace(/\s+/g, " ").trim()})`);

r = await sendWebhook({ ...appt, cents: 100, txId: `tx-bad-${run}` });
if (r.body?.result?.result !== "amount_mismatch") fail("Un monto alterado debía rechazarse");
sql(`update public.appointments set status='pending_payment', hold_expires_at=now()+interval '20 min' where id='${apptId}'`);
await page.goto(`${APP}/paciente/citas/${apptId}`);
const appt2 = await captureCheckout(page, () => page.click('button:has-text("Pagar")'));
r = await sendWebhook({ ...appt2, txId: `tx-a-${run}` });
if (r.body?.result?.status !== "pending_acceptance") fail(`Webhook cita: ${JSON.stringify(r.body)}`);
await page.goto(`${APP}/pago/resultado?ref=${appt2.reference}`);
await expectFlash(page, "Esperando aceptación del profesional");
await page.screenshot({ path: `${SHOTS}/04-pago-resultado.png`, fullPage: true });
ok("Monto alterado rechazado; nuevo intento pagado al 100 % → Pendiente de aceptación");

// ---------------------------------------------------------------- profesional acepta y presta el servicio
await login(page, emails.pro);
await page.goto(`${APP}/profesional`);
await page.screenshot({ path: `${SHOTS}/05-solicitud-profesional.png`, fullPage: true });
if ((await page.textContent("main")).includes("3001234567")) fail("El teléfono del paciente no debe verse antes de aceptar");
await act(page, 'button:has-text("ACEPTAR CITA")');
await expectFlash(page, "Cita aceptada");
await page.goto(`${APP}/profesional/citas`);
if (!(await page.textContent("main")).includes("3001234567")) fail("Tras aceptar, el profesional debe ver el teléfono");
await act(page, 'button:has-text("Voy en camino")');
await act(page, 'button:has-text("Llegué al domicilio")');
await act(page, 'button:has-text("Iniciar atención")');
sql(`update public.appointments set starts_at=now()-interval '61 min', ends_at=now()-interval '1 min' where id='${apptId}'`); // avanza el reloj de la prueba
await page.reload();
await act(page, 'button:has-text("Marcar como completada")');
if (sql(`select status from public.appointments where id='${apptId}'`) !== "completed") fail("La cita debía quedar Completada");
ok("Profesional acepta (datos del paciente visibles solo tras aceptar), en camino → llegó → en curso → completada");

// ---------------------------------------------------------------- paciente confirma y califica
await login(page, emails.pat);
await page.goto(`${APP}/paciente/citas/${apptId}`);
await act(page, 'button:has-text("Sí, recibí la atención")');
await act(page, 'button:has-text("Calificar")');
await expectFlash(page, "Gracias por tu calificación");
await page.screenshot({ path: `${SHOTS}/06-cita-paciente.png`, fullPage: true });
ok("Paciente confirma la atención y califica");

// ---------------------------------------------------------------- liquidación
await login(page, emails.admin);
await page.goto(`${APP}/admin/liquidaciones`);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
await page.fill('input[name="period_start"]', today);
await page.fill('input[name="period_end"]', today);
await act(page, 'button:has-text("Generar")');
await expectFlash(page, "Se generaron 1 liquidaciones");
await act(page, 'button:has-text("Generar")');
await expectFlash(page, "No hay servicios completados pendientes");
await act(page, 'button:has-text("Aprobar liquidación")');
await page.fill('input[name="reference"]', `TRF-${run}`);
await act(page, 'button:has-text("Registrar pago")');
await expectFlash(page, "Liquidación marcada como pagada");
ok("Liquidación generada sin duplicados, aprobada y pagada con referencia");

const net = sql(`select professional_net_amount from public.appointments where id='${apptId}'`);
const comm = sql(`select commission_amount from public.appointments where id='${apptId}'`);
const paid = sql(`select net_amount from public.professional_payouts where professional_id='${proId}' and status='paid'`);
if (net !== paid) fail(`Neto (${net}) distinto a lo liquidado (${paid})`);
const balance = sql(`select coalesce(sum(case when direction='debit' then amount else -amount end),0) from public.financial_ledger`);
if (balance !== "0") fail("Libro contable descuadrado");
ok(`Comisión ${comm} COP registrada como ingreso; neto ${net} COP pagado al profesional; libro cuadrado`);

await page.goto(`${APP}/admin`);
await page.screenshot({ path: `${SHOTS}/07-admin-dashboard.png`, fullPage: true });
await login(page, emails.pro);
await page.goto(`${APP}/profesional/ganancias`);
await page.screenshot({ path: `${SHOTS}/08-ganancias.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(APP);
await page.screenshot({ path: `${SHOTS}/09-inicio-movil.png`, fullPage: true });
ok("Capturas guardadas en " + SHOTS);

await browser.close();
console.log("\nFLUJO COMPLETO SUPERADO");
