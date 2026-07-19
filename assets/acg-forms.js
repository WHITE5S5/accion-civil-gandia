/* Sentry — monitoreo de errores JS en producción (loader oficial, carga async).
   Se inyecta aquí para cubrir todas las páginas sin tocar support.js. El CSP permite *.sentry-cdn.com y *.sentry.io.
   Guarda de localhost: en desarrollo no se envía nada. */
(function () {
  try {
    if (window.__acgSentry) return; window.__acgSentry = 1;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    var s = document.createElement('script');
    s.src = 'https://js-de.sentry-cdn.com/f00a0f84bd56e8f63c9f648b284bd50d.min.js';
    s.crossOrigin = 'anonymous';
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();

/* Google Analytics 4 (gtag) — analítica de audiencia. Cubre todas las páginas vía acg-forms.
   No trackea en localhost (dev no contamina). CSP permite googletagmanager.com + google-analytics.com. */
(function () {
  try {
    if (window.__acgGA) return; window.__acgGA = 1;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    var ID = 'G-RFPXGHZMFN';
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    (document.head || document.documentElement).appendChild(g);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ID);
  } catch (e) {}
})();

/* acg-forms.js — conecta los formularios estáticos con /api/* (Fase 1).
   Delegación global: funciona en las 67 páginas sin tocar los componentes dc.
   - Newsletter del footer (todas las páginas) → POST /api/newsletter (double opt-in)
   - Formulario de contacto (Contacto) → POST /api/contacto
   - Crear propuesta (CrearPropuesta) → POST /api/propuesta
   TODO Turnstile: cuando exista TURNSTILE_SECRET_KEY en Netlify, añadir aquí el widget
   (window.ACG_TS_SITEKEY) y enviar turnstileToken. Sin él, la API no lo exige. */

/* Inyección SINCRONIZADA con el render del runtime: MutationObserver corre en el
   mismo frame en que aparece el header/nav (antes del pintado), así el botón de
   cuenta, el carrito, etc. salen A LA VEZ que la página, no 1,5 s después.
   Las fn deben ser idempotentes. Interval lento solo como red de seguridad. */
window.__acgOnRender = window.__acgOnRender || function (fn) {
  try { fn(); } catch (e) {}
  try {
    new MutationObserver(function () { try { fn(); } catch (e) {} })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  setInterval(function () { try { fn(); } catch (e) {} }, 8000);
};
(function () {
  'use strict';
  var lang = 'es';
  try { lang = localStorage.getItem('acg_lang') || 'es'; } catch (e) {}
  var es = lang !== 'va';
  var T = {
    sending: es ? 'Enviando…' : 'Enviant…',
    okContact: es ? 'Mensaje enviado. Te responderemos lo antes posible.' : 'Missatge enviat. Et respondrem al més prompte possible.',
    okNews: es ? 'Revisa tu correo y confirma la suscripción (mira también el spam).' : 'Revisa el teu correu i confirma la subscripció (mira també l’spam).',
    okProp: es ? 'Propuesta recibida. La revisaremos y te contactaremos por email.' : 'Proposta rebuda. La revisarem i et contactarem per correu.',
    errGeneric: es ? 'No se ha podido enviar. Inténtalo de nuevo en unos minutos.' : 'No s’ha pogut enviar. Torna a provar en uns minuts.',
    errUnconfigured: es ? 'El envío automático aún no está activo. Escríbenos a info@accioncivilgandia.org' : 'L’enviament automàtic encara no està actiu. Escriu-nos a info@accioncivilgandia.org',
    errRate: es ? 'Demasiados intentos seguidos. Espera un rato.' : 'Massa intents seguits. Espera una estona.',
    errEmail: es ? 'Escribe un correo válido.' : 'Escriu un correu vàlid.',
    errPrivacy: es ? 'Debes aceptar la política de privacidad.' : 'Has d’acceptar la política de privacitat.',
    errFields: es ? 'Revisa los campos: ' : 'Revisa els camps: '
  };

  function statusEl(after) {
    var el = after.parentNode.querySelector('.acg-form-status');
    if (!el) {
      el = document.createElement('div');
      el.className = 'acg-form-status';
      el.setAttribute('role', 'status');
      el.style.cssText = 'font:600 14px Public Sans,sans-serif;margin-top:10px;line-height:1.5';
      after.parentNode.insertBefore(el, after.nextSibling);
    }
    return el;
  }
  function show(el, msg, ok) {
    el.textContent = msg;
    el.style.color = ok ? '#2E9E5B' : '#C0392B';
  }
  function post(url, data, btn, st, okMsg, onOk, onErr) {
    var old = btn.textContent;
    btn.disabled = true; btn.style.opacity = '.6'; btn.textContent = T.sending;
    fetch(url, { method: 'POST', headers: (function(){var h={'content-type':'application/json'};try{var t=localStorage.getItem('acg_session');if(t)h.authorization='Bearer '+t;}catch(e){}return h;})(), body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        if (r.s >= 200 && r.s < 300 && r.j && r.j.ok) { show(st, okMsg, true); if (onOk) onOk(); }
        else if (r.s === 503) show(st, T.errUnconfigured, false);
        else if (r.s === 429) show(st, T.errRate, false);
        else { show(st, (r.j && r.j.error && r.j.error.message) ? T.errFields + r.j.error.message : T.errGeneric, false); if (onErr) { try { onErr(r); } catch (e) {} } }
      })
      .catch(function () { show(st, T.errGeneric, false); })
      .then(function () { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = old; });
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ---- Errores de campo con scroll directo: marca la casilla en rojo, escribe el motivo debajo
  // y lleva al usuario hasta ella (nada de descubrir el fallo arriba tras hacer scroll).
  function limpiaErrores(f) {
    var ms = f.querySelectorAll('.acg-field-err');
    for (var i = 0; i < ms.length; i++) ms[i].remove();
    var ins = f.querySelectorAll('[data-acg-bad]');
    for (var j = 0; j < ins.length; j++) { ins[j].style.borderColor = ''; ins[j].style.boxShadow = ''; ins[j].removeAttribute('data-acg-bad'); ins[j].removeAttribute('aria-invalid'); }
  }
  function marcaError(el, msg, esPrimero) {
    if (!el) return;
    el.style.borderColor = '#D93B3B';
    el.style.boxShadow = '0 0 0 3px rgba(217,59,59,.14)';
    el.setAttribute('data-acg-bad', '1'); el.setAttribute('aria-invalid', 'true');
    var m = document.createElement('div');
    m.className = 'acg-field-err'; m.setAttribute('role', 'alert');
    m.style.cssText = 'color:#C0392B;font:600 13px Public Sans,sans-serif;margin-top:6px;line-height:1.45';
    m.textContent = '⚠ ' + msg;
    el.parentNode.insertBefore(m, el.nextSibling);
    function clear() { el.style.borderColor = ''; el.style.boxShadow = ''; el.removeAttribute('data-acg-bad'); el.removeAttribute('aria-invalid'); if (m.parentNode) m.remove(); }
    el.addEventListener('input', clear, { once: true });
    el.addEventListener('change', clear, { once: true });
    if (esPrimero) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { el.scrollIntoView(); }
      try { el.focus({ preventScroll: true }); } catch (e2) {}
    }
  }

  // ---- Newsletter del footer (delegado, todas las páginas)
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn || btn.closest('form')) return;
    var wrap = btn.parentNode;
    var input = wrap && wrap.querySelector('input');
    if (!input || !/corre|email/i.test(input.placeholder || '')) return;
    ev.preventDefault();
    var st = statusEl(wrap);
    var email = (input.value || '').trim();
    if (!EMAIL_RE.test(email)) return show(st, T.errEmail, false);
    post('/api/newsletter', { email: email, lang: lang, hp: '' }, btn, st, T.okNews, function () { input.value = ''; try { localStorage.setItem('acg_nl_ok', '1'); } catch (e) {} });
  });

  function mktConsent(f, email) {
    var c = f.querySelector('.acg-mkt-check input');
    if (c && c.checked) fetch('/api/cuenta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'marketing-consent', email: email, lang: lang }) }).catch(function () {});
  }

  // ---- Contacto y CrearPropuesta (submit delegado)
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!(f instanceof HTMLFormElement)) return;
    var btn = f.querySelector('button[type=submit],button:last-of-type');
    if (!btn) return;
    var st = statusEl(btn);
    var texts = f.querySelectorAll('input[type=text]');
    var email = f.querySelector('input[type=email]');
    var area = f.querySelector('textarea');
    var selects = f.querySelectorAll('select');

    if (f.querySelector('#privacy-check')) {           // Contacto
      ev.preventDefault();
      if (!f.querySelector('#privacy-check').checked) return show(st, T.errPrivacy, false);
      if (!email || !EMAIL_RE.test(email.value.trim())) return show(st, T.errEmail, false);
      post('/api/contacto', {
        nombre: texts[0] ? texts[0].value.trim() : '',
        apellidos: texts[1] ? texts[1].value.trim() : '',
        email: email.value.trim(),
        asunto: selects[0] ? selects[0].value : '',
        mensaje: area ? area.value.trim() : '',
        lang: lang, hp: ''
      }, btn, st, T.okContact, function () { mktConsent(f, email.value.trim()); f.reset(); });
    } else if (f.querySelector('#anon-check')) {        // Crear propuesta
      ev.preventDefault();
      var sesion = false; try { sesion = !!localStorage.getItem('acg_session'); } catch (e) {}
      if (!sesion) { if (window.acgLoginPopup) window.acgLoginPopup(); return; }
      var titulo = f.querySelector('input[maxlength]') || texts[0];
      var catSel = selects[0];
      // Validación en cliente (mismas reglas que el backend): marcar cada casilla que falla y llevar a la primera.
      limpiaErrores(f);
      var FLD = {
        invalid_titulo: es ? 'El título debe tener entre 5 y 140 caracteres.' : 'El títol ha de tindre entre 5 i 140 caràcters.',
        invalid_descripcion: es ? 'La descripción debe tener al menos 30 caracteres (máx. 5000). Cuéntanos tu idea con algo más de detalle.' : 'La descripció ha de tindre almenys 30 caràcters (màx. 5000). Conta’ns la teua idea amb una mica més de detall.',
        invalid_categoria: es ? 'Elige una categoría de la lista.' : 'Tria una categoria de la llista.'
      };
      var fallos = [];
      var _tv = titulo ? titulo.value.trim() : '';
      var _dv = area ? area.value.trim() : '';
      if (_tv.length < 5 || _tv.length > 140) fallos.push([titulo, FLD.invalid_titulo]);
      if (_dv.length < 30 || _dv.length > 5000) fallos.push([area, FLD.invalid_descripcion]);
      if (catSel && catSel.selectedIndex <= 0) fallos.push([catSel, FLD.invalid_categoria]);
      if (fallos.length) {
        for (var _fi = 0; _fi < fallos.length; _fi++) marcaError(fallos[_fi][0], fallos[_fi][1], _fi === 0);
        show(st, es ? 'Revisa los campos marcados en rojo.' : 'Revisa els camps marcats en roig.', false);
        return;
      }
      // Nombre y correo salen de la cuenta (backend). Barrio se detecta del mapa (window._acgPropBarrio).
      post('/api/propuesta', {
        titulo: titulo ? titulo.value.trim() : '',
        descripcion: area ? area.value.trim() : '',
        categoria: selects[0] ? selects[0].value : '',
        barrio: window._acgPropBarrio || (lang === 'va' ? 'Tota la ciutat' : 'Toda la ciudad'),
        anonimo: f.querySelector('#anon-check').checked,
        imagenes: (window._acgPropFotos ? window._acgPropFotos() : []),
        lat: (function(){ try { if (window._acgPropMk) return +window._acgPropMk.getLatLng().lat.toFixed(6); } catch (e2) {} return window._acgPropCoords ? window._acgPropCoords.lat : null; })(),
        lng: (function(){ try { if (window._acgPropMk) return +window._acgPropMk.getLatLng().lng.toFixed(6); } catch (e2) {} return window._acgPropCoords ? window._acgPropCoords.lng : null; })(),
        lang: lang, hp: '',
        newsletter: !!(f.querySelector('#nl-check') && f.querySelector('#nl-check').checked)
      }, btn, st, '', function () {
        f.reset(); if (window._acgPropFotosClear) window._acgPropFotosClear(); window._acgPropCoords = null; window._acgPropBarrio = null; window._acgPropMk = null;
        var ov = document.createElement('div'); ov.setAttribute('role', 'dialog');
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(7,30,69,.8);display:flex;align-items:center;justify-content:center;padding:20px';
        ov.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:32px 26px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.45)">'
          + '<div style="width:60px;height:60px;border-radius:50%;background:#E7F4EC;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1E7A45" stroke-width="2.6"><path d="M20 6 9 17l-5-5"></path></svg></div>'
          + '<div style="font:800 21px Public Sans,system-ui,sans-serif;color:#0A2A5E;margin:0 0 8px">' + (lang === 'va' ? 'Proposta enviada a moderació' : 'Propuesta enviada a moderación') + '</div>'
          + '<div style="color:#5C6B7A;font-size:15px;line-height:1.5;margin:0 0 22px">' + (lang === 'va' ? 'Gràcies per participar. La revisarem i et contactarem per correu.' : 'Gracias por participar. La revisaremos y te contactaremos por correo.') + '</div>'
          + '<button id="acg-prop-ok" type="button" style="width:100%;border:none;cursor:pointer;background:#1563C4;color:#fff;font:700 16px Public Sans,system-ui,sans-serif;padding:15px;border-radius:10px">' + (lang === 'va' ? 'Tancar' : 'Cerrar') + '</button></div>';
        document.body.appendChild(ov);
        document.getElementById('acg-prop-ok').addEventListener('click', function () { location.href = '/participacion'; });
      }, function (r) {
        // Error del backend: llevar directamente a la casilla culpable y explicar el motivo en rojo.
        var code = r.j && r.j.error && r.j.error.code;
        var mapa = { invalid_titulo: titulo, invalid_descripcion: area, invalid_categoria: catSel };
        if (code && mapa[code]) { limpiaErrores(f); marcaError(mapa[code], FLD[code] || r.j.error.message, true); }
      });
    }
  });
})();

// ---- Mapa-pin para captar la ubicación en Crear propuesta ----
(function () {
  var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';
  function inject() {
    if (!window.L) return;
    var anon = document.getElementById('anon-check');
    var form = anon && anon.closest ? anon.closest('form') : null;
    if (!form || document.getElementById('acg-prop-map')) return;
    var wrap = document.createElement('div');
    wrap.id = 'acg-prop-map-wrap';
    wrap.style.cssText = 'margin:14px 0';
    wrap.innerHTML = '<label style="display:block;font:600 13px Public Sans;color:#42525F;margin-bottom:6px">' + (VA ? 'Ubicació al mapa (opcional)' : 'Ubicación en el mapa (opcional)') + '</label>'
      + '<div style="display:flex;gap:8px;margin-bottom:8px"><input id="acg-prop-dir" placeholder="' + (VA ? 'Busca una adreça (ex. passeig Germanies 33)' : 'Busca una dirección (ej. paseo Germanías 33)') + '" style="flex:1;background:#F4F7FB;border:1.5px solid #E4EBF2;border-radius:10px;padding:10px 13px;font:400 14px Public Sans,sans-serif;outline:none"><button type="button" id="acg-prop-geo" style="border:none;cursor:pointer;background:#0A2A5E;color:#fff;font:700 13px Public Sans,sans-serif;padding:0 16px;border-radius:10px">' + (VA ? 'Buscar' : 'Buscar') + '</button></div>'
      + '<div id="acg-prop-map" style="height:230px;border:1px solid #E1E8F1;border-radius:12px;overflow:hidden;background:#EEF3F9"></div><p id="acg-prop-hint" style="font:400 11.5px Public Sans;color:#8A97A5;margin:5px 0 0">' + (VA ? 'Busca una adreça o fes clic al mapa per marcar el punt de la proposta.' : 'Busca una dirección o pincha en el mapa para marcar el punto de la propuesta.') + '</p>';
    var btn = form.querySelector('button[type="submit"]') || form.querySelector('button');
    if (btn && btn.parentNode) btn.parentNode.insertBefore(wrap, btn); else form.appendChild(wrap);
    try {
      var map = L.map('acg-prop-map').setView([38.9686, -0.1817], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      var mk = null;
      // Barrios de Gandia (clave por palabra que devuelve el geocoder → etiqueta canónica del backend).
      var BKW = [
        [/beniopa|sant *pere/, 'Beniopa – Sant Pere'],
        [/grau|grao|venecia|rafalcaid/, 'Grau – Venècia – Rafalcaid'],
        [/marxuquera|marchuquera/, 'Marxuquera'],
        [/santa *an/, 'Santa Anna'],
        [/corea/, 'Corea'],
        [/benipeixcar/, 'Benipeixcar'],
        [/raval|prado/, 'El Raval – El Prado'],
        [/germanies|jardinets/, 'Germanies – Els Jardinets'],
        [/liptica|argentina/, 'Pl. El·líptica – Rep. Argentina'],
        [/platja|playa/, 'Playa de Gandia'],
        [/historic|centre|centro/, 'Centro Histórico']
      ];
      var _lastValid = null;
      function norm(x){ return String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
      function revertir() {
        var h = document.getElementById('acg-prop-hint');
        if (_lastValid) { if (mk) mk.setLatLng(_lastValid); }
        else { if (mk) { try { map.removeLayer(mk); } catch (e) {} mk = null; } window._acgPropCoords = null; window._acgPropBarrio = null; window._acgPropMk = null;
          if (h) { h.textContent = VA ? 'Cap ubicacio fixada' : 'Sin ubicacion fijada'; h.style.color = ''; h.style.fontWeight = ''; } }
      }
      // Fija la ubicacion SOLO si el municipio es Gandia (rechaza Rafelcofer, Real de Gandia, Oliva, el mar de otros terminos, etc.)
      function fijar(ll) {
        var lat = +ll.lat.toFixed(6), lng = +ll.lng.toFixed(6);
        var h = document.getElementById('acg-prop-hint');
        if (h) { h.textContent = (VA ? 'Comprovant la zona...' : 'Comprobando la zona...'); h.style.color = '#8A6D0B'; h.style.fontWeight = '700'; }
        fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&addressdetails=1&lat=' + lat + '&lon=' + lng)
          .then(function (r) { return r.json(); }).then(function (j) {
            var a = (j && j.address) || {};
            // Municipio EXACTO Gandia. Ojo: "el Real de Gandia" es OTRO pueblo que contiene "gandia" en el nombre
            // (viene en a.village, no en town/city) -> por eso comparamos igualdad exacta y no incluimos village.
            var esGandia = [a.city, a.town, a.municipality].some(function (v) { return norm(v) === 'gandia'; });
            if (!esGandia) { avisoFuera(); revertir(); return; }
            window._acgPropCoords = { lat: lat, lng: lng }; window._acgPropMk = mk; _lastValid = [lat, lng];
            var campos = [a.quarter, a.neighbourhood, a.suburb, a.city_district, a.hamlet, a.residential, a.village];
            var found = '';
            for (var f = 0; f < campos.length && !found; f++) { if (!campos[f]) continue; var sN = norm(campos[f]); for (var i = 0; i < BKW.length; i++) { if (BKW[i][0].test(sN)) { found = BKW[i][1]; break; } } }
            window._acgPropBarrio = found || null;
            if (h) { var base = (VA ? 'Ubicacio fixada' : 'Ubicacion fijada'); h.textContent = found ? (base + ' - ' + (VA ? 'Barri' : 'Barrio') + ': ' + found) : (base + ' - ' + (VA ? 'tota la ciutat' : 'toda la ciudad')); h.style.color = '#1E7A45'; h.style.fontWeight = '700'; }
          }).catch(function () {
            window._acgPropCoords = { lat: lat, lng: lng }; window._acgPropMk = mk; _lastValid = [lat, lng]; window._acgPropBarrio = null;
            if (h) { h.textContent = (VA ? 'Ubicacio fixada' : 'Ubicacion fijada'); h.style.color = '#1E7A45'; h.style.fontWeight = '700'; }
          });
      }
      function dentro(ll) { return enCaja([ll.lng, ll.lat]); }
      function avisoFuera() { if (window.acgToast) window.acgToast(VA ? 'Només pots marcar dins de Gandia i els seus barris.' : 'Solo puedes marcar dentro de Gandia y sus barrios.', false); }
      function onDrag() { var p = mk.getLatLng(); if (!dentro(p)) { avisoFuera(); if (_lastValid) mk.setLatLng(_lastValid); else if (window._acgPropCoords) mk.setLatLng([window._acgPropCoords.lat, window._acgPropCoords.lng]); return; } fijar(p); }
      function ensureMk(ll) { if (!mk) { mk = L.marker(ll, { draggable: true }).addTo(map); mk.on('dragend', onDrag); } else mk.setLatLng(ll); }
      map.on('click', function (e) {
        try { map.invalidateSize({ pan: false, animate: false }); } catch (er) {}
        var ll = e.latlng;
        try { if (e.originalEvent) ll = map.mouseEventToLatLng(e.originalEvent) || e.latlng; } catch (er) {}
        if (!dentro(ll)) { avisoFuera(); return; }   // fuera de Gandia y sus barrios: no se puede marcar
        ensureMk(ll); fijar(ll);
      });
      // Buscador acotado ESTRICTO a Gandia (enCaja): no salen ubicaciones de otros pueblos (Oliva, etc.).
      function ponPin(ll) { ensureMk(ll); map.setView(ll, 17); fijar(ll); }
      var E2V = { 'calle': 'carrer', 'avenida': 'avinguda', 'avda': 'avinguda', 'av': 'avinguda', 'plaza': 'plaça', 'paseo': 'passeig', 'camino': 'camí', 'iglesia': 'església', 'ayuntamiento': 'ajuntament', 'playa': 'platja', 'puerto': 'port', 'mercado': 'mercat', 'san': 'sant', 'nueva': 'nova', 'mayor': 'major', 'parque': 'parc', 'estación': 'estació', 'estacion': 'estació', 'jardín': 'jardí', 'jardin': 'jardí', 'río': 'riu', 'rio': 'riu', 'centro': 'centre', 'ciudad': 'ciutat', 'colegio': 'escola', 'teatro': 'teatre', 'museo': 'museu', 'puente': 'pont', 'castillo': 'castell', 'cementerio': 'cementeri', 'polideportivo': 'poliesportiu', 'estadio': 'estadi' };
      var V2E = { 'carrer': 'calle', 'avinguda': 'avenida', 'plaça': 'plaza', 'passeig': 'paseo', 'camí': 'camino', 'cami': 'camino', 'església': 'iglesia', 'esglesia': 'iglesia', 'ajuntament': 'ayuntamiento', 'platja': 'playa', 'port': 'puerto', 'mercat': 'mercado', 'sant': 'san', 'nova': 'nueva', 'major': 'mayor', 'parc': 'parque', 'estació': 'estación', 'estacio': 'estación', 'jardí': 'jardín', 'jardi': 'jardín', 'riu': 'río', 'centre': 'centro', 'ciutat': 'ciudad', 'escola': 'colegio', 'teatre': 'teatro', 'museu': 'museo', 'pont': 'puente', 'castell': 'castillo', 'cementeri': 'cementerio', 'poliesportiu': 'polideportivo', 'estadi': 'estadio' };
      function geoSwap(s, m2) { return s.split(' ').map(function (w) { var lw = w.toLowerCase(); return m2[lw] || w; }).join(' '); }
      function enCaja(c) { return c[1] >= 38.93 && c[1] <= 39.03 && c[0] >= -0.27 && c[0] <= -0.135; }
      function buscar() {
        var inp = document.getElementById('acg-prop-dir'); if (!inp || !inp.value.trim()) return;
        var btn2 = document.getElementById('acg-prop-geo'); if (btn2) btn2.disabled = true;
        var q = inp.value.trim();
        var vs = [q, geoSwap(q, E2V), geoSwap(q, V2E)].filter(function (v, i, a) { return a.indexOf(v) === i; });
        function fin(ll) {
          if (btn2) btn2.disabled = false;
          if (ll) ponPin(ll);
          else if (window.acgToast) window.acgToast(VA ? 'No trobat per Gandia; prova amb carrer i número' : 'No encontrado por Gandia; prueba con calle y número', false);
        }
        (function next(i) {
          if (i < vs.length) {                            // Photon: tolerante a erratas y multiidioma, con sesgo en Gandia
            fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(vs[i]) + '&lat=38.9686&lon=-0.1817&limit=5')
              .then(function (r) { return r.json(); }).then(function (j) {
                var f = (j.features || []).filter(function (x) { return enCaja(x.geometry.coordinates); })[0];
                if (f) fin({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
                else next(i + 1);
              }).catch(function () { next(i + 1); });
            return;
          }
          fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q=' + encodeURIComponent(q + ', Gandia, Valencia'))
            .then(function (r) { return r.json(); }).then(function (j) {
              if (j && j[0] && enCaja([Number(j[0].lon), Number(j[0].lat)])) fin({ lat: Number(j[0].lat), lng: Number(j[0].lon) }); else fin(null);
            }).catch(function () { fin(null); });
        })(0);
      }
      var gbtn = document.getElementById('acg-prop-geo');
      if (gbtn) gbtn.addEventListener('click', buscar);
      var gdir = document.getElementById('acg-prop-dir');
      if (gdir) gdir.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
      function kick() { try { map.invalidateSize(); } catch (e) {} }
      setTimeout(kick, 250); setTimeout(kick, 900); setTimeout(kick, 2000);
      try { new IntersectionObserver(function (es, obs) { es.forEach(function (en) { if (en.isIntersecting) { kick(); obs.disconnect(); } }); }).observe(map.getContainer()); } catch (e) {}
      // Mantener el tamaño fresco si el contenedor cambia (redimensionar ventana, rotar móvil,
      // aparecer/ocultar teclado): sin esto Leaflet proyecta mal los clics lejos del centro.
      // NO toca mousedown → no interfiere con el arrastre/paneo.
      try { new ResizeObserver(function () { kick(); }).observe(map.getContainer()); } catch (e) {}
    } catch (e) {}
  }
  // Sincronizado con el render del runtime: el mapa aparece con el formulario,
  // no 1,5 s después (el intervalo queda solo como red de seguridad).
  try { new MutationObserver(function () { inject(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  setInterval(inject, 1500);
  inject();
})();

// ---- Botón Entrar / Mi cuenta + popup de login (Fase 3) ----
(function () {
  function curVA() { try { return (localStorage.getItem('acg_lang') || 'es') === 'va'; } catch (e) { return false; } }
  function conSesion() { try { return !!localStorage.getItem('acg_session'); } catch (e) { return false; } }
  // En la Home móvil no hay <header> (layout propio): #acg-mobbar es la barra superior donde inyectar los mismos botones.
  function hostHeader() { return document.querySelector("header div[style*='margin-left:auto'], header div[style*='margin-left: auto'], #acg-mobbar"); }
  var VA = curVA();   // textos de popups/notas de este bloque (los botones de cabecera usan curVA() en vivo)

  // CSS responsivo de los botones inyectados (una sola vez). En pantallas estrechas los botones
  // Únete/Cuenta pasan a solo-icono para que NUNCA desborden ni empujen el carrito.
  (function () {
    if (document.getElementById('acg-hbtn-css')) return;
    var st = document.createElement('style'); st.id = 'acg-hbtn-css';
    st.textContent =
      // El texto normal NO es editable: cursor flecha en vez del I-beam de "escribir" (y sin caret
      // parpadeante al clicar). Los campos reales (input/textarea) conservan su cursor y su caret;
      // botones, enlaces, selects y checks van con la mano.
      'body{cursor:default;caret-color:transparent}' +
      'input,textarea{cursor:text;caret-color:auto}' +
      '[contenteditable],[contenteditable] *{cursor:text;caret-color:auto}' +
      'a[href],button,select,option,input[type=checkbox],input[type=radio],input[type=file],summary{cursor:pointer}' +
      // Esqueleto de carga GLOBAL: 20 páginas usaban la clase acg-sk sin definir su CSS → la demo
      // se veía tal cual mientras cargaba ("muestra una cosa y luego la real"). Definición única aquí.
      '.acg-sk{background:#eef2f6!important;border-color:#e3e9f0!important;pointer-events:none;position:relative;overflow:hidden}' +
      '.acg-sk *{color:transparent!important;visibility:hidden!important}' +
      '.acg-sk::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent);transform:translateX(-100%);animation:acgshim 1.3s infinite}' +
      '@keyframes acgshim{100%{transform:translateX(100%)}}' +
      'header div[style*="margin-left:auto"],header div[style*="margin-left: auto"]{min-width:0;flex-wrap:nowrap}' +
      '.acg-hbtn{transition:padding .12s}' +
      // Tamaño UNIFORME (38px de alto) para TODOS los controles del lado derecho del nav, en PC y móvil:
      // toggle ES/VA (32px dentro de su envoltorio de 3px = 38px), CTA Participa, buscador Home, Únete, Cuenta y carrito.
      'header div[style*="margin-left:auto"]>a.acg-btn,header div[style*="margin-left: auto"]>a.acg-btn,#acg-mobbar>a.acg-btn,' +
      'header div[style*="margin-left:auto"]>button.acg-btn,header div[style*="margin-left: auto"]>button.acg-btn,#acg-mobbar>button.acg-btn' +
      '{height:38px!important;box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;padding-top:0!important;padding-bottom:0!important}' +
      'header div[style*="margin-left:auto"]>a[href*="Participacion"],header div[style*="margin-left: auto"]>a[href*="Participacion"]' +
      '{font-size:13px!important;padding-left:16px!important;padding-right:16px!important;justify-content:center}' +
      '#acg-unete-btn,#acg-auth-btn{font-size:13px!important;padding-left:14px!important;padding-right:14px!important}' +
      // Toggle ES/VA: el envoltorio siempre con 3px y los botones a 32px (los selectores largos empatan en
      // especificidad con el override !important de cada página y ganan por venir después en el <head>).
      'header div[style*="margin-left:auto"]>div:has(>button),header div[style*="margin-left: auto"]>div:has(>button),#acg-mobbar>div:has(>button){padding:3px!important;display:inline-flex;align-items:center}' +
      "header>div[style*='height:70px']>div[style*='margin-left:auto']>div button,header>div[style*='height:70px']>div[style*='margin-left: auto']>div button," +
      'header div[style*="margin-left:auto"]>div>button.acg-btn,header div[style*="margin-left: auto"]>div>button.acg-btn,#acg-mobbar>div>button.acg-btn' +
      '{height:32px!important;box-sizing:border-box!important;padding:0 11px!important;font-size:12px!important;display:inline-flex;align-items:center}' +
      // Buscador de la Home en modo icono: mismo 38×38 que el resto (la página lo pone a 40/36).
      '#acg-mobbar .acg-search-btn{width:38px!important;padding:0!important;justify-content:center!important;font-size:0!important;gap:0!important}' +
      '@media(max-width:1439px){header .acg-search-btn{width:38px!important}}' +
      // ≤1300px (portátiles justos incluidos): Únete/Cuenta a solo-icono 38×38 — sin esto el carrito se recortaba a 1280.
      '@media(max-width:1300px){#acg-unete-btn .acg-hbtn-txt,#acg-auth-btn .acg-hbtn-txt{display:none}#acg-unete-btn,#acg-auth-btn{width:38px!important;padding-left:0!important;padding-right:0!important;justify-content:center!important}' +
      'header div[style*="margin-left:auto"],header div[style*="margin-left: auto"]{gap:8px!important}}';
    (document.head || document.documentElement).appendChild(st);
  })();

  // Botón de cabecera "Entrar / Mi cuenta": find-or-create + SIEMPRE refresca la etiqueta al idioma actual
  // (así cambia al instante al togglear ES/VA, sin recargar).
  function ponBoton() {
    var host = hostHeader(); if (!host) return;
    var a = document.getElementById('acg-auth-btn');
    if (!a) {
      a = document.createElement('a'); a.id = 'acg-auth-btn'; a.className = 'acg-btn acg-hbtn';
      a.style.cssText = 'text-decoration:none;background:#0A2A5E;color:#fff;font:700 12.5px Public Sans;padding:8px 14px;border-radius:9px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;flex-shrink:0';
      host.appendChild(a);
    }
    a.href = '/cuenta';
    var txt = conSesion() ? (curVA() ? 'El meu compte' : 'Mi cuenta') : 'Entrar';
    if (a.getAttribute('data-txt') === txt) return;   // idempotente: sin cambios reales no se toca el DOM (evita bucle con el MutationObserver)
    a.setAttribute('data-txt', txt); a.setAttribute('aria-label', txt);
    a.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg><span class="acg-hbtn-txt">' + txt + '</span>';
  }
  window.__acgOnRender(ponBoton);

  // Botón "Únete/Uneix-te": find-or-create + refresca etiqueta al idioma actual
  function ponUnete() {
    var host = hostHeader(); if (!host) return;
    var a = document.getElementById('acg-unete-btn');
    if (!a) {
      a = document.createElement('a'); a.id = 'acg-unete-btn'; a.className = 'acg-btn acg-hbtn';
      a.href = '/Participa.dc.html';
      a.style.cssText = 'text-decoration:none;background:#F6BE18;color:#0A2A5E;font:800 12.5px Public Sans;padding:8px 14px;border-radius:9px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;flex-shrink:0';
      var auth = document.getElementById('acg-auth-btn');
      if (auth) host.insertBefore(a, auth); else host.appendChild(a);
    }
    var txt = curVA() ? 'Uneix-te' : 'Únete';
    if (a.getAttribute('data-txt') === txt) return;   // idempotente (evita bucle con el MutationObserver)
    a.setAttribute('data-txt', txt); a.setAttribute('aria-label', txt);
    a.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20.8 8.6a5 5 0 0 0-8.1-1.6L12 7.7l-.7-.7a5 5 0 1 0-7.1 7.1l7.8 7.4 7.8-7.4a5 5 0 0 0 1-5.5Z"></path></svg><span class="acg-hbtn-txt">' + txt + '</span>';
  }
  window.__acgOnRender(ponUnete);

  // En CrearPropuesta con sesión: ocultar el bloque "Tus datos" (ya se conoce la cuenta)
  function ajustaPropuesta() {
    var anon = document.getElementById('anon-check');
    if (!anon || !conSesion()) return;
    var bloque = anon.closest('div[style*="border-radius:20px"]');
    if (bloque && bloque.style.display !== 'none') {
      bloque.style.display = 'none';
      var nota = document.createElement('div');
      nota.className = 'acg-prop-nota';
      nota.style.cssText = 'background:#EAF3FC;border:1px solid #CFE0F5;border-radius:14px;padding:14px 16px;font:600 13.5px Public Sans,sans-serif;color:#1563C4;display:flex;align-items:center;gap:9px';
      nota.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"></path></svg>' +
        (VA ? 'Publiques amb el teu compte verificat.' : 'Publicas con tu cuenta verificada.');
      bloque.parentNode.insertBefore(nota, bloque);
    }
  }
  window.__acgOnRender(ajustaPropuesta);

  // Popup de invitación a crear cuenta
  window.acgLoginPopup = function () {
    if (document.getElementById('acg-login-pop')) return;
    // Guardar a dónde volver tras el login + borrador del form de propuesta (no perder lo escrito).
    try {
      localStorage.setItem('acg_return', location.pathname + location.search);
      var _pf = document.getElementById('acg-form-propuesta');
      if (_pf) {
        var _pd = {};
        var _t1 = _pf.querySelector('input[maxlength]'); if (_t1) _pd.t = _t1.value;
        var _t2 = _pf.querySelector('textarea'); if (_t2) _pd.d = _t2.value;
        var _s1 = _pf.querySelector('select'); if (_s1) _pd.c = _s1.value;
        var _a1 = _pf.querySelector('#anon-check'); if (_a1) _pd.a = _a1.checked;
        var _n1 = _pf.querySelector('#nl-check'); if (_n1) _pd.n = _n1.checked;
        if (window._acgPropCoords) _pd.co = window._acgPropCoords;
        localStorage.setItem('acg_prop_draft', JSON.stringify(_pd));
      }
    } catch (e) {}
    var o = document.createElement('div');
    o.id = 'acg-login-pop';
    o.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(7,30,69,.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px';
    o.innerHTML = '<div style="background:#fff;border-radius:22px;max-width:400px;width:100%;padding:32px 30px;text-align:center;box-shadow:0 30px 70px rgba(10,42,94,.3);position:relative">' +
      '<button id="acg-pop-x" style="position:absolute;top:14px;right:16px;border:none;background:none;font-size:22px;color:#8A99A8;cursor:pointer;line-height:1">×</button>' +
      '<div style="width:54px;height:54px;border-radius:16px;background:#EAF3FC;display:flex;align-items:center;justify-content:center;margin:0 auto 14px"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1563C4" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>' +
      '<h3 style="font:800 21px Bricolage Grotesque,sans-serif;color:#0A2A5E;margin:0 0 8px">' + (VA ? 'Uneix-te a la comunitat' : 'Únete a la comunidad') + '</h3>' +
      '<p style="font:400 14px Public Sans,sans-serif;color:#5C6B7A;margin:0 0 20px;line-height:1.55">' + (VA ? 'Per a votar, comentar i participar necessites un compte gratuït. Tarda menys d’un minut.' : 'Para votar, comentar y participar necesitas una cuenta gratuita. Tardas menos de un minuto.') + '</p>' +
      '<a href="/cuenta" style="display:block;text-decoration:none;background:#F6BE18;color:#0A2A5E;font:800 15px Public Sans,sans-serif;padding:13px;border-radius:12px;margin-bottom:10px">' + (VA ? 'Crear compte o entrar' : 'Crear cuenta o entrar') + '</a>' +
      '<a href="/cuenta" style="display:block;text-decoration:none;background:#fff;color:#17232F;border:1.5px solid #E4EBF2;font:700 14px Public Sans,sans-serif;padding:12px;border-radius:12px">' + (VA ? 'Continuar amb Google' : 'Continuar con Google') + '</a></div>';
    document.body.appendChild(o);
    function _cerrar() { o.remove(); try { localStorage.removeItem('acg_return'); localStorage.removeItem('acg_prop_draft'); } catch (e) {} }
    o.addEventListener('click', function (e) { if (e.target === o) _cerrar(); });
    document.getElementById('acg-pop-x').addEventListener('click', _cerrar);
  };
  // Restaurar el borrador de Crear propuesta al volver (tras login) — sondea hasta que el form exista.
  (function () {
    try { if (!localStorage.getItem('acg_prop_draft')) return; } catch (e) { return; }
    var tries = 0;
    var iv = setInterval(function () {
      var pf = document.getElementById('acg-form-propuesta');
      if (pf) {
        try {
          var pd = JSON.parse(localStorage.getItem('acg_prop_draft') || '{}');
          var t1 = pf.querySelector('input[maxlength]'); if (t1 && pd.t) t1.value = pd.t;
          var t2 = pf.querySelector('textarea'); if (t2 && pd.d) t2.value = pd.d;
          var s1 = pf.querySelector('select'); if (s1 && pd.c) s1.value = pd.c;
          var a1 = pf.querySelector('#anon-check'); if (a1 && pd.a) a1.checked = true;
          var n1 = pf.querySelector('#nl-check'); if (n1 && pd.n) n1.checked = true;
          if (pd.co) window._acgPropCoords = pd.co;
          localStorage.removeItem('acg_prop_draft');
        } catch (e) {}
        clearInterval(iv);
      } else if (++tries > 25) clearInterval(iv);
    }, 300);
  })();

  function urlPid() { try { var v = new URLSearchParams(location.search).get('id') || ''; return /^[0-9a-f-]{36}$/.test(v) ? v : ''; } catch (er) { return ''; } }
  function token() { try { return localStorage.getItem('acg_session') || ''; } catch (er) { return ''; } }
  // El access token de Supabase caduca (~1 h). Sin esto, un usuario CON sesión recibía
  // "necesitas cuenta" al apoyar/votar. En 401: refrescar con acg_refresh y reintentar 1 vez.
  var SUPA_URL = 'https://msbrdowdkwqrrdlfeztj.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zYnJkb3dka3dxcnJkbGZlenRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NDc5NTAsImV4cCI6MjA5OTAyMzk1MH0.ByomcWyS0YiQHg8KjdYvx32vxwa1ilGZOE-1aD0TRR0';
  var _refreshing = null;
  function refrescaSesion() {
    if (_refreshing) return _refreshing;   // SERIALIZA: el refresh token de Supabase es de un solo uso; dos refrescos a la vez → el 2º falla (401 falso)
    var rt = ''; try { rt = localStorage.getItem('acg_refresh') || ''; } catch (er) {}
    if (!rt) return Promise.resolve(false);
    _refreshing = fetch(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: SUPA_ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt })
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (!j.access_token) return false;
        try { localStorage.setItem('acg_session', j.access_token); if (j.refresh_token) localStorage.setItem('acg_refresh', j.refresh_token); } catch (er) {}
        return true;
      }).catch(function () { return false; })
      .then(function (res) { _refreshing = null; return res; });
    return _refreshing;
  }
  // fetch autenticado: si la API devuelve 401, refresca la sesión y reintenta UNA vez.
  function authFetch(url, opts) {
    function go() {
      var o = opts || {};
      var h = Object.assign({}, o.headers || {}, { authorization: 'Bearer ' + token() });
      return fetch(url, Object.assign({}, o, { headers: h }));
    }
    return go().then(function (r) {
      if (r.status !== 401) return r;
      return refrescaSesion().then(function (ok) { return ok ? go() : r; });
    });
  }
  // Tras votar, refresca los contadores visibles de la tarjeta/página (no solo el botón).
  function pintaContadores(scope, j) {
    try {
      var leaves = (scope || document).querySelectorAll('span,div,b,strong,p,h3,h4');
      for (var i = 0; i < leaves.length; i++) {
        var el2 = leaves[i];
        if (el2.children.length) continue;
        // El denominador de "X / Y" (la meta) va precedido por "/": es la meta, NO un contador → no tocarlo.
        var _pv = el2.previousSibling;
        if (_pv && /\/\s*$/.test(_pv.textContent || '')) continue;
        var tx = (el2.textContent || '').trim();
        var m = tx.match(/^(\d+)(\s*(apoyos?|suports?))$/i);
        if (m) { el2.textContent = j.aFavor + m[2]; continue; }
        if (/^\d+$/.test(tx)) {
          // el runtime envuelve el número: la etiqueta puede estar en el padre O en el abuelo
          var pa = el2.parentElement, ab = pa && pa.parentElement;
          var ctx = (((pa && pa.textContent) || '') + ' ' + ((ab && ab.textContent) || '')).toLowerCase();
          var fav = ctx.indexOf('a favor') > -1, con = ctx.indexOf('en contra') > -1, apo = /apoyo|suport/.test(ctx);
          if (con && !fav) el2.textContent = String(j.enContra);
          else if ((fav && !con) || (apo && !con)) el2.textContent = String(j.aFavor);
          else if (fav && con) {
            // contenedor conjunto: decide por la etiqueta más cercana dentro del abuelo
            var propio = ((pa && pa.textContent) || '').toLowerCase();
            if (propio.indexOf('en contra') > -1 && propio.indexOf('a favor') === -1) el2.textContent = String(j.enContra);
            else if (propio.indexOf('a favor') > -1) el2.textContent = String(j.aFavor);
          }
        }
      }
    } catch (er) {}
  }
  // Tras votar: recalcula la BARRA de progreso (desde la meta visible) y repinta los números de apoyos
  // (el grande del detalle, el "X / Y" de las tarjetas y el que va junto al icono de pulgar).
  function pintaApoyoUI(scope, j) {
    try {
      var root = scope || document;
      var val = String(Math.round(j.aFavor)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');   // miles con punto (== this.fmt)
      function setNum(head) {
        var cands = [head].concat([].slice.call(head.querySelectorAll('*')));
        for (var k = 0; k < cands.length; k++) {
          var c = cands[k]; if (c.children.length) continue;
          var tx = (c.textContent || '').trim();
          if (/^[\d.]+$/.test(tx)) { c.textContent = val; return; }                       // nodo = solo número (detalle)
          var m = tx.match(/^([\d.]+)(\s*\/\s*[\d.]+.*)$/); if (m) { c.textContent = val + m[2]; return; }  // "X / Y" (lista)
        }
      }
      // 1) Barras de progreso: recalcular el ancho desde la meta que aparece en su encabezado.
      // Selector por "cubic-bezier" (no lleva ':' → el navegador no lo normaliza con espacios como haría con "transition:width").
      var fills = root.querySelectorAll('div[style*="cubic-bezier"]');
      for (var i = 0; i < fills.length; i++) {
        var fill = fills[i], track = fill.parentElement, head = track && track.previousElementSibling;
        if (!head) continue;
        var mm = (head.textContent || '').match(/\/\s*([\d.]+)/);      // encabezado tipo "… / 5.000"
        if (!mm) continue;                                            // no es un widget de apoyos → ignorar
        var metaN = Number(mm[1].replace(/\./g, '')) || 0;
        if (metaN > 0) fill.style.width = Math.min(100, Math.round(j.aFavor / metaN * 100)) + '%';
        setNum(head);
      }
      // 2) Número de apoyos junto al icono de pulgar (M7 11v9)
      var sps = root.querySelectorAll('span');
      for (var s = 0; s < sps.length; s++) {
        var sp = sps[s];
        if (sp.children.length !== 1 || !/M7 11v9/.test(sp.innerHTML)) continue;   // solo el svg pulgar + texto
        for (var c2 = 0; c2 < sp.childNodes.length; c2++) {
          var nd = sp.childNodes[c2];
          if (nd.nodeType === 3 && /\d/.test(nd.nodeValue)) nd.nodeValue = nd.nodeValue.replace(/[\d.]+/, val);
        }
      }
    } catch (e) {}
  }
  var MIVOTO = {};   // pid -> mi voto actual (1, -1 o 0). Permite el toggle quitar-voto.
  function pintaBtnVotado(el, valor, n, esApoyo) {
    var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';
    if (!el.getAttribute('data-orig')) el.setAttribute('data-orig', el.innerHTML);
    if (el.getAttribute('data-ostyle') == null) el.setAttribute('data-ostyle', el.getAttribute('style') || '');   // guarda el estilo original (color azul, etc.) para restaurarlo al quitar el voto
    el.setAttribute('data-voted', String(valor));
    el.style.background = valor === 1 ? '#2E9E5B' : '#D93B3B'; el.style.color = '#fff'; el.style.border = 'none';
    var txt = esApoyo ? (VA ? 'Recolzada' : 'Apoyada') : (valor === 1 ? 'A favor' : 'En contra');
    el.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"></path></svg>' + txt + ((n === '' || n == null) ? '' : ' (' + n + ')');
  }
  function pintaBtnNeutro(el) {
    var orig = el.getAttribute('data-orig');
    if (orig != null) el.innerHTML = orig;
    el.removeAttribute('data-voted');
    var os = el.getAttribute('data-ostyle');
    if (os != null) el.setAttribute('style', os);   // restaura el estilo original (vuelve a azul), no dejarlo gris
    else { el.style.background = ''; el.style.color = ''; el.style.border = ''; }
  }
  // Solo un sentido puede estar activo: al votar (o cambiar el sentido), el otro botón se apaga.
  function apagaHermanos(scope, el) {
    var vs = (scope || document).querySelectorAll('[data-voted]');
    for (var i = 0; i < vs.length; i++) if (vs[i] !== el) pintaBtnNeutro(vs[i]);
  }
  function votar(pid, valor, el, esApoyo) {
    if (el.getAttribute('data-voting')) return;
    el.setAttribute('data-voting', '1');
    var quitar = MIVOTO[pid] === valor;   // ya había votado esto mismo → toggle: quitar el voto
    authFetch('/api/votos', {
      method: quitar ? 'DELETE' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposalId: pid, valor: valor })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        el.removeAttribute('data-voting');
        if (r.j && r.j.ok) {
          MIVOTO[pid] = r.j.miVoto || 0;
          var scope = el.closest('[data-pid]') || document;
          apagaHermanos(scope, el);
          if (r.j.miVoto) pintaBtnVotado(el, valor, valor === 1 ? r.j.aFavor : r.j.enContra, esApoyo);
          else pintaBtnNeutro(el);
          pintaContadores(scope, r.j);
          pintaApoyoUI(scope, r.j);
        } else if (r.s === 401) { window.acgLoginPopup(); }
      }).catch(function () { el.removeAttribute('data-voting'); });
  }
  // En la página de detalle: al cargar, pintar si YA habías votado (para que "sumar" y "quitar" tengan sentido)
  (function estadoInicial() {
    var pid = urlPid();
    if (!pid || !token()) return;
    authFetch('/api/votos?proposalId=' + pid, {})
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok) return;
        MIVOTO[pid] = j.miVoto || 0;
        // Sincroniza el número de apoyos y la barra con el recuento REAL (/api/votos, sin caché).
        // Evita que al recargar se vea el valor viejo que sirve el CDN cacheado de /api/proposals.
        var sync = function () { pintaContadores(document, j); pintaApoyoUI(document, j); };
        sync(); setTimeout(sync, 900); setTimeout(sync, 2200);
        if (!j.miVoto) return;
        var marca = function () {
          var btns = document.querySelectorAll('button, a');
          for (var i = 0; i < btns.length; i++) {
            var t = (btns[i].textContent || '').trim().toLowerCase();
            if (j.miVoto === 1 && /^(votar a favor|a favor|apoyar|recolzar|donar suport|dóna suport|suport)\b/.test(t) && !btns[i].getAttribute('data-orig')) { pintaBtnVotado(btns[i], 1, j.aFavor, /^(apoyar|recolzar|donar suport|dóna suport|suport)\b/.test(t)); return true; }
            if (j.miVoto === -1 && /^(votar en contra|en contra)\b/.test(t) && !btns[i].getAttribute('data-orig')) { pintaBtnVotado(btns[i], -1, j.enContra, false); return true; }
          }
          return false;
        };
        if (!marca()) { var tries = 0; var tm = setInterval(function () { if (marca() || ++tries > 10) clearInterval(tm); }, 800); }
      }).catch(function () {});
  })();

  // En páginas con LISTA de tarjetas: marcar en verde ("Apoyada") las que YA has apoyado y activar el toggle
  // (al pulsarlas de nuevo se quita el voto y la barra retrocede). Antes solo se hacía en el detalle.
  (function estadoListaInicial() {
    if (!token() || !document.querySelector('[data-pid]')) return;
    var apoyoBtn = function (card) {
      var bs = card.querySelectorAll('button');
      for (var k = 0; k < bs.length; k++) { if (/^(apoyar|recolzar|donar suport|dóna suport|suport)\b/.test((bs[k].textContent || '').trim().toLowerCase())) return bs[k]; }
      return null;
    };
    // Nº de apoyos REAL desde /api/votos (nunca rascar el número de la tarjeta: en la Home el elemento
    // sobre la barra es "Meta: 100 apoyos" y el marcado tras recargar mostraba ese 100 como contador).
    var CNT = {};
    var pideCnt = function (pid) {
      if (CNT[pid] != null) return;
      CNT[pid] = '';   // en curso: mientras tanto el botón se pinta sin número
      authFetch('/api/votos?proposalId=' + pid, {})
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (jj) {
          if (!jj || !jj.ok) { delete CNT[pid]; return; }
          CNT[pid] = String(jj.aFavor || 0);
          var c2 = document.querySelector('[data-pid="' + pid + '"]');
          var b2 = c2 && (c2.querySelector('button[data-voted]') || apoyoBtn(c2));
          if (b2) pintaBtnVotado(b2, 1, CNT[pid], true);
        }).catch(function () { delete CNT[pid]; });
    };
    authFetch('/api/votos?mine=1', {})
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok || !j.mine) return;
        for (var pid in j.mine) { if (j.mine[pid] === 1 && MIVOTO[pid] == null) MIVOTO[pid] = 1; }   // semilla (respeta si luego quitas el voto)
        var aplica = function () {
          var cs = document.querySelectorAll('[data-pid]');
          for (var i = 0; i < cs.length; i++) {
            var card = cs[i], pid = card.getAttribute('data-pid');
            if (!pid || MIVOTO[pid] !== 1) continue;                 // solo las que sigues apoyando ahora
            var btn = apoyoBtn(card);
            if (!btn || btn.getAttribute('data-voted')) continue;
            pideCnt(pid);
            pintaBtnVotado(btn, 1, CNT[pid] || '', true);
          }
        };
        aplica();
        var tries = 0; var tm = setInterval(function () { aplica(); if (++tries > 15) clearInterval(tm); }, 700);   // el runtime re-renderiza: re-aplicar
      }).catch(function () {});
  })();

  function comentar(pid, btn) {
    if (btn.getAttribute('data-sending')) return;
    var box = btn.closest('div');
    var ta = box && box.querySelector('.acg-coment-input');
    while (!ta && box && box.parentNode) { box = box.parentNode; ta = box.querySelector ? box.querySelector('.acg-coment-input') : null; }
    if (!ta) return;
    var texto = (ta.value || '').trim();
    var msg = box.querySelector('.acg-coment-msg');
    var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';
    if (texto.length < 2) { ta.focus(); return; }
    btn.setAttribute('data-sending', '1');
    authFetch('/api/comentarios', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proposalId: pid, texto: texto, lang: VA ? 'va' : 'es' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        btn.removeAttribute('data-sending');
        if (r.j && r.j.ok) {
          ta.value = '';
          if (msg) { msg.style.color = '#2E9E5B'; msg.textContent = VA ? 'Comentari publicat.' : 'Comentario publicado.'; msg.style.display = 'block'; }
          try {   // OPTIMISTA: pinta el comentario al instante con foto, cargo y medallas reales (los devuelve el servidor)
            var _lista = document.querySelector('.acg-coment-list');
            if (_lista) {
              function _e(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
              var cm = r.j.comentario || { autor: (VA ? 'Tu' : 'Tú'), texto: texto, avatar: '', cargo: '', titulos: [], fecha: (VA ? 'ara' : 'ahora') };
              var nom = cm.autor || (VA ? 'Veí/na' : 'Vecino/a');
              var ini = (nom.split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase()) || '··';
              var meds = (cm.titulos || []).map(function (t) { return t.emoji; }).filter(Boolean).join(' ');
              var avBg = cm.cargo ? '#6B4EE6' : '#0B7580';
              var avHtml = cm.avatar
                ? '<img src="' + _e(cm.avatar) + '" alt="" referrerpolicy="no-referrer" style="width:40px;height:40px;flex-shrink:0;border-radius:3px;object-fit:cover">'
                : '<span style="width:40px;height:40px;flex-shrink:0;border-radius:3px;background:' + avBg + ';color:#fff;font:800 13px Public Sans;display:flex;align-items:center;justify-content:center">' + _e(ini) + '</span>';
              var cargoHtml = cm.cargo ? '<sup style="font-size:8.5px;font-weight:800;color:#6B4EE6;letter-spacing:.03em;text-transform:uppercase;margin-left:2px">' + _e(cm.cargo).toUpperCase() + '</sup>' : '';
              var medsHtml = meds ? '<span style="font-size:13px;letter-spacing:2px">' + meds + '</span>' : '';
              var _card = document.createElement('div'); _card.style.cssText = 'display:flex;gap:12px';
              _card.innerHTML = avHtml + '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px"><span style="font:700 14px Public Sans;color:#17232F"><span class="_nm"></span>' + cargoHtml + '</span><span style="font-size:12.5px;color:#66788A">' + _e(cm.fecha || (VA ? 'ara' : 'ahora')) + '</span>' + medsHtml + '</div><p style="font-size:14.5px;color:#42525F;margin:0;text-wrap:pretty"></p></div>';
              _card.querySelector('._nm').textContent = nom;
              _card.querySelector('p').textContent = cm.texto || texto;
              _lista.appendChild(_card); _card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          } catch (e) {}
        } else if (r.s === 401) { window.acgLoginPopup(); }
        else if (msg) { msg.style.color = '#D93B3B'; msg.textContent = VA ? 'No s’ha pogut enviar. Torna-ho a provar.' : 'No se pudo enviar. Inténtalo de nuevo.'; msg.style.display = 'block'; }
      }).catch(function () { btn.removeAttribute('data-sending'); });
  }

  // Apoyo a campañas del partido (delegado; requiere sesión; toggle)
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-acg-camp]') : null;
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (!conSesion()) { window.acgLoginPopup(); return; }
    if (el.getAttribute('data-camping')) return;
    var slug = el.getAttribute('data-acg-camp');
    if (!slug) return;
    el.setAttribute('data-camping', '1');
    authFetch('/api/campanas-apoyo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: slug }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        el.removeAttribute('data-camping');
        if (r.j && r.j.ok) {
          var VA2 = (localStorage.getItem('acg_lang') || 'es') === 'va';
          el.textContent = r.j.miApoyo ? (VA2 ? 'Li dones suport ✓' : 'La apoyas ✓') : (VA2 ? 'Recolzar campanya' : 'Apoyar campaña');
          el.style.background = r.j.miApoyo ? '#1E7A45' : '#1563C4';
          var ns = document.querySelectorAll('[data-camp-n]');
          for (var i = 0; i < ns.length; i++) ns[i].textContent = String(r.j.apoyos);
        } else if (r.s === 401) { window.acgLoginPopup(); }
      }).catch(function () { el.removeAttribute('data-camping'); });
  }, true);

  // Likes en comentarios del debate (delegado; requiere sesión)
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-acg-like]') : null;
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (!conSesion()) { window.acgLoginPopup(); return; }
    if (el.getAttribute('data-liking')) return;
    el.setAttribute('data-liking', '1');
    authFetch('/api/comentarios', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'like', commentId: el.getAttribute('data-acg-like') }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        el.removeAttribute('data-liking');
        if (r.j && r.j.ok) {
          var n = el.querySelector('[data-like-n]'); if (n) n.textContent = String(r.j.likes);
          var svg = el.querySelector('svg');
          if (r.j.miLike) { el.style.background = '#FBECEC'; el.style.color = '#D24B4B'; el.style.borderColor = '#F5C9C9'; if (svg) svg.setAttribute('fill', '#D24B4B'); }
          else { el.style.background = '#fff'; el.style.color = '#5C6B7A'; el.style.borderColor = '#E4EBF2'; if (svg) svg.setAttribute('fill', 'none'); }
        } else if (r.s === 401) { window.acgLoginPopup(); }
      }).catch(function () { el.removeAttribute('data-liking'); });
  }, true);

  // Denunciar propuesta (botón del detalle): popup con motivos → POST /api/reportes (revisión manual en admin)
  function abreDenuncia(pid) {
    if (document.getElementById('acg-den-pop')) return;
    var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';
    var motivos = [
      ['spam', VA ? 'Spam o publicitat' : 'Spam o publicidad'],
      ['ofensivo', VA ? 'Contingut ofensiu o insults' : 'Contenido ofensivo o insultos'],
      ['falso', VA ? 'Informació falsa o enganyosa' : 'Información falsa o engañosa'],
      ['duplicado', VA ? 'Proposta duplicada' : 'Propuesta duplicada'],
      ['otro', VA ? 'Un altre motiu' : 'Otro motivo']
    ];
    var o = document.createElement('div');
    o.id = 'acg-den-pop';
    o.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(7,30,69,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px';
    var opts = motivos.map(function (m) {
      return '<label style="display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border:1px solid #E4EBF2;border-radius:9px;cursor:pointer;font:500 14px Public Sans,sans-serif;color:#33414F"><input type="radio" name="acg-den-mot" value="' + m[0] + '" style="margin-top:2px;accent-color:#D93B3B;flex-shrink:0">' + m[1] + '</label>';
    }).join('');
    o.innerHTML = '<div style="background:#fff;border-radius:18px;max-width:430px;width:100%;padding:26px;box-shadow:0 30px 70px rgba(10,42,94,.3);position:relative;max-height:88vh;overflow:auto">' +
      '<button id="acg-den-x" aria-label="Cerrar" style="position:absolute;top:12px;right:14px;border:none;background:none;font-size:22px;color:#8A99A8;cursor:pointer;line-height:1">×</button>' +
      '<h3 style="font:800 20px Fraunces,serif;color:#0A2A5E;margin:0 0 6px">' + (VA ? 'Denunciar proposta' : 'Denunciar propuesta') + '</h3>' +
      '<p style="font:400 13.5px Public Sans,sans-serif;color:#5C6B7A;margin:0 0 16px;line-height:1.5">' + (VA ? 'Conta’ns què passa amb aquesta proposta. L’equip la revisarà.' : 'Cuéntanos qué pasa con esta propuesta. El equipo la revisará.') + '</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">' + opts + '</div>' +
      '<textarea id="acg-den-nota" maxlength="500" placeholder="' + (VA ? 'Detalls (opcional)' : 'Detalles (opcional)') + '" style="width:100%;min-height:64px;resize:vertical;border:1px solid #E4EBF2;border-radius:9px;padding:11px 13px;font:400 14px Public Sans,sans-serif;color:#17232F;outline:none;box-sizing:border-box"></textarea>' +
      '<div id="acg-den-st" style="font:600 13px Public Sans,sans-serif;margin:10px 0 0;min-height:18px"></div>' +
      '<div style="display:flex;gap:9px;margin-top:12px">' +
      '<button id="acg-den-cancel" style="flex:1;border:1px solid #E4EBF2;background:#fff;color:#42525F;font:700 14px Public Sans,sans-serif;padding:12px;border-radius:9px;cursor:pointer">' + (VA ? 'Cancel·lar' : 'Cancelar') + '</button>' +
      '<button id="acg-den-go" style="flex:1;border:none;background:#D93B3B;color:#fff;font:800 14px Public Sans,sans-serif;padding:12px;border-radius:9px;cursor:pointer">' + (VA ? 'Enviar denúncia' : 'Enviar denuncia') + '</button>' +
      '</div></div>';
    document.body.appendChild(o);
    function cerrar() { o.remove(); }
    o.addEventListener('click', function (e) { if (e.target === o) cerrar(); });
    document.getElementById('acg-den-x').addEventListener('click', cerrar);
    document.getElementById('acg-den-cancel').addEventListener('click', cerrar);
    var go = document.getElementById('acg-den-go');
    go.addEventListener('click', function () {
      var st = document.getElementById('acg-den-st');
      var sel = o.querySelector('input[name="acg-den-mot"]:checked');
      if (!sel) { st.style.color = '#D93B3B'; st.textContent = VA ? 'Tria un motiu.' : 'Elige un motivo.'; return; }
      if (go.getAttribute('data-sending')) return;
      go.setAttribute('data-sending', '1'); go.style.opacity = '.7';
      var nota = (document.getElementById('acg-den-nota').value || '').trim();
      authFetch('/api/reportes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proposalId: pid, motivo: sel.value, nota: nota }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (r) {
          go.removeAttribute('data-sending'); go.style.opacity = '1';
          if (r.j && r.j.ok) {
            o.querySelector('div').innerHTML = '<div style="text-align:center;padding:10px 4px"><div style="width:56px;height:56px;border-radius:50%;background:#E7F4EC;display:flex;align-items:center;justify-content:center;margin:0 auto 14px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1E7A45" stroke-width="2.6"><path d="M20 6 9 17l-5-5"></path></svg></div><h3 style="font:800 19px Fraunces,serif;color:#0A2A5E;margin:0 0 8px">' + (VA ? 'Denúncia enviada' : 'Denuncia enviada') + '</h3><p style="font:400 14px Public Sans,sans-serif;color:#5C6B7A;margin:0 0 18px;line-height:1.5">' + (VA ? 'Gràcies. L’equip ho revisarà.' : 'Gracias. El equipo lo revisará.') + '</p><button id="acg-den-ok" style="width:100%;border:none;background:#1563C4;color:#fff;font:700 15px Public Sans,sans-serif;padding:13px;border-radius:9px;cursor:pointer">' + (VA ? 'Tancar' : 'Cerrar') + '</button></div>';
            document.getElementById('acg-den-ok').addEventListener('click', cerrar);
          } else if (r.s === 401) { cerrar(); window.acgLoginPopup(); }
          else { st.style.color = '#D93B3B'; st.textContent = (r.j && r.j.error && r.j.error.message) || (VA ? 'No s’ha pogut enviar.' : 'No se pudo enviar.'); }
        }).catch(function () { go.removeAttribute('data-sending'); go.style.opacity = '1'; st.style.color = '#D93B3B'; st.textContent = VA ? 'Error de connexió.' : 'Error de conexión.'; });
    });
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-acg-denunciar]') : null;
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (!conSesion()) { window.acgLoginPopup(); return; }
    var pid = urlPid();
    if (pid) abreDenuncia(pid);
  }, true);

  // CTAs de participación (delegado, cubre botones renderizados por el runtime)
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button, a');
    if (!el || el.closest('#acg-login-pop')) return;
    var t = (el.textContent || '').trim().toLowerCase();
    var esApoyar = /^(apoyar|recolzar|apoyada|recolzada|donar suport|dóna suport|suport)\b/.test(t);   // "apoyada/recolzada" = ya votada → 2º clic quita el voto; en VA los botones dicen "Donar suport"/"Suport"
    var esFavor = /^(votar a favor|a favor)\b/.test(t);
    var esContra = /^(votar en contra|en contra)\b/.test(t);
    var esComentar = /^(comentar|enviar comentario|enviar comentari|publicar)\b/.test(t);
    if (!(esApoyar || esFavor || esContra || esComentar)) return;
    if (!conSesion()) { e.preventDefault(); e.stopPropagation(); window.acgLoginPopup(); return; }
    // "Comentar" en una tarjeta de lista es un enlace al detalle: dejarlo pasar.
    if (esComentar && el.tagName === 'A') return;
    // Voto: id desde la tarjeta (lista) o desde la URL (detalle)
    var card = el.closest('[data-pid]');
    var pid = (card && card.getAttribute('data-pid')) || urlPid();
    if ((esApoyar || esFavor || esContra) && pid) {
      e.preventDefault(); e.stopPropagation();
      votar(pid, esContra ? -1 : 1, el, esApoyar);
    } else if (esComentar && pid) {
      e.preventDefault(); e.stopPropagation();
      comentar(pid, el);
    }
  }, true);
})();

// ---- Captación legal de correos: opt-in en formularios + popup de newsletter ----
(function () {
  var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';

  // Checkbox de novedades en Contacto y CrearPropuesta (re-inyectado si el runtime re-renderiza)
  function ponOptIn() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      if (!f.querySelector('#privacy-check')) continue;   // solo Contacto; en Crear propuesta el correo sale de la cuenta
      if (f.querySelector('.acg-mkt-check')) continue;
      var btn = f.querySelector('button[type=submit],button:last-of-type');
      if (!btn) continue;
      var l = document.createElement('label');
      l.className = 'acg-mkt-check';
      l.style.cssText = 'display:flex;gap:9px;align-items:flex-start;font:400 12.5px Public Sans,sans-serif;color:#8A97A5;margin:10px 0;cursor:pointer;line-height:1.45';
      l.innerHTML = '<input type="checkbox" style="width:16px;height:16px;flex-shrink:0;margin-top:1px;accent-color:#0A2A5E">' +
        (VA ? 'Vull rebre novetats i comunicacions d’Acció Civil per correu (opcional, baixa en un clic).' : 'Quiero recibir novedades y comunicaciones de Acción Civil por email (opcional, baja en un clic).');
      btn.parentNode.insertBefore(l, btn);
    }
  }
  window.__acgOnRender(ponOptIn);

  // Popup de newsletter: reaparece cada 2 páginas visitadas hasta que te suscribes,
  // con un mínimo de 90 s entre apariciones para no ser pesados.
  var KEY_OK = 'acg_nl_ok', KEY_PV = 'acg_nl_pv', KEY_LAST = 'acg_nl_last';
  var pv = 1;
  try { pv = (Number(localStorage.getItem(KEY_PV)) || 0) + 1; localStorage.setItem(KEY_PV, String(pv)); } catch (e) {}
  function puedeSalir() {
    try {
      if (localStorage.getItem(KEY_OK)) return false;
      if (localStorage.getItem('acg_session')) return false;         // usuario registrado: no molestar
      if (pv % 2 !== 0 && pv > 1) return false;                       // cada 2 páginas (y también en la 1ª visita)
      var last = Number(localStorage.getItem(KEY_LAST) || 0);
      if (last && Date.now() - last < 90e3) return false;             // respiro mínimo de 90 s
    } catch (e) {}
    return !document.getElementById('acg-login-pop') && !document.getElementById('acg-nl-pop');
  }
  function abreNews() {
    if (!puedeSalir()) return;
    var o = document.createElement('div');
    o.id = 'acg-nl-pop';
    o.style.cssText = 'position:fixed;inset:0;z-index:9400;background:rgba(7,30,69,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px';
    o.innerHTML = '<div style="background:#fff;border-radius:22px;max-width:420px;width:100%;padding:30px;text-align:center;box-shadow:0 30px 70px rgba(10,42,94,.3);position:relative">' +
      '<button id="acg-nl-x" style="position:absolute;top:14px;right:16px;border:none;background:none;font-size:22px;color:#8A99A8;cursor:pointer;line-height:1">×</button>' +
      '<div style="width:54px;height:54px;border-radius:16px;background:#FBF0DC;display:flex;align-items:center;justify-content:center;margin:0 auto 14px"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#D98A0B" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="3"></rect><path d="m2 7 10 6 10-6"></path></svg></div>' +
      '<h3 style="font:800 21px Bricolage Grotesque,sans-serif;color:#0A2A5E;margin:0 0 8px">' + (VA ? 'No et perdes res de Gandia' : 'No te pierdas nada de Gandia') + '</h3>' +
      '<p style="font:400 13.5px Public Sans,sans-serif;color:#5C6B7A;margin:0 0 18px;line-height:1.55">' + (VA ? 'Propostes, campanyes i actes del teu barri al teu correu. Sense spam.' : 'Propuestas, campañas y actos de tu barrio en tu correo. Sin spam.') + '</p>' +
      '<div style="display:flex;gap:8px"><input id="acg-nl-mail" type="email" placeholder="' + (VA ? 'El teu correu' : 'Tu correo electrónico') + '" style="flex:1;min-width:0;border:1.5px solid #E4EBF2;border-radius:11px;padding:12px 13px;font:400 14px Public Sans,sans-serif;outline:none">' +
      '<button id="acg-nl-go" style="border:none;cursor:pointer;background:#F6BE18;color:#0A2A5E;font:800 14px Public Sans,sans-serif;padding:0 18px;border-radius:11px;white-space:nowrap">' + (VA ? 'Apunta’m' : 'Apúntame') + '</button></div>' +
      '<div id="acg-nl-st" style="font:600 13px Public Sans,sans-serif;margin-top:10px;min-height:18px"></div>' +
      '<p style="font:400 11px Public Sans,sans-serif;color:#AAB6C2;margin:8px 0 0">' + (VA ? 'Doble confirmació per correu. En subscriure’t acceptes la <a href="/privacidad" style="color:#8A99A8">política de privacitat</a>.' : 'Doble confirmación por correo. Al suscribirte aceptas la <a href="/privacidad" style="color:#8A99A8">política de privacidad</a>.') + '</p></div>';
    document.body.appendChild(o);
    try { localStorage.setItem(KEY_LAST, String(Date.now())); } catch (e) {}
    function cierra() { try { localStorage.setItem(KEY_LAST, String(Date.now())); } catch (e) {} o.remove(); }
    o.addEventListener('click', function (e) { if (e.target === o) cierra(); });
    document.getElementById('acg-nl-x').addEventListener('click', cierra);
    function enviar() {
      var mail = (document.getElementById('acg-nl-mail').value || '').trim();
      var st = document.getElementById('acg-nl-st');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) { st.style.color = '#C0392B'; st.textContent = VA ? 'Escriu un correu vàlid.' : 'Escribe un correo válido.'; return; }
      fetch('/api/newsletter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mail, lang: VA ? 'va' : 'es', hp: '' }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (r) {
          var st2 = document.getElementById('acg-nl-st');
          if (r.s < 300 && r.j.ok) { st2.style.color = '#2E9E5B'; st2.textContent = VA ? 'Fet! Revisa el teu correu i confirma la subscripció.' : '¡Hecho! Revisa tu correo y confirma la suscripción.'; try { localStorage.setItem(KEY_OK, '1'); } catch (e) {} setTimeout(function () { o.remove(); }, 3500); }
          else { st2.style.color = '#C0392B'; st2.textContent = (r.j.error && r.j.error.message) || (VA ? 'No s’ha pogut enviar.' : 'No se pudo enviar.'); }
        });
    }
    document.getElementById('acg-nl-go').addEventListener('click', enviar);
    document.getElementById('acg-nl-mail').addEventListener('keydown', function (e) { if (e.key === 'Enter') enviar(); });
  }
  var lanzado = false;
  function lanza() { if (lanzado) return; lanzado = true; abreNews(); }
  setTimeout(lanza, 12000);
  window.addEventListener('scroll', function () {
    var h = document.documentElement;
    if (h.scrollTop > (h.scrollHeight - h.clientHeight) * 0.5) lanza();
  }, { passive: true });
})();

// ---- Fotos adjuntas en Crear Propuesta (máx. 3, comprimidas en el navegador) ----
(function () {
  var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';
  var FOTOS = [];
  window._acgPropFotos = function () { return FOTOS.slice(0, 3); };
  window._acgPropFotosClear = function () { FOTOS = []; var p = document.getElementById('acg-prop-prev'); if (p) p.innerHTML = ''; };
  function comprimir(file, cb) {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height, MAX = 1280;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      var d = c.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(img.src);
      cb(d);
    };
    img.onerror = function () { cb(null); };
    img.src = URL.createObjectURL(file);
  }
  function pinta(prev) {
    prev.innerHTML = FOTOS.map(function (d, i) {
      return '<span style="position:relative;display:inline-block"><img src="' + d + '" alt="" style="width:76px;height:58px;object-fit:cover;border-radius:8px;border:1px solid #D7E0EA"><button type="button" data-qf="' + i + '" aria-label="Quitar foto" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:0;background:#C0392B;color:#fff;font-size:11px;cursor:pointer;line-height:1">✕</button></span>';
    }).join('');
  }
  function inyecta() {
    var chk = document.querySelector('#anon-check');
    if (!chk) return;
    var f = chk.closest('form') || chk.closest('div');
    if (!f || document.getElementById('acg-prop-fotos')) return;
    var btn = f.querySelector('button[type="submit"]') || f.querySelector('button');
    var box = document.createElement('div');
    box.setAttribute('data-acg-fotos', '1');
    box.style.cssText = 'margin:14px 0';
    box.innerHTML = '<label style="display:block;font:600 13px Public Sans,sans-serif;color:#42525F;margin-bottom:6px">' + (VA ? 'Fotos del problema (opcional, màx. 3)' : 'Fotos del problema (opcional, máx. 3)') + '</label>'
      + '<div id="acg-prop-drop" style="border:2px dashed #C9D6E4;border-radius:14px;padding:22px 16px;text-align:center;cursor:pointer;background:#F7FAFD;transition:border-color .15s,background .15s">'
      + '<div style="font-size:26px;line-height:1;margin-bottom:6px">📷</div>'
      + '<div style="font:700 13.5px Public Sans,sans-serif;color:#0A2A5E">' + (VA ? 'Arrossega les teues fotos ací' : 'Arrastra tus fotos aquí') + '</div>'
      + '<div style="font:500 12.5px Public Sans,sans-serif;color:#8A99A8;margin-top:3px">' + (VA ? 'o fes clic per a triar-les de la galeria' : 'o haz clic para elegirlas de tu galería') + '</div>'
      + '</div>'
      + '<input id="acg-prop-fotos" type="file" accept="image/*" multiple style="display:none">'
      + '<div id="acg-prop-prev" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"></div>';
    if (btn && btn.parentNode === f) f.insertBefore(box, btn);
    else if (btn && btn.parentNode) btn.parentNode.parentNode ? btn.parentNode.insertBefore(box, btn) : f.appendChild(box);
    else f.appendChild(box);
    pinta(box.querySelector('#acg-prop-prev'));   // re-render del runtime: repintar lo ya elegido
  }
  function admite(files) {
    [].slice.call(files || []).slice(0, 3 - FOTOS.length).forEach(function (file) {
      if (!/^image\//.test(file.type)) return;
      comprimir(file, function (d) {
        if (d && FOTOS.length < 3) { FOTOS.push(d); var p = document.getElementById('acg-prop-prev'); if (p) pinta(p); }
      });
    });
  }
  // Delegación a nivel de documento: el runtime re-renderiza el DOM y se lleva los listeners locales.
  document.addEventListener('click', function (e) {
    var q = e.target.closest ? e.target.closest('[data-qf]') : null;
    if (q) { FOTOS.splice(Number(q.getAttribute('data-qf')), 1); var p = document.getElementById('acg-prop-prev'); if (p) pinta(p); return; }
    var d = e.target.closest ? e.target.closest('#acg-prop-drop') : null;
    if (d && FOTOS.length < 3) { var i2 = document.getElementById('acg-prop-fotos'); if (i2) i2.click(); }
  }, true);
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'acg-prop-fotos') { admite(e.target.files); e.target.value = ''; }
  }, true);
  // Si arrastras un archivo con el formulario presente, se acepta SOLTARLO EN CUALQUIER PARTE
  // de la página (y nunca se abre la imagen en el navegador por soltar fuera del recuadro).
  function esArrastreDeArchivo(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!(t && [].indexOf.call(t, 'Files') > -1 && document.getElementById('acg-prop-drop'));
  }
  document.addEventListener('dragover', function (e) {
    if (!esArrastreDeArchivo(e)) return;
    e.preventDefault();
    var d = document.getElementById('acg-prop-drop');
    if (d) { d.style.borderColor = '#1563C4'; d.style.background = '#EAF3FC'; }
  }, true);
  document.addEventListener('dragleave', function (e) {
    var d = document.getElementById('acg-prop-drop');
    if (d && (!e.relatedTarget || e.relatedTarget === document.documentElement)) { d.style.borderColor = '#C9D6E4'; d.style.background = '#F7FAFD'; }
  }, true);
  document.addEventListener('drop', function (e) {
    if (!esArrastreDeArchivo(e)) return;
    e.preventDefault();
    var d = document.getElementById('acg-prop-drop');
    if (d) { d.style.borderColor = '#C9D6E4'; d.style.background = '#F7FAFD'; }
    admite(e.dataTransfer.files);
    var p = document.getElementById('acg-prop-prev'); if (p) p.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, true);
  window.__acgOnRender(inyecta);
})();

// ---- Tarjeta de propuesta clicable entera + contador real de "propuestas recibidas" ----
(function () {
  // Toda la tarjeta lleva al detalle (en móvil solo entraba por el título)
  var css = document.createElement('style');
  css.textContent = '[data-pid]{cursor:pointer}';
  document.head.appendChild(css);
  document.addEventListener('click', function (e) {
    var card = e.target.closest ? e.target.closest('[data-pid]') : null;
    if (!card) return;
    if (e.target.closest('button, a, input, textarea, select')) return;   // botones/enlaces mandan
    var pid = card.getAttribute('data-pid');
    if (/^[0-9a-f-]{36}$/.test(pid)) location.href = '/propuesta-ciudadana?id=' + pid;
  });
  // Contador "X propuestas ciudadanas recibidas" con el número real de la BBDD
  function cuenta() {
    var leaf = [].filter.call(document.querySelectorAll('span,div,b,strong'), function (el) {
      if (el.children.length) return false;
      if (!/^[\d.,]+$/.test((el.textContent || '').trim())) return false;
      var ab = el.parentElement && el.parentElement.parentElement;
      var ctx = (((el.parentElement && el.parentElement.textContent) || '') + ' ' + ((ab && ab.textContent) || '')).toLowerCase();
      return ctx.indexOf('recibidas') > -1 || ctx.indexOf('rebudes') > -1;
    })[0];
    if (!leaf || leaf.getAttribute('data-acg-real')) return !!leaf;
    fetch('/api/proposals').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || j.recibidas == null) return;
      var el = [].filter.call(document.querySelectorAll('span,div,b,strong'), function (el2) {
        if (el2.children.length) return false;
        if (!/^[\d.,]+$/.test((el2.textContent || '').trim())) return false;
        var ab2 = el2.parentElement && el2.parentElement.parentElement;
        var ctx2 = (((el2.parentElement && el2.parentElement.textContent) || '') + ' ' + ((ab2 && ab2.textContent) || '')).toLowerCase();
        return ctx2.indexOf('recibidas') > -1 || ctx2.indexOf('rebudes') > -1;
      })[0];
      if (el) { el.textContent = String(j.recibidas); el.setAttribute('data-acg-real', '1'); }
    }).catch(function () {});
    return true;
  }
  var t0 = 0;
  var tm = setInterval(function () { if (cuenta() || ++t0 > 15) clearInterval(tm); }, 900);
})();

/* ---- Buscador real del sitio (overlay propio, robusto ante el runtime) ----
   Intercepta la lupa (.acg-search-btn) en captura, antes que el handler del runtime,
   y abre un overlay 100% gestionado por JS: búsqueda en vivo al escribir sobre un
   índice de páginas + contenido real (APIs), y recientes reales en localStorage. */
(function () {
  'use strict';
  var VA = false; try { VA = (localStorage.getItem('acg_lang') || 'es') === 'va'; } catch (e) {}
  function V(a, b) { return VA ? b : a; }
  function norm(s) { try { return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { return (s || '').toString().toLowerCase(); } }
  function esc(s) { return (s || '').toString().replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var IC = {
    doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6',
    shield: 'M12 4 5 6.5V11c0 4.2 3 7 7 8.3 4-1.3 7-4.1 7-8.3V6.5L12 4Z',
    news: 'M5 4h11v15H5z M8 8h6 M8 12h6',
    flag: 'M4 21V5a2 2 0 0 1 2-2h9l-1 4 1 4H6',
    pin: 'M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11ZM12 10a1.6 1.6 0 1 0 0-.01',
    users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    cal: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z M16 2v4 M8 2v4 M3 10h18',
    euro: 'M12 3v18 M8 7h6a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h6',
    cart: 'M6 6h15l-1.5 9h-12z M6 6 5 3H2 M9 20a1 1 0 1 0 0-.01 M18 20a1 1 0 1 0 0-.01',
    hand: 'M14 11V6a2 2 0 0 0-4 0v5 M10 9V4a2 2 0 0 0-4 0v9 M6 12a2 2 0 0 0-2 2c0 3 3 7 8 7s6-3 6-7v-3a2 2 0 0 0-4 0',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 16v-4 M12 8h.01'
  };
  function E(t, k, href, cat, icon) { return { t: t, k: norm(t + ' ' + k + ' ' + cat), href: href, cat: cat, icon: icon, meta: cat }; }

  var STATIC = [
    E(V('Propuestas', 'Propostes'), 'programa politico ejes', '/Propuestas.dc.html', V('Programa', 'Programa'), IC.doc),
    E(V('Programa electoral 2027', 'Programa electoral 2027'), 'elecciones pdf', '/ProgramaElectoral.dc.html', V('Programa', 'Programa'), IC.doc),
    E(V('Seguridad cercana', 'Seguretat propera'), 'policia proximidad camaras antiokupacion', '/CategoriaSeguridad.dc.html', V('Eje', 'Eix'), IC.shield),
    E(V('Cultura accesible', 'Cultura accessible'), 'fiestas tradiciones barrios', '/CategoriaCultura.dc.html', V('Eje', 'Eix'), IC.doc),
    E(V('Empleo y futuro', 'Ocupació i futur'), 'comercio trabajo juventud', '/CategoriaEmpleo.dc.html', V('Eje', 'Eix'), IC.euro),
    E(V('Gandia unida: Ciudad y Playa', 'Gandia unida'), 'desestacionalizacion grao playa', '/CategoriaGandiaUnida.dc.html', V('Eje', 'Eix'), IC.pin),
    E(V('Servicios básicos', 'Serveis bàsics'), 'limpieza transporte mantenimiento', '/CategoriaServicios.dc.html', V('Eje', 'Eix'), IC.doc),
    E(V('Participación ciudadana', 'Participació ciutadana'), 'propuestas votar', '/Participacion.dc.html', V('Participa', 'Participa'), IC.hand),
    E(V('Crear propuesta', 'Crear proposta'), 'proponer idea barrio', '/CrearPropuesta.dc.html', V('Participa', 'Participa'), IC.hand),
    E(V('Comunidad', 'Comunitat'), 'chat foro vecinos', '/Comunidad.dc.html', V('Participa', 'Participa'), IC.users),
    E(V('Cómo funciona', 'Com funciona'), 'ayuda guia', '/ComoFunciona.dc.html', V('Participa', 'Participa'), IC.info),
    E(V('Acción en Gandia', 'Acció a Gandia'), 'actuaciones logros', '/Accion.dc.html', V('Acción', 'Acció'), IC.pin),
    E(V('Mapa de actuaciones', 'Mapa d actuacions'), 'mapa barrios', '/MapaActuaciones.dc.html', V('Acción', 'Acció'), IC.pin),
    E(V('Campañas', 'Campanyes'), 'recogidas apoyo firmas', '/Campanas.dc.html', V('Campañas', 'Campanyes'), IC.flag),
    E(V('Actualidad', 'Actualitat'), 'noticias comunicados', '/Actualidad.dc.html', V('Actualidad', 'Actualitat'), IC.news),
    E(V('Agenda', 'Agenda'), 'actos eventos', '/Agenda.dc.html', V('Agenda', 'Agenda'), IC.cal),
    E(V('Transparencia', 'Transparència'), 'cuentas tesoreria estatutos donaciones', '/Transparencia.dc.html', V('Transparencia', 'Transparència'), IC.euro),
    E(V('Únete: dona o afíliate', 'Uneix-te'), 'afiliacion donacion socio cuota', '/Participa.dc.html', V('Únete', 'Uneix-te'), IC.hand),
    E(V('Tienda', 'Botiga'), 'merchandising camiseta', '/tienda', V('Tienda', 'Botiga'), IC.cart),
    E(V('Conócenos', 'Coneix-nos'), 'quienes somos', '/Conocenos.dc.html', V('Conócenos', 'Coneix-nos'), IC.info),
    E(V('Historia', 'Història'), 'fundacion 2022', '/Historia.dc.html', V('Conócenos', 'Coneix-nos'), IC.info),
    E(V('Equipo', 'Equip'), 'miembros junta', '/Equipo.dc.html', V('Conócenos', 'Coneix-nos'), IC.users),
    E(V('Valores', 'Valors'), 'principios independencia', '/Valores.dc.html', V('Conócenos', 'Coneix-nos'), IC.info),
    E(V('Preguntas frecuentes', 'Preguntes freqüents'), 'faq dudas', '/FAQ.dc.html', V('Conócenos', 'Coneix-nos'), IC.info),
    E(V('Contacto', 'Contacte'), 'email telefono direccion', '/Contacto.dc.html', V('Contacto', 'Contacte'), IC.info),
    E(V('Canal de denuncias', 'Canal de denúncies'), 'denunciar corrupcion buzon', '/denuncias', V('Legal', 'Legal'), IC.shield)
  ];
  ['Grao', 'Playa', 'Beniopa', 'Benipeixcar', 'Corea', 'Raval', 'Santa Anna', 'Marchuquera', 'Germanies', 'República Argentina'].forEach(function (b) {
    STATIC.push(E(b, 'barrio zona distrito', '/MapaActuaciones.dc.html', V('Barrio', 'Barri'), IC.pin));
  });

  var LIVE = null, liveTs = 0;
  function fReq(url, cat, icon, fb) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var items = (j && j.items) || [];
      return items.map(function (x) {
        var title = x.title || x.name || x.nombre || '';
        return { t: title, k: norm(title + ' ' + (x.barrio || '') + ' ' + cat), href: x.href || fb || '#', cat: cat, icon: icon, meta: x.meta || x.date || x.fecha || x.barrio || cat };
      }).filter(function (e) { return e.t; });
    }).catch(function () { return []; });
  }
  function loadLive(cb) {
    var now = Date.now();
    if (LIVE && (now - liveTs) < 300000) { cb(); return; }
    try { var c = JSON.parse(sessionStorage.getItem('acg_sidx') || 'null'); if (c && (now - c.ts) < 300000) { LIVE = c.d; liveTs = c.ts; cb(); return; } } catch (e) {}
    var L = VA ? 'va' : 'es';
    Promise.all([
      fReq('/api/proposals?lang=' + L, V('Propuestas ciudadanas', 'Propostes ciutadanes'), IC.hand, '/Participacion.dc.html'),
      fReq('/api/posts?lang=' + L + '&limit=40', V('Actualidad', 'Actualitat'), IC.news, '/Actualidad.dc.html'),
      fReq('/api/campaigns?lang=' + L, V('Campañas', 'Campanyes'), IC.flag, '/Campanas.dc.html'),
      fReq('/api/events?lang=' + L, V('Agenda', 'Agenda'), IC.cal, '/Agenda.dc.html'),
      fReq('/api/actuaciones?lang=' + L, V('Acción', 'Acció'), IC.pin, '/Accion.dc.html'),
      fReq('/api/equipo?lang=' + L, V('Equipo', 'Equip'), IC.users, '/Equipo.dc.html')
    ]).then(function (arrs) {
      var out = []; arrs.forEach(function (a) { out = out.concat(a || []); });
      LIVE = out; liveTs = now;
      try { sessionStorage.setItem('acg_sidx', JSON.stringify({ ts: now, d: out })); } catch (e) {}
      cb();
    }).catch(function () { LIVE = LIVE || []; cb(); });
  }

  function recents() { try { return JSON.parse(localStorage.getItem('acg_recent') || '[]'); } catch (e) { return []; } }
  function saveRecent(q) { q = (q || '').trim(); if (!q) return; try { var r = recents().filter(function (x) { return norm(x) !== norm(q); }); r.unshift(q); localStorage.setItem('acg_recent', JSON.stringify(r.slice(0, 6))); } catch (e) {} }

  function search(q) {
    var toks = norm(q).split(/\s+/).filter(Boolean); if (!toks.length) return [];
    var nq = norm(q), all = STATIC.concat(LIVE || []), res = [];
    all.forEach(function (e) {
      if (!toks.every(function (tk) { return e.k.indexOf(tk) > -1; })) return;
      var nt = norm(e.t), s = 0;
      if (nt.indexOf(nq) === 0) s += 100; else if (nt.indexOf(nq) > -1) s += 50;
      toks.forEach(function (tk) { if (nt.indexOf(tk) === 0) s += 10; });
      res.push({ e: e, s: s });
    });
    res.sort(function (a, b) { return b.s - a.s; });
    return res.map(function (x) { return x.e; }).slice(0, 28);
  }

  function tile(e) {
    return '<a href="' + esc(e.href) + '" class="acg-stile">'
      + '<span class="acg-sic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + e.icon + '"/></svg></span>'
      + '<span class="acg-stx"><span class="acg-st1">' + esc(e.t) + '</span><span class="acg-st2">' + esc(e.meta || e.cat) + '</span></span>'
      + '<svg class="acg-sar" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B8C4D2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></a>';
  }
  function render(q, body) {
    if (!q.trim()) {
      var html = '', rc = recents();
      if (rc.length) {
        html += '<div class="acg-shd"><span>' + V('Búsquedas recientes', 'Cerques recents') + '</span><button class="acg-sclear" type="button">' + V('Borrar', 'Esborrar') + '</button></div>';
        html += '<div class="acg-schips">' + rc.map(function (x) { return '<button class="acg-schip" type="button" data-q="' + esc(x) + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B2" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>' + esc(x) + '</button>'; }).join('') + '</div>';
      }
      var sug = [0, 7, 13, 14, 16].map(function (i) { return STATIC[i]; }).filter(Boolean);
      html += '<div class="acg-sgh">' + V('Sugerencias', 'Suggeriments') + '</div>' + sug.map(tile).join('');
      body.innerHTML = html; return;
    }
    var r = search(q);
    if (!r.length) { body.innerHTML = '<div class="acg-snone">' + V('Sin resultados para', 'Sense resultats per a') + ' “' + esc(q) + '”</div>'; return; }
    var groups = [], map = {};
    r.forEach(function (e) { if (!map[e.cat]) { map[e.cat] = []; groups.push(e.cat); } map[e.cat].push(e); });
    body.innerHTML = groups.map(function (c) { return '<div class="acg-sgh">' + esc(c) + '</div>' + map[c].map(tile).join(''); }).join('');
  }

  var ov = null, input = null, deb = null;
  function build() {
    if (ov) return;
    injectCSS();
    ov = document.createElement('div'); ov.className = 'acg-sov'; ov.style.display = 'none';
    ov.innerHTML = '<div class="acg-scard">'
      + '<div class="acg-shead"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1563C4" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>'
      + '<input class="acg-sinp" type="text" autocomplete="off" spellcheck="false" placeholder="' + V('Buscar propuestas, noticias, barrios…', 'Cercar propostes, noticies, barris…') + '" aria-label="' + V('Buscar', 'Cercar') + '">'
      + '<button class="acg-sesc" type="button">ESC</button></div>'
      + '<div class="acg-sbody"></div></div>';
    document.body.appendChild(ov);
    input = ov.querySelector('.acg-sinp');
    var body = ov.querySelector('.acg-sbody');
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('.acg-sesc')) { close(); return; }
      var chip = e.target.closest('.acg-schip'); if (chip) { input.value = chip.getAttribute('data-q'); render(input.value, body); input.focus(); return; }
      if (e.target.closest('.acg-sclear')) { try { localStorage.removeItem('acg_recent'); } catch (er) {} render(input.value, body); return; }
      if (e.target.closest('.acg-stile')) { saveRecent(input.value); }
    });
    input.addEventListener('input', function () { if (deb) clearTimeout(deb); deb = setTimeout(function () { render(input.value, body); }, 110); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter') { var f = ov.querySelector('.acg-stile'); if (f) { saveRecent(input.value); location.href = f.getAttribute('href'); } }
    });
  }
  function open() {
    build(); ov.style.display = 'flex'; document.documentElement.style.overflow = 'hidden';
    input.value = '';
    var body = ov.querySelector('.acg-sbody'); render('', body);
    loadLive(function () { if (ov.style.display !== 'none') render(input.value, body); });
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
  }
  function close() { if (ov) ov.style.display = 'none'; document.documentElement.style.overflow = ''; }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('.acg-search-btn')) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); open(); }
  }, true);

  function injectCSS() {
    if (document.getElementById('acg-sov-css')) return;
    var st = document.createElement('style'); st.id = 'acg-sov-css';
    st.textContent = '.acg-sov{position:fixed;inset:0;z-index:9600;background:rgba(8,22,48,.52);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);display:flex;justify-content:center;align-items:flex-start;padding:64px 16px 16px}'
      + '.acg-scard{width:100%;max-width:640px;background:#fff;border-radius:14px;box-shadow:0 44px 100px rgba(8,22,48,.42);overflow:hidden;display:flex;flex-direction:column;max-height:84vh}'
      + '.acg-shead{display:flex;align-items:center;gap:12px;padding:15px 18px;border-bottom:1px solid #EEF2F7;flex-shrink:0}'
      + '.acg-sinp{flex:1;min-width:0;border:none;outline:none;font:500 17px Public Sans,system-ui,sans-serif;color:#17232F;background:transparent}'
      + '.acg-sesc{border:1px solid #E4EBF2;background:#F4F7FB;color:#5C6B7A;font:700 11px Public Sans,sans-serif;padding:5px 10px;border-radius:7px;cursor:pointer}'
      + '.acg-sbody{overflow-y:auto;padding:12px 12px 18px}'
      + '.acg-shd{display:flex;align-items:center;justify-content:space-between;padding:6px 10px 8px}'
      + '.acg-shd span{font:700 11px Public Sans,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#66788A}'
      + '.acg-sclear{border:none;background:none;color:#1563C4;font:700 12px Public Sans,sans-serif;cursor:pointer;padding:2px 4px}'
      + '.acg-schips{display:flex;flex-wrap:wrap;gap:8px;padding:0 10px 6px}'
      + '.acg-schip{display:inline-flex;align-items:center;gap:7px;border:1px solid #E4EBF2;background:#fff;color:#33414F;font:600 13px Public Sans,sans-serif;padding:7px 12px;border-radius:20px;cursor:pointer}'
      + '.acg-schip:hover{background:#F4F7FB}'
      + '.acg-sgh{padding:13px 10px 5px;font:700 11px Public Sans,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#0B7580}'
      + '.acg-stile{display:flex;align-items:center;gap:13px;text-decoration:none;padding:10px;border-radius:10px}'
      + '.acg-stile:hover{background:#F4F7FB}'
      + '.acg-sic{width:40px;height:40px;flex-shrink:0;border-radius:9px;background:#EAF3FC;display:flex;align-items:center;justify-content:center;color:#1563C4}'
      + '.acg-stx{flex:1;min-width:0;display:flex;flex-direction:column}'
      + '.acg-st1{font:700 15px Public Sans,sans-serif;color:#17232F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.acg-st2{font-size:12.5px;color:#5C6B7A;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.acg-sar{flex-shrink:0}'
      + '.acg-snone{padding:30px 14px;text-align:center;color:#66788A;font:500 15px Public Sans,sans-serif}';
    document.head.appendChild(st);
  }
})();

// ---- Popup de mapa de la sede (cerrable) — se abre desde cualquier enlace con href="#sede-mapa" ----
(function () {
  function VA() { try { return (localStorage.getItem('acg_lang') || 'es') === 'va'; } catch (e) { return false; } }
  var LAT = 38.9757828, LNG = -0.1832722;
  var DIR_ES = 'Avda. República Argentina 42, entresuelo · Local 3 · 46702 Gandia';
  var DIR_VA = 'Avda. República Argentina 42, entresòl · Local 3 · 46702 Gandia';
  function cerrar() { var o = document.getElementById('acg-sede-pop'); if (o) o.remove(); document.removeEventListener('keydown', onEsc); }
  function onEsc(e) { if (e.key === 'Escape') cerrar(); }
  window.acgSedeMapa = function () {
    if (document.getElementById('acg-sede-pop')) return;
    var va = VA();
    var o = document.createElement('div');
    o.id = 'acg-sede-pop';
    o.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(7,30,69,.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px';
    var bbox = (LNG - 0.006) + ',' + (LAT - 0.004) + ',' + (LNG + 0.006) + ',' + (LAT + 0.004);
    o.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:520px;width:100%;overflow:hidden;box-shadow:0 30px 80px rgba(7,30,69,.4)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #EEF2F7">' +
          '<div><div style="font:800 17px Bricolage Grotesque,sans-serif;color:#0A2A5E">' + (va ? 'La nostra seu' : 'Nuestra sede') + '</div>' +
          '<div style="font:400 12.5px Public Sans,sans-serif;color:#5C6B7A;margin-top:2px">' + (va ? DIR_VA : DIR_ES) + '</div></div>' +
          '<button id="acg-sede-x" aria-label="Cerrar" style="border:none;background:#F0F4F9;color:#5C6B7A;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:20px;line-height:1;flex-shrink:0">×</button>' +
        '</div>' +
        '<iframe title="Mapa de la sede" src="https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + LAT + ',' + LNG + '" style="width:100%;height:300px;border:0;display:block"></iframe>' +
        '<div style="padding:14px 18px;display:flex;gap:10px">' +
          '<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + LAT + ',' + LNG + '" target="_blank" rel="noopener" style="flex:1;text-align:center;text-decoration:none;background:#0A2A5E;color:#fff;font:800 14px Public Sans,sans-serif;padding:12px;border-radius:10px">' + (va ? 'Veure on està' : 'Ver dónde está') + '</a>' +
          '<button id="acg-sede-close2" style="background:#fff;color:#17232F;border:1.5px solid #E4EBF2;font:700 14px Public Sans,sans-serif;padding:12px 18px;border-radius:10px;cursor:pointer">' + (va ? 'Tancar' : 'Cerrar') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(o);
    o.addEventListener('click', function (e) { if (e.target === o) cerrar(); });
    var x = document.getElementById('acg-sede-x'); if (x) x.addEventListener('click', cerrar);
    var c2 = document.getElementById('acg-sede-close2'); if (c2) c2.addEventListener('click', cerrar);
    document.addEventListener('keydown', onEsc);
  };
  // Delegación: cualquier enlace a "#sede-mapa" abre el popup (sin tocar los componentes dc).
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href$="#sede-mapa"],a[href="#sede-mapa"]') : null;
    if (a) { e.preventDefault(); window.acgSedeMapa(); }
  }, true);
})();
