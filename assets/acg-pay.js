/* acg-pay.js — modales de donación y afiliación (Fase 4, Stripe Checkout).
   Revive los CTAs de Participa: botones con [data-acg-pay="donar"|"afiliate"|"contacto"].
   Cumplimiento: LO 8/2007 (identificación + declaraciones antes del pago) y RGPD art. 9. */
(function () {
  var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';
  var T = function (es, va) { return VA ? va : es; };
  var S = {
    lbl: 'display:block;font:600 12.5px Public Sans,sans-serif;color:#42525F;margin:12px 0 5px',
    inp: 'width:100%;box-sizing:border-box;border:1.5px solid #E1E8F1;border-radius:10px;padding:11px 13px;font:400 14.5px Public Sans,sans-serif;outline:none;background:#fff',
    chk: 'display:flex;gap:9px;align-items:flex-start;font:400 12.5px Public Sans,sans-serif;color:#42525F;margin:9px 0;cursor:pointer;line-height:1.45',
    chip: 'flex:1;min-width:70px;border:1.5px solid #E1E8F1;background:#fff;color:#33414F;font:700 14px Public Sans,sans-serif;padding:11px 8px;border-radius:11px;cursor:pointer;text-align:center',
    btn: 'width:100%;border:none;cursor:pointer;background:#0A2A5E;color:#fff;font:800 15px Public Sans,sans-serif;padding:14px;border-radius:12px;margin-top:18px',
    h: 'font:800 22px Bricolage Grotesque,sans-serif;color:#0A2A5E;margin:0 0 4px',
    sub: 'font:400 13.5px Public Sans,sans-serif;color:#5C6B7A;margin:0 0 14px;line-height:1.5'
  };
  var row2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';

  function overlay(inner) {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(7,30,69,.55);backdrop-filter:blur(5px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto';
    o.innerHTML = '<div style="background:#fff;border-radius:22px;max-width:470px;width:100%;padding:30px 26px;box-shadow:0 30px 80px rgba(10,42,94,.35);position:relative;margin:auto">' +
      '<button class="x" aria-label="Cerrar" style="position:absolute;top:14px;right:16px;border:none;background:none;font-size:26px;color:#8A99A8;cursor:pointer;line-height:1">×</button>' +
      inner + '<div class="acg-pay-msg" style="display:none;font:600 13px Public Sans,sans-serif;margin-top:12px;text-align:center"></div></div>';
    document.body.appendChild(o);
    o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
    o.querySelector('.x').addEventListener('click', function () { o.remove(); });
    return o;
  }
  function val(o, sel) { var el = o.querySelector(sel); return el ? el.value.trim() : ''; }
  function chk(o, sel) { var el = o.querySelector(sel); return !!(el && el.checked); }
  function say(o, text, ok) { var m = o.querySelector('.acg-pay-msg'); m.textContent = text; m.style.color = ok ? '#1E7A45' : '#C0392B'; m.style.display = 'block'; }
  function send(url, data, btn, o) {
    var orig = btn.textContent; btn.disabled = true; btn.textContent = T('Redirigiendo a pago seguro…', 'Redirigint a pagament segur…');
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        if (r.j && r.j.checkoutUrl) { window.location = r.j.checkoutUrl; return; }
        btn.disabled = false; btn.textContent = orig;
        say(o, (r.j && r.j.error && r.j.error.message) || T('No se pudo procesar. Revisa los datos e inténtalo de nuevo.', 'No s’ha pogut processar. Revisa les dades i torna-ho a provar.'));
      }).catch(function () { btn.disabled = false; btn.textContent = orig; say(o, T('Error de conexión.', 'Error de connexió.')); });
  }
  // Selector de importe con chips + opción libre. Devuelve un getter de céntimos.
  function chips(o, wrap, opciones, libreMin) {
    var box = o.querySelector(wrap);
    var state = { cents: opciones[0].cents, libre: false };
    box.querySelectorAll('[data-c]').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelectorAll('[data-c]').forEach(function (x) { x.style.background = '#fff'; x.style.color = '#33414F'; x.style.borderColor = '#E1E8F1'; });
        b.style.background = '#0A2A5E'; b.style.color = '#fff'; b.style.borderColor = '#0A2A5E';
        var c = b.getAttribute('data-c');
        var inp = o.querySelector('.acg-libre');
        if (c === 'libre') { state.libre = true; inp.style.display = 'block'; inp.focus(); }
        else { state.libre = false; inp.style.display = 'none'; state.cents = Number(c); }
      });
    });
    return function () {
      if (state.libre) {
        var v = Math.round(parseFloat((o.querySelector('.acg-libre').value || '').replace(',', '.')) * 100);
        if (!(v >= libreMin)) return null;
        return v;
      }
      return state.cents;
    };
  }

  // ---------- DONACIÓN ----------
  function donar() {
    var o = overlay(
      '<h3 style="' + S.h + '">' + T('Haz una donación', 'Fes una donació') + '</h3>' +
      '<p style="' + S.sub + '">' + T('Aportación puntual. Por ley (LO 8/2007) las donaciones a partidos deben estar identificadas.', 'Aportació puntual. Per llei (LO 8/2007) les donacions a partits han d’estar identificades.') + '</p>' +
      '<div class="acg-amt" style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button" data-c="1000" style="' + S.chip + '">10 €</button>' +
        '<button type="button" data-c="2500" style="' + S.chip + '">25 €</button>' +
        '<button type="button" data-c="5000" style="' + S.chip + '">50 €</button>' +
        '<button type="button" data-c="10000" style="' + S.chip + '">100 €</button>' +
        '<button type="button" data-c="libre" style="' + S.chip + '">' + T('Otra', 'Altra') + '</button>' +
      '</div>' +
      '<input class="acg-libre" type="number" min="1" step="1" placeholder="' + T('Importe en €', 'Import en €') + '" style="' + S.inp + ';display:none;margin-top:10px">' +
      '<div style="' + row2 + ';margin-top:6px"><div><label style="' + S.lbl + '">' + T('Nombre', 'Nom') + '</label><input class="acg-n" style="' + S.inp + '"></div>' +
      '<div><label style="' + S.lbl + '">' + T('Apellidos', 'Cognoms') + '</label><input class="acg-a" style="' + S.inp + '"></div></div>' +
      '<div style="' + row2 + '"><div><label style="' + S.lbl + '">' + T('DNI / NIE', 'DNI / NIE') + '</label><input class="acg-d" style="' + S.inp + '"></div>' +
      '<div><label style="' + S.lbl + '">Email</label><input class="acg-e" type="email" style="' + S.inp + '"></div></div>' +
      '<div style="margin-top:14px">' +
      '<label style="' + S.chk + '"><input type="checkbox" class="acg-c1" style="margin-top:2px">' + T('Declaro que soy persona física (no empresa).', 'Declare que soc persona física (no empresa).') + '</label>' +
      '<label style="' + S.chk + '"><input type="checkbox" class="acg-c2" style="margin-top:2px">' + T('Declaro que la donación se hace con fondos propios.', 'Declare que la donació es fa amb fons propis.') + '</label>' +
      '<label style="' + S.chk + '"><input type="checkbox" class="acg-c3" style="margin-top:2px">' + T('Declaro no superar 50.000 € de donaciones al partido este año.', 'Declare no superar 50.000 € de donacions al partit enguany.') + '</label></div>' +
      '<button class="acg-go" style="' + S.btn + '">' + T('Donar', 'Donar') + '</button>' +
      '<p style="font:400 11.5px Public Sans,sans-serif;color:#8A97A5;margin:10px 0 0;text-align:center">' + T('Pago seguro con Stripe · recibo por email', 'Pagament segur amb Stripe · rebut per email') + '</p>'
    );
    var getCents = chips(o, '.acg-amt', [{ cents: 1000 }], 100);
    o.querySelector('.acg-go').addEventListener('click', function () {
      var cents = getCents();
      if (!cents || cents < 100) return say(o, T('Indica un importe válido (mínimo 1 €).', 'Indica un import vàlid (mínim 1 €).'));
      if (!(chk(o, '.acg-c1') && chk(o, '.acg-c2') && chk(o, '.acg-c3'))) return say(o, T('Debes aceptar las tres declaraciones legales.', 'Has d’acceptar les tres declaracions legals.'));
      send('/api/donaciones', {
        nombre: val(o, '.acg-n'), apellidos: val(o, '.acg-a'), dni: val(o, '.acg-d'), email: val(o, '.acg-e'),
        importeCents: cents, declaracionPersonaFisica: true, declaracionFondosPropios: true, declaracionLimiteAnual: true
      }, o.querySelector('.acg-go'), o);
    });
  }

  // ---------- AFILIACIÓN ----------
  function afiliar() {
    var o = overlay(
      '<h3 style="' + S.h + '">' + T('Afíliate a Acción Civil', 'Afilia’t a Acció Civil') + '</h3>' +
      '<p style="' + S.sub + '">' + T('Cuota mensual. Tus datos de afiliación son categoría especial (RGPD art. 9) y se tratan cifrados.', 'Quota mensual. Les teues dades d’afiliació són categoria especial (RGPD art. 9) i es tracten xifrades.') + '</p>' +
      '<label style="' + S.lbl + '">' + T('Cuota mensual', 'Quota mensual') + '</label>' +
      '<div class="acg-amt" style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button" data-c="base" style="' + S.chip + '">15 €</button>' +
        '<button type="button" data-c="media" style="' + S.chip + '">30 €</button>' +
        '<button type="button" data-c="libre" style="' + S.chip + '">' + T('Otra', 'Altra') + '</button>' +
      '</div>' +
      '<input class="acg-libre" type="number" min="30" step="1" placeholder="' + T('€/mes (mínimo 30)', '€/mes (mínim 30)') + '" style="' + S.inp + ';display:none;margin-top:10px">' +
      '<div style="' + row2 + ';margin-top:6px"><div><label style="' + S.lbl + '">' + T('Nombre', 'Nom') + '</label><input class="acg-n" style="' + S.inp + '"></div>' +
      '<div><label style="' + S.lbl + '">' + T('Apellidos', 'Cognoms') + '</label><input class="acg-a" style="' + S.inp + '"></div></div>' +
      '<div style="' + row2 + '"><div><label style="' + S.lbl + '">' + T('DNI / NIE', 'DNI / NIE') + '</label><input class="acg-d" style="' + S.inp + '"></div>' +
      '<div><label style="' + S.lbl + '">' + T('Fecha de nacimiento', 'Data de naixement') + '</label><input class="acg-fn" type="date" style="' + S.inp + '"></div></div>' +
      '<label style="' + S.lbl + '">Email</label><input class="acg-e" type="email" style="' + S.inp + '">' +
      '<div style="' + row2 + '"><div><label style="' + S.lbl + '">' + T('Dirección', 'Adreça') + '</label><input class="acg-dir" style="' + S.inp + '"></div>' +
      '<div><label style="' + S.lbl + '">' + T('Código postal', 'Codi postal') + '</label><input class="acg-cp" inputmode="numeric" style="' + S.inp + '"></div></div>' +
      '<label style="' + S.lbl + '">' + T('Teléfono (opcional)', 'Telèfon (opcional)') + '</label><input class="acg-tel" style="' + S.inp + '">' +
      '<div style="margin-top:14px">' +
      '<label style="' + S.chk + '"><input type="checkbox" class="acg-c1" style="margin-top:2px">' + T('Acepto los estatutos del partido.', 'Accepte els estatuts del partit.') + '</label>' +
      '<label style="' + S.chk + '"><input type="checkbox" class="acg-c2" style="margin-top:2px">' + T('Doy mi consentimiento explícito al tratamiento de mis datos de afiliación política (RGPD art. 9).', 'Done el meu consentiment explícit al tractament de les meues dades d’afiliació política (RGPD art. 9).') + '</label></div>' +
      '<button class="acg-go" style="' + S.btn + '">' + T('Afiliarme', 'Afiliar-me') + '</button>' +
      '<p style="font:400 11.5px Public Sans,sans-serif;color:#8A97A5;margin:10px 0 0;text-align:center">' + T('Pago seguro con Stripe · domiciliación SEPA o tarjeta · baja cuando quieras', 'Pagament segur amb Stripe · domiciliació SEPA o targeta · baixa quan vulgues') + '</p>'
    );
    var tipoState = { t: 'base' };
    var getCents = chips(o, '.acg-amt', [{ cents: 0 }], 3000);
    // sobreescribir: en afiliación el chip elige tipo, no importe
    o.querySelectorAll('.acg-amt [data-c]').forEach(function (b) {
      b.addEventListener('click', function () { tipoState.t = b.getAttribute('data-c'); });
    });
    o.querySelector('.acg-go').addEventListener('click', function () {
      var tipo = tipoState.t, importeCents = null;
      if (tipo === 'libre') {
        importeCents = Math.round(parseFloat((val(o, '.acg-libre') || '').replace(',', '.')) * 100);
        if (!(importeCents >= 3000)) return say(o, T('La cuota libre debe ser de 30 € o más.', 'La quota lliure ha de ser de 30 € o més.'));
      }
      if (!(chk(o, '.acg-c1') && chk(o, '.acg-c2'))) return say(o, T('Debes aceptar los estatutos y el tratamiento de datos.', 'Has d’acceptar els estatuts i el tractament de dades.'));
      send('/api/afiliacion', {
        nombre: val(o, '.acg-n'), apellidos: val(o, '.acg-a'), dni: val(o, '.acg-d'), email: val(o, '.acg-e'),
        direccion: val(o, '.acg-dir'), cp: val(o, '.acg-cp'), telefono: val(o, '.acg-tel'),
        fechaNacimiento: val(o, '.acg-fn'), cuotaTipo: tipo, importeCents: importeCents,
        aceptaEstatutos: true, aceptaPrivacidadArt9: true
      }, o.querySelector('.acg-go'), o);
    });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-acg-pay]');
    if (!el) return;
    var k = el.getAttribute('data-acg-pay');
    if (k === 'donar') { e.preventDefault(); donar(); }
    else if (k === 'afiliate') { e.preventDefault(); afiliar(); }
    else if (k === 'contacto') { e.preventDefault(); window.location = '/Contacto.dc.html'; }
  }, true);

  // Enlace directo al formulario de afiliación: /participa?afiliate=1
  (function () {
    var p; try { p = new URLSearchParams(location.search); } catch (e) { return; }
    if (p.get('afiliate') === '1' || p.get('afiliarse') === '1') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', afiliar);
      else afiliar();
    }
  })();

  // Agradecimiento al volver de Stripe
  (function () {
    var p; try { p = new URLSearchParams(location.search); } catch (e) { return; }
    var af = p.get('afiliacion') === 'ok', don = p.get('donacion') === 'ok';
    if (!af && !don) return;
    overlay('<div style="text-align:center;padding-top:6px"><div style="font-size:44px;line-height:1;margin-bottom:8px">✅</div>' +
      '<h3 style="' + S.h + '">' + T('¡Gracias!', 'Gràcies!') + '</h3>' +
      '<p style="' + S.sub + '">' + (af ? T('Tu afiliación está en marcha. Recibirás la confirmación por email.', 'La teua afiliació està en marxa. Rebràs la confirmació per email.') : T('Tu donación se ha completado. Te enviamos el recibo por email.', 'La teua donació s’ha completat. T’enviem el rebut per email.')) + '</p></div>');
  })();

  window.acgDonar = donar; window.acgAfiliar = afiliar;
})();
