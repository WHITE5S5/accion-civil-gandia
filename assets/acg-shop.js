/* acg-shop.js — módulo de carrito de la Tienda de merchandising.
   - Lee/escribe el carrito en localStorage('acg_cart').
   - Pinta de forma idempotente un icono 🛒 con contador en el header de CUALQUIER
     página donde se cargue (mismo patrón que acg-forms.js: bucle + marcadores, sin
     asumir que el DOM del runtime persista).
   - Expone funciones globales que Tienda/Producto/Carrito usan.
   Clave localStorage: 'acg_cart'. Formato de cada línea:
     { variant_id, cantidad, nombre, talla, precio_cents, slug, imagen }
*/
(function () {
  'use strict';
  var KEY = 'acg_cart';
  function lang() { try { return localStorage.getItem('acg_lang') || 'es'; } catch (e) { return 'es'; } }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var a = JSON.parse(raw);
      if (!Array.isArray(a)) return [];
      // saneado defensivo
      return a.filter(function (l) { return l && l.variant_id; }).map(function (l) {
        return {
          variant_id: l.variant_id,
          cantidad: Math.max(1, Number(l.cantidad) || 1),
          nombre: l.nombre || '',
          talla: l.talla || '',
          precio_cents: Number(l.precio_cents) || 0,
          slug: l.slug || '',
          imagen: l.imagen || ''
        };
      });
    } catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items || [])); } catch (e) {}
    _cntMemo = null;
    updateBadge();
    try { document.dispatchEvent(new CustomEvent('acg-cart-change')); } catch (e) {}
    return items || [];
  }
  // Memo del contador: updateBadge corre en CADA mutación del DOM (MutationObserver);
  // sin memo, cada mutación paga localStorage+JSON.parse. Se invalida al escribir y
  // caduca a los 3s (cubre escrituras desde otras pestañas junto al interval de 8s).
  var _cntMemo = null, _cntTs = 0;
  function count() {
    var now = Date.now();
    if (_cntMemo != null && (now - _cntTs) < 3000) return _cntMemo;
    _cntMemo = read().reduce(function (n, l) { return n + (Number(l.cantidad) || 0); }, 0);
    _cntTs = now;
    return _cntMemo;
  }
  function totalCents() {
    return read().reduce(function (n, l) { return n + (Number(l.precio_cents) || 0) * (Number(l.cantidad) || 0); }, 0);
  }
  function add(line) {
    if (!line || !line.variant_id) return read();
    var items = read();
    var qty = Math.max(1, Number(line.cantidad) || 1);
    var found = null;
    for (var i = 0; i < items.length; i++) { if (items[i].variant_id === line.variant_id) { found = items[i]; break; } }
    if (found) { found.cantidad = (Number(found.cantidad) || 0) + qty; }
    else {
      items.push({
        variant_id: line.variant_id, cantidad: qty, nombre: line.nombre || '',
        talla: line.talla || '', precio_cents: Number(line.precio_cents) || 0,
        slug: line.slug || '', imagen: line.imagen || ''
      });
    }
    return write(items);
  }
  function setQty(variant_id, qty) {
    var items = read();
    qty = Math.max(1, Number(qty) || 1);
    for (var i = 0; i < items.length; i++) { if (items[i].variant_id === variant_id) { items[i].cantidad = qty; break; } }
    return write(items);
  }
  function remove(variant_id) {
    return write(read().filter(function (l) { return l.variant_id !== variant_id; }));
  }
  function clear() { return write([]); }

  function fmt(cents) {
    var n = (Number(cents) || 0) / 100;
    try { return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
    catch (e) { return n.toFixed(2).replace('.', ',') + ' €'; }
  }

  // Toast con estilo del sitio (nunca alert/confirm nativos)
  function toast(msg, ok) {
    var t = document.createElement('div');
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(10px);z-index:9700;background:' +
      (ok ? '#0A2A5E' : '#C0392B') + ';color:#fff;font:600 14px Public Sans,sans-serif;padding:13px 20px;border-radius:11px;' +
      'box-shadow:0 14px 40px rgba(10,42,94,.3);opacity:0;transition:opacity .25s,transform .25s;max-width:calc(100vw - 40px);text-align:center';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(function () {
      t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(function () { t.remove(); }, 300);
    }, 3200);
  }

  // ---- Icono de carrito en el header (idempotente) ----
  function ponCarrito() {
    if (document.getElementById('acg-cart-btn')) { updateBadge(); return; }
    var host = document.querySelector("header div[style*='margin-left:auto'], header div[style*='margin-left: auto'], #acg-mobbar");
    if (!host) return;
    var a = document.createElement('a');
    a.id = 'acg-cart-btn';
    a.href = '/carrito';
    a.className = 'acg-btn';
    a.setAttribute('aria-label', lang() === 'va' ? 'Cistella' : 'Carrito');
    a.style.cssText = 'position:relative;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;' +
      'width:38px;height:38px;border-radius:9px;background:#F0F4F9;color:#0A2A5E;flex-shrink:0';
    a.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>' +
      '<span id="acg-cart-badge" class="acg-cart-badge" style="position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#F6BE18;color:#0A2A5E;font:800 10.5px Public Sans,sans-serif;display:none;align-items:center;justify-content:center;line-height:1">0</span>';
    host.appendChild(a);
    updateBadge();
  }
  function updateBadge() {
    var c = count();
    var txt = c > 0 ? String(c) : '';
    var disp = c > 0 ? 'inline-flex' : 'none';
    var els = document.querySelectorAll('.acg-cart-badge');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      // IMPRESCINDIBLE idempotente: escribir textContent SIEMPRE genera una mutación del DOM que
      // dispara el MutationObserver de enhance() → updateBadge() → ... bucle infinito que congela
      // TODA la web cuando el carrito tiene items (c>0). Solo tocamos el DOM si el valor cambia.
      if (c > 0 && el.textContent !== txt) el.textContent = txt;
      if (el.style.display !== disp) el.style.display = disp;
    }
  }
  // ---- Ítem "Tienda" en el nav (idempotente, se salta si ya existe) ----
  function tiendaLabel() { return lang() === 'va' ? 'Botiga' : 'Tienda'; }
  function yaTieneTienda(root) {
    return !!(root && (root.querySelector('a[href="/tienda"]') || root.querySelector('a[href="/Tienda.dc.html"]')));
  }
  // Nav superior (escritorio): añade un .acg-nav-item con enlace a /tienda.
  function ponTiendaTop() {
    var nav = document.querySelector('header nav');
    if (!nav || !nav.querySelector('.acg-nav-item')) return; // no es el nav de subpágina
    if (yaTieneTienda(nav)) return;
    var item = document.createElement('div');
    item.className = 'acg-nav-item';
    item.setAttribute('data-acg-tienda', '1');
    item.style.position = 'relative';
    var a = document.createElement('a');
    a.href = '/tienda';
    a.textContent = tiendaLabel();
    a.style.cssText = 'text-decoration:none;color:#33414F;font:600 14.5px Public Sans;white-space:nowrap;display:flex;align-items:center;gap:4px';
    item.appendChild(a);
    nav.appendChild(item);
  }
  // Barra inferior (móvil): deja "Tienda" en lugar de "Noticias" (queda 2+2:
  // Inicio, Programa | Participa | Tienda, Más). Noticias sigue en el nav superior y en "Más".
  function ponTiendaBottom() {
    var bars = document.querySelectorAll('nav');
    var bar = null;
    for (var i = 0; i < bars.length; i++) { if (bars[i].querySelector('.acg-bn')) { bar = bars[i]; break; } }
    if (!bar) return;
    var noti = bar.querySelector('a.acg-bn[href*="ctualidad"], a.acg-bn[href*="oticias"]');
    if (noti) noti.style.display = 'none'; // oculta Noticias para no saturar la barra
    if (yaTieneTienda(bar)) return;
    var a = document.createElement('a');
    a.href = '/tienda';
    a.className = 'acg-bn';
    a.setAttribute('data-acg-tienda', '1');
    a.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.6-5h14.8L21 9M4 9h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><path d="M9 13h6"></path></svg>' + tiendaLabel();
    var last = bar.lastElementChild; // el botón "Más" (toggle menú)
    if (last && last.tagName === 'BUTTON') bar.insertBefore(a, last); else bar.appendChild(a);
  }

  function enhance() { ponCarrito(); ponTiendaTop(); ponTiendaBottom(); }
  // Sincronizado con el render del runtime (mismo frame, antes del pintado):
  // el carrito y "Tienda" aparecen A LA VEZ que el header, no 1,5 s después.
  window.__acgOnRender = window.__acgOnRender || function (fn) {
    try { fn(); } catch (e) {}
    try {
      new MutationObserver(function () { try { fn(); } catch (e) {} })
        .observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    setInterval(function () { try { fn(); } catch (e) {} }, 8000);
  };
  window.__acgOnRender(enhance);

  // ---- API global ----
  window.acgCart = {
    read: read, write: write, add: add, setQty: setQty, remove: remove,
    clear: clear, count: count, totalCents: totalCents, fmt: fmt, toast: toast
  };
  window.acgCartRead = read;
  window.acgCartAdd = add;
  window.acgCartRemove = remove;
  window.acgCartSetQty = setQty;
  window.acgCartClear = clear;
  window.acgCartCount = count;
  window.acgCartTotal = totalCents;
  window.acgCartFmt = fmt;
  window.acgToast = toast;
})();
