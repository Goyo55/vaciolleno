// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Carga automática de métricas desde Supabase
// ═══════════════════════════════════════════════════════════════════
// Este script busca elementos con data-metrica="XXX" y les mete el
// valor real desde la base de datos. Se ejecuta al cargar cualquier
// página que lo incluya.
//
// Uso en HTML:
//   <div data-metrica="total_libros">0</div>
//   <div data-metrica="paises_alcanzados">0</div>
//   <div data-metrica="total_donado_eur" data-formato="euros">€0</div>
//
// Formatos disponibles (opcional, en data-formato):
//   - "numero"  — 1234 (default)
//   - "compacto" — 33.8K, 1.2M
//   - "euros"   — €4.200
//   - "euros-compacto" — €4.2K
// ═══════════════════════════════════════════════════════════════════

(function() {
  const SUPABASE_URL = 'https://tuagkbjixoolmtmwwsus.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_VFoLqoJsalIKNJ2GFpSbzA_QS5RH4-U';

  // ─── Formateadores ───
  const formateadores = {
    numero: (n) => {
      if (n === null || n === undefined) return '0';
      return Number(n).toLocaleString('es-ES');
    },
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

  // ─── Animación de conteo ───
  function animarNumero(elemento, valorFinal, formato = 'numero') {
    const formatear = formateadores[formato] || formateadores.numero;
    const duracion = 1200; // ms
    const inicio = performance.now();

    function tick(ahora) {
      const t = Math.min((ahora - inicio) / duracion, 1);
      // Easing (ease-out cubic)
      const eased = 1 - Math.pow(1 - t, 3);
      const valorActual = valorFinal * eased;
      elemento.textContent = formatear(valorActual);
      if (t < 1) requestAnimationFrame(tick);
      else elemento.textContent = formatear(valorFinal);
    }

    requestAnimationFrame(tick);
  }

  // ─── Cargar métricas desde Supabase ───
  async function cargarMetricas() {
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

      if (!res.ok) {
        console.warn('No se pudieron cargar las métricas:', res.status);
        return;
      }

      const metricas = await res.json();
      aplicarMetricas(metricas);
    } catch (err) {
      console.warn('Error cargando métricas:', err);
    }
  }

  // ─── Aplicar métricas a todos los elementos con data-metrica ───
  function aplicarMetricas(metricas) {
    document.querySelectorAll('[data-metrica]').forEach((el) => {
      const clave = el.dataset.metrica;
      const formato = el.dataset.formato || 'numero';
      const valor = metricas[clave];

      if (valor === undefined || valor === null) {
        console.warn(`Métrica desconocida: ${clave}`);
        return;
      }

      // Si el elemento está en el viewport, anima. Si no, pon el valor directo.
      const rect = el.getBoundingClientRect();
      const enViewport = rect.top < window.innerHeight && rect.bottom > 0;

      if (enViewport) {
        animarNumero(el, valor, formato);
      } else {
        const formatear = formateadores[formato] || formateadores.numero;
        el.textContent = formatear(valor);
      }
    });
  }

  // ─── Arrancar cuando el DOM esté listo ───
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cargarMetricas);
  } else {
    cargarMetricas();
  }
})();
