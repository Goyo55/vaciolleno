// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Blog público (Home + listado + entrada individual)
// ═══════════════════════════════════════════════════════════════════
// Autodetecta contenedores y actúa:
//   #blog-home-grid          → 3 tarjetas más recientes en la Home
//   #blog-listado            → listado completo con "Ver más" y filtros
//   #blog-entrada            → una entrada individual (renderiza Markdown)
// ═══════════════════════════════════════════════════════════════════

(function() {
  const SUPABASE_URL  = 'https://tuagkbjixoolmtmwwsus.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_VFoLqoJsalIKNJ2GFpSbzA_QS5RH4-U';

  // ─── Utilidades ───
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fecha(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function tiempoLectura(texto) {
    const palabras = (texto || '').trim().split(/\s+/).length;
    const min = Math.max(1, Math.round(palabras / 200));
    return `${min} min de lectura`;
  }

  // Slug URL para una entrada
  function urlEntrada(slug) {
    return `/blog/${slug}`;
  }

  // Extraer slug de la URL actual (soporta /blog/xxx o ?slug=xxx)
  function slugActual() {
    // 1. Query param
    const params = new URLSearchParams(window.location.search);
    const q = params.get('slug');
    if (q) return q;
    // 2. Path /blog/xxx
    const match = window.location.pathname.match(/\/blog\/([^\/?#]+)/);
    return match ? match[1] : null;
  }

  // Cargar marked (Markdown parser) desde CDN si no está disponible
  function cargarMarked() {
    return new Promise((resolve) => {
      if (typeof marked !== 'undefined') return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js';
      script.onload = () => resolve();
      script.onerror = () => resolve(); // fallback silencioso
      document.head.appendChild(script);
    });
  }

  // ─── Fetch a las RPC públicas ───
  async function fetchListado(limite = 20, desplazamiento = 0, etiqueta = null) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_blog_listado`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limite,
          desplazamiento,
          etiqueta_filtro: etiqueta || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Error cargando blog:', err);
      return [];
    }
  }

  async function fetchEntrada(slug) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_blog_entrada`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug_buscar: slug }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error('Error cargando entrada:', err);
      return null;
    }
  }

  async function fetchEtiquetas() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_blog_etiquetas`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      return [];
    }
  }

  async function incrementarVistas(slug) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/incrementar_vistas_blog`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug_buscar: slug }),
      });
    } catch (_) { /* ignorar */ }
  }

  // ─── Renderizar tarjeta ───
  function renderTarjeta(e, opciones = {}) {
    const tieneImagen = e.imagen_url && e.imagen_url.trim() !== '';
    const etiquetas = (e.etiquetas || []).slice(0, 3).map(t =>
      `<span class="blog-tag">${esc(t)}</span>`
    ).join('');
    const featuredClass = opciones.destacada && e.destacada ? ' blog-card-destacada' : '';

    return `
      <a href="${urlEntrada(esc(e.slug))}" class="blog-card${featuredClass}">
        ${tieneImagen ? `
          <div class="blog-card-imagen" style="background-image:url('${esc(e.imagen_url)}');">
            ${e.destacada ? '<span class="blog-card-badge">Destacada</span>' : ''}
          </div>
        ` : `
          <div class="blog-card-imagen blog-card-imagen-placeholder">
            ${e.destacada ? '<span class="blog-card-badge">Destacada</span>' : ''}
            <span class="placeholder-glyph">●</span>
          </div>
        `}
        <div class="blog-card-body">
          ${etiquetas ? `<div class="blog-card-tags">${etiquetas}</div>` : ''}
          <h3 class="blog-card-title">${esc(e.titulo || '')}</h3>
          ${e.resumen ? `<p class="blog-card-resumen">${esc(e.resumen)}</p>` : ''}
          <div class="blog-card-meta">
            <span>${esc(e.autor_nombre || 'Equipo Vacío Lleno')}</span>
            <span class="blog-sep">·</span>
            <span>${fecha(e.fecha_publicacion)}</span>
          </div>
        </div>
      </a>
    `;
  }

  // ─── HOME: 3 tarjetas ───
  async function pintarHome(container) {
    container.innerHTML = '<div class="blog-loading">Cargando entradas…</div>';
    const entradas = await fetchListado(3);
    if (!entradas || entradas.length === 0) {
      container.innerHTML = '<div class="blog-loading">Pronto empezaremos a publicar aquí. Vuelve en unos días.</div>';
      return;
    }
    container.innerHTML = entradas.map(e => renderTarjeta(e)).join('');
  }

  // ─── Listado con filtros y paginación ───
  const LISTADO_BATCH = 12;
  let listadoEstado = { desplazamiento: 0, etiqueta: null, terminado: false };

  async function pintarListado(container) {
    // Etiqueta inicial desde URL (?tag=xxx)
    const params = new URLSearchParams(window.location.search);
    listadoEstado.etiqueta = params.get('tag') || null;

    container.innerHTML = '<div class="blog-loading">Cargando entradas…</div>';

    // Pintar barra de etiquetas
    const barraEtiquetas = document.getElementById('blog-etiquetas-barra');
    if (barraEtiquetas) {
      const etiquetas = await fetchEtiquetas();
      const chipsTodos = `<button class="blog-tag-btn ${!listadoEstado.etiqueta ? 'active' : ''}" data-etiqueta="">Todas</button>`;
      const chipsEtiq = etiquetas.slice(0, 20).map(e =>
        `<button class="blog-tag-btn ${listadoEstado.etiqueta === e.etiqueta ? 'active' : ''}" data-etiqueta="${esc(e.etiqueta)}">${esc(e.etiqueta)} <span class="blog-tag-count">${e.total}</span></button>`
      ).join('');
      barraEtiquetas.innerHTML = chipsTodos + chipsEtiq;
      barraEtiquetas.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.blog-tag-btn');
        if (!btn) return;
        const etiqueta = btn.dataset.etiqueta || null;
        const url = new URL(window.location.href);
        if (etiqueta) url.searchParams.set('tag', etiqueta);
        else url.searchParams.delete('tag');
        window.history.replaceState({}, '', url);
        listadoEstado = { desplazamiento: 0, etiqueta, terminado: false };
        barraEtiquetas.querySelectorAll('.blog-tag-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cargarLote(container, true);
      });
    }

    await cargarLote(container, true);
  }

  async function cargarLote(container, reset) {
    if (reset) {
      listadoEstado.desplazamiento = 0;
      listadoEstado.terminado = false;
      container.innerHTML = '';
    }
    const entradas = await fetchListado(LISTADO_BATCH, listadoEstado.desplazamiento, listadoEstado.etiqueta);

    if (reset && entradas.length === 0) {
      container.innerHTML = `<div class="blog-loading">${listadoEstado.etiqueta ? 'No hay entradas con la etiqueta "' + esc(listadoEstado.etiqueta) + '"' : 'Aún no hay entradas publicadas.'}</div>`;
      const btn = document.getElementById('blog-ver-mas');
      if (btn) btn.style.display = 'none';
      return;
    }
    if (entradas.length < LISTADO_BATCH) listadoEstado.terminado = true;

    const html = entradas.map(e => renderTarjeta(e, { destacada: reset })).join('');
    container.insertAdjacentHTML('beforeend', html);
    listadoEstado.desplazamiento += entradas.length;

    const btnVerMas = document.getElementById('blog-ver-mas');
    if (btnVerMas) {
      btnVerMas.style.display = listadoEstado.terminado ? 'none' : 'inline-block';
      if (!btnVerMas.dataset.conectado) {
        btnVerMas.dataset.conectado = '1';
        btnVerMas.addEventListener('click', () => cargarLote(container, false));
      }
    }
  }

  // ─── Entrada individual ───
  async function pintarEntrada(container) {
    const slug = slugActual();
    if (!slug) {
      container.innerHTML = renderNoEncontrado();
      return;
    }
    container.innerHTML = '<div class="blog-loading" style="padding:6rem 2rem;">Cargando…</div>';

    const [entrada] = await Promise.all([
      fetchEntrada(slug),
      cargarMarked(),
    ]);

    if (!entrada) {
      container.innerHTML = renderNoEncontrado();
      return;
    }

    // Actualizar título y meta description
    document.title = `${entrada.titulo} — Vacío Lleno`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && entrada.resumen) metaDesc.setAttribute('content', entrada.resumen);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', `${entrada.titulo} — Vacío Lleno`);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc && entrada.resumen) ogDesc.setAttribute('content', entrada.resumen);
    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg && entrada.imagen_url) ogImg.setAttribute('content', entrada.imagen_url);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', `https://vaciolleno.org/blog/${entrada.slug}`);

    // Renderizar Markdown
    const contenidoHtml = typeof marked !== 'undefined'
      ? marked.parse(entrada.contenido || '')
      : `<pre>${esc(entrada.contenido || '')}</pre>`;

    const etiquetasHtml = (entrada.etiquetas || []).map(t =>
      `<a href="/blog?tag=${encodeURIComponent(t)}" class="blog-tag">${esc(t)}</a>`
    ).join('');

    container.innerHTML = `
      ${entrada.imagen_url ? `
        <div class="entrada-hero" style="background-image:url('${esc(entrada.imagen_url)}');">
          <div class="entrada-hero-overlay"></div>
          <div class="entrada-hero-content">
            ${etiquetasHtml ? `<div class="entrada-tags">${etiquetasHtml}</div>` : ''}
            <h1 class="entrada-titulo">${esc(entrada.titulo)}</h1>
            <div class="entrada-meta">
              <span>${esc(entrada.autor_nombre || 'Equipo Vacío Lleno')}</span>
              <span class="blog-sep">·</span>
              <span>${fecha(entrada.fecha_publicacion)}</span>
              <span class="blog-sep">·</span>
              <span>${tiempoLectura(entrada.contenido)}</span>
            </div>
          </div>
        </div>
      ` : `
        <div class="entrada-hero entrada-hero-plain">
          <div class="entrada-hero-content">
            ${etiquetasHtml ? `<div class="entrada-tags">${etiquetasHtml}</div>` : ''}
            <h1 class="entrada-titulo">${esc(entrada.titulo)}</h1>
            <div class="entrada-meta">
              <span>${esc(entrada.autor_nombre || 'Equipo Vacío Lleno')}</span>
              <span class="blog-sep">·</span>
              <span>${fecha(entrada.fecha_publicacion)}</span>
              <span class="blog-sep">·</span>
              <span>${tiempoLectura(entrada.contenido)}</span>
            </div>
          </div>
        </div>
      `}

      ${entrada.resumen ? `<p class="entrada-resumen">${esc(entrada.resumen)}</p>` : ''}

      <article class="entrada-contenido">${contenidoHtml}</article>

      ${etiquetasHtml ? `
        <div class="entrada-footer-tags">
          <div class="entrada-footer-tags-label">Etiquetas</div>
          <div>${etiquetasHtml}</div>
        </div>
      ` : ''}

      <div class="entrada-compartir">
        <div class="entrada-footer-tags-label">Compartir</div>
        <div class="entrada-compartir-botones">
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(entrada.titulo + ' — Vacío Lleno')}&url=${encodeURIComponent('https://vaciolleno.org/blog/' + entrada.slug)}" target="_blank" rel="noopener">X / Twitter</a>
          <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(entrada.titulo + ' — https://vaciolleno.org/blog/' + entrada.slug)}" target="_blank" rel="noopener">WhatsApp</a>
          <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('https://vaciolleno.org/blog/' + entrada.slug)}" target="_blank" rel="noopener">LinkedIn</a>
          <button onclick="navigator.clipboard.writeText('https://vaciolleno.org/blog/${esc(entrada.slug)}').then(() => this.textContent = 'Enlace copiado ✓').catch(() => {})">Copiar enlace</button>
        </div>
      </div>

      <div class="entrada-cta">
        <h3>El proyecto continúa</h3>
        <p>Vacío Lleno vive gracias a personas que donan libros, dinero o su tiempo. Súmate.</p>
        <div class="entrada-cta-botones">
          <a href="/vaciolleno-donaciones.html" class="btn-primary"><span>Donar</span></a>
          <a href="/blog" class="btn-secondary">Más entradas</a>
        </div>
      </div>
    `;

    // Incrementar contador de vistas (fire-and-forget)
    incrementarVistas(slug);
  }

  function renderNoEncontrado() {
    return `
      <div class="entrada-hero entrada-hero-plain">
        <div class="entrada-hero-content">
          <h1 class="entrada-titulo">Entrada no encontrada</h1>
          <div class="entrada-meta">Es posible que haya sido despublicada o que la URL sea incorrecta.</div>
        </div>
      </div>
      <div class="entrada-cta">
        <a href="/blog" class="btn-primary"><span>Ver todas las entradas</span></a>
      </div>
    `;
  }

  // ─── Arranque ───
  document.addEventListener('DOMContentLoaded', () => {
    const homeGrid = document.getElementById('blog-home-grid');
    if (homeGrid) pintarHome(homeGrid);

    const listado = document.getElementById('blog-listado');
    if (listado) pintarListado(listado);

    const entrada = document.getElementById('blog-entrada');
    if (entrada) pintarEntrada(entrada);
  });
})();
