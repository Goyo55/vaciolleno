// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Webhook de Stripe
// ═══════════════════════════════════════════════════════════════════
// Confirma pagos, actualiza estado y envía emails.
// El "código" en las donaciones anónimas es el propio importe con
// céntimos únicos (ej. €5,07) — no se genera ningún código externo.
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

export const config = { api: { bodyParser: false } };

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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatEur(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + '€';
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

  if (donacion.estado === 'confirmada') {
    console.log(`Donación ${donacionId} ya confirmada, saltando`);
    return donacion;
  }

  const [actualizada] = await supa(`donaciones?id=eq.${donacionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      estado: 'confirmada',
      confirmado_en: new Date().toISOString(),
      ...camposExtra,
    }),
  });

  enviarEmailsConfirmacion(actualizada).catch(err =>
    console.error('Error enviando emails:', err)
  );

  return actualizada;
}

async function enviarEmailsConfirmacion(donacion) {
  const importeStr = formatEur(donacion.importe);
  const tipoTxt = donacion.tipo === 'mensual' ? 'mensual' : 'única';
  const anonTxt = donacion.anonimo ? ' anónima' : '';

  try {
    await resend.emails.send({
      from: REMITENTE,
      to: donacion.email,
      replyTo: 'hola@vaciolleno.org',
      subject: donacion.anonimo
        ? `Tu firma en Vacío Lleno · ${importeStr}`
        : `Gracias por tu donación · Vacío Lleno`,
      html: renderConfirmacionDonante(donacion, importeStr),
    });
  } catch (e) {
    console.error('Error email donante:', e);
  }

  try {
    await resend.emails.send({
      from: REMITENTE,
      to: NOTIFICATION_EMAIL,
      replyTo: donacion.email,
      subject: `💰 Nueva donación ${tipoTxt}${anonTxt} — ${importeStr}`,
      html: renderNotificacionAdmin(donacion, importeStr),
    });
  } catch (e) {
    console.error('Error email admin:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Sin firma de Stripe' });

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
          console.log('PaymentIntent sin donacion_id — ignorado');
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

        const [nuevaDonacion] = await supa('donaciones', {
          method: 'POST',
          body: JSON.stringify({
            importe: invoice.amount_paid,  // Mismo importe único que el original
            moneda: invoice.currency,
            tipo: 'mensual',
            anonimo: original.anonimo,
            email: original.email,
            nombre: original.nombre,
            mensaje: original.mensaje,
            mostrar_publica: original.mostrar_publica,
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

function renderConfirmacionDonante(donacion, importeStr) {
  const nombre = donacion.anonimo ? 'amigo/a de Vacío Lleno' : (donacion.nombre || 'amigo/a de Vacío Lleno');
  const esRecurrente = donacion.tipo === 'mensual';

  let cuerpo;
  if (donacion.anonimo) {
    cuerpo = `
      <p class="salutation">Gracias.</p>
      <p>Tu donación${esRecurrente ? ' mensual' : ''} de <strong>${importeStr}</strong> ha sido confirmada.</p>

      <div class="highlight" style="text-align:center;">
        <p style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.2em;color:#888;margin:0 0 8px;text-transform:uppercase;">Tu firma en Vacío Lleno</p>
        <p style="font-family:Georgia,serif;font-size:36px;font-weight:900;color:#0f1f3d;letter-spacing:0.03em;margin:0;">${escapeHtml(importeStr)}</p>
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#666;margin:12px 0 0;line-height:1.5;">
          Este importe exacto es tu firma invisible este año. Nadie más donará esta cantidad en 2026. Es tu código, guárdalo.
        </p>
      </div>

      <p>Con <strong>${importeStr}</strong> el proyecto puede poner en circulación libros perforados hacia Latinoamérica. Cada uno de esos ejemplares está pensado para seguir encontrando nuevos lectores durante años — mientras el papel resista.</p>

      <p><a href="https://vaciolleno.org/vaciolleno-impacto.html" class="btn">Ver impacto en vivo →</a></p>

      ${esRecurrente ? `
        <hr class="divider">
        <p style="font-size:13px;color:#666;line-height:1.6;">
          <strong>¿Necesitas cancelar tu donación mensual?</strong><br>
          Responde a este email indicándonos tu importe <strong>${escapeHtml(importeStr)}</strong> y la cancelaremos inmediatamente.
        </p>
      ` : ''}
    `;
  } else {
    cuerpo = `
      <p class="salutation">Gracias, ${escapeHtml(nombre)}.</p>
      <p>Tu donación${esRecurrente ? ' mensual' : ''} de <strong>${importeStr}</strong> ha sido confirmada correctamente. Gracias por sumarte a la circulación.</p>

      <p>Con <strong>${importeStr}</strong> el proyecto puede poner en circulación libros perforados hacia Latinoamérica. Cada uno de esos ejemplares está pensado para seguir encontrando nuevos lectores durante años — mientras el papel resista.</p>

      <p><a href="https://vaciolleno.org/vaciolleno-impacto.html" class="btn">Ver impacto en vivo →</a></p>

      ${esRecurrente ? `
        <hr class="divider">
        <p style="font-size:13px;color:#666;line-height:1.6;">
          <strong>¿Necesitas cancelar tu donación mensual?</strong><br>
          Responde a este email y la cancelaremos inmediatamente. Sin preguntas.
        </p>
      ` : ''}
    `;
  }

  const inner = `
    ${cuerpo}
    <hr class="divider">
    <p class="sign">Con gratitud,</p>
    <p class="sign-name">El equipo de Vacío Lleno</p>
    <p class="sign-role">vaciolleno.org · Libros que circulan</p>
  `;

  return wrapperEmail(inner, 'donación');
}

function renderNotificacionAdmin(donacion, importeStr) {
  const tipoTxt = donacion.tipo === 'mensual' ? 'mensual · recurrente' : 'única';
  const piId = donacion.stripe_payment_intent_id || '';
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f5f3ee;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:white;padding:32px;">
    <h2 style="font-family:Georgia,serif;color:#0f1f3d;margin-top:0;">
      💰 Nueva donación ${donacion.anonimo ? 'anónima ' : ''}${tipoTxt.split(' ')[0]}
    </h2>
    <div style="background:#fff8e1;border-left:3px solid #c9a84c;padding:16px 20px;margin:16px 0;">
      <div style="font-family:monospace;font-size:11px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Importe ${donacion.anonimo ? '(código anónimo)' : ''}</div>
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#0f1f3d;">${escapeHtml(importeStr)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Tipo</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;">${tipoTxt}</td></tr>
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Anónima</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;">${donacion.anonimo ? 'Sí' : 'No'}</td></tr>
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;">${escapeHtml(donacion.email || '—')}</td></tr>
      <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Nombre</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial;font-size:14px;">${escapeHtml(donacion.nombre || (donacion.anonimo ? '(anónimo)' : '—'))}</td></tr>
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
          <a href="https://vaciolleno.org/vaciolleno-legal-privacidad.html" style="color:#888;">Política de privacidad</a> ·
          <a href="https://vaciolleno.org/vaciolleno-legal-aviso.html" style="color:#888;">Aviso legal</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
