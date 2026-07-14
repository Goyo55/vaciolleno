// ═══════════════════════════════════════════════════════════════════
// VACÍO LLENO — Donaciones (Stripe Elements + Payment Element)
// ═══════════════════════════════════════════════════════════════════
// Modelo:
//   - Con nombre: importe libre (5€, 15.50€…) + nombre + muro opcional
//   - Anónimo: importe entero → backend le añade céntimos únicos
//   - Anónimo mensual: se cobra el mismo importe único cada mes
// ═══════════════════════════════════════════════════════════════════

(function() {
  let stripe = null, elements = null, paymentElement = null;
  let clientSecret = null, donacionId = null;

  let currentAmount = null;
  let currentFreq = 'once';
  let esAnonimo = false;
  let mostrarPublica = false;
  let importeRealCents = null; // importe con céntimos únicos si es anónimo

  function $(id) { return document.getElementById(id); }

  function showError(msg) {
    const el = $('errorMsg');
    if (!el) return;
    el.textContent = msg; el.classList.add('visible');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideError() { const el = $('errorMsg'); if (el) el.classList.remove('visible'); }
  function showPaymentError(msg) { const el = $('paymentError'); if (el) { el.textContent = msg; el.classList.add('visible'); } }
  function hidePaymentError() { const el = $('paymentError'); if (el) el.classList.remove('visible'); }

  function formatEur(cents) { return (cents / 100).toFixed(2).replace('.', ',') + '€'; }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ═══ TABS ═══
  window.switchTab = function(type) {
    $('tabMoney').classList.toggle('active', type === 'money');
    $('tabBook').classList.toggle('active', type === 'book');
    $('moneyForm').classList.toggle('active', type === 'money');
    $('bookForm').classList.toggle('active', type === 'book');
  };

  // ═══ FRECUENCIA ═══
  window.setFreq = function(f) {
    currentFreq = f;
    $('freqOnce').classList.toggle('active', f === 'once');
    $('freqMonthly').classList.toggle('active', f === 'monthly');
    actualizarBotonPagar();
  };

  // ═══ TOGGLE ANÓNIMO ═══
  window.toggleAnon = function() {
    esAnonimo = !esAnonimo;
    $('anonToggle').classList.toggle('active', esAnonimo);
    $('toggleSwitchAnon').classList.toggle('on', esAnonimo);
    $('anonHint').classList.toggle('visible', esAnonimo);
    $('nameField').style.display = esAnonimo ? 'none' : 'block';

    // Cuando anónimo, el importe debe ser entero
    const input = $('amountInput');
    if (esAnonimo) {
      input.step = '1';
      input.min = '1';
      // Redondear al entero si tenía decimales
      if (currentAmount && !Number.isInteger(currentAmount)) {
        currentAmount = Math.round(currentAmount);
        input.value = currentAmount;
      }
    } else {
      input.step = '0.01';
    }

    // Actualizar texto del muro
    const sub = $('muroSubtext');
    if (sub) {
      sub.textContent = esAnonimo
        ? 'Aparecerás como "Anónimo · ' + (currentAmount ? formatEur(currentAmount * 100) : 'X,XX€') + '" (importe con céntimos únicos).'
        : 'Con tu nombre y tu mensaje si lo escribes.';
    }
  };

  // ═══ MURO PÚBLICO ═══
  window.toggleMuroPublico = function() {
    mostrarPublica = !mostrarPublica;
    $('muroToggle').classList.toggle('active', mostrarPublica);
    $('toggleSwitchMuro').classList.toggle('on', mostrarPublica);
  };

  // ═══ IMPORTE ═══
  window.onAmountChange = function(val) {
    let num = parseFloat(val) || null;
    if (esAnonimo && num) num = Math.floor(num);
    currentAmount = num;
    clearSelectedAmounts();
    updateImpactPreview(num);
    actualizarBotonPagar();
  };

  window.selectAmount = function(amount) {
    $('amountInput').value = amount;
    currentAmount = amount;
    clearSelectedAmounts();
    document.querySelectorAll('.suggested-amt').forEach(btn => {
      if (parseInt(btn.dataset.amount) === amount) btn.classList.add('selected');
    });
    updateImpactPreview(amount);
    actualizarBotonPagar();
  };

  function clearSelectedAmounts() {
    document.querySelectorAll('.suggested-amt').forEach(b => b.classList.remove('selected'));
  }

  function updateImpactPreview(amount) {
    const rows = document.querySelectorAll('.impact-row');
    if (!rows.length) return;
    rows.forEach(r => r.style.opacity = '0.4');
    if (!amount) return;
    if (amount >= 100) rows[4].style.opacity = '1';
    else if (amount >= 50) rows[3].style.opacity = '1';
    else if (amount >= 15) rows[2].style.opacity = '1';
    else if (amount >= 5) rows[1].style.opacity = '1';
    else if (amount >= 2) rows[0].style.opacity = '1';
  }

  function actualizarBotonPagar() {
    const btn = $('pagarBtn');
    if (!btn || !importeRealCents) return;
    const importe = formatEur(importeRealCents);
    const texto = currentFreq === 'monthly'
      ? `Donar ${importe} cada mes`
      : `Completar donación de ${importe}`;
    btn.querySelector('span').textContent = texto;
  }

  // ═══ PASO 1 → PASO 2 ═══
  window.continuarAlPago = async function() {
    hideError();
    const amount = parseFloat($('amountInput').value);
    const email = $('donorEmail').value.trim();
    const nombre = esAnonimo ? '' : $('donorName').value.trim();
    const mensaje = $('donorMessage').value.trim();

    if (!amount || amount < 1) return showError('Introduce una cantidad válida (mínimo 1€)');
    if (amount > 5000) return showError('Para donaciones superiores a 5000€ escríbenos a hola@vaciolleno.org');
    if (esAnonimo && !Number.isInteger(amount)) return showError('Para donación anónima el importe debe ser un euro entero (ej. 5, 15, 30…). El sistema le añadirá los céntimos únicos.');
    if (!email || !email.includes('@')) return showError('Introduce un email válido para recibir la confirmación');

    const btn = $('continuarBtn');
    btn.disabled = true;
    btn.innerHTML = '<span><span class="spinner"></span>Preparando pago…</span>';

    try {
      const res = await fetch('/api/crear-donacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importe: amount,
          tipo: currentFreq === 'monthly' ? 'mensual' : 'unica',
          anonimo: esAnonimo,
          email,
          nombre: nombre || null,
          mensaje: mensaje || null,
          mostrar_publica: mostrarPublica,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar el pago');

      clientSecret = data.clientSecret;
      donacionId = data.donacion_id;
      importeRealCents = data.importe_real;
      const publishableKey = data.publishableKey;

      if (!stripe) stripe = Stripe(publishableKey);

      elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: 'night',
          variables: {
            colorPrimary: '#c9a84c',
            colorBackground: '#1a3260',
            colorText: '#f5f3ee',
            colorDanger: '#c0392b',
            fontFamily: '"DM Sans", system-ui, sans-serif',
            fontSizeBase: '15px',
            borderRadius: '0px',
            spacingUnit: '4px',
          },
          rules: {
            '.Input': { backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px' },
            '.Input:focus': { borderColor: '#c9a84c', boxShadow: 'none' },
            '.Label': { color: 'rgba(245,243,238,0.6)', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: '"DM Mono", monospace', marginBottom: '6px' },
          },
        },
      });

      paymentElement = elements.create('payment', { layout: { type: 'tabs', defaultCollapsed: false } });
      paymentElement.mount('#payment-element');

      $('step1Form').style.display = 'none';
      $('step2Payment').style.display = 'block';
      renderResumen(email, nombre);
      actualizarBotonPagar();

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showError(err.message || 'Algo salió mal. Vuelve a intentarlo.');
      btn.disabled = false;
      btn.innerHTML = '<span>Continuar al pago →</span>';
    }
  };

  function renderResumen(email, nombre) {
    const resumen = $('resumenDatos');
    if (!resumen) return;
    const tipo = currentFreq === 'monthly' ? 'Mensual · cada mes' : 'Una vez';
    const importeStr = formatEur(importeRealCents);
    const filas = [
      `<div class="resumen-row destacada"><span>${esAnonimo ? 'Tu importe único' : 'Importe'}</span><span><strong>${importeStr}</strong></span></div>`,
      `<div class="resumen-row"><span>Frecuencia</span><span>${tipo}</span></div>`,
      `<div class="resumen-row"><span>Email</span><span>${escapeHtml(email)}</span></div>`,
    ];
    if (!esAnonimo && nombre) filas.push(`<div class="resumen-row"><span>Nombre</span><span>${escapeHtml(nombre)}</span></div>`);
    if (esAnonimo) filas.push(`<div class="resumen-row"><span>Anónimo</span><span>Sí · céntimos únicos</span></div>`);
    resumen.innerHTML = filas.join('');
  }

  window.volverAlFormulario = function() {
    $('step2Payment').style.display = 'none';
    $('step1Form').style.display = 'block';
    const btn = $('continuarBtn');
    btn.disabled = false;
    btn.innerHTML = '<span>Continuar al pago →</span>';
    if (paymentElement) { try { paymentElement.destroy(); } catch (_) {} paymentElement = null; }
    elements = null; clientSecret = null; importeRealCents = null;
  };

  // ═══ PASO 2: confirmar ═══
  window.completarDonacion = async function() {
    hidePaymentError();
    if (!stripe || !elements || !clientSecret) return showPaymentError('Sesión no válida. Vuelve a intentarlo.');

    const btn = $('pagarBtn');
    btn.disabled = true;
    const textoOrig = btn.querySelector('span').textContent;
    btn.querySelector('span').innerHTML = '<span class="spinner"></span>Procesando…';

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/vaciolleno-donacion-confirmada.html`,
      },
    });

    if (error) {
      showPaymentError(error.message || 'No se pudo procesar el pago. Revisa tus datos y vuelve a intentarlo.');
      btn.disabled = false;
      btn.querySelector('span').textContent = textoOrig;
    }
  };

  // ═══ FORMULARIO DE LIBROS ═══
  window.handleBookDonate = async function() {
    const count = $('bookCount').value;
    const name = $('bookName').value.trim();
    const email = $('bookEmail').value.trim();
    const city = $('bookCity').value.trim();
    const notes = $('bookNotes').value.trim();

    if (!count || count < 1) return alert('Indica cuántos libros tienes');
    if (!name) return alert('Indica tu nombre para coordinar la recogida');
    if (!email || !email.includes('@')) return alert('Introduce un email válido');

    const categorias = Array.from(document.querySelectorAll('#bookForm .book-cats input[type="checkbox"]:checked')).map(cb => cb.value);
    const deliveryRadio = document.querySelector('input[name="delivery"]:checked');
    const metodoEntrega = deliveryRadio ? deliveryRadio.value : '';

    try {
      const res = await fetch('/api/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'donacion-libros',
          nombre: name, email, ciudad: city, cantidad: count,
          categorias, metodoEntrega, mensaje: notes,
        }),
      });
      if (!res.ok) throw new Error('Error del servidor');
      showBookSuccess();
    } catch (err) {
      alert('No se pudo enviar. Vuelve a intentarlo en unos segundos.');
    }
  };

  function showBookSuccess() {
    $('moneyForm').style.display = 'none';
    $('bookForm').style.display = 'none';
    document.querySelector('.donation-tabs').style.display = 'none';
    const panel = $('successPanel');
    panel.classList.add('visible');
    $('successTitle').textContent = 'Recibido.';
    $('successCode').textContent = '';
    $('successBody').textContent = 'Nos pondremos en contacto contigo en las próximas 48 horas para coordinar la recogida. Tus libros van a cambiar vidas.';
  }

  // ═══ ARRANQUE ═══
  document.addEventListener('DOMContentLoaded', () => {
    const hash = window.location.hash;
    if (hash === '#libros') switchTab('book');
  });
})();
