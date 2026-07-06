// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Función serverless universal para formularios
// ═══════════════════════════════════════════════════════════════════
// Recibe los envíos de los formularios del sitio, los guarda en
// Supabase (tabla `formularios`) y envía dos emails con Resend:
// uno de notificación al equipo y otro de respuesta automática
// al usuario.
// ═══════════════════════════════════════════════════════════════════

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN POR TIPO DE FORMULARIO
// ─────────────────────────────────────────────────────────────
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

// Columnas conocidas en la tabla `formularios`. Todo lo demás va a datos_extra.
const COLUMNAS_TABLA = new Set([
  'tipo', 'nombre', 'email', 'ciudad', 'pais', 'cantidad', 'mensaje',
]);

// ─────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { tipo, ...datos } = req.body;

    // Validación básica
    if (!tipo || !CONFIG[tipo]) {
      return res.status(400).json({ error: 'Tipo de formulario no válido' });
    }
    if (!datos.email || !datos.email.includes('@')) {
      return res.status(400).json({ error: 'Email no válido' });
    }
    if (!datos.nombre) {
      return res.status(400).json({ error: 'Falta el nombre' });
    }

    const config = CONFIG[tipo];

    // ─────────────────────────────────────────────────────────
    // 1. Guardar en Supabase
    // ─────────────────────────────────────────────────────────
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        // Separar campos fijos de campos extra
        const fila = { tipo };
        const extra = {};

        for (const [k, v] of Object.entries(datos)) {
          if (COLUMNAS_TABLA.has(k)) {
            fila[k] = Array.isArray(v) ? v.join(', ') : v;
          } else if (v !== undefined && v !== null && v !== '') {
            extra[k] = v;
          }
        }

        if (Object.keys(extra).length > 0) {
          fila.datos_extra = extra;
        }

        const supabaseRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/formularios`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: process.env.SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
              Prefer: 'return=minimal',
            },
            body: JSON.stringify(fila),
          }
        );

        if (!supabaseRes.ok) {
          const errText = await supabaseRes.text();
          console.error('Supabase respondió con error:', supabaseRes.status, errText);
        }
      } catch (dbErr) {
        // Si Supabase falla, seguimos con los emails. No bloqueamos al usuario.
        console.error('Error guardando en Supabase:', dbErr);
      }
    }

    // ─────────────────────────────────────────────────────────
    // 2. Email de notificación al equipo
    // ─────────────────────────────────────────────────────────
    await resend.emails.send({
      from: REMITENTE,
      to: NOTIFICATION_EMAIL,
      replyTo: datos.email,
      subject: `${config.notificationSubject} — ${datos.nombre}`,
      html: renderNotificacion(tipo, datos),
    });

    // ─────────────────────────────────────────────────────────
    // 3. Autoresponder al usuario
    // ─────────────────────────────────────────────────────────
    await resend.emails.send({
      from: REMITENTE,
      to: datos.email,
      replyTo: config.replyTo,
      subject: config.subject,
      html: renderAutoresponder(tipo, datos),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error en /api/enviar:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

// ─────────────────────────────────────────────────────────────
// EMAIL DE NOTIFICACIÓN INTERNA (para el equipo)
// ─────────────────────────────────────────────────────────────
function renderNotificacion(tipo, datos) {
  const filas = Object.entries(datos)
    .map(([k, v]) => {
      const valor = Array.isArray(v) ? v.join(', ') : (v || '—');
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">${k}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial,sans-serif;font-size:14px;color:#111;">${escapeHtml(valor)}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f5f3ee;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:white;padding:32px;">
    <h2 style="font-family:Georgia,serif;color:#0f1f3d;margin-top:0;">
      Nuevo envío de formulario: <span style="text-transform:capitalize;">${tipo.replace('-', ' ')}</span>
    </h2>
    <p style="color:#666;font-size:13px;">Recibido el ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:20px;">
      ${filas}
    </table>
    <p style="color:#888;font-size:12px;margin-top:24px;">
      Para responder al usuario, simplemente responde a este email (el reply-to ya apunta a ${escapeHtml(datos.email)}).
    </p>
  </div>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────
// AUTORESPONDERS AL USUARIO
// ─────────────────────────────────────────────────────────────
function renderAutoresponder(tipo, datos) {
  const nombre = escapeHtml(datos.nombre || '');

  const templates = {
    voluntario: () => {
      const roles = Array.isArray(datos.roles) ? datos.roles.join(', ') : (datos.roles || '—');
      const disp = Array.isArray(datos.disponibilidad) ? datos.disponibilidad.join(', ') : (datos.disponibilidad || '—');
      return wrapper(`
        <p class="salutation">Hola, ${nombre}.</p>
        <p>Hemos recibido tu solicitud de voluntariado. Bienvenido/a a la insurgencia.</p>
        <p>En las próximas <strong>48 horas</strong> te escribimos personalmente para presentarte al equipo, confirmarte el rol que más encaja con tu disponibilidad y contarte los próximos pasos concretos.</p>
        <div class="highlight">
          <p><strong>Lo que seleccionaste:</strong><br>
          Rol: ${escapeHtml(roles)}<br>
          Disponibilidad: ${escapeHtml(disp)}<br>
          Ciudad: ${escapeHtml(datos.ciudad || '—')}</p>
        </div>
        <p>Mientras tanto, si quieres conocer el proyecto en profundidad — la filosofía detrás de la perforación, el sistema A/B/C y hacia dónde vamos — puedes leer el manifiesto completo:</p>
        <p><a href="https://vaciolleno.org/vaciolleno-manifiesto.html" class="btn">Leer el manifiesto →</a></p>
        <hr class="divider">
        <p class="sign">Un saludo,</p>
        <p class="sign-name">El equipo de Vacío Lleno</p>
        <p class="sign-role">Insurgencia intelectual · vaciolleno.org</p>
      `, 'voluntariado');
    },
    'donacion-libros': () => wrapper(`
      <p class="salutation">Hola, ${nombre}.</p>
      <p>Hemos recibido tu formulario de donación de libros. Esto es exactamente lo que hace que el proyecto funcione.</p>
      <p>En las próximas <strong>48 horas</strong> te contactamos para coordinar la recogida o el envío, según lo que te venga mejor.</p>
      <div class="highlight">
        <p><strong>Lo que nos has comunicado:</strong><br>
        Número aprox. de libros: ${escapeHtml(datos.cantidad || '—')}<br>
        Ciudad: ${escapeHtml(datos.ciudad || '—')}<br>
        Método preferido: ${escapeHtml(datos.metodoEntrega || '—')}</p>
      </div>
      <p>Una vez recibamos los libros, los clasificaremos según el sistema A/B/C del proyecto:</p>
      <p style="padding-left:16px;border-left:2px solid #ddd;">
        <strong>30% (Categoría A)</strong> — perforados y distribuidos gratis en Latinoamérica.<br>
        <strong>50% (Categoría B)</strong> — vendidos para financiar los envíos.<br>
        <strong>20% (Categoría C)</strong> — donados a bibliotecas locales.
      </p>
      <p>Cada libro tuyo tiene posibilidades reales de pasar por 40 manos distintas en los próximos años. Eso empieza contigo.</p>
      <hr class="divider">
      <p class="sign">Hasta pronto,</p>
      <p class="sign-name">El equipo de Vacío Lleno</p>
      <p class="sign-role">Insurgencia intelectual · vaciolleno.org</p>
    `, 'donación de libros'),
    'donacion-dinero': () => wrapper(`
      <p class="salutation">Gracias.</p>
      <p>Hemos recibido tu intención de donar. En breve te enviamos el enlace de pago seguro para completar la donación.</p>
      <div class="highlight">
        <p><strong>Resumen:</strong><br>
        Importe indicado: <strong>${escapeHtml(datos.cantidad || '—')}€</strong><br>
        Frecuencia: ${escapeHtml(datos.frecuencia || 'Una vez')}</p>
      </div>
      <p>Con <strong>${escapeHtml(datos.cantidad || 'tu aportación')}€</strong>, el proyecto puede distribuir libros perforados a Latinoamérica. Cada libro pasará por unas 40 manos antes de que deje de circular — si alguna vez lo hace.</p>
      <p>Puedes ver el impacto en tiempo real de lo que estás contribuyendo a construir:</p>
      <p><a href="https://vaciolleno.org/vaciolleno-impacto.html" class="btn">Ver impacto en vivo →</a></p>
      <hr class="divider">
      <p class="sign">Con gratitud,</p>
      <p class="sign-name">El equipo de Vacío Lleno</p>
      <p class="sign-role">Insurgencia intelectual · vaciolleno.org</p>
    `, 'donación'),
    contacto: () => wrapper(`
      <p class="salutation">Hola, ${nombre}.</p>
      <p>Hemos recibido tu mensaje. Gracias por escribirnos.</p>
      <p>Te respondemos en un plazo máximo de <strong>48–72 horas</strong>.</p>
      <div class="highlight">
        <p>Mientras tanto, puede que encuentres lo que buscas en estas secciones del sitio:<br><br>
          <a href="https://vaciolleno.org/vaciolleno-proyecto.html" style="color:#0f1f3d;">→ Cómo funciona el proyecto</a><br>
          <a href="https://vaciolleno.org/vaciolleno-libros.html" style="color:#0f1f3d;">→ Las 10 categorías de libros</a><br>
          <a href="https://vaciolleno.org/vaciolleno-voluntarios.html" style="color:#0f1f3d;">→ Cómo ser voluntario/a</a><br>
          <a href="https://vaciolleno.org/vaciolleno-impacto.html" style="color:#0f1f3d;">→ Impacto en tiempo real</a>
        </p>
      </div>
      <hr class="divider">
      <p class="sign">Hasta pronto,</p>
      <p class="sign-name">El equipo de Vacío Lleno</p>
      <p class="sign-role">Insurgencia intelectual · vaciolleno.org</p>
    `, 'contacto'),
  };

  return templates[tipo]();
}

// Envoltorio HTML común para las 4 plantillas
function wrapper(inner, formularioLabel) {
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
            .highlight { background: rgba(15,31,61,0.06); border-left: 3px solid #c9a84c; padding: 16px 20px; margin: 24px 0; font-family: Arial, sans-serif; font-size: 14px; }
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
          Has recibido este correo porque completaste el formulario de ${formularioLabel} en vaciolleno.org.<br>
          No compartimos tu dirección con terceros. Tu privacidad está protegida bajo el RGPD.<br>
          <a href="https://vaciolleno.org/vaciolleno-legal-privacidad.html" style="color:#888;">Política de privacidad</a> ·
          <a href="https://vaciolleno.org/vaciolleno-legal-aviso.html" style="color:#888;">Aviso legal</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Escape básico de HTML para prevenir inyecciones
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
