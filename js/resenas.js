// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Gestión de reseñas públicas
// ═══════════════════════════════════════════════════════════════════
// Autodetecta contenedores en la página y actúa:
//   #resenas-home-grid       → rellena 3 tarjetas en la Home
//   #resenas-listado         → rellena listado completo en la página propia
//   #resenaForm              → maneja el envío del formulario público
// ═══════════════════════════════════════════════════════════════════

(function() {
  const SUPABASE_URL  = 'https://tuagkbjixoolmtmwwsus.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_VFoLqoJsalIKNJ2GFpSbzA_QS5RH4-U';

  const TIPO_LABEL = {
    donante: 'Donante',
    voluntario: 'Voluntario',
    receptor: 'Receptor',
    organizacion: 'Organización',
    otro: 'Comunidad',
  };

  // ─── Utilidades ───
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ubicacionTexto(r) {
    return [r.ciudad, r.pais].filter(Boolean).map(esc).join(', ');
  }

  // ─── Fetch a la RPC pública ───
  async function fetchResenas(limite = 20) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_resenas_publicas`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ limite }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Error cargando reseñas:', err);
      return [];
    }
  }

  // ─── Renderizar tarjeta ───
  function renderTarjeta(r) {
    const nombre = esc(r.autor_nombre || 'Anónimo');
    const tipo = esc(TIPO_LABEL[r.autor_tipo] || 'Comunidad');
    const ubicacion = ubicacionTexto(r);
    return `
      <article class="resena-card">
        <div class="resena-quote-mark">"</div>
        <blockquote class="resena-cita">${esc(r.cita || '')}</blockquote>
        <div class="resena-autor">
          <div class="resena-nombre">${nombre}</div>
          <div class="resena-meta">
            <span>${tipo}</span>${ubicacion ? '<span class="resena-sep">·</span><span>' + ubicacion + '</span>' : ''}
          </div>
        </div>
      </article>
    `;
  }

  // ─── HOME: 3 tarjetas fijas ───
  async function pintarHome(container) {
    container.innerHTML = '<div class="resenas-loading">Cargando voces…</div>';
    const resenas = await fetchResenas(3);
    if (!resenas || resenas.length === 0) {
      container.innerHTML = '<div class="resenas-loading">Todavía no hay testimonios publicados. Sé el primero en compartir tu experiencia.</div>';
      return;
    }
    container.innerHTML = resenas.slice(0, 3).map(renderTarjeta).join('');
  }

  // ─── Página propia: listado completo con filtros ───
  let resenasCache = [];
  let filtroActivo = 'todas';

  async function pintarListado(container) {
    container.innerHTML = '<div class="resenas-loading">Cargando voces…</div>';
    resenasCache = await fetchResenas(200);
    aplicarFiltro(container);
    conectarFiltros();
  }

  function aplicarFiltro(container) {
    let filtradas = resenasCache;
    if (filtroActivo !== 'todas') {
      filtradas = resenasCache.filter(r => r.autor_tipo === filtroActivo);
    }
    if (filtradas.length === 0) {
      container.innerHTML = '<div class="resenas-loading">No hay testimonios en este filtro todavía.</div>';
    } else {
      container.innerHTML = filtradas.map(renderTarjeta).join('');
    }
    // Actualizar contador
    const contador = document.getElementById('resenas-contador');
    if (contador) {
      contador.textContent = filtradas.length === 1
        ? '1 testimonio'
        : `${filtradas.length} testimonios`;
    }
  }

  function conectarFiltros() {
    const botones = document.querySelectorAll('[data-filtro-tipo]');
    botones.forEach(btn => {
      btn.addEventListener('click', () => {
        filtroActivo = btn.dataset.filtroTipo;
        botones.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cont = document.getElementById('resenas-listado');
        if (cont) aplicarFiltro(cont);
      });
    });
  }

  // ─── Formulario público ───
  function conectarFormulario(form) {
    const msg = document.getElementById('resenaFormMsg');
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      msg.className = 'resena-form-msg';

      const datos = {
        tipo: 'resena',
        nombre: form.rNombre.value.trim(),
        email: form.rEmail.value.trim(),
        tipo_perfil: form.rTipoPerfil.value,
        cita: form.rCita.value.trim(),
        ciudad: form.rCiudad.value.trim(),
        pais: form.rPais.value.trim(),
      };

      // Validación básica en cliente
      if (!datos.nombre || !datos.email || !datos.cita) {
        msg.textContent = 'Por favor completa los campos obligatorios.';
        msg.classList.add('error');
        return;
      }
      if (!datos.email.includes('@')) {
        msg.textContent = 'El email no parece válido.';
        msg.classList.add('error');
        return;
      }
      if (datos.cita.length < 20) {
        msg.textContent = 'La reseña necesita al menos 20 caracteres. Cuéntanos un poco más.';
        msg.classList.add('error');
        return;
      }

      submitBtn.disabled = true;
      const textoOriginal = submitBtn.textContent;
      submitBtn.textContent = 'Enviando…';

      try {
        const res = await fetch('/api/enviar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Error al enviar');

        msg.textContent = '¡Gracias! Recibimos tu reseña. La revisaremos y publicaremos en unos días. Te avisamos por email.';
        msg.classList.add('ok');
        form.reset();
      } catch (err) {
        msg.textContent = 'Hubo un problema al enviar. Vuelve a intentarlo en un momento.';
        msg.classList.add('error');
        console.error(err);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = textoOriginal;
      }
    });
  }

  // ─── Arranque ───
  document.addEventListener('DOMContentLoaded', () => {
    const homeGrid = document.getElementById('resenas-home-grid');
    if (homeGrid) pintarHome(homeGrid);

    const listado = document.getElementById('resenas-listado');
    if (listado) pintarListado(listado);

    const form = document.getElementById('resenaForm');
    if (form) conectarFormulario(form);
  });
})();
