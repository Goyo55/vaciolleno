// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Función serverless (VERSIÓN DEBUG)
// ═══════════════════════════════════════════════════════════════════
// Esta versión devuelve el error real al navegador para diagnosticar
// el problema. Volveremos a la versión normal cuando funcione.
// ═══════════════════════════════════════════════════════════════════

import { Resend } from 'resend';

const CONFIG = {
  voluntario: {
    subject: 'Te has unido a Vacío Lleno — Lo que viene ahora',
    replyTo: 'voluntarios@vaciolleno.org',
    notificationSubject: '🙋 Nuevo voluntario/a',
  },
  'donacion-libros': {
    subject: 'Tus libros van a viajar — Confirmación de Vacío Lleno',
    replyTo: 'voluntarios@vaciolleno.org',
    notificationSubject: '📚 Nueva donación de libros',
  },
  'donacion-dinero': {
    subject: 'Tu donación ha llegado — Gracias de parte de Vacío Lleno',
    replyTo: 'hola@vaciolleno.org',
    notificationSubject: '💰 Nueva donación de dinero',
  },
  contacto: {
    subject: 'Hemos recibido tu mensaje — Vacío Lleno',
    replyTo: 'hola@vaciolleno.org',
    notificationSubject: '✉️ Nuevo mensaje de contacto',
  },
};

const REMITENTE = 'Vacío Lleno <hola@vaciolleno.org>';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'hola@vaciolleno.org';

const COLUMNAS_TABLA = new Set([
  'tipo', 'nombre', 'email', 'ciudad', 'pais', 'cantidad', 'mensaje',
]);

// Diagnóstico: qué variables de entorno están presentes
const ENV_STATUS = {
  RESEND_API_KEY: !!process.env.RESEND_API_KEY,
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
  NOTIFICATION_EMAIL: !!process.env.NOTIFICATION_EMAIL,
};

export default async function handler(req, res) {
  // Diagnóstico rápido: GET devuelve qué variables están presentes
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      mensaje: 'La función está viva. Variables presentes:',
      variables: ENV_STATUS,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const trace = { paso: 'inicio', env: ENV_STATUS };

  try {
    trace.paso = 'parseando body';
    const { tipo, ...datos } = req.body || {};

    trace.paso = 'validando';
    trace.tipo = tipo;
    trace.tieneEmail = !!datos.email;
    trace.tieneNombre = !!datos.nombre;

    if (!tipo || !CONFIG[tipo]) {
      return res.status(400).json({ error: 'Tipo de formulario no válido', trace });
    }
    if (!datos.email || !datos.email.includes('@')) {
      return res.status(400).json({ error: 'Email no válido', trace });
    }
    if (!datos.nombre) {
      return res.status(400).json({ error: 'Falta el nombre', trace });
    }

    const config = CONFIG[tipo];

    // 1. Supabase
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      trace.paso = 'guardando en Supabase';
      const fila = { tipo };
      const extra = {};
      for (const [k, v] of Object.entries(datos)) {
        if (COLUMNAS_TABLA.has(k)) {
          fila[k] = Array.isArray(v) ? v.join(', ') : v;
        } else if (v !== undefined && v !== null && v !== '') {
          extra[k] = v;
        }
      }
      if (Object.keys(extra).length > 0) fila.datos_extra = extra;

      const supabaseUrl = `${process.env.SUPABASE_URL}/rest/v1/formularios`;
      trace.supabaseUrl = supabaseUrl;

      const supabaseRes = await fetch(supabaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(fila),
      });

      trace.supabaseStatus = supabaseRes.status;
      if (!supabaseRes.ok) {
        trace.supabaseError = await supabaseRes.text();
      }
    } else {
      trace.supabaseSaltada = true;
    }

    // 2. Resend — notificación al equipo
    trace.paso = 'creando cliente Resend';
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({
        error: 'Falta RESEND_API_KEY en variables de entorno',
        trace,
      });
    }
    const resend = new Resend(process.env.RESEND_API_KEY);

    trace.paso = 'enviando email de notificación al equipo';
    const notif = await resend.emails.send({
      from: REMITENTE,
      to: NOTIFICATION_EMAIL,
      replyTo: datos.email,
      subject: `${config.notificationSubject} — ${datos.nombre}`,
      html: `<p>Nuevo envío tipo <b>${tipo}</b> de <b>${datos.nombre}</b> (${datos.email}).</p><pre>${JSON.stringify(datos, null, 2)}</pre>`,
    });

    trace.notifResult = notif;

    if (notif.error) {
      return res.status(500).json({
        error: 'Resend rechazó el email de notificación',
        resendError: notif.error,
        trace,
      });
    }

    // 3. Resend — autoresponder al usuario
    trace.paso = 'enviando autoresponder al usuario';
    const auto = await resend.emails.send({
      from: REMITENTE,
      to: datos.email,
      replyTo: config.replyTo,
      subject: config.subject,
      html: `<p>Hola ${datos.nombre},</p><p>Hemos recibido tu mensaje. Te contactaremos pronto.</p><p>— El equipo de Vacío Lleno</p>`,
    });

    if (auto.error) {
      return res.status(500).json({
        error: 'Resend rechazó el autoresponder',
        resendError: auto.error,
        trace,
      });
    }

    return res.status(200).json({ ok: true, trace });
  } catch (err) {
    return res.status(500).json({
      error: 'Excepción en el servidor',
      mensaje: err.message,
      stack: err.stack,
      trace,
    });
  }
}
