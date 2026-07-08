/* acg-forms.js — conecta los formularios estáticos con /api/* (Fase 1).
   Delegación global: funciona en las 67 páginas sin tocar los componentes dc.
   - Newsletter del footer (todas las páginas) → POST /api/newsletter (double opt-in)
   - Formulario de contacto (Contacto) → POST /api/contacto
   - Crear propuesta (CrearPropuesta) → POST /api/propuesta
   TODO Turnstile: cuando exista TURNSTILE_SECRET_KEY en Netlify, añadir aquí el widget
   (window.ACG_TS_SITEKEY) y enviar turnstileToken. Sin él, la API no lo exige. */
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
  function post(url, data, btn, st, okMsg, onOk) {
    var old = btn.textContent;
    btn.disabled = true; btn.style.opacity = '.6'; btn.textContent = T.sending;
    fetch(url, { method: 'POST', headers: (function(){var h={'content-type':'application/json'};try{var t=localStorage.getItem('acg_session');if(t)h.authorization='Bearer '+t;}catch(e){}return h;})(), body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        if (r.s >= 200 && r.s < 300 && r.j && r.j.ok) { show(st, okMsg, true); if (onOk) onOk(); }
        else if (r.s === 503) show(st, T.errUnconfigured, false);
        else if (r.s === 429) show(st, T.errRate, false);
        else show(st, (r.j && r.j.error && r.j.error.message) ? T.errFields + r.j.error.message : T.errGeneric, false);
      })
      .catch(function () { show(st, T.errGeneric, false); })
      .then(function () { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = old; });
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    post('/api/newsletter', { email: email, lang: lang, hp: '' }, btn, st, T.okNews, function () { input.value = ''; });
  });

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
      }, btn, st, T.okContact, function () { f.reset(); });
    } else if (f.querySelector('#anon-check')) {        // Crear propuesta
      ev.preventDefault();
      if (!email || !EMAIL_RE.test(email.value.trim())) return show(st, T.errEmail, false);
      var titulo = f.querySelector('input[maxlength]') || texts[0];
      var nombre = null;
      for (var i = 0; i < texts.length; i++) if (texts[i] !== titulo) { nombre = texts[i]; break; }
      post('/api/propuesta', {
        titulo: titulo ? titulo.value.trim() : '',
        descripcion: area ? area.value.trim() : '',
        categoria: selects[0] ? selects[0].value : '',
        barrio: selects[1] ? selects[1].value : '',
        nombre: nombre ? nombre.value.trim() : '',
        email: email.value.trim(),
        anonimo: f.querySelector('#anon-check').checked,
        lang: lang, hp: ''
      }, btn, st, T.okProp, function () { f.reset(); });
    }
  });
})();
