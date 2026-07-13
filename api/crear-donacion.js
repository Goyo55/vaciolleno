// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Crear donación (PaymentIntent único o Subscription)
// ═══════════════════════════════════════════════════════════════════
// Recibe del formulario los datos de la donación, crea el registro
// pendiente en Supabase y devuelve el clientSecret al frontend para
// que Stripe Elements confirme el pago.
//
// La confirmación real la maneja el webhook (/api/stripe-webhook.js),
// que es donde se genera el código anónimo y se envían los emails.
// ═══════════════════════════════════════════════════════════════════

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Límites (en euros)
const IMPORTE_MIN = 1;
const IMPORTE_MAX = 5000;

// ─── Cliente REST Supabase ───
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

// ═══════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const {
      importe,
      tipo = 'unica',
      email,
      nombre,
      mensaje,
      mostrar_publica = false,
    } = req.body || {};

    // ─── Validaciones ───
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Email no válido' });
    }
    if (!['unica', 'mensual'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo no válido (debe ser unica o mensual)' });
    }

    const importeNum = Number(importe);
    if (!importeNum || isNaN(importeNum)) {
      return res.status(400).json({ error: 'Importe no válido' });
    }
    if (importeNum < IMPORTE_MIN) {
      return res.status(400).json({ error: `El importe mínimo es ${IMPORTE_MIN}€` });
    }
    if (importeNum > IMPORTE_MAX) {
      return res.status(400).json({
        error: `El importe máximo es ${IMPORTE_MAX}€. Para donaciones mayores, escríbenos a hola@vaciolleno.org`,
      });
    }

    const importeCent = Math.round(importeNum * 100);

    // ─── Crear o recuperar Customer en Stripe ───
    let customer;
    const existentes = await stripe.customers.list({ email: email.trim(), limit: 1 });
    if (existentes.data.length > 0) {
      customer = existentes.data[0];
      if (nombre && !customer.name) {
        customer = await stripe.customers.update(customer.id, { name: nombre.trim() });
      }
    } else {
      customer = await stripe.customers.create({
        email: email.trim(),
        name: nombre ? nombre.trim() : undefined,
        metadata: { origen: 'vaciolleno.org' },
      });
    }

    // ─── Crear registro pendiente en Supabase ───
    const [donacion] = await supa('donaciones', {
      method: 'POST',
      body: JSON.stringify({
        importe: importeCent,
        moneda: 'eur',
        tipo,
        email: email.trim(),
        nombre: nombre ? nombre.trim() : null,
        mensaje: mensaje ? String(mensaje).trim().slice(0, 500) : null,
        mostrar_publica: !!mostrar_publica,
        stripe_customer_id: customer.id,
        estado: 'pendiente',
      }),
    });

    // ─── Crear PaymentIntent (único) o Subscription (mensual) ───
    let clientSecret;
    const updates = {};

    if (tipo === 'unica') {
      const pi = await stripe.paymentIntents.create({
        amount: importeCent,
        currency: 'eur',
        customer: customer.id,
        automatic_payment_methods: { enabled: true },
        description: 'Donación única a Vacío Lleno',
        receipt_email: email.trim(),
        metadata: {
          donacion_id: donacion.id,
          origen: 'vaciolleno.org',
        },
      });
      clientSecret = pi.client_secret;
      updates.stripe_payment_intent_id = pi.id;
    } else {
      // Suscripción mensual con Price ad-hoc
      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{
          price_data: {
            currency: 'eur',
            product: process.env.STRIPE_PRODUCT_ID,
            unit_amount: importeCent,
            recurring: { interval: 'month' },
          },
        }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          donacion_id: donacion.id,
          origen: 'vaciolleno.org',
        },
      });

      const paymentIntent = sub.latest_invoice?.payment_intent;
      if (!paymentIntent) {
        throw new Error('No se pudo obtener el PaymentIntent de la suscripción');
      }

      clientSecret = paymentIntent.client_secret;
      updates.stripe_subscription_id = sub.id;
      updates.stripe_payment_intent_id = paymentIntent.id;
    }

    // Guardar los IDs de Stripe en el registro
    await supa(`donaciones?id=eq.${donacion.id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    });

    return res.status(200).json({
      ok: true,
      clientSecret,
      donacion_id: donacion.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (err) {
    console.error('Error en /api/crear-donacion:', err);

    // Errores de Stripe con mensaje útil
    if (err?.type?.startsWith('Stripe')) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message || 'Error interno' });
  }
}
