// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Panel de administración (backend)
// ═══════════════════════════════════════════════════════════════════
// Función serverless única que recibe todas las operaciones del panel
// admin. Verifica contraseña en cada request y hace las operaciones
// con la SUPABASE_SERVICE_KEY (salta RLS).
//
// Estructura del body:
//   { password: "...", accion: "listar_libros", datos: {...} }
// ═══════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PWD    = process.env.ADMIN_PASSWORD;

// ─── Cliente REST minimalista de Supabase ───
async function supa(path, opciones = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opciones,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opciones.method === 'POST' ? 'return=representation' : 'return=representation',
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

// ─── Handler principal ───
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { password, accion, datos = {} } = req.body || {};

  // Verificación de contraseña (con pequeño delay para disuadir brute force)
  if (!ADMIN_PWD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD no configurada en Vercel' });
  }
  if (!password || password !== ADMIN_PWD) {
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  try {
    let resultado;
    switch (accion) {
      // ─── LOGIN ───
      case 'login':
        return res.status(200).json({ ok: true });

      // ─── FORMULARIOS (bandeja de entrada de voluntarios) ───
      case 'formularios_listar': {
        const filtro = datos.estado ? `&estado=eq.${datos.estado}` : '';
        resultado = await supa(`formularios?select=*&order=creado_en.desc&limit=200${filtro}`);
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'formularios_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        resultado = await supa(`formularios?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify(cambios),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }

      // ─── VOLUNTARIOS (fichas públicas) ───
      case 'voluntarios_listar': {
        resultado = await supa(`voluntarios?select=*&order=orden_visual.asc,creado_en.desc&limit=200`);
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'voluntarios_crear': {
        resultado = await supa(`voluntarios`, {
          method: 'POST',
          body: JSON.stringify(datos),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'voluntarios_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        resultado = await supa(`voluntarios?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify(cambios),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'voluntarios_eliminar': {
        const { id } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await supa(`voluntarios?id=eq.${id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── LIBROS ───
      case 'libros_listar': {
        resultado = await supa(`libros?select=*&order=creado_en.desc&limit=500`);
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'libros_crear': {
        resultado = await supa(`libros`, {
          method: 'POST',
          body: JSON.stringify(datos),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'libros_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        resultado = await supa(`libros?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify(cambios),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'libros_eliminar': {
        const { id } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await supa(`libros?id=eq.${id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── RESEÑAS ───
      case 'resenas_listar': {
        resultado = await supa(`resenas?select=*&order=creado_en.desc&limit=200`);
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'resenas_crear': {
        resultado = await supa(`resenas`, {
          method: 'POST',
          body: JSON.stringify(datos),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'resenas_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        resultado = await supa(`resenas?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify(cambios),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'resenas_eliminar': {
        const { id } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await supa(`resenas?id=eq.${id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── ORGANIZACIONES ───
      case 'organizaciones_listar': {
        resultado = await supa(`organizaciones?select=*&order=creado_en.desc&limit=200`);
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'organizaciones_crear': {
        resultado = await supa(`organizaciones`, {
          method: 'POST',
          body: JSON.stringify(datos),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'organizaciones_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        resultado = await supa(`organizaciones?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify(cambios),
        });
        return res.status(200).json({ ok: true, data: resultado });
      }
      case 'organizaciones_eliminar': {
        const { id } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await supa(`organizaciones?id=eq.${id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── RESUMEN DASHBOARD ADMIN ───
      case 'resumen': {
        const [formNuevos, voluntarios, libros, resenas, donaciones] = await Promise.all([
          supa(`formularios?select=id&estado=eq.nuevo`),
          supa(`voluntarios?select=id`),
          supa(`libros?select=id`),
          supa(`resenas?select=id`),
          supa(`donaciones?select=id&estado=eq.confirmada`),
        ]);
        return res.status(200).json({
          ok: true,
          data: {
            formularios_nuevos: formNuevos.length,
            voluntarios_publicados: voluntarios.length,
            libros_total: libros.length,
            resenas_total: resenas.length,
            donaciones_confirmadas: donaciones.length,
          },
        });
      }

      default:
        return res.status(400).json({ error: `Acción desconocida: ${accion}` });
    }
  } catch (err) {
    console.error('Error en /api/admin:', err);
    return res.status(500).json({ error: err.message });
  }
}
