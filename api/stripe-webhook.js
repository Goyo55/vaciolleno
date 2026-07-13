// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Webhook de Stripe
// ═══════════════════════════════════════════════════════════════════
// Recibe eventos de Stripe y actualiza el estado de las donaciones.
// Cuando un pago se confirma:
//   1. Genera el código anónimo único (VL-YYYY-XXXXXX)
//   2. Actualiza el registro en Supabase
//   3. Envía email al donante con su código
//   4. Envía notificación al equipo
//
// Eventos manejados:
//   - payment_intent.succeeded       (donación única confirmada o 1er cobro de suscripción)
//   - payment_intent.payment_failed  (pago fallido)
//   - invoice.payment_succeeded      (cobro recurrente mensual, 2º en adelante)
//   - customer.subscription.deleted  (suscripción cancelada)
//   - charge.refunded                (reembolso)
// ═══════════════════════════════════════════════════════════════════

import Stripe from 'stripe';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'hola@vaciolleno.org';
const REMITENTE = 'Vacío Lleno <hola@vaciolleno.org>';

// IMPORTANTE: desactivar el body parser para poder verificar la firma con el buffer raw
export const config = {
  api: { bodyParser: false },
};

// ─── Utilidades ───
async function buffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function supa(path, opciones = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opciones,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opciones.prefer || 'return=representation',
      ...(opciones.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase ${res.status}: ${errText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function generarCodigoAnonimo() {
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/generar_codigo_donacion`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!rpcRes.ok) throw new Error(`No se pudo generar código anónimo: ${rpcRes.status}`);
  return await rpcRes.json();
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════════
// LÓGICA DE CONFIRMACIÓN
// ═══════════════════════════════════════════════════════════════════
async function confirmarDonacion(donacionId, camposExtra = {}) {
  const rows = await supa(`donaciones?id=eq.${donacionId}&select=*`);
  if (!rows || rows.length === 0) {
    console.warn(`Donación no encontrada: ${donacionId}`);
    return null;
  }
  const donacion = rows[0];

  // Idempotencia: si ya está confirmada, no volver a procesarla
  if (donacion.estado === 'confirmada') {
    console.log(`Donación ${donacionId} ya confirmada, saltando`);
    return donacion;
  }

  // Generar código si aún no tiene
  const codigo = donacion.codigo_anonimo || await generarCodigoAnonimo();

  // Actualizar
  const [actualizada] = await supa(`donaciones?id=eq.${donacionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      estado: 'confirmada',
      codigo_anonimo: codigo,
      confirmado_en: new Date().toISOString(),
      ...camposExtra,
    }),
  });

  // Emails (fire-and-forget: no bloqueamos el ack al webhook)
  enviarEmailsConfirmacion(actualizada).catch(err =>
    console.error('Error enviando emails de confirmación:', err)
  );

  return actualizada;
}

async function enviarEmailsConfirmacion(donacion) {
  const importeEur = (donacion.importe / 100).toFixed(2);
  const tipoTxt = donacion.tipo === 'mensual' ? 'mensual' : 'única';

  // Email al donante
  try {
    await resend.emails.send({
      from: REMITENTE,
      to: donacion.email,
      replyTo: 'hola@vaciolleno.org',
      subject: `Tu donación está en circulación — ${donacion.codigo_anonimo}`,
      html: renderConfirmacionDonante(donacion, importeEur),
    });
  } catch (e) {
    console.error('Error email donante:', e);
  }

  // Notificación al equipo
  try {
    await resend.emails.send({
      from: REMITENTE,
      to: NOTIFICATION_EMAIL,
      replyTo: donacion.email,
      subject: `💰 Nueva donación ${tipoTxt} — ${importeEur}€ · ${donacion.codigo_anonimo}`,
      html: renderNotificacionAdmin(donacion, importeEur),
    });
  } catch (e) {
    console.error('Error email admin:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Sin firma de Stripe' });

  // Verificar firma con el buffer raw
  let event;
  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Verificación de firma falló:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`[Stripe] Evento recibido: ${event.type} (${event.id})`);

  try {
    switch (event.type) {

      // ─── Donación única confirmada, o 1er cobro de suscripción ───
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const donacionId = pi.metadata?.donacion_id;
        if (!donacionId) {
          console.log('PaymentIntent sin donacion_id en metadata — probablemente no es del sitio, ignorado');
          break;
        }
        await confirmarDonacion(donacionId);
        break;
      }

      // ─── Pago fallido ───
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const donacionId = pi.metadata?.donacion_id;
        if (donacionId) {
          await supa(`donaciones?id=eq.${donacionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: 'fallida' }),
            prefer: 'return=minimal',
          });
        }
        break;
      }

      // ─── Cobro recurrente (2º mes en adelante) ───
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;

        // El primer cobro ya lo procesa payment_intent.succeeded arriba
        if (invoice.billing_reason !== 'subscription_cycle') break;

        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        // Buscar la donación original para copiar sus datos
        const originales = await supa(
          `donaciones?stripe_subscription_id=eq.${subscriptionId}&estado=eq.confirmada&order=creado_en.asc&limit=1&select=*`
        );
        if (!originales || originales.length === 0) {
          console.warn(`No se encontró donación original para subscription ${subscriptionId}`);
          break;
        }
        const original = originales[0];

        // Crear nuevo registro para este mes (ya confirmado)
        const codigo = await generarCodigoAnonimo();
        const [nuevaDonacion] = await supa('donaciones', {
          method: 'POST',
          body: JSON.stringify({
            importe: invoice.amount_paid,
            moneda: invoice.currency,
            tipo: 'mensual',
            email: original.email,
            nombre: original.nombre,
            mensaje: original.mensaje,
            mostrar_publica: original.mostrar_publica,
            codigo_anonimo: codigo,
            stripe_customer_id: original.stripe_customer_id,
            stripe_subscription_id: subscriptionId,
            stripe_payment_intent_id: invoice.payment_intent,
            estado: 'confirmada',
            confirmado_en: new Date().toISOString(),
            metadata: { invoice_id: invoice.id, ciclo_mensual: true },
          }),
        });

        enviarEmailsConfirmacion(nuevaDonacion).catch(err =>
          console.error('Error email renovación:', err)
        );
        break;
      }

      // ─── Suscripción cancelada ───
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supa(`donaciones?stripe_subscription_id=eq.${sub.id}&estado=eq.confirmada`, {
          method: 'PATCH',
          body: JSON.stringify({ cancelado_en: new Date().toISOString() }),
          prefer: 'return=minimal',
        });
        break;
      }

      // ─── Reembolso ───
      case 'charge.refunded': {
        const charge = event.data.object;
        if (charge.payment_intent) {
          await supa(`donaciones?stripe_payment_intent_id=eq.${charge.payment_intent}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: 'reembolsada' }),
            prefer: 'return=minimal',
          });
        }
        break;
      }

      default:
        console.log(`[Stripe] Evento no manejado: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error procesando webhook:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEMPLATES DE EMAIL
// ═══════════════════════════════════════════════════════════════════

function renderConfirmacionDonante(donacion, importeEur) {
  const nombre = donacion.nombre || 'amigo/a de Vacío Lleno';
  const esRecurrente = donacion.tipo === 'mensual';

  const tipoTexto = esRecurrente
    ? `Tu donación mensual de <strong>${importeEur}€</strong> ha sido confirmada. A partir de hoy, cada mes cobraremos el mismo importe automáticamente.`
    : `Tu donación de <strong>${importeEur}€</strong> ha sido confirmada correctamente. Gracias por sumarte a la circulación.`;

  const inner = `
    <p class="salutation">Gracias, ${escapeHtml(nombre)}.</p>
    <p>${tipoTexto}</p>

    <div class="highlight" style="text-align:center;">
      <p style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.2em;color:#888;margin:0 0 8px;text-transform:uppercase;">Tu código de donación</p>
      <p style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#0f1f3d;letter-spacing:0.08em;margin:0;">${escapeHtml(donacion.codigo_anonimo)}</p>
      <p style="font-family:Arial,sans-serif;font-size:12px;color:#666;margin:12px 0 0;line-height:1.5;">
        Este código es único, irrepetible y tuyo. Guárdalo. Con él podrás rastrear el impacto de tu aportación cuando publiquemos la trazabilidad pública del proyecto.
      </p>
    </div>

    <p>Con <strong>${importeEur}€</strong> el proyecto puede financiar la perforación y envío de libros a Latinoamérica. Cada libro pasará por unas 40 manos antes de dejar de circular — si es que alguna vez lo hace.</p>

    <p>Puedes ver el impacto acumulado del proyecto en tiempo real:</p>
    <p><a href="https://vaciolleno.org/vaciolleno-impacto.html" class="btn">Ver impacto en vivo →</a></p>

    ${esRecurrente ? `
      <hr class="divider">
      <p style="font-size:13px;color:#666;line-height:1.6;">
        <strong>¿Necesitas cancelar tu donación mensual?</strong><br>
        Responde a este email indicándonos tu código <strong>${escapeHtml(donacion.codigo_anonimo)}</strong> y la cancelaremos inmediatamente. Sin preguntas, sin fricción.
      </p>
    ` : ''}

    <hr class="divider">
    <p class="sign">Con gratitud,</p>
    <p class="sign-name">El equipo de Vacío Lleno</p>
    <p class="sign-role">Insurgencia intelectual · vaciolleno.org</p>
  `;

  return wrapperEmail(inner, 'donación');
}

function renderNotificacionAdmin(donacion, importeEur) {
  const tipoTxt = donacion.tipo === 'mensual' ? 'mensual' : 'única';
  const piId = donacion.stripe_payment_intent_id || '';
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f5f3ee;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:white;padding:32px;">
    <h2 style="font-family:Georgia,serif;color:#0f1f3d;margin-top:0;">
      💰 Nueva donación ${tipoTxt}
    </h2>
    <div style="background:#fff8e1;border-left:3px solid #c9a84c;padding:16px 20px;margin:16px 0;">
      <div style="font-family:monospace;font-size:11px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Código</div>
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#0f1f3d;letter-spacing:0.05em;">${escapeHtml(donacion.codigo_anonimo || '')}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Importe</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;font-weight:bold;">${importeEur}€ ${donacion.tipo === 'mensual' ? '(mensual · recurrente)' : ''}</td></tr>
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;">${escapeHtml(donacion.email || '—')}</td></tr>
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Nombre</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;">${escapeHtml(donacion.nombre || '—')}</td></tr>
      ${donacion.mensaje ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Mensaje</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;font-style:italic;">"${escapeHtml(donacion.mensaje)}"</td></tr>` : ''}
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Muro público</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;">${donacion.mostrar_publica ? 'Sí' : 'No'}</td></tr>
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Confirmada</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;">${new Date(donacion.confirmado_en || Date.now()).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</td></tr>
    </table>
    <p style="color:#666;font-size:13px;margin-top:20px;">
      Ver el pago en Stripe: <a href="https://dashboard.stripe.com/payments/${escapeHtml(piId)}" style="color:#0f1f3d;">dashboard.stripe.com</a>
    </p>
  </div>
</body></html>`;
}

function wrapperEmail(inner, formularioLabel) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#e8e2d6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e2d6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#f2ede4;font-family:Georgia,serif;color:#1c1a14;">
        <tr><td style="background:#0f1f3d;padding:20px 32px;color:#f2ede4;font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.2em;">
          ● VACÍO LLENO
        </td></tr>
        <tr><td style="padding:36px 32px;line-height:1.7;font-size:15px;">
          <style>
            .salutation { font-size: 18px; font-weight: bold; margin: 0 0 20px 0; }
            .highlight { background: rgba(15,31,61,0.06); border-left: 3px solid #c9a84c; padding: 20px 24px; margin: 24px 0; font-family: Arial, sans-serif; }
            .btn { display: inline-block; background: #0f1f3d; color: #f2ede4 !important; padding: 14px 28px; text-decoration: none; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; margin: 12px 0; }
            .divider { border: none; border-top: 1px solid rgba(28,26,20,0.15); margin: 32px 0 20px; }
            .sign { margin: 0 0 4px 0; font-style: italic; color: #555; }
            .sign-name { margin: 0; font-weight: bold; }
            .sign-role { margin: 4px 0 0 0; font-family: 'Courier New', monospace; font-size: 11px; color: #888; letter-spacing: 0.1em; text-transform: uppercase; }
            p { margin: 0 0 16px 0; }
          </style>
          ${inner}
        </td></tr>
        <tr><td style="padding:20px 32px;background:rgba(15,31,61,0.04);font-family:Arial,sans-serif;font-size:11px;color:#888;line-height:1.6;">
          Has recibido este correo porque completaste una ${formularioLabel} en vaciolleno.org.<br>
          No compartimos tu dirección con terceros.<br>
          <a href="https://vaciolleno.org/vaciolleno-legal-privacidad.html" style="color:#888;">Política de privacidad</a> ·
          <a href="https://vaciolleno.org/vaciolleno-legal-aviso.html" style="color:#888;">Aviso legal</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
