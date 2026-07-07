// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Panel de administración (backend con Supabase Auth)
// ═══════════════════════════════════════════════════════════════════
// Verifica JWT de Supabase Auth en cada request, comprueba permisos
// del usuario, y ejecuta operaciones usando SUPABASE_SERVICE_KEY.
// ═══════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// ─── Mapa de acciones → permiso requerido ───
const PERMISOS_REQUERIDOS = {
  mi_perfil: null,      // cualquier autenticado
  resumen: null,        // cualquier autenticado

  formularios_listar: 'formularios',
  formularios_actualizar: 'formularios',

  voluntarios_listar: 'voluntarios',
  voluntarios_crear: 'voluntarios',
  voluntarios_actualizar: 'voluntarios',
  voluntarios_eliminar: 'voluntarios',

  libros_listar: 'libros',
  libros_crear: 'libros',
  libros_actualizar: 'libros',
  libros_eliminar: 'libros',

  resenas_listar: 'resenas',
  resenas_crear: 'resenas',
  resenas_actualizar: 'resenas',
  resenas_eliminar: 'resenas',

  organizaciones_listar: 'organizaciones',
  organizaciones_crear: 'organizaciones',
  organizaciones_actualizar: 'organizaciones',
  organizaciones_eliminar: 'organizaciones',

  usuarios_listar: 'admin',
  usuarios_invitar: 'admin',
  usuarios_actualizar_permisos: 'admin',
  usuarios_desactivar: 'admin',
  usuarios_activar: 'admin',
};

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

// ─── Verificar token del usuario y obtener perfil ───
async function verificarUsuario(accessToken) {
  if (!accessToken) return null;

  // Verificar token contra Supabase Auth
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user || !user.id) return null;

  // Obtener perfil
  const perfiles = await supa(`admin_perfiles?user_id=eq.${user.id}&select=*`);
  if (!perfiles || perfiles.length === 0) return null;
  const perfil = perfiles[0];
  if (!perfil.activo) return null;

  // Actualizar último acceso (fire-and-forget)
  supa(`admin_perfiles?user_id=eq.${user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ultimo_acceso: new Date().toISOString() }),
    prefer: 'return=minimal',
  }).catch(() => {});

  return perfil;
}

// ─── Verificar si el usuario tiene un permiso ───
function tienePermiso(perfil, permisoRequerido) {
  if (permisoRequerido === null) return true;  // no requiere permiso
  if (!perfil.permisos) return false;
  return perfil.permisos.includes('admin') || perfil.permisos.includes(permisoRequerido);
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { access_token, accion, datos = {} } = req.body || {};

  // 1. Verificar autenticación
  const perfil = await verificarUsuario(access_token);
  if (!perfil) {
    return res.status(401).json({ error: 'Sesión no válida o expirada' });
  }

  // 2. Verificar permisos
  const permisoRequerido = PERMISOS_REQUERIDOS[accion];
  if (permisoRequerido === undefined) {
    return res.status(400).json({ error: `Acción desconocida: ${accion}` });
  }
  if (!tienePermiso(perfil, permisoRequerido)) {
    return res.status(403).json({
      error: `No tienes permiso para "${accion}". Requiere: ${permisoRequerido}`
    });
  }

  // 3. Ejecutar acción
  try {
    let resultado;
    switch (accion) {

      case 'mi_perfil':
        return res.status(200).json({
          ok: true,
          data: {
            email: perfil.email,
            nombre: perfil.nombre,
            permisos: perfil.permisos,
          },
        });

      // ─── FORMULARIOS ───
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

      // ─── VOLUNTARIOS ───
      case 'voluntarios_listar':
        return res.status(200).json({ ok: true, data: await supa(`voluntarios?select=*&order=orden_visual.asc,creado_en.desc&limit=200`) });
      case 'voluntarios_crear':
        return res.status(200).json({ ok: true, data: await supa(`voluntarios`, { method: 'POST', body: JSON.stringify(datos) }) });
      case 'voluntarios_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({ ok: true, data: await supa(`voluntarios?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }) });
      }
      case 'voluntarios_eliminar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        await supa(`voluntarios?id=eq.${datos.id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── LIBROS ───
      case 'libros_listar':
        return res.status(200).json({ ok: true, data: await supa(`libros?select=*&order=creado_en.desc&limit=500`) });
      case 'libros_crear':
        return res.status(200).json({ ok: true, data: await supa(`libros`, { method: 'POST', body: JSON.stringify(datos) }) });
      case 'libros_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({ ok: true, data: await supa(`libros?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }) });
      }
      case 'libros_eliminar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        await supa(`libros?id=eq.${datos.id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── RESEÑAS ───
      case 'resenas_listar':
        return res.status(200).json({ ok: true, data: await supa(`resenas?select=*&order=creado_en.desc&limit=200`) });
      case 'resenas_crear':
        return res.status(200).json({ ok: true, data: await supa(`resenas`, { method: 'POST', body: JSON.stringify(datos) }) });
      case 'resenas_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({ ok: true, data: await supa(`resenas?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }) });
      }
      case 'resenas_eliminar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        await supa(`resenas?id=eq.${datos.id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── ORGANIZACIONES ───
      case 'organizaciones_listar':
        return res.status(200).json({ ok: true, data: await supa(`organizaciones?select=*&order=creado_en.desc&limit=200`) });
      case 'organizaciones_crear':
        return res.status(200).json({ ok: true, data: await supa(`organizaciones`, { method: 'POST', body: JSON.stringify(datos) }) });
      case 'organizaciones_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({ ok: true, data: await supa(`organizaciones?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }) });
      }
      case 'organizaciones_eliminar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        await supa(`organizaciones?id=eq.${datos.id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── USUARIOS DEL PANEL (solo admin) ───
      case 'usuarios_listar':
        return res.status(200).json({ ok: true, data: await supa(`admin_perfiles?select=*&order=creado_en.asc&limit=200`) });

      case 'usuarios_invitar': {
        const { email, nombre, permisos } = datos;
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email no válido' });
        if (!Array.isArray(permisos) || permisos.length === 0) return res.status(400).json({ error: 'Selecciona al menos un permiso' });

        // 1. Invitar en Supabase Auth (envía email con enlace de setup)
        const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/invite`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, data: { nombre: nombre || '' } }),
        });
        if (!inviteRes.ok) {
          const errText = await inviteRes.text();
          return res.status(500).json({ error: `Error invitando: ${errText}` });
        }
        const inviteData = await inviteRes.json();
        const newUserId = inviteData.user?.id || inviteData.id;
        if (!newUserId) return res.status(500).json({ error: 'Auth no devolvió user_id' });

        // 2. Crear perfil con permisos
        try {
          await supa(`admin_perfiles`, {
            method: 'POST',
            body: JSON.stringify({
              user_id: newUserId,
              email: email,
              nombre: nombre || null,
              permisos: permisos,
              activo: true,
              invitado_por: perfil.user_id,
            }),
            prefer: 'return=minimal',
          });
        } catch (perfilErr) {
          // Si el perfil ya existía, actualizar en lugar de fallar
          await supa(`admin_perfiles?user_id=eq.${newUserId}`, {
            method: 'PATCH',
            body: JSON.stringify({ nombre: nombre || null, permisos, activo: true }),
            prefer: 'return=minimal',
          });
        }

        return res.status(200).json({ ok: true, mensaje: `Invitación enviada a ${email}` });
      }

      case 'usuarios_actualizar_permisos': {
        const { user_id, permisos, nombre } = datos;
        if (!user_id) return res.status(400).json({ error: 'Falta user_id' });
        if (!Array.isArray(permisos)) return res.status(400).json({ error: 'Permisos deben ser un array' });

        // Protección: no puedes quitarte a ti mismo el permiso 'admin' si eres el único admin
        if (user_id === perfil.user_id && !permisos.includes('admin')) {
          const otrosAdmins = await supa(`admin_perfiles?permisos=cs.{admin}&activo=eq.true&user_id=neq.${perfil.user_id}&select=user_id`);
          if (!otrosAdmins || otrosAdmins.length === 0) {
            return res.status(400).json({ error: 'No puedes quitarte "admin" siendo el único administrador activo' });
          }
        }

        const cambios = { permisos };
        if (nombre !== undefined) cambios.nombre = nombre;
        return res.status(200).json({
          ok: true,
          data: await supa(`admin_perfiles?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify(cambios),
          }),
        });
      }

      case 'usuarios_desactivar': {
        const { user_id } = datos;
        if (!user_id) return res.status(400).json({ error: 'Falta user_id' });
        if (user_id === perfil.user_id) {
          return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });
        }
        return res.status(200).json({
          ok: true,
          data: await supa(`admin_perfiles?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ activo: false }),
          }),
        });
      }

      case 'usuarios_activar': {
        const { user_id } = datos;
        if (!user_id) return res.status(400).json({ error: 'Falta user_id' });
        return res.status(200).json({
          ok: true,
          data: await supa(`admin_perfiles?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ activo: true }),
          }),
        });
      }

      // ─── RESUMEN ───
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
        return res.status(400).json({ error: `Acción no implementada: ${accion}` });
    }
  } catch (err) {
    console.error('Error en /api/admin:', err);
    return res.status(500).json({ error: err.message });
  }
}
