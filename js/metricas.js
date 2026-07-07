// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Carga automática de métricas y contenido desde Supabase
// ═══════════════════════════════════════════════════════════════════

(function() {
  const SUPABASE_URL = 'https://tuagkbjixoolmtmwwsus.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_VFoLqoJsalIKNJ2GFpSbzA_QS5RH4-U';

  const formateadores = {
    numero: (n) => n === null || n === undefined ? '0' : Number(n).toLocaleString('es-ES'),
    compacto: (n) => {
      if (!n || n < 1000) return String(Math.round(n || 0));
      if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
      return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    },
    euros: (n) => '€' + Number(n || 0).toLocaleString('es-ES'),
    'euros-compacto': (n) => {
      if (!n || n < 1000) return '€' + Math.round(n || 0);
      if (n < 1000000) return '€' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
      return '€' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    },
  };

  function animarNumero(el, valorFinal, formato = 'numero') {
    const fmt = formateadores[formato] || formateadores.numero;
    const dur = 1200;
    const inicio = performance.now();
    function tick(ahora) {
      const t = Math.min((ahora - inicio) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(valorFinal * eased);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = fmt(valorFinal);
    }
    requestAnimationFrame(tick);
  }

  const ESTADO_LABELS = {
    recibido: { texto: 'Recibido', icono: '📥', clase: 'new' },
    clasificado: { texto: 'Clasificado', icono: '📚', clase: 'new' },
    perforado: { texto: 'Perforado', icono: '○', clase: 'new' },
    en_transito: { texto: 'En tránsito →', icono: '📦', clase: 'transit' },
    entregado: { texto: 'Entregado', icono: '📗', clase: 'delivered' },
    en_circulacion: { texto: 'En circulación', icono: '🔄', clase: 'delivered' },
  };

  // ═══ 10 categorías temáticas (deben coincidir con la BD) ═══
  const CATEGORIA_LABELS = {
    economia_finanzas: 'Economía & Finanzas',
    filosofia_pensamiento: 'Filosofía & Pensamiento Crítico',
    libertad_derechos: 'Libertad & Derechos',
    historia_politica: 'Historia & Política',
    ciencia_tecnologia: 'Ciencia & Tecnología',
    psicologia_desarrollo: 'Psicología & Desarrollo',
    liderazgo_emprendimiento: 'Liderazgo & Emprendimiento',
    biografias_memorias: 'Biografías & Memorias',
    literatura_ficcion: 'Literatura & Ficción',
    educacion_pedagogia: 'Educación & Pedagogía',
  };

  const CATEGORIA_COLORES = [
    '#c9a84c', '#4a9eff', '#00d4a1', '#ff9f43',
    '#a29bfe', '#ff4757', '#e17055', '#00b894',
    '#6c5ce7', '#fdcb6e'
  ];

  function tiempoRelativo(fechaStr) {
    if (!fechaStr) return '';
    const diff = (Date.now() - new Date(fechaStr).getTime()) / 1000;
    if (diff < 60) return Math.round(diff) + 's';
    if (diff < 3600) return Math.round(diff / 60) + 'm';
    if (diff < 86400) return Math.round(diff / 3600) + 'h';
    if (diff < 604800) return Math.round(diff / 86400) + 'd';
    return Math.round(diff / 604800) + 'sem';
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function iniciales(nombre) {
    if (!nombre) return '?';
    const p = nombre.trim().split(/\s+/);
    if (p.length === 1) return p[0].charAt(0).toUpperCase();
    return (p[0].charAt(0) + p[p.length - 1].charAt(0)).toUpperCase();
  }

  // ═══ RENDERIZADORES ═══

  function renderNumeros(m) {
    document.querySelectorAll('[data-metrica]').forEach((el) => {
      const clave = el.dataset.metrica;
      const formato = el.dataset.formato || 'numero';
      const valor = m[clave];
      if (valor === undefined || valor === null) return;
      if (typeof valor !== 'number') return;
      const rect = el.getBoundingClientRect();
      const enViewport = rect.top < window.innerHeight && rect.bottom > 0;
      if (enViewport) animarNumero(el, valor, formato);
      else el.textContent = (formateadores[formato] || formateadores.numero)(valor);
    });
  }

  function renderTicker(resenas) {
    const cont = document.getElementById('tickerInner');
    if (!cont) return;
    if (!resenas || resenas.length === 0) {
      cont.innerHTML = '<div class="ticker-item"><span class="ticker-quote" style="opacity:0.4;">Aún no hay reseñas publicadas. Serán las voces de quienes reciban los libros.</span></div>';
      return;
    }
    const items = [...resenas, ...resenas].map((r, i) => {
      const sep = i < resenas.length * 2 - 1 ? '<span class="ticker-sep">·</span>' : '';
      const lugar = [r.ciudad, r.pais].filter(Boolean).join(', ');
      const source = [r.autor_nombre, lugar].filter(Boolean).join(' · ');
      return `<div class="ticker-item"><span class="ticker-quote">"${esc(r.cita)}"</span><span class="ticker-source">— ${esc(source || 'Anónimo')}</span></div>${sep}`;
    }).join('');
    cont.innerHTML = items;
  }

  function renderMapa(paises) {
    const cont = document.getElementById('mapNodes');
    if (!cont) return;
    if (!paises || paises.length === 0) { cont.innerHTML = ''; return; }
    const nodos = paises.filter(p => p.x_mapa && p.y_mapa).map((p, i) => {
      const c = p.color_rgb;
      const r = Math.max(8, Math.min(24, p.radio || 12));
      const inner = Math.max(3, r / 3);
      const delay = (i * 0.4).toFixed(1);
      return `<g class="map-node">
        <circle cx="${p.x_mapa}" cy="${p.y_mapa}" r="${r}" fill="rgba(${c},0.08)" stroke="rgba(${c},0.2)" stroke-width="1"/>
        <circle cx="${p.x_mapa}" cy="${p.y_mapa}" r="${r}" fill="none" stroke="rgba(${c},0.4)" stroke-width="1" class="node-ring" opacity="0"/>
        <circle cx="${p.x_mapa}" cy="${p.y_mapa}" r="${inner}" fill="rgba(${c},0.6)"/>
        <circle cx="${p.x_mapa}" cy="${p.y_mapa}" r="${inner}" fill="rgba(${c},0.3)" class="ping-dot" style="animation-delay:${delay}s"/>
        <text x="${p.x_mapa}" y="${p.y_mapa + r + 12}" text-anchor="middle" font-family="DM Mono, monospace" font-size="9" fill="rgba(${c},0.6)" letter-spacing="0.05em">${esc(p.codigo || '')}</text>
        <text x="${p.x_mapa}" y="${p.y_mapa + r + 24}" text-anchor="middle" font-family="DM Mono, monospace" font-size="8" fill="rgba(232,240,255,0.35)">${p.total} libros</text>
      </g>`;
    }).join('');
    cont.innerHTML = nodos;
  }

  function renderFeed(actividad) {
    const cont = document.getElementById('feedItems');
    if (!cont) return;
    if (!actividad || actividad.length === 0) {
      cont.innerHTML = '<div class="feed-item" style="opacity:0.5;font-style:italic;">La actividad aparecerá aquí cuando los primeros libros empiecen a moverse.</div>';
      return;
    }
    cont.innerHTML = actividad.map(a => {
      const estado = ESTADO_LABELS[a.estado_actual] || ESTADO_LABELS.recibido;
      const lugar = [a.ubicacion_actual_ciudad, a.pais_destino].filter(Boolean).join(', ');
      return `<div class="feed-item ${estado.clase}">
        <span class="feed-icon">${estado.icono}</span>
        <div class="feed-content">
          <div class="feed-title">${esc(a.titulo)}</div>
          <div class="feed-meta">${estado.texto}${lugar ? ' · ' + esc(lugar) : ''}</div>
        </div>
        <span class="feed-time">${tiempoRelativo(a.actualizado_en)}</span>
      </div>`;
    }).join('');
  }

  function renderChartBarras(semanas) {
    const cont = document.getElementById('chartBars');
    if (!cont) return;
    if (!semanas || semanas.length === 0) {
      cont.innerHTML = '<div style="text-align:center;opacity:0.4;padding:2rem 0;font-size:0.85rem;">Sin datos aún.</div>';
      return;
    }
    const max = Math.max(...semanas.map(s => s.total), 1);
    cont.innerHTML = semanas.map(s => {
      const alto = Math.max(6, (s.total / max) * 100);
      return `<div class="chart-bar-item" style="display:inline-flex;flex-direction:column;align-items:center;flex:1;gap:6px;">
        <div style="height:${alto}%;min-height:6px;background:var(--gold);width:100%;max-width:24px;border-radius:2px;opacity:0.85;"></div>
        <div style="font-family:DM Mono,monospace;font-size:9px;color:rgba(232,240,255,0.4);white-space:nowrap;">${esc(s.semana)}</div>
        <div style="font-family:DM Mono,monospace;font-size:10px;color:rgba(232,240,255,0.7);">${s.total}</div>
      </div>`;
    }).join('');
    cont.style.display = 'flex';
    cont.style.alignItems = 'flex-end';
    cont.style.gap = '6px';
    cont.style.height = '160px';
    cont.style.padding = '1rem 0';
  }

  function renderSeguimiento(libro) {
    const panel = document.getElementById('journeyContent');
    if (!panel) return;
    if (!libro) {
      panel.innerHTML = '<div style="opacity:0.5;font-style:italic;padding:2rem 0;text-align:center;">Aún no hay libros en seguimiento. Cuando marques uno como destacado desde el panel de administración, aparecerá su journey completo aquí.</div>';
      return;
    }
    const codigo = libro.codigo_seguimiento || '—';
    const pasos = [
      { label: 'Recibido', fecha: libro.fecha_clasificacion, detalle: libro.voluntario_clasificador ? 'Voluntario/a: ' + libro.voluntario_clasificador : '', done: !!libro.fecha_clasificacion, esActivo: libro.estado_actual === 'recibido' },
      { label: 'Clasificado', fecha: libro.fecha_clasificacion, detalle: '', done: !!libro.fecha_clasificacion, esActivo: libro.estado_actual === 'clasificado' },
      { label: 'Perforado', fecha: libro.fecha_perforacion, detalle: 'Símbolo Vacío Lleno', done: !!libro.fecha_perforacion, esActivo: libro.estado_actual === 'perforado' },
      { label: 'Enviado', fecha: libro.fecha_envio, detalle: libro.pais_destino ? '→ ' + libro.pais_destino : '', done: !!libro.fecha_envio, esActivo: libro.estado_actual === 'en_transito' },
      { label: 'En circulación', fecha: libro.fecha_entrega, detalle: libro.ubicacion_actual_ciudad ? libro.ubicacion_actual_ciudad + (libro.lector_numero ? ' · ' + libro.lector_numero + 'º lector' : '') : '', done: libro.estado_actual === 'en_circulacion', esActivo: libro.estado_actual === 'en_circulacion' || libro.estado_actual === 'entregado' },
    ];
    const pasosHTML = pasos.map(p => {
      const cls = p.esActivo ? 'active' : (p.done ? 'done' : '');
      const valor = p.fecha ? new Date(p.fecha).toLocaleDateString('es-ES', { day:'numeric', month:'short' }) : '—';
      return `<div class="journey-step ${cls}"><div class="journey-step-label">${esc(p.label)}</div><div class="journey-step-value">${esc(p.detalle || valor)}</div></div>`;
    }).join('');
    panel.innerHTML = `<div class="journey-title">${esc(libro.titulo)}</div><div class="journey-author">${esc(libro.autor)} · ${esc(codigo)}</div><div class="journey-steps">${pasosHTML}</div>`;
  }

  function renderLibrosPorPais(paises) {
    const cont = document.getElementById('countryRows');
    if (!cont) return;
    if (!paises || paises.length === 0) {
      cont.innerHTML = '<div style="opacity:0.5;font-style:italic;padding:1rem 0;">Sin libros distribuidos aún.</div>';
      return;
    }
    const max = Math.max(...paises.map(p => p.total), 1);
    cont.innerHTML = paises.map(p => {
      const pct = Math.round((p.total / max) * 100);
      return `<div class="country-row">
        <span class="country-flag">${esc(p.bandera)}</span>
        <span class="country-name">${esc(p.pais)}</span>
        <div class="country-bar-track"><div class="country-bar-fill" style="width:${pct}%;background:${p.color};"></div></div>
        <span class="country-count">${p.total}</span>
      </div>`;
    }).join('');
  }

  function renderLibrosPorCategoria(cats) {
    const donutWrap = document.getElementById('donutWrap');
    if (!donutWrap) return;
    if (!cats || cats.length === 0) {
      donutWrap.innerHTML = '<div style="opacity:0.5;font-style:italic;padding:1rem 0;text-align:center;">Sin categorías aún.</div>';
      return;
    }
    const total = cats.reduce((s, c) => s + c.total, 0) || 1;
    const perimetro = 2 * Math.PI * 40;
    let offset = 0;
    const segmentos = cats.map((c, i) => {
      const pct = c.total / total;
      const dash = pct * perimetro;
      const seg = `<circle cx="55" cy="55" r="40" fill="none" stroke="${CATEGORIA_COLORES[i % CATEGORIA_COLORES.length]}" stroke-width="16" stroke-dasharray="${dash.toFixed(2)} ${(perimetro - dash).toFixed(2)}" stroke-dashoffset="${-offset.toFixed(2)}" transform="rotate(-90 55 55)"/>`;
      offset += dash;
      return seg;
    }).join('');
    const leyenda = cats.map((c, i) => {
      const pct = Math.round((c.total / total) * 100);
      return `<div class="donut-legend-item" style="display:flex;align-items:center;gap:0.5rem;font-size:0.75rem;margin-bottom:0.35rem;">
        <span style="width:8px;height:8px;border-radius:50%;background:${CATEGORIA_COLORES[i % CATEGORIA_COLORES.length]};flex-shrink:0;"></span>
        <span style="flex:1;color:rgba(232,240,255,0.75);">${esc(CATEGORIA_LABELS[c.categoria] || c.categoria)}</span>
        <span style="font-family:DM Mono,monospace;color:rgba(232,240,255,0.5);">${pct}%</span>
      </div>`;
    }).join('');
    donutWrap.innerHTML = `<div class="donut-svg"><svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="40" fill="none" stroke="rgba(232,240,255,0.05)" stroke-width="16"/>${segmentos}</svg></div><div class="donut-legend" style="flex:1;padding-left:1rem;">${leyenda}</div>`;
    donutWrap.style.display = 'flex';
    donutWrap.style.alignItems = 'center';
  }

  function renderVoluntarios(voluntarios) {
    const cont = document.getElementById('voluntariosGrid');
    if (!cont) return;
    if (!voluntarios || voluntarios.length === 0) {
      cont.innerHTML = `<div class="team-empty"><div class="team-empty-icon">○</div><div class="team-empty-text">Pronto tendrás caras aquí.<br><strong>Sé una de ellas.</strong></div><a href="#form" class="team-empty-cta">Quiero ser voluntario/a →</a></div>`;
      return;
    }
    cont.innerHTML = voluntarios.map(v => {
      const lugar = [v.ciudad, v.pais].filter(Boolean).join(' · ');
      const foto = v.foto_url
        ? `<img src="${esc(v.foto_url)}" alt="${esc(v.nombre)}" onerror="this.style.display='none';this.parentElement.textContent='${esc(iniciales(v.nombre))}';">`
        : esc(iniciales(v.nombre));
      return `<article class="team-card">
        <div class="team-photo">${foto}</div>
        <div class="team-role">${esc(v.rol)}</div>
        <h3 class="team-name">${esc(v.nombre)}</h3>
        ${lugar ? `<div class="team-loc">${esc(lugar)}</div>` : ''}
        ${v.bio_corta ? `<p class="team-bio">${esc(v.bio_corta)}</p>` : ''}
      </article>`;
    }).join('');
  }

  // ═══ NUEVO: RENDERIZAR LIBROS DENTRO DE CADA CAT-CARD ═══
  function renderCategoriasCards(detalle) {
    // detalle = {"economia_finanzas": {total:X, libros:[...]}, ...}
    detalle = detalle || {};

    // Rellenar los 3 libros de ejemplo por card
    document.querySelectorAll('[data-cat-books]').forEach((cont) => {
      const cat = cont.dataset.catBooks;
      const info = detalle[cat];
      if (!info || !info.libros || info.libros.length === 0) {
        cont.innerHTML = `<div class="cat-book" style="opacity:0.5;font-style:italic;">
          <div class="cat-book-dot" style="background:currentColor;opacity:0.4;"></div>
          <span class="cat-book-title" style="font-style:italic;">Pronto — sé el primero en donar</span>
          <span class="cat-book-author">de esta categoría</span>
        </div>`;
        return;
      }
      cont.innerHTML = info.libros.slice(0, 3).map(l => `
        <div class="cat-book">
          <div class="cat-book-dot"></div>
          <span class="cat-book-title">${esc(l.titulo)}</span>
          <span class="cat-book-author">${esc(l.autor)}</span>
        </div>
      `).join('');
    });

    // Rellenar los contadores "N en circulación"
    document.querySelectorAll('[data-cat-stat]').forEach((el) => {
      const cat = el.dataset.catStat;
      const info = detalle[cat];
      if (!info || !info.total) {
        el.textContent = 'Sin libros aún';
        el.style.opacity = '0.5';
      } else {
        el.textContent = `${info.total} en circulación`;
        el.style.opacity = '1';
      }
    });
  }

  // ═══ ORQUESTADOR ═══
  async function cargarTodo() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_metricas_publicas`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      if (!res.ok) { console.warn('Métricas:', res.status); return; }
      const m = await res.json();
      renderNumeros(m);
      renderTicker(m.resenas);
      renderMapa(m.libros_por_pais);
      renderFeed(m.actividad_reciente);
      renderChartBarras(m.libros_por_semana);
      renderSeguimiento(m.libro_seguimiento);
      renderLibrosPorPais(m.libros_por_pais);
      renderLibrosPorCategoria(m.libros_por_categoria);
      renderVoluntarios(m.voluntarios_publicados);
      renderCategoriasCards(m.libros_por_categoria_detalle);
    } catch (err) {
      console.warn('Error cargando métricas:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cargarTodo);
  } else {
    cargarTodo();
  }
})();
