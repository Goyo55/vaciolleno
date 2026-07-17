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
  mi_perfil: null,
  resumen: null,

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
  resenas_aprobar: 'resenas',
  resenas_rechazar: 'resenas',
  resenas_destacar_toggle: 'resenas',

  organizaciones_listar: 'organizaciones',
  organizaciones_crear: 'organizaciones',
  organizaciones_actualizar: 'organizaciones',
  organizaciones_eliminar: 'organizaciones',

  libros_deseados_listar: 'libros',
  libros_deseados_crear: 'libros',
  libros_deseados_actualizar: 'libros',
  libros_deseados_eliminar: 'libros',

  usuarios_listar: 'admin',
  usuarios_invitar: 'admin',
  usuarios_actualizar_permisos: 'admin',
  usuarios_desactivar: 'admin',
  usuarios_activar: 'admin',

  blog_listar: 'blog',
  blog_obtener: 'blog',
  blog_crear: 'blog',
  blog_actualizar: 'blog',
  blog_eliminar: 'blog',
  blog_publicar: 'blog',
  blog_despublicar: 'blog',
  blog_generar_slug: 'blog',
  blog_etiquetas_todas: 'blog',
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

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user || !user.id) return null;

  const perfiles = await supa(`admin_perfiles?user_id=eq.${user.id}&select=*`);
  if (!perfiles || perfiles.length === 0) return null;
  const perfil = perfiles[0];
  if (!perfil.activo) return null;

  supa(`admin_perfiles?user_id=eq.${user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ultimo_acceso: new Date().toISOString() }),
    prefer: 'return=minimal',
  }).catch(() => {});

  return perfil;
}

function tienePermiso(perfil, permisoRequerido) {
  if (permisoRequerido === null) return true;
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

  const perfil = await verificarUsuario(access_token);
  if (!perfil) {
    return res.status(401).json({ error: 'Sesión no válida o expirada' });
  }

  const permisoRequerido = PERMISOS_REQUERIDOS[accion];
  if (permisoRequerido === undefined) {
    return res.status(400).json({ error: `Acción desconocida: ${accion}` });
  }
  if (!tienePermiso(perfil, permisoRequerido)) {
    return res.status(403).json({
      error: `No tienes permiso para "${accion}". Requiere: ${permisoRequerido}`
    });
  }

  try {
    let resultado;
    switch (accion) {

      case 'mi_perfil':
        return res.status(200).json({
          ok: true,
          data: {
            user_id: perfil.user_id,
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
      // Ordena por pendientes primero (publicada=false), luego por fecha
      case 'resenas_listar': {
        let filtro = '';
        if (datos.filtro === 'pendientes') filtro = '&publicada=eq.false';
        else if (datos.filtro === 'publicadas') filtro = '&publicada=eq.true';
        return res.status(200).json({
          ok: true,
          data: await supa(`resenas?select=*&order=publicada.asc,creado_en.desc&limit=300${filtro}`),
        });
      }
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
      // Acciones rápidas
      case 'resenas_aprobar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({
          ok: true,
          data: await supa(`resenas?id=eq.${datos.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              publicada: true,
              motivo_rechazo: null,
              aprobada_en: new Date().toISOString(),
              aprobada_por: perfil.user_id,
            }),
          }),
        });
      }
      case 'resenas_rechazar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({
          ok: true,
          data: await supa(`resenas?id=eq.${datos.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              publicada: false,
              motivo_rechazo: datos.motivo || 'No cumple criterios editoriales',
            }),
          }),
        });
      }
      case 'resenas_destacar_toggle': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        const actual = await supa(`resenas?id=eq.${datos.id}&select=destacada`);
        const nuevo = !(actual[0]?.destacada);
        return res.status(200).json({
          ok: true,
          data: await supa(`resenas?id=eq.${datos.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ destacada: nuevo }),
          }),
        });
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

      // ─── LIBROS DESEADOS (wishlist) ───
      case 'libros_deseados_listar':
        return res.status(200).json({ ok: true, data: await supa(`libros_deseados?select=*&order=prioridad.asc,creado_en.desc&limit=500`) });
      case 'libros_deseados_crear':
        return res.status(200).json({ ok: true, data: await supa(`libros_deseados`, { method: 'POST', body: JSON.stringify(datos) }) });
      case 'libros_deseados_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({ ok: true, data: await supa(`libros_deseados?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }) });
      }
      case 'libros_deseados_eliminar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        await supa(`libros_deseados?id=eq.${datos.id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ─── USUARIOS DEL PANEL (solo admin) ───
      case 'usuarios_listar':
        return res.status(200).json({ ok: true, data: await supa(`admin_perfiles?select=*&order=creado_en.asc&limit=200`) });

      case 'usuarios_invitar': {
        const { email, nombre, permisos } = datos;
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email no válido' });
        if (!Array.isArray(permisos) || permisos.length === 0) return res.status(400).json({ error: 'Selecciona al menos un permiso' });

        let newUserId = null;
        const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            email_confirm: true,
            user_metadata: { nombre: nombre || '' },
          }),
        });
        if (createRes.ok) {
          const created = await createRes.json();
          newUserId = created.id || created.user?.id;
        } else {
          const searchRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?filter=email.eq.${encodeURIComponent(email)}`, {
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          });
          if (searchRes.ok) {
            const list = await searchRes.json();
            const users = list.users || list;
            const found = Array.isArray(users) ? users.find(u => u.email === email) : null;
            if (found) newUserId = found.id;
          }
          if (!newUserId) {
            const errText = await createRes.text();
            return res.status(500).json({ error: `Auth users: ${errText}` });
          }
        }

        const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'recovery',
            email,
            redirect_to: 'https://vaciolleno.org/admin.html',
          }),
        });
        if (!linkRes.ok) {
          const errText = await linkRes.text();
          return res.status(500).json({ error: `Generate link: ${errText}` });
        }
        const linkData = await linkRes.json();
        const inviteUrl = linkData.action_link || linkData.properties?.action_link;
        if (!inviteUrl) return res.status(500).json({ error: 'No se pudo obtener el enlace de invitación' });

        try {
          await supa(`admin_perfiles`, {
            method: 'POST',
            body: JSON.stringify({
              user_id: newUserId,
              email,
              nombre: nombre || null,
              permisos,
              activo: true,
              invitado_por: perfil.user_id,
            }),
            prefer: 'return=minimal',
          });
        } catch (_) {
          await supa(`admin_perfiles?user_id=eq.${newUserId}`, {
            method: 'PATCH',
            body: JSON.stringify({ nombre: nombre || null, permisos, activo: true }),
            prefer: 'return=minimal',
          });
        }

        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        if (RESEND_API_KEY) {
          const nombreMostrar = nombre || email.split('@')[0];
          const permisosLista = permisos.map(p => `<li style="margin:0.3rem 0;">${p}</li>`).join('');
          const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#e8e2d6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e2d6;padding:32px 16px;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#f2ede4;font-family:Georgia,serif;color:#1c1a14;">
    <tr><td style="background:#0f1f3d;padding:20px 32px;color:#f2ede4;font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.2em;">● VACÍO LLENO</td></tr>
    <tr><td style="padding:36px 32px;line-height:1.7;font-size:15px;">
      <p style="font-size:18px;font-weight:bold;margin:0 0 20px 0;">Hola, ${nombreMostrar}.</p>
      <p>Te han invitado a formar parte del equipo de <strong>Vacío Lleno</strong> como colaborador/a del panel de gestión.</p>
      <p>Podrás gestionar las siguientes áreas del proyecto:</p>
      <ul style="background:rgba(15,31,61,0.06);border-left:3px solid #c9a84c;padding:16px 20px 16px 40px;margin:24px 0;font-family:Arial,sans-serif;font-size:14px;">${permisosLista}</ul>
      <p>Para activar tu cuenta y establecer tu contraseña, pulsa el botón:</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${inviteUrl}" style="display:inline-block;background:#0f1f3d;color:#f2ede4;padding:16px 32px;text-decoration:none;font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Activar mi cuenta →</a>
      </p>
      <p style="font-size:12px;color:#888;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="font-family:monospace;word-break:break-all;color:#555;">${inviteUrl}</span></p>
      <hr style="border:none;border-top:1px solid rgba(28,26,20,0.15);margin:32px 0 20px;">
      <p style="margin:0 0 4px 0;font-style:italic;color:#555;">Nos vemos dentro,</p>
      <p style="margin:0;font-weight:bold;">El equipo de Vacío Lleno</p>
      <p style="margin:4px 0 0 0;font-family:'Courier New',monospace;font-size:11px;color:#888;letter-spacing:0.1em;text-transform:uppercase;">vaciolleno.org · Libros que circulan</p>
    </td></tr>
    <tr><td style="padding:20px 32px;background:rgba(15,31,61,0.04);font-family:Arial,sans-serif;font-size:11px;color:#888;line-height:1.6;">
      Si no esperabas esta invitación, puedes ignorar este mensaje.<br>El enlace expira en 24 horas.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Vacío Lleno <hola@vaciolleno.org>',
              to: email,
              subject: 'Te han invitado al panel de Vacío Lleno',
              html,
            }),
          });
          if (!emailRes.ok) {
            const errText = await emailRes.text();
            console.error('Resend error:', errText);
            return res.status(200).json({ ok: true, mensaje: `Perfil creado, pero email falló. Enlace directo: ${inviteUrl}` });
          }
        }

        return res.status(200).json({ ok: true, mensaje: `Invitación enviada a ${email}` });
      }

      case 'usuarios_actualizar_permisos': {
        const { user_id, permisos, nombre } = datos;
        if (!user_id) return res.status(400).json({ error: 'Falta user_id' });
        if (!Array.isArray(permisos)) return res.status(400).json({ error: 'Permisos deben ser un array' });

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

      // ─── BLOG ───
      case 'blog_listar': {
        let filtro = '';
        if (datos.estado) filtro += `&estado=eq.${datos.estado}`;
        if (datos.busqueda) filtro += `&or=(titulo.ilike.*${encodeURIComponent(datos.busqueda)}*,resumen.ilike.*${encodeURIComponent(datos.busqueda)}*)`;
        return res.status(200).json({
          ok: true,
          data: await supa(`blog_entradas?select=id,slug,titulo,resumen,etiquetas,imagen_url,autor_nombre,estado,fecha_publicacion,destacada,vistas,creado_en,actualizado_en&order=creado_en.desc&limit=200${filtro}`),
        });
      }
      case 'blog_obtener': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        const rows = await supa(`blog_entradas?id=eq.${datos.id}&select=*`);
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Entrada no encontrada' });
        return res.status(200).json({ ok: true, data: rows[0] });
      }
      case 'blog_generar_slug': {
        if (!datos.texto_base) return res.status(400).json({ error: 'Falta texto_base' });
        const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/generar_slug_blog`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ texto_base: datos.texto_base }),
        });
        const slug = await rpcRes.json();
        return res.status(200).json({ ok: true, data: { slug } });
      }
      case 'blog_crear': {
        const nuevaEntrada = {
          ...datos,
          autor_id: perfil.user_id,
          autor_nombre: datos.autor_nombre || perfil.nombre || perfil.email.split('@')[0],
        };
        // Si no viene slug o viene vacío, genera uno desde el título
        if (!nuevaEntrada.slug) {
          const slugRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/generar_slug_blog`, {
            method: 'POST',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ texto_base: nuevaEntrada.titulo }),
          });
          nuevaEntrada.slug = await slugRes.json();
        }
        return res.status(200).json({ ok: true, data: await supa(`blog_entradas`, { method: 'POST', body: JSON.stringify(nuevaEntrada) }) });
      }
      case 'blog_actualizar': {
        const { id, cambios } = datos;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({ ok: true, data: await supa(`blog_entradas?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }) });
      }
      case 'blog_eliminar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        await supa(`blog_entradas?id=eq.${datos.id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }
      case 'blog_publicar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({
          ok: true,
          data: await supa(`blog_entradas?id=eq.${datos.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              estado: 'publicado',
              fecha_publicacion: datos.fecha_publicacion || new Date().toISOString(),
            }),
          }),
        });
      }
      case 'blog_despublicar': {
        if (!datos.id) return res.status(400).json({ error: 'Falta id' });
        return res.status(200).json({
          ok: true,
          data: await supa(`blog_entradas?id=eq.${datos.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: 'borrador' }),
          }),
        });
      }
      case 'blog_etiquetas_todas': {
        // Devuelve todas las etiquetas únicas usadas en las entradas (para autocompletar)
        const filas = await supa(`blog_entradas?select=etiquetas&limit=500`);
        const set = new Set();
        (filas || []).forEach(f => (f.etiquetas || []).forEach(e => set.add(e)));
        return res.status(200).json({ ok: true, data: Array.from(set).sort() });
      }

      // ─── RESUMEN ───
      case 'resumen': {
        const [formNuevos, voluntarios, libros, resenasPendientes, resenasTotal, donaciones, blogBorradores, blogPublicadas] = await Promise.all([
          supa(`formularios?select=id&estado=eq.nuevo`),
          supa(`voluntarios?select=id`),
          supa(`libros?select=id`),
          supa(`resenas?select=id&publicada=eq.false`),
          supa(`resenas?select=id`),
          supa(`donaciones?select=id&estado=eq.confirmada`),
          supa(`blog_entradas?select=id&estado=eq.borrador`),
          supa(`blog_entradas?select=id&estado=eq.publicado`),
        ]);
        return res.status(200).json({
          ok: true,
          data: {
            formularios_nuevos: formNuevos.length,
            voluntarios_publicados: voluntarios.length,
            libros_total: libros.length,
            resenas_pendientes: resenasPendientes.length,
            resenas_total: resenasTotal.length,
            donaciones_confirmadas: donaciones.length,
            blog_borradores: blogBorradores.length,
            blog_publicadas: blogPublicadas.length,
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
