// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Muro público de donantes
// ═══════════════════════════════════════════════════════════════════
// Carga métricas globales, listado de donaciones publicas, y ofrece
// búsqueda instantánea por nombre o por importe (útil para donantes
// anónimos que quieran encontrar su firma).
// ═══════════════════════════════════════════════════════════════════

(function() {
  const SUPABASE_URL  = 'https://tuagkbjixoolmtmwwsus.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_VFoLqoJsalIKNJ2GFpSbzA_QS5RH4-U';

  let donacionesCache = [];

  // ─── Utilidades ───
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function formatEur(cents) {
    return (cents / 100).toFixed(2).replace('.', ',') + '€';
  }
  function formatEurTotal(cents) {
    const eur = cents / 100;
    if (Number.isInteger(eur)) {
      return new Intl.NumberFormat('es-ES').format(eur) + '€';
    }
    return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(eur) + '€';
  }
  function formatFecha(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function formatMes(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  }

  // ─── Fetch a Supabase RPCs ───
  async function fetchRPC(nombre, params = {}) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`Error ${nombre}:`, err);
      return null;
    }
  }

  // ─── HERO: contador global ───
  async function pintarMetricas() {
    const metricas = await fetchRPC('get_metricas_donaciones');
    if (!metricas) return;

    const elDonantes = document.getElementById('metricaDonantes');
    const elMovilizado = document.getElementById('metricaMovilizado');
    const elDonaciones = document.getElementById('metricaDonaciones');

    if (elDonantes) elDonantes.textContent = metricas.total_donantes || 0;
    if (elMovilizado) elMovilizado.textContent = formatEurTotal(metricas.total_recaudado_cents || 0);
    if (elDonaciones) elDonaciones.textContent = metricas.total_donaciones || 0;
  }

  // ─── TIMELINE ───
  async function cargarDonaciones() {
    const container = document.getElementById('timeline');
    if (!container) return;

    const data = await fetchRPC('get_donaciones_publicas', { limite: 500 });
    if (!data) {
      container.innerHTML = '<div class="muro-empty">No se pudo cargar el muro. Vuelve a intentarlo en un momento.</div>';
      return;
    }
    donacionesCache = data;

    if (donacionesCache.length === 0) {
      container.innerHTML = `
        <div class="muro-empty">
          <p>El muro está vacío por ahora.</p>
          <p class="muro-empty-sub">Sé la primera voz.</p>
          <a href="/vaciolleno-donaciones.html" class="btn-primary-inline">Sumarme →</a>
        </div>`;
      return;
    }

    renderTimeline(donacionesCache);
  }

  function renderTimeline(donaciones) {
    const container = document.getElementById('timeline');
    if (!container) return;

    if (donaciones.length === 0) {
      container.innerHTML = '<div class="muro-empty"><p>Ninguna coincidencia con tu búsqueda.</p></div>';
      return;
    }

    // Agrupar por mes/año
    const grupos = {};
    donaciones.forEach(d => {
      const key = formatMes(d.confirmado_en);
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(d);
    });

    let html = '';
    Object.entries(grupos).forEach(([mes, items]) => {
      html += `<div class="timeline-mes"><span>${esc(mes)}</span></div>`;
      items.forEach(d => {
        html += renderEntrada(d);
      });
    });

    container.innerHTML = html;
  }

  function renderEntrada(d) {
    const importe = formatEur(d.importe);
    const esAnonimo = d.anonimo;
    const esMensual = d.tipo === 'mensual';
    const nombre = d.nombre_mostrar || 'Anónimo';

    const badgeMensual = esMensual
      ? '<span class="badge-mensual">Mensual</span>'
      : '';

    const mensajeHtml = d.mensaje && d.mensaje.trim()
      ? `<blockquote class="entrada-mensaje">"${esc(d.mensaje)}"</blockquote>`
      : '';

    return `
      <article class="timeline-entrada ${esAnonimo ? 'entrada-anonima' : ''}">
        <div class="timeline-punto"></div>
        <div class="timeline-contenido">
          <div class="entrada-header">
            <div class="entrada-nombre-wrap">
              <span class="entrada-nombre">${esc(nombre)}</span>
              ${badgeMensual}
            </div>
            <div class="entrada-importe">${importe}</div>
          </div>
          ${esAnonimo ? '<div class="entrada-anonimo-nota">Firma única · irrepetible en 2026</div>' : ''}
          ${mensajeHtml}
          <div class="entrada-fecha">${formatFecha(d.confirmado_en)}</div>
        </div>
      </article>
    `;
  }

  // ─── BÚSQUEDA ───
  function conectarBuscador() {
    const input = document.getElementById('buscador');
    if (!input) return;

    let timer;
    input.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = e.target.value.trim().toLowerCase();
        aplicarBusqueda(q);
      }, 200);
    });
  }

  function aplicarBusqueda(q) {
    if (!q) {
      renderTimeline(donacionesCache);
      return;
    }

    // Normalizar la query: soporta "15,07€", "15.07", "1507", "maría"
    const qNumerico = q.replace(/[€\s]/g, '').replace(',', '.');
    const numQ = parseFloat(qNumerico);
    const centsQ = !isNaN(numQ) ? Math.round(numQ * 100) : null;

    const filtradas = donacionesCache.filter(d => {
      // Búsqueda por nombre
      const nombre = (d.nombre_mostrar || 'anónimo').toLowerCase();
      if (nombre.includes(q)) return true;

      // Búsqueda por importe exacto o parcial
      if (centsQ !== null) {
        if (d.importe === centsQ) return true;
        // Búsqueda parcial: 15,07 encuentra 1507
        const importeStr = formatEur(d.importe).replace('€', '').replace(',', '.');
        if (importeStr.includes(qNumerico)) return true;
      }

      // Búsqueda en mensaje
      if (d.mensaje && d.mensaje.toLowerCase().includes(q)) return true;

      return false;
    });

    renderTimeline(filtradas);
  }

  // ─── ARRANQUE ───
  document.addEventListener('DOMContentLoaded', () => {
    pintarMetricas();
    cargarDonaciones().then(() => conectarBuscador());
  });
})();
