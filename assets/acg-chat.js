// Chat de miembros — Comunidad. Activa la maqueta cuando hay sesión (localStorage acg_session).
// Sin sesión: convierte la nota en enlace al área ciudadana. Fase 3.
(function () {
  var SUPA = 'https://msbrdowdkwqrrdlfeztj.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zYnJkb3dka3dxcnJkbGZlenRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NDc5NTAsImV4cCI6MjA5OTAyMzk1MH0.ByomcWyS0YiQHg8KjdYvx32vxwa1ilGZOE-1aD0TRR0';
  var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';
  var T = {
    entra: VA ? 'Inicia sessió per participar al xat' : 'Inicia sesión para participar en el chat',
    ph: VA ? 'Escriu un missatge…' : 'Escribe un mensaje…',
    vive: VA ? 'Xat en directe — sigues respectuós/osa. Els missatges es moderen.' : 'Chat en directo — sé respetuoso/a. Los mensajes se moderan.',
    error: VA ? 'No s’ha pogut enviar' : 'No se pudo enviar',
    vacio: VA ? 'Encara no hi ha missatges. Escriu el primer!' : 'Aún no hay mensajes. ¡Escribe el primero!'
  };
  function tok() { return localStorage.getItem('acg_session') || ''; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  async function api(method, body, qs) {
    var r = await fetch('/api/chat' + (qs || ''), {
      method: method,
      headers: Object.assign({ authorization: 'Bearer ' + tok() }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 401 && localStorage.getItem('acg_refresh')) {
      var rf = await fetch(SUPA + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: localStorage.getItem('acg_refresh') })
      });
      var j = await rf.json().catch(function () { return {}; });
      if (j.access_token) {
        localStorage.setItem('acg_session', j.access_token);
        localStorage.setItem('acg_refresh', j.refresh_token || '');
        r = await fetch('/api/chat' + (qs || ''), {
          method: method,
          headers: Object.assign({ authorization: 'Bearer ' + tok() }, body ? { 'content-type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined
        });
      }
    }
    return { s: r.status, j: await r.json().catch(function () { return {}; }) };
  }

  function burbuja(m) {
    var mio = m.mio;
    var ini = (m.autor || '?').trim().slice(0, 2).toUpperCase();
    var sup = m.cargo ? '<sup style="font-size:8px;font-weight:800;color:#6B4EE6;letter-spacing:.03em;text-transform:uppercase;margin-left:3px">' + esc(m.cargo) + '</sup>' : '';
    var badges = (m.titulos && m.titulos.length) ? m.titulos.map(function (t) { return '<span title="' + esc(t.label) + '" style="font-size:11px;margin-left:2px;vertical-align:middle">' + (t.emoji || '') + '</span>'; }).join('') : '';
    return '<div style="display:flex;gap:10px;flex-direction:' + (mio ? 'row-reverse' : 'row') + '">' +
      (m.avatar ? '<img src="' + esc(m.avatar) + '" alt="" referrerpolicy="no-referrer" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0">' : '<div style="width:30px;height:30px;border-radius:50%;background:' + (mio ? '#0A2A5E' : '#E8F6F8') + ';color:' + (mio ? '#F5B942' : '#0FA6B6') + ';display:flex;align-items:center;justify-content:center;font:800 11px Public Sans;flex-shrink:0">' + esc(ini) + '</div>') +
      '<div style="max-width:78%"><div style="font:600 11.5px Public Sans;color:#8A99A8;margin:0 0 3px;text-align:' + (mio ? 'right' : 'left') + '">' + esc(m.autor) + sup + badges + '</div>' +
      '<div style="background:' + (mio ? '#0A2A5E' : '#F0F4F9') + ';color:' + (mio ? '#fff' : '#17232F') + ';font-size:13.5px;padding:10px 14px;border-radius:' + (mio ? '14px 4px 14px 14px' : '4px 14px 14px 14px') + '">' + esc(m.texto) + '</div></div></div>';
  }

  // Localiza el input del chat por su placeholder (el dc-runtime no expone [disabled] al selector).
  function findInput() {
    var ins = document.querySelectorAll('input');
    for (var i = 0; i < ins.length; i++) {
      var ph = ins[i].placeholder || '';
      if (/Disponible al iniciar|Disponible en iniciar|Escribe un mensaje|Escriu un missatge/.test(ph)) return ins[i];
      if (ins[i].getAttribute('data-acg-chat')) return ins[i];
    }
    return null;
  }

  // Esqueleto de carga (mientras llega lo real) — usa la clase .acg-sk (shimmer) de support.js.
  var SK = '<div style="display:flex;flex-direction:column;gap:14px;padding:6px 0">' + [0, 1, 2, 3].map(function (i) {
    var r = i % 2;
    return '<div style="display:flex;gap:10px;flex-direction:' + (r ? 'row-reverse' : 'row') + '"><div class="acg-sk" style="width:30px;height:30px;border-radius:50%;flex-shrink:0"></div><div class="acg-sk" style="height:40px;width:' + (170 - i * 22) + 'px;border-radius:12px"></div></div>';
  }).join('') + '</div>';

  // Lista de mensajes persistente (mismo nodo entre re-renders → sin parpadeo ni pérdida de contenido).
  var LISTA = document.createElement('div');
  LISTA.style.cssText = 'display:flex;flex-direction:column;gap:12px;max-height:420px;overflow-y:auto;padding-right:4px';
  LISTA.innerHTML = SK;                 // arranca en esqueleto, nunca con mensajes falsos
  var ultimo = '';
  var cargadoUnaVez = false;

  async function cargar() {
    if (!tok()) return;
    var r = await api('GET', null, '?lang=' + (VA ? 'va' : 'es'));
    if (!r.j.ok) return;
    var items = (r.j.items || []).slice().reverse();
    var firma = items.map(function (m) { return m.id; }).join(',');
    if (firma === ultimo && LISTA.childElementCount) { cargadoUnaVez = true; return; }
    ultimo = firma;
    LISTA.innerHTML = items.length ? items.map(burbuja).join('') :
      '<div style="color:#8A99A8;font-size:13.5px;text-align:center;padding:18px 0">' + T.vacio + '</div>';
    cargadoUnaVez = true;
    LISTA.scrollTop = LISTA.scrollHeight;
  }
  async function enviar() {
    var input = findInput(); if (!input) return;
    var txt = input.value.trim(); if (!txt) return;
    input.value = ''; input.focus();
    var _opt = null;   // OPTIMISTA: pinta el mensaje al instante; el poll lo consolida
    try { var _o = document.createElement('div'); _o.innerHTML = burbuja({ mio: true, autor: (VA ? 'Tu' : 'Tú'), texto: txt, titulos: [] }); _opt = _o.firstChild; if (_opt) { _opt.style.opacity = '.65'; LISTA.appendChild(_opt); LISTA.scrollTop = LISTA.scrollHeight; } } catch (e) {}
    var r = await api('POST', { texto: txt });
    if (r.j.ok) { ultimo = ''; cargar(); }
    else { if (_opt) _opt.remove(); var nota = input.parentElement.nextElementSibling; if (nota && nota.lastChild) nota.lastChild.textContent = ' ' + ((r.j.error && r.j.error.message) || T.error); }
  }

  // Idempotente: se ejecuta en bucle y reconstruye lo que el runtime haya borrado.
  function enhance() {
    var input = findInput();
    if (!input) return;
    var fila = input.parentElement;
    var caja = fila.parentElement;
    var nota = fila.nextElementSibling;
    var boton = fila.querySelector('button');

    // Quitar SIEMPRE las burbujas demo del template y colocar nuestra LISTA (también sin sesión).
    var n = caja.firstElementChild;
    while (n && n !== fila) { var next = n.nextElementSibling; if (n !== LISTA) n.remove(); n = next; }
    if (LISTA.parentElement !== caja || LISTA.nextElementSibling !== fila) caja.insertBefore(LISTA, fila);

    if (!tok()) {                                         // sin sesión: aviso de login, nunca mensajes falsos
      if (!cargadoUnaVez) LISTA.innerHTML = '<div style="color:#8A99A8;font-size:13.5px;text-align:center;padding:24px 12px">' + (VA ? 'Inicia sessió per veure i participar al xat de la comunitat.' : 'Inicia sesión para ver y participar en el chat de la comunidad.') + '</div>';
      if (input.getAttribute('data-acg-locked')) return;
      input.setAttribute('data-acg-locked', '1');
      if (nota) nota.innerHTML = '<a href="/cuenta" style="color:#0FA6B6;font-weight:700;text-decoration:none">' + T.entra + ' →</a>';
      input.style.cursor = 'pointer'; input.title = T.entra; fila.style.opacity = '1';
      fila.addEventListener('click', function () { location.href = '/cuenta'; });
      return;
    }

    // Habilitar input/botón (idempotente)
    if (input.disabled) input.disabled = false;
    input.removeAttribute('disabled');
    input.setAttribute('data-acg-chat', '1');
    input.style.cursor = 'text'; input.style.background = '#fff'; input.style.color = '#17232F';
    if (input.placeholder !== T.ph) input.placeholder = T.ph;
    if (boton) { boton.disabled = false; boton.removeAttribute('disabled'); boton.style.cursor = 'pointer'; boton.style.opacity = '1'; }
    fila.style.opacity = '1';

    // Cablear eventos una vez por nodo (los nodos nuevos del runtime se recablean solos)
    if (!input.getAttribute('data-acg-wired')) {
      input.setAttribute('data-acg-wired', '1');
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') enviar(); });
    }
    if (boton && !boton.getAttribute('data-acg-wired')) {
      boton.setAttribute('data-acg-wired', '1');
      boton.addEventListener('click', enviar);
    }
    if (nota && /Vista previa|Vista prèvia|Disponible/.test(nota.textContent)) {
      var ico = nota.querySelector('svg');
      nota.textContent = '';
      if (ico) nota.appendChild(ico);
      nota.appendChild(document.createTextNode(' ' + T.vive));
    }
  }

  enhance();
  cargar();
  setInterval(function () { if (!document.hidden) enhance(); }, 1000);        // re-aplica tras cada re-render del runtime
  // Sondeo del chat: 4s con la pestaña VISIBLE (frescura intacta); 0 con la pestaña oculta
  // (una pestaña abierta en segundo plano quemaba ~15 invocaciones/min de Netlify).
  setInterval(function () { if (!document.hidden && tok()) cargar(); }, 2500);
  try { document.addEventListener('visibilitychange', function () { if (!document.hidden && tok()) cargar(); }); } catch (e) {}
})();
