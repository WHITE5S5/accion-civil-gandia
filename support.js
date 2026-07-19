// GENERATED from dc-runtime/src/*.ts — do not edit. Rebuild with `cd dc-runtime && bun run build`.
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/react.ts
  function getReact() {
    const R = window.React;
    if (!R) throw new Error("dc-runtime: window.React is not available yet");
    return R;
  }
  function getReactDOM() {
    const RD = window.ReactDOM;
    if (!RD) throw new Error("dc-runtime: window.ReactDOM is not available yet");
    return RD;
  }
  var h = ((...args) => getReact().createElement(
    ...args
  ));

  // src/parse.ts
  function parseDcDocument(doc) {
    const dc = doc.querySelector("x-dc");
    if (!dc) return null;
    const scriptEl = doc.querySelector("script[data-dc-script]");
    const { props, preview } = parseDataProps(
      scriptEl?.getAttribute("data-props") ?? null
    );
    return {
      template: dc.innerHTML,
      js: scriptEl ? scriptEl.textContent || "" : "",
      props,
      preview
    };
  }
  function parseDcText(src) {
    const openMatch = /<x-dc(?:\s[^>]*)?>/.exec(src);
    if (!openMatch) return null;
    const close = src.lastIndexOf("</x-dc>");
    if (close === -1 || close < openMatch.index) return null;
    const template = src.slice(openMatch.index + openMatch[0].length, close);
    const doc = new DOMParser().parseFromString(src, "text/html");
    const scriptEl = doc.querySelector("script[data-dc-script]");
    const { props, preview } = parseDataProps(
      scriptEl?.getAttribute("data-props") ?? null
    );
    return {
      template,
      js: scriptEl ? scriptEl.textContent || "" : "",
      props,
      preview
    };
  }
  function parseDataProps(raw) {
    if (!raw) return { props: null, preview: null };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { props: null, preview: null };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { props: null, preview: null };
    }
    const obj = parsed;
    const preview = obj.$preview && typeof obj.$preview === "object" ? obj.$preview : null;
    const rest = {};
    for (const k of Object.keys(obj)) {
      if (k[0] !== "$") rest[k] = obj[k];
    }
    return { props: Object.keys(rest).length ? rest : null, preview };
  }
  function dcNameFromPath(pathname) {
    let p = pathname || "";
    try {
      p = decodeURIComponent(p);
    } catch {
    }
    const base = p.split("/").pop() || "Root";
    return base.replace(/\.dc\.html$/, "").replace(/\.html?$/, "") || "Root";
  }

  // src/boot.ts
  var BASE_CSS = `
    .sc-placeholder{background:color-mix(in srgb,currentColor 8%,transparent);
      border:1px solid color-mix(in srgb,currentColor 50%,transparent);
      border-radius:2px;box-sizing:border-box;overflow:hidden}
    @keyframes sc-shine{0%{background-position:100% 50%}100%{background-position:0% 50%}}
    /* Esqueleto de carga reutilizable (nunca datos de ejemplo) */
    .acg-sk{position:relative;overflow:hidden;color:transparent!important;
      background:#EEF2F6!important;border-color:#E4EBF2!important;box-shadow:none!important;pointer-events:none}
    .acg-sk *{visibility:hidden!important}
    .acg-sk::after{content:'';position:absolute;inset:0;pointer-events:none;
      background:linear-gradient(90deg,rgba(233,238,244,0) 20%,rgba(210,220,232,.85) 40%,rgba(233,238,244,0) 60%);
      background-size:300% 100%;animation:sc-shine 1.35s ease infinite}
    /* Aparición suave del contenido real (del esqueleto a lo real, sin salto brusco) */
    @media (prefers-reduced-motion: no-preference){
      .acg-in{animation:acgIn .45s cubic-bezier(.22,.61,.36,1) both}
      @keyframes acgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    }
    html.sc-dc-streaming .sc-placeholder,
    html.sc-dc-streaming .sc-interp.sc-missing{position:relative;
      background:color-mix(in srgb,currentColor 5%,transparent);
      border-color:transparent}
    html.sc-dc-streaming .sc-placeholder::before,
    html.sc-dc-streaming .sc-interp.sc-missing::before{content:'';
      position:absolute;inset:0;pointer-events:none;
      background:linear-gradient(90deg,rgba(217,119,87,0) 25%,rgba(247,225,211,.95) 37%,rgba(217,119,87,0) 63%);
      background-size:400% 100%;animation:sc-shine 1.4s ease infinite}
    html.sc-dc-streaming .sc-placeholder:nth-child(n+9 of .sc-placeholder)::before,
    html.sc-dc-streaming .sc-interp.sc-missing:nth-child(n+9 of .sc-interp.sc-missing)::before{animation:none;
      background:color-mix(in srgb,currentColor 8%,transparent)}
    .sc-placeholder-error{padding:4px 8px;font:11px/1.4 ui-monospace,monospace;
      color:color-mix(in srgb,currentColor 70%,transparent);word-break:break-word}
    .sc-interp.sc-missing{display:inline-block;width:2em;height:1em;overflow:hidden;
      vertical-align:text-bottom;background:rgba(255,255,255,.3);border:1px solid rgba(0,0,0,.5);
      border-radius:2px;box-sizing:border-box;color:transparent;
      user-select:none}
    .sc-interp.sc-unresolved{font-family:ui-monospace,monospace;font-size:.85em;
      color:color-mix(in srgb,currentColor 50%,transparent);
      background:color-mix(in srgb,currentColor 10%,transparent);border-radius:3px;
      padding:0 3px}
    .sc-host.sc-has-error{position:relative}
    .sc-logic-error{position:absolute;top:8px;left:8px;z-index:2147483647;max-width:60ch;
      padding:6px 10px;background:#b00020;color:#fff;font:12px/1.4 ui-monospace,monospace;
      border-radius:3px;white-space:pre-wrap;pointer-events:none}
    /* Mirrors PRINT_BASELINE_CSS in apps/web deck-stage-export.ts \u2014 keep both
       in sync until dc-runtime regains a build step. */
    @media print {
      @page { margin: 0.5cm; }
      figure, table { break-inside: avoid; }
      #dc-root, #dc-root > .sc-host { height: auto; }
      *, *::before, *::after {
        print-color-adjust: exact; -webkit-print-color-adjust: exact;
        backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
        animation-delay: -99s !important; animation-duration: .001s !important;
        animation-iteration-count: 1 !important; animation-fill-mode: both !important;
        animation-play-state: running !important; transition-duration: 0s !important;
      }
    }
  `;
  var FULL_PAGE_CSS = "html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}";
  function rootNameForDocument(doc, loc) {
    let bootPath = loc.pathname || "";
    if (!/\.dc\.html?$/i.test(safeDecode(bootPath))) {
      try {
        bootPath = new URL(doc.baseURI || "/").pathname;
      } catch {
      }
    }
    return dcNameFromPath(bootPath);
  }
  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }
  function boot(runtime, doc = document) {
    const parsed = parseDcDocument(doc);
    if (!parsed) return null;
    const React = getReact();
    const rootName = rootNameForDocument(doc, location);
    runtime.markFetched(rootName);
    runtime.setRootName(rootName);
    runtime.adoptParsed(rootName, parsed);
    fetch(location.href).then((res) => res.ok ? res.text() : "").then((t) => {
      const raw = t ? parseDcText(t) : null;
      if (raw?.template) runtime.updateHtml(rootName, raw.template);
    }).catch(() => {
    });
    const dc = doc.querySelector("x-dc");
    const hostEl = doc.createElement("div");
    hostEl.id = "dc-root";
    dc.replaceWith(hostEl);
    if (!parsed.preview) {
      const s = doc.createElement("style");
      s.textContent = FULL_PAGE_CSS;
      doc.head.appendChild(s);
    }
    const Root = runtime.getDC(rootName);
    const entry = runtime.registry.get(rootName);
    function StandaloneRoot() {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const sub = () => setTick((n) => n + 1);
        entry.subs.add(sub);
        return () => {
          entry.subs.delete(sub);
        };
      }, []);
      const defaults = React.useMemo(() => {
        const d = {};
        for (const k in entry.propsMeta || {}) {
          const v = entry.propsMeta?.[k]?.default;
          if (v !== void 0) d[k] = v;
        }
        return d;
      }, [entry.propsMeta]);
      return h(Root, { ...defaults, ...entry.propOverrides || {} });
    }
    const ReactDOM = getReactDOM();
    if (ReactDOM.createRoot)
      ReactDOM.createRoot(hostEl).render(h(StandaloneRoot));
    else ReactDOM.render(h(StandaloneRoot), hostEl);
    return rootName;
  }

  // src/expr.ts
  var IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  var NUMBER_RE = /^-?\d+(\.\d+)?$/;
  function resolve(vals, src) {
    const expr = String(src).trim();
    if (!expr) return void 0;
    if (expr[0] === "(" && expr[expr.length - 1] === ")" && parensWrapWhole(expr)) {
      return resolve(vals, expr.slice(1, -1));
    }
    const eq = findTopLevelEquality(expr);
    if (eq) {
      const lv = resolve(vals, expr.slice(0, eq.index));
      const rv = resolve(vals, expr.slice(eq.index + eq.op.length));
      switch (eq.op) {
        case "===":
          return lv === rv;
        case "!==":
          return lv !== rv;
        case "==":
          return lv == rv;
        default:
          return lv != rv;
      }
    }
    if (expr[0] === "!") return !resolve(vals, expr.slice(1));
    if (expr === "true") return true;
    if (expr === "false") return false;
    if (expr === "null") return null;
    if (expr === "undefined") return void 0;
    if (NUMBER_RE.test(expr)) return Number(expr);
    if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) {
      return expr.slice(1, -1);
    }
    return resolvePath(vals, expr);
  }
  function parensWrapWhole(expr) {
    let depth = 0;
    for (let i = 0; i < expr.length - 1; i++) {
      if (expr[i] === "(") depth++;
      else if (expr[i] === ")") {
        depth--;
        if (depth === 0) return false;
      }
    }
    return true;
  }
  function findTopLevelEquality(expr) {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i];
      if (c === "[" || c === "(") depth++;
      else if (c === "]" || c === ")") depth--;
      else if (depth === 0 && (c === "=" || c === "!") && expr[i + 1] === "=") {
        if (i > 0 && (expr[i - 1] === "=" || expr[i - 1] === "!")) continue;
        if (!expr.slice(0, i).trim()) continue;
        const op = expr[i + 2] === "=" ? c + "==" : c + "=";
        return { index: i, op };
      }
    }
    return null;
  }
  function resolvePath(vals, expr) {
    const head = expr.match(IDENT_RE);
    if (!head) return void 0;
    let cur = vals == null ? void 0 : vals[head[0]];
    let i = head[0].length;
    while (i < expr.length) {
      if (expr[i] === ".") {
        const m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
        if (!m) return void 0;
        cur = cur == null ? void 0 : cur[m[0]];
        i += 1 + m[0].length;
      } else if (expr[i] === "[") {
        let depth = 1;
        let j = i + 1;
        while (j < expr.length && depth > 0) {
          if (expr[j] === "[") depth++;
          else if (expr[j] === "]") {
            depth--;
            if (depth === 0) break;
          }
          j++;
        }
        if (depth !== 0) return void 0;
        const key = resolve(vals, expr.slice(i + 1, j));
        cur = cur == null ? void 0 : cur[key];
        i = j + 1;
      } else {
        return void 0;
      }
    }
    return cur;
  }

  // src/encode.ts
  var CAMEL_ATTR = "sc-camel-";
  var INLINE_TEXT_TAGS = new Set(
    "a abbr b bdi bdo br cite code del dfn em i ins kbd mark q s samp small span strike strong sub sup u var wbr".split(
      " "
    )
  );
  var RAW_WRAP = {
    select: "sc-raw-select",
    table: "sc-raw-table",
    tbody: "sc-raw-tbody",
    thead: "sc-raw-thead",
    tfoot: "sc-raw-tfoot",
    tr: "sc-raw-tr",
    td: "sc-raw-td",
    th: "sc-raw-th",
    caption: "sc-raw-caption"
  };
  var RAW_UNWRAP = Object.fromEntries(
    Object.entries(RAW_WRAP).map(([k, v]) => [v, k])
  );
  var EVENT_MAP = {
    onclick: "onClick",
    onchange: "onChange",
    oninput: "onInput",
    onsubmit: "onSubmit",
    onkeydown: "onKeyDown",
    onkeyup: "onKeyUp",
    onkeypress: "onKeyPress",
    onmousedown: "onMouseDown",
    onmouseup: "onMouseUp",
    onmouseenter: "onMouseEnter",
    onmouseleave: "onMouseLeave",
    onfocus: "onFocus",
    onblur: "onBlur",
    ondoubleclick: "onDoubleClick",
    oncontextmenu: "onContextMenu"
  };
  var ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
  var IMPORT_SELF_CLOSE_RE = new RegExp(
    "<(x-import|dc-import)(" + ATTRS + ")/>",
    "gi"
  );
  var CAMEL_ATTR_RE = /(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g;
  function encodeCase(html) {
    html = html.replace(
      IMPORT_SELF_CLOSE_RE,
      (_, t, a) => "<" + t + a + "></" + t + ">"
    );
    html = html.replace(/<helmet(\s|>)/gi, "<sc-helmet$1");
    html = html.replace(/<\/helmet\s*>/gi, "</sc-helmet>");
    html = html.replace(
      CAMEL_ATTR_RE,
      (_, sp, name, eq) => sp + CAMEL_ATTR + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + eq
    );
    for (const [real, alias] of Object.entries(RAW_WRAP)) {
      html = html.replace(
        new RegExp("(</?)" + real + "(?=[\\s>])", "gi"),
        "$1" + alias
      );
    }
    return html;
  }
  function kebabToCamel(s) {
    return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }
  function cssToObj(css) {
    const o = {};
    for (const decl of css.split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      o[prop.startsWith("--") ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
    }
    return o;
  }
  function compileAttr(raw) {
    const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (whole) {
      const path = whole[1];
      return (vals) => resolve(vals, path);
    }
    if (raw.includes("{{")) {
      const parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
      return (vals) => parts.map((s, i) => i & 1 ? resolve(vals, s) ?? "" : s).join("");
    }
    return () => raw;
  }

  // src/compile.ts
  function collectProps(node, kind, host) {
    const propGetters = [];
    const pseudoClasses = [];
    let hintSize = null;
    for (const { name, value } of [...node.attributes]) {
      if (name === "sc-name" || name === "data-dc-tpl") continue;
      let key = name;
      if (key.startsWith(CAMEL_ATTR))
        key = kebabToCamel(key.slice(CAMEL_ATTR.length));
      if (key === "hint-size") {
        hintSize = value;
        continue;
      }
      if (key.startsWith("style-")) {
        pseudoClasses.push(host.pseudoClass(key.slice(6), value));
        continue;
      }
      if (kind !== "dom") {
        if (key.includes("-") && !(kind === "x-import" && (key.startsWith("aria-") || key.startsWith("data-"))))
          key = kebabToCamel(key);
      } else {
        if (key === "class") key = "className";
        else if (key === "for") key = "htmlFor";
        else if (key.startsWith("on"))
          key = EVENT_MAP[key] || "on" + key[2].toUpperCase() + key.slice(3);
      }
      propGetters.push([key, compileAttr(value)]);
    }
    return { propGetters, pseudoClasses, hintSize };
  }
  var HOST_STYLE_PROPS = /* @__PURE__ */ new Set([
    "position",
    "left",
    "right",
    "top",
    "bottom",
    "inset",
    "width",
    "height",
    "z-index",
    "transform"
  ]);
  function hostPositionStyle(style) {
    const all = typeof style === "string" ? cssToObj(style) : style != null && typeof style === "object" ? style : null;
    if (!all) return void 0;
    const out = {};
    for (const [k, v] of Object.entries(all)) {
      const kebab = k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      if (HOST_STYLE_PROPS.has(kebab)) out[k] = v;
    }
    return Object.keys(out).length ? out : void 0;
  }
  function compileTemplate(html, host) {
    const tpl = document.createElement("template");
    //! nosemgrep: direct-inner-html-assignment
    tpl.innerHTML = encodeCase(html);
    let tplN = 0;
    (function stamp(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        node.setAttribute("data-dc-tpl", String(tplN++));
      }
      for (const c of node.childNodes) stamp(c);
    })(tpl.content);
    const builders = walkChildren(tpl.content, host);
    const render = ((vals, ctx) => builders.map((b, i) => b(vals || {}, ctx, i)));
    render.__annotated = tpl.innerHTML;
    return render;
  }
  function walkChildren(node, host) {
    return [...node.childNodes].map((c) => walk(c, host)).filter((b) => b != null);
  }
  function walk(node, host) {
    if (node.nodeType === Node.TEXT_NODE) return walkText(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (tag === "sc-for") return walkFor(el, host);
    if (tag === "sc-if") return walkIf(el, host);
    if (tag === "x-import") return walkXImport(el, host);
    if (tag === "sc-helmet") return host.helmet(el);
    if (tag === "dc-import") return walkComponent(el, host);
    return walkElement(el, host);
  }
  var warnedHoles = /* @__PURE__ */ new Set();
  function warnUnresolved(ctx, what) {
    const key = (ctx?.__name || "?") + "\0" + what;
    if (warnedHoles.has(key)) return;
    warnedHoles.add(key);
    console.warn("[dc-runtime] " + (ctx?.__name || "template") + ": " + what);
  }
  function walkText(node) {
    const txt = node.nodeValue ?? "";
    if (!txt.includes("{{")) {
      if (!txt.trim() && !txt.includes(" ")) return null;
      return () => txt;
    }
    const parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
    return (vals, ctx, key) => h(
      getReact().Fragment,
      { key },
      ...parts.map((p, i) => {
        if (!(i & 1)) return p;
        const v = resolve(vals, p);
        if (v === void 0) {
          if (!ctx?.__streamingNow) {
            if (document.body?.hasAttribute("data-dc-editor-on")) {
              return h(
                "span",
                { key: i, className: "sc-interp sc-unresolved" },
                "{{ " + p.trim() + " }}"
              );
            }
            warnUnresolved(
              ctx,
              "{{ " + p.trim() + " }} never resolved \u2014 rendered as empty"
            );
            return null;
          }
          return h(
            "span",
            { key: i, className: "sc-interp sc-missing" },
            p.trim()
          );
        }
        if (getReact().isValidElement(v) || Array.isArray(v)) {
          return h(getReact().Fragment, { key: i }, v);
        }
        if (v === null || typeof v === "boolean") return null;
        return h("span", { key: i, className: "sc-interp" }, String(v));
      })
    );
  }
  function walkFor(el, host) {
    const listGet = compileAttr(el.getAttribute("list") || "");
    const asName = el.getAttribute("as") || "item";
    const hintN = parseInt(el.getAttribute("hint-placeholder-count") || "0", 10);
    const kids = walkChildren(el, host);
    const listSrc = el.getAttribute("list") || "";
    return (vals, ctx, key) => {
      let list = listGet(vals);
      if (!Array.isArray(list)) {
        if (!ctx?.__streamingNow) {
          if (list !== void 0 && list !== null) {
            warnUnresolved(
              ctx,
              'sc-for list="' + listSrc + '" is not an array (' + typeof list + ")"
            );
          }
          list = [];
        } else {
          list = hintN > 0 ? Array(hintN).fill(void 0) : [];
        }
      }
      return h(
        getReact().Fragment,
        { key },
        list.map((item, i) => {
          const sub = { ...vals, [asName]: item, $index: i };
          return h(
            getReact().Fragment,
            { key: i },
            kids.map((b, j) => b(sub, ctx, j))
          );
        })
      );
    };
  }
  function walkIf(el, host) {
    const valGet = compileAttr(el.getAttribute("value") || "");
    const hintRaw = el.getAttribute("hint-placeholder-val");
    const hintGet = hintRaw != null ? compileAttr(hintRaw) : null;
    const kids = walkChildren(el, host);
    return (vals, ctx, key) => {
      let v = valGet(vals);
      if (v === void 0 && hintGet && ctx?.__streamingNow) v = hintGet(vals);
      return v ? h(
        getReact().Fragment,
        { key },
        kids.map((b, j) => b(vals, ctx, j))
      ) : null;
    };
  }
  function walkComponent(el, host) {
    const name = el.getAttribute("name") || el.getAttribute("component") || "";
    el.removeAttribute("name");
    el.removeAttribute("component");
    const tplId = el.getAttribute("data-dc-tpl");
    const styleRaw = el.getAttribute("style");
    el.removeAttribute("style");
    const styleGet = styleRaw != null ? compileAttr(styleRaw) : null;
    const { propGetters, hintSize } = collectProps(el, "dc-import", host);
    const kids = walkChildren(el, host);
    return (vals, ctx, key) => {
      const props = {
        key,
        __hintSize: hintSize,
        __tplId: tplId,
        __hostStyle: styleGet ? hostPositionStyle(styleGet(vals)) : void 0
      };
      for (const [k, g] of propGetters) {
        const v = g(vals);
        if (k === "dcProps") {
          if (v && typeof v === "object") Object.assign(props, v);
          continue;
        }
        props[k] = v;
      }
      if (kids.length) props.children = kids.map((b, j) => b(vals, ctx, j));
      return h(host.component(name), props);
    };
  }
  function walkXImport(el, host) {
    const globalNameGet = compileAttr(
      el.getAttribute("component-from-global-scope") || ""
    );
    const exportNameGet = compileAttr(
      el.getAttribute("component") || el.getAttribute("name") || ""
    );
    const fromRaw = el.getAttribute("from") || el.getAttribute("src") || el.getAttribute("import") || "";
    const urls = fromRaw.trim() ? fromRaw.trim().split(/\s+/) : [];
    const url = urls.length ? urls[urls.length - 1] : "";
    const kindOf = (u) => /\.(jsx|tsx)(\?|#|$)/i.test(u) ? "jsx" : "js";
    const tplId = el.getAttribute("data-dc-tpl");
    const styleRaw = el.getAttribute("style");
    el.removeAttribute("style");
    const styleGet = styleRaw != null ? compileAttr(styleRaw) : null;
    const wrap = tplId != null || styleGet != null;
    const { propGetters, hintSize } = collectProps(el, "x-import", host);
    const hasContent = el.children.length > 0 || !!(el.textContent || "").trim();
    const kids = hasContent ? walkChildren(el, host) : [];
    const urlBindable = fromRaw.includes("{{");
    if (urls.length && !urlBindable) {
      let prev;
      for (const u of urls) prev = host.loadExternal(kindOf(u), u, prev);
    }
    const evalName = (g, vals) => {
      const v = g(vals);
      const s = v == null ? "" : String(v);
      return s.includes("{{") ? "" : s;
    };
    return (vals, ctx, key) => {
      const globalName = evalName(globalNameGet, vals);
      const name = globalName || evalName(exportNameGet, vals);
      const C = !name || urlBindable ? null : globalName ? host.resolveExternalGlobal(url, globalName) : host.resolveExternal(url, name);
      const hostStyle = styleGet ? hostPositionStyle(styleGet(vals)) : void 0;
      const wrapper = wrap ? {
        key,
        className: "sc-host-x",
        "data-dc-tpl": tplId,
        style: hostStyle || { display: "contents" }
      } : null;
      if (!C) {
        const error = urlBindable ? "x-import `from` cannot contain {{ \u2026 }} \u2014 module URLs are resolved at parse time; use a literal URL" : host.resolveExternalError(url, name);
        const ph = host.placeholder({
          key: wrapper ? void 0 : key,
          name,
          hintSize,
          error
        });
        return wrapper ? h("div", wrapper, ph) : ph;
      }
      const props = wrapper ? {} : { key };
      let unresolvedHole = false;
      for (const [k, g] of propGetters) {
        if (k === "component" || k === "componentFromGlobalScope" || k === "from") {
          continue;
        }
        const v = g(vals);
        if (v === void 0) unresolvedHole = true;
        if (k === "dcProps") {
          if (v && typeof v === "object") Object.assign(props, v);
          continue;
        }
        props[k] = v;
      }
      if (unresolvedHole && ctx?.__htmlStreamingNow) {
        const ph = host.placeholder({
          key: wrapper ? void 0 : key,
          name,
          hintSize,
          error: null
        });
        return wrapper ? h("div", wrapper, ph) : ph;
      }
      if (kids.length) props.children = kids.map((b, j) => b(vals, ctx, j));
      return wrapper ? h("div", wrapper, h(C, props)) : h(C, props);
    };
  }
  function contentKey(el) {
    const clone = el.cloneNode(true);
    for (const d of clone.querySelectorAll("*")) {
      while (d.attributes.length) d.removeAttribute(d.attributes[0].name);
    }
    const s = clone.innerHTML;
    let h2 = 5381;
    for (let i = 0; i < s.length; i++) h2 = (h2 << 5) + h2 + s.charCodeAt(i) | 0;
    return s.length + "." + (h2 >>> 0).toString(36);
  }
  var NEVER_CONTENT_KEYED = new Set(
    "script style textarea option title select canvas iframe video audio".split(
      " "
    )
  );
  var NOT_INLINE_SELECTOR = ":not(" + [...INLINE_TEXT_TAGS].join(",") + ")";
  function walkElement(el, host) {
    const realTag = RAW_UNWRAP[el.localName] || el.localName;
    const tplId = el.getAttribute("data-dc-tpl");
    const inlineOnly = el.childNodes.length > 0 && !NEVER_CONTENT_KEYED.has(realTag) && el.querySelector(NOT_INLINE_SELECTOR) === null;
    const keySuffix = inlineOnly ? "|" + contentKey(el) : "";
    const { propGetters, pseudoClasses } = collectProps(el, "dom", host);
    const kids = walkChildren(el, host);
    return (vals, ctx, key) => {
      const props = {
        key: key + keySuffix,
        "data-dc-tpl": tplId
      };
      for (const [k, g] of propGetters) {
        let v = g(vals);
        if (k === "style" && typeof v === "string") v = cssToObj(v);
        if ((k === "value" || k === "checked") && v === void 0) {
          v = k === "checked" ? false : "";
        }
        props[k] = v;
      }
      if (pseudoClasses.length) {
        props.className = [props.className, ...pseudoClasses].filter(Boolean).join(" ");
      }
      return h(realTag, props, ...kids.map((b, j) => b(vals, ctx, j)));
    };
  }

  // src/logic.ts
  var StreamableLogic = class {
    constructor(props) {
      __publicField(this, "props");
      __publicField(this, "state", {});
      /** Back-pointer to the wrapper component, installed after construction. */
      __publicField(this, "__host");
      this.props = props || {};
    }
    setState(update, cb) {
      this.__host && this.__host.__setLogicState(update, cb);
    }
    forceUpdate() {
      this.__host && this.__host.forceUpdate();
    }
    componentDidMount() {
    }
    componentDidUpdate(_prevProps) {
    }
    componentWillUnmount() {
    }
    /** The flat object the template renders against (merged over props). */
    renderVals() {
      return {};
    }
  };
  function evalDcLogic(src) {
    //! nosemgrep: eval-and-function-constructor
    const fn = new Function(
      "DCLogic",
      "StreamableLogic",
      "React",
      src + '\n;return (typeof Component!=="undefined"&&Component)||undefined;'
    );
    return fn(StreamableLogic, StreamableLogic, getReact());
  }

  // src/component.ts
  function shallowEqual(a, b) {
    if (!b) return false;
    const ak = Object.keys(a).filter((k) => k !== "children");
    const bk = Object.keys(b).filter((k) => k !== "children");
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (a[k] !== b[k]) return false;
    return true;
  }
  function Placeholder({
    name,
    hintSize,
    streaming,
    error
  }) {
    const [w, hgt] = (hintSize || "100%,60px").split(",");
    return h(
      "div",
      {
        className: "sc-placeholder" + (streaming ? " sc-streaming" : ""),
        style: { width: w.trim(), height: hgt && hgt.trim() },
        title: name
      },
      error ? h(
        "div",
        { className: "sc-placeholder-error" },
        (name ? name + ": " : "") + error
      ) : null
    );
  }
  function hintToMin(hint) {
    if (!hint) return void 0;
    const [w, hgt] = hint.split(",");
    return { minWidth: w.trim(), minHeight: hgt && hgt.trim() };
  }
  function createComponentFactory(registry, ensureFetched) {
    const React = getReact();
    const AncestorContext = React.createContext([]);
    class StreamableComponent extends React.Component {
      constructor(props) {
        super(props);
        __publicField(this, "__name");
        __publicField(this, "__sub");
        __publicField(this, "__needsDidMount", false);
        /** Snapshot of the registry's streaming flags taken at render time —
         *  builders read it off the RenderCtx (this) to pick placeholder vs
         *  render-nothing for unresolved values. */
        __publicField(this, "__streamingNow", false);
        __publicField(this, "__htmlStreamingNow", false);
        /** When a construct throws, remember the (class, registry.ver, props)
         *  triple so render-time reconcile doesn't re-attempt it on every parent
         *  re-render. A registry bump (new class, template, external module
         *  resolving via bumpAll) changes `ver` and breaks the memo so an
         *  env-dependent constructor can self-heal. */
        __publicField(this, "__failedLogic", null);
        __publicField(this, "__failedUserProps", null);
        __publicField(this, "__failedVer", -1);
        /** Per-instance constructor error — kept here (not on the registry entry)
         *  so one instance's successful construct can't hide a sibling's failure,
         *  and a construct can never wipe an eval error `updateJs` recorded on
         *  `r.logicError`. */
        __publicField(this, "__ctorError", null);
        __publicField(this, "logic");
        this.__name = props.__name;
        this.state = { __v: 0, __err: null };
        this.__sub = () => {
          if (this.state.__err) this.setState({ __err: null });
          this.forceUpdate();
        };
        this.__makeLogic(registry.get(this.__name).Logic, null);
        ensureFetched(this.__name);
      }
      /** Error-boundary hook: a render crash anywhere in this DC's subtree
       *  (its own template, an x-import'd component, a child DC without its
       *  own deeper boundary) lands here instead of unmounting the page. */
      static getDerivedStateFromError(e) {
        return { __err: e instanceof Error && e.message ? e.message : String(e) };
      }
      componentDidCatch(e, info) {
        console.error(
          "[dc-runtime] render error in <" + this.__name + ">:",
          e,
          info?.componentStack || ""
        );
      }
      /** Instantiate the logic class (or the no-op base) and adopt `prevState`
       *  over its initial state — used both at mount and on hot-swap. */
      __makeLogic(Logic, prevState) {
        const L = Logic || StreamableLogic;
        try {
          this.logic = new L(this.__userProps());
          this.__failedLogic = null;
          this.__failedUserProps = null;
          this.__ctorError = null;
        } catch (e) {
          console.error(e);
          this.__failedLogic = Logic;
          this.__failedUserProps = this.__userProps();
          this.__failedVer = registry.get(this.__name).ver;
          this.__ctorError = this.__name + ": " + (e instanceof Error && e.message ? e.message : String(e));
          this.logic = new StreamableLogic(
            this.__userProps()
          );
        }
        this.logic.__host = this;
        if (prevState)
          this.logic.state = { ...this.logic.state || {}, ...prevState };
      }
      /** The props the author's logic + template see — internal __-prefixed
       *  wiring stripped. */
      __userProps() {
        const { __name, __hintSize, __tplId, __hostStyle, ...rest } = this.props;
        return rest;
      }
      __setLogicState(update, cb) {
        const prev = this.logic.state;
        const patch = typeof update === "function" ? update(prev) : update;
        this.logic.state = { ...prev, ...patch };
        this.setState((s) => ({ __v: s.__v + 1 }), cb);
      }
      /** Swap the logic instance when the registry's Logic class changed
       *  (streaming completion, hot reload). State carries over; didMount
       *  re-fires after the swap commits so refs exist. */
      __reconcileLogic() {
        const r = registry.get(this.__name);
        const Next = r.Logic;
        const Cur = this.logic.constructor;
        if (Next === Cur || !Next && Cur === StreamableLogic || Next === this.__failedLogic && r.ver === this.__failedVer && shallowEqual(this.__userProps(), this.__failedUserProps)) {
          return;
        }
        if (!this.__needsDidMount) {
          try {
            this.logic.componentWillUnmount();
          } catch (e) {
            console.error(e);
          }
        }
        this.__makeLogic(Next, this.logic.state);
        this.__needsDidMount = true;
      }
      componentDidMount() {
        registry.get(this.__name).subs.add(this.__sub);
        try {
          this.logic.componentDidMount();
        } catch (e) {
          console.error(e);
        }
      }
      componentDidUpdate(prevProps) {
        this.logic.props = this.__userProps();
        if (this.__needsDidMount) {
          if (this.state.__err || !registry.get(this.__name).tpl) return;
          this.__needsDidMount = false;
          try {
            this.logic.componentDidMount();
          } catch (e) {
            console.error(e);
          }
        } else {
          try {
            this.logic.componentDidUpdate(prevProps);
          } catch (e) {
            console.error(e);
          }
        }
      }
      componentWillUnmount() {
        registry.get(this.__name).subs.delete(this.__sub);
        if (!this.__needsDidMount) {
          try {
            this.logic.componentWillUnmount();
          } catch (e) {
            console.error(e);
          }
        }
      }
      render() {
        const r = registry.get(this.__name);
        const cls = "sc-host" + (r.htmlStreaming ? " sc-streaming-html" : "") + (r.jsStreaming ? " sc-streaming-js" : "");
        const hintStyle = r.htmlStreaming ? hintToMin(this.props.__hintSize) : void 0;
        const hostStyle = this.props.__hostStyle || hintStyle ? { ...hintStyle || {}, ...this.props.__hostStyle || {} } : void 0;
        const hostBase = {
          className: cls,
          style: hostStyle,
          "data-sc-name": this.__name,
          "data-dc-tpl": this.props.__tplId
        };
        const chain = Array.isArray(this.context) ? this.context : [];
        if (chain.includes(this.__name)) {
          const cycle = [
            ...chain.slice(chain.indexOf(this.__name)),
            this.__name
          ].join(" \u2192 ");
          return h(
            "div",
            { ...hostBase, className: cls + " sc-has-error" },
            h(Placeholder, {
              name: this.__name,
              hintSize: this.props.__hintSize,
              error: "circular import: " + cycle
            })
          );
        }
        if (this.state.__err) {
          return h(
            "div",
            { ...hostBase, className: cls + " sc-has-error" },
            h(
              "div",
              { className: "sc-logic-error", "data-omelette-chrome": "" },
              this.__name + ": " + this.state.__err
            ),
            h(Placeholder, {
              name: this.__name,
              hintSize: this.props.__hintSize,
              error: this.state.__err
            })
          );
        }
        this.__reconcileLogic();
        if (!r.tpl) {
          return h(
            "div",
            hostBase,
            h(Placeholder, { name: this.__name, hintSize: this.props.__hintSize })
          );
        }
        const userProps = this.__userProps();
        this.logic.props = userProps;
        let vals = userProps;
        let renderErr = r.logicError || this.__ctorError;
        try {
          vals = { ...userProps, ...this.logic.renderVals() || {} };
        } catch (e) {
          console.error(e);
          renderErr = this.__name + ".renderVals(): " + (e instanceof Error && e.message ? e.message : String(e));
        }
        this.__streamingNow = !!(r.htmlStreaming || r.jsStreaming);
        this.__htmlStreamingNow = !!r.htmlStreaming;
        return h(
          "div",
          { ...hostBase, className: cls + (renderErr ? " sc-has-error" : "") },
          renderErr && h(
            "div",
            { className: "sc-logic-error", "data-omelette-chrome": "" },
            renderErr
          ),
          h(
            AncestorContext.Provider,
            { value: [...chain, this.__name] },
            r.tpl(vals, this)
          )
        );
      }
    }
    __publicField(StreamableComponent, "contextType", AncestorContext);
    const named = /* @__PURE__ */ new Map();
    function getDC(name) {
      const hit = named.get(name);
      if (hit) return hit;
      function Dispatcher(p) {
        const [, setTick] = React.useState(0);
        React.useEffect(() => {
          const sub = () => setTick((n) => n + 1);
          registry.get(name).subs.add(sub);
          return () => {
            registry.get(name).subs.delete(sub);
          };
        }, []);
        ensureFetched(name);
        return h(StreamableComponent, { ...p, __name: name });
      }
      Dispatcher.displayName = name;
      named.set(name, Dispatcher);
      return Dispatcher;
    }
    return {
      getDC,
      StreamableComponent
    };
  }

  // src/external.ts
  var isCustomElementName = (n) => !n.includes(".") && n.includes("-");
  function isRenderableType(g) {
    if (typeof g === "function") return !isElementClass(g);
    return typeof g === "object" && g !== null && typeof g.$$typeof === "symbol";
  }
  function resolveDottedPath(root, name) {
    let cur = root;
    for (const seg of name.split(".")) {
      if (cur == null) return void 0;
      cur = cur[seg];
    }
    return cur;
  }
  var BABEL_URL = "/assets/vendor/babel.min.js";
  var BABEL_SRI = "sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y";
  var GLOBAL_POLL_INTERVAL_MS = 50;
  var GLOBAL_POLL_TIMEOUT_MS = 3e4;
  function createExternalModules(onResolved) {
    const cache = /* @__PURE__ */ new Map();
    let babelLoading = null;
    const reportedMissing = /* @__PURE__ */ new Map();
    const polling = /* @__PURE__ */ new Set();
    function ensureBabel() {
      if (window.Babel) return Promise.resolve();
      if (babelLoading) return babelLoading;
      babelLoading = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = BABEL_URL;
        s.integrity = BABEL_SRI;
        s.crossOrigin = "anonymous";
        s.onload = () => res();
        s.onerror = rej;
        document.head.appendChild(s);
      });
      return babelLoading;
    }
    const pending = /* @__PURE__ */ new Map();
    function load(kind, url, after) {
      const existing = pending.get(url);
      if (existing) return existing;
      cache.set(url, null);
      console.info("[dc-runtime] x-import: loading", url, "(" + kind + ")");
      const ready = Promise.all([
        kind === "jsx" ? ensureBabel() : Promise.resolve(),
        after ?? Promise.resolve()
      ]);
      const p = ready.then(() => fetch(url)).then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }).then((src) => {
        const code = kind === "jsx" ? window.Babel.transform(src, {
          filename: url,
          presets: ["react", "typescript"]
        }).code : src;
        const module = { exports: {} };
        const before = new Set(Object.keys(window));
        //! nosemgrep: eval-and-function-constructor
        new Function("React", "module", "exports", "require", code)(
          getReact(),
          module,
          module.exports,
          () => ({})
        );
        const globals = {};
        for (const k of Object.keys(window)) {
          if (!before.has(k) && typeof window[k] === "function") {
            globals[k] = window[k];
          }
        }
        cache.set(url, { mod: module.exports, globals });
        console.info(
          "[dc-runtime] x-import: loaded",
          url,
          "\u2014 exports:",
          Object.keys(module.exports),
          "window globals:",
          Object.keys(globals)
        );
        onResolved();
      }).catch((e) => {
        cache.set(url, {
          mod: {},
          globals: {},
          error: "failed to load: " + (e instanceof Error && e.message ? e.message : String(e))
        });
        console.error(
          "[dc-runtime] x-import: FAILED to load",
          url,
          "(" + kind + ")",
          e
        );
        onResolved();
      });
      pending.set(url, p);
      return p;
    }
    function resolve2(url, name) {
      const entry = cache.get(url);
      if (!entry) return null;
      const { mod, globals } = entry;
      const C = mod && mod[name] || globals && globals[name] || typeof window !== "undefined" && window[name] || mod && mod.default;
      if (typeof C === "function") return C;
      const key = url + "\0" + name;
      if (!reportedMissing.has(key)) {
        reportedMissing.set(
          key,
          entry.error || 'no export named "' + name + '" (has: ' + Object.keys(mod).join(", ") + ")"
        );
        console.error(
          "[dc-runtime] x-import: module",
          url,
          "loaded but has no component named",
          JSON.stringify(name),
          "\u2014 available exports:",
          Object.keys(mod),
          "window globals:",
          Object.keys(globals),
          ". The module must `module.exports = {" + name + "}` or set `window." + name + "`."
        );
      }
      return null;
    }
    function waitForGlobal(name) {
      if (polling.has(name)) return;
      polling.add(name);
      const started = Date.now();
      const isCE = isCustomElementName(name);
      const tick = () => {
        const found = isCE ? customElements.get(name) : isRenderableType(resolveDottedPath(window, name));
        if (found) {
          polling.delete(name);
          onResolved();
          return;
        }
        if (Date.now() - started >= GLOBAL_POLL_TIMEOUT_MS) {
          console.warn(
            "[dc-runtime] x-import: global",
            JSON.stringify(name),
            "never appeared on window after " + GLOBAL_POLL_TIMEOUT_MS + "ms"
          );
          return;
        }
        setTimeout(tick, GLOBAL_POLL_INTERVAL_MS);
      };
      setTimeout(tick, GLOBAL_POLL_INTERVAL_MS);
    }
    function resolveGlobal(url, name) {
      const isCE = isCustomElementName(name);
      if (!url) {
        if (isCE) {
          if (customElements.get(name)) return name;
          waitForGlobal(name);
          return null;
        }
        const g2 = resolveDottedPath(window, name);
        if (isRenderableType(g2)) return g2;
        waitForGlobal(name);
        return null;
      }
      const entry = cache.get(url);
      if (!entry) return null;
      if (isCE && customElements.get(name)) return name;
      const g = entry.globals[name] ?? resolveDottedPath(window, name);
      if (isRenderableType(g)) return g;
      if (name.includes(".")) return null;
      const key = url + "\0global\0" + name;
      if (!reportedMissing.has(key)) {
        reportedMissing.set(key, null);
        if (isCE && !customElements.get(name)) {
          console.warn(
            "[dc-runtime] x-import:",
            url,
            "loaded but no custom element",
            JSON.stringify(name),
            "is registered and window." + name + " is not a function \u2014 rendering <" + name + "> as an unknown element."
          );
        }
      }
      return name;
    }
    function getError(url, name) {
      const entry = cache.get(url);
      if (entry?.error) return entry.error;
      return reportedMissing.get(url + "\0" + name) || null;
    }
    return { load, resolve: resolve2, resolveGlobal, getError };
  }
  function isElementClass(g) {
    try {
      return typeof g === "function" && typeof HTMLElement !== "undefined" && g.prototype instanceof HTMLElement;
    } catch {
      return false;
    }
  }

  // src/atomics.ts
  var ATOMIC_CSS = (
    // layout
    ".fx{display:flex}.col{display:flex;flex-direction:column}.grid{display:grid}.ac{align-items:center}.jc{justify-content:center}.jb{justify-content:space-between}.f1{flex:1}.noshrink{flex-shrink:0}.wrap{flex-wrap:wrap}.fw5{font-weight:500}.fw6{font-weight:600}.fw7{font-weight:700}.fw8{font-weight:800}.fs11{font-size:11px}.fs12{font-size:12px}.fs13{font-size:13px}.fs14{font-size:14px}.fs15{font-size:15px}.fs16{font-size:16px}.fs20{font-size:20px}.fs22{font-size:22px}.upper{text-transform:uppercase}.tc{text-align:center}.nowrap{white-space:nowrap}.gap8{gap:8px}.gap10{gap:10px}.gap12{gap:12px}.gap16{gap:16px}.gap24{gap:24px}.m0{margin:0}.mt8{margin-top:8px}.mt12{margin-top:12px}.mt16{margin-top:16px}.mb8{margin-bottom:8px}.mb12{margin-bottom:12px}.mb16{margin-bottom:16px}.posrel{position:relative}.posabs{position:absolute}.round{border-radius:50%}.ohide{overflow:hidden}.bbox{box-sizing:border-box}.pointer{cursor:pointer}.w100{width:100%}.b0{border:none}"
  );

  // src/helmet.ts
  var DESIGN_DOC_MODE_RE = /<meta\b[^>]*\bname\s*=\s*["']design_doc_mode["'][^>]*\b(?:content|value)\s*=\s*["'](\w+)["']/i;
  var CANVAS_BG_LIGHT = "#f0eee6";
  var CANVAS_BG_DARK = "#2e2c26";
  function createHelmetManager(doc, isStreaming) {
    const mounted = /* @__PURE__ */ new Set();
    const live = /* @__PURE__ */ new Map();
    let designDocMode = null;
    let canvasStyleEl = null;
    let appTheme = "light";
    try {
      const ds = doc.documentElement.dataset.theme;
      appTheme = ds === "dark" || ds === "light" ? ds : new URLSearchParams(doc.defaultView?.location.search ?? "").get(
        "theme"
      ) === "dark" ? "dark" : "light";
    } catch {
    }
    function applyCanvasBg() {
      if (!canvasStyleEl) return;
      const bg = appTheme === "dark" ? CANVAS_BG_DARK : CANVAS_BG_LIGHT;
      canvasStyleEl.textContent = `html,body{background:${bg}}#dc-root>.sc-host{position:relative}`;
    }
    function postDesignMode(mode) {
      if (window.parent === window) return;
      try {
        window.parent.postMessage({ type: "__dc_design_mode", mode }, "*");
      } catch {
      }
    }
    function setDesignDocMode(mode) {
      if (mode === designDocMode) return;
      designDocMode = mode;
      postDesignMode(mode);
      if (mode === "canvas") {
        doc.documentElement.setAttribute("data-dc-canvas", "");
        canvasStyleEl = doc.createElement("style");
        canvasStyleEl.setAttribute("data-dc-canvas", "");
        applyCanvasBg();
        doc.head.appendChild(canvasStyleEl);
      } else {
        doc.documentElement.removeAttribute("data-dc-canvas");
        canvasStyleEl?.remove();
        canvasStyleEl = null;
      }
    }
    window.addEventListener("message", (e) => {
      const type = e.data && e.data.type;
      if (type === "__dc_theme") {
        const t = e.data.theme;
        if (t === "light" || t === "dark") {
          appTheme = t;
          doc.documentElement.dataset.theme = t;
          applyCanvasBg();
        }
        return;
      }
      if (!designDocMode || type !== "__dc_probe") return;
      postDesignMode(designDocMode);
    });
    function compile(node) {
      const raw = [...node.children];
      const helmetClosed = node.nextSibling != null || node.parentNode?.nextSibling != null;
      if (node.hasAttribute("data-dc-atomics") && !mounted.has("__dc-atomics")) {
        mounted.add("__dc-atomics");
        const el = doc.createElement("style");
        el.id = "__dc-atomics";
        el.textContent = ATOMIC_CSS;
        doc.head.appendChild(el);
      }
      return (_vals, ctx) => {
        const name = ctx && ctx.__name || "";
        const streaming = !!(name && isStreaming(name));
        for (let i = 0; i < raw.length; i++) {
          const child = raw[i];
          const tag = child.tagName;
          const mayBePartial = streaming && !helmetClosed && i === raw.length - 1;
          if (tag === "SCRIPT") {
            if (mayBePartial) continue;
            const key = "SCRIPT|" + (child.getAttribute("src") || child.textContent || "");
            if (mounted.has(key)) continue;
            mounted.add(key);
            const el = doc.createElement("script");
            for (const { name: an, value } of [...child.attributes])
              el.setAttribute(an, value);
            if (child.textContent) el.textContent = child.textContent;
            doc.head.appendChild(el);
          } else if (tag === "LINK" || tag === "META") {
            if (mayBePartial) continue;
            const key = tag + "|" + (child.getAttribute("href") || child.getAttribute("src") || child.outerHTML);
            if (mounted.has(key)) continue;
            mounted.add(key);
            doc.head.appendChild(child.cloneNode(true));
          } else {
            const key = name + "|" + i;
            let el = live.get(key);
            if (!el || el.tagName !== tag) {
              if (el) el.remove();
              el = doc.createElement(tag.toLowerCase());
              live.set(key, el);
              doc.head.appendChild(el);
            }
            for (const { name: an, value } of [...child.attributes]) {
              if (el.getAttribute(an) !== value) el.setAttribute(an, value);
            }
            if (el.textContent !== child.textContent)
              el.textContent = child.textContent;
          }
        }
        return null;
      };
    }
    return { compile, setDesignDocMode };
  }

  // src/pseudo.ts
  function createPseudoSheet(doc) {
    let el = null;
    const cache = /* @__PURE__ */ new Map();
    let n = 0;
    return (pseudo, css) => {
      const k = pseudo + "|" + css;
      const hit = cache.get(k);
      if (hit) return hit;
      if (!el) {
        el = doc.createElement("style");
        doc.head.appendChild(el);
      }
      const cls = "scp" + (n++).toString(36);
      const sel = pseudo === "before" || pseudo === "after" ? "." + cls + "::" + pseudo : "." + cls + ":" + pseudo;
      el.sheet.insertRule(sel + "{" + css + "}", el.sheet.cssRules.length);
      cache.set(k, cls);
      return cls;
    };
  }

  // src/registry.ts
  function createRegistry() {
    const entries = /* @__PURE__ */ Object.create(null);
    function get(name) {
      return entries[name] || (entries[name] = {
        html: "",
        tpl: null,
        Logic: null,
        jsStreaming: false,
        htmlStreaming: false,
        ver: 0,
        subs: /* @__PURE__ */ new Set(),
        fetched: false
      });
    }
    function bump(name) {
      const r = get(name);
      r.ver++;
      for (const fn of r.subs) fn();
    }
    return {
      entries,
      get,
      bump,
      bumpAll() {
        for (const n in entries) bump(n);
      }
    };
  }

  // src/runtime.ts
  var COMPONENT_DIR = ".";
  function createRuntime(doc = document) {
    const registry = createRegistry();
    const pseudoClass = createPseudoSheet(doc);
    const helmet = createHelmetManager(
      doc,
      (name) => registry.get(name).htmlStreaming
    );
    const external = createExternalModules(() => registry.bumpAll());
    const factory = createComponentFactory(registry, ensureFetched);
    const host = {
      component: (name) => factory.getDC(name),
      placeholder: (props) => h(Placeholder, props),
      helmet: (node) => helmet.compile(node),
      loadExternal: (kind, url, after) => external.load(kind, url, after),
      resolveExternal: (url, name) => external.resolve(url, name),
      resolveExternalGlobal: (url, name) => external.resolveGlobal(url, name),
      resolveExternalError: (url, name) => external.getError(url, name),
      pseudoClass
    };
    function ensureFetched(name) {
      const r = registry.get(name);
      if (r.fetched) return;
      r.fetched = true;
      const url = COMPONENT_DIR + "/" + encodeURIComponent(name) + ".dc.html";
      fetch(url).then((res) => {
        if (!res.ok) {
          console.error(
            "[dc-runtime] sibling fetch for <" + name + "/> failed:",
            url,
            "returned",
            res.status,
            "\u2014 the reference renders as an empty placeholder."
          );
          return "";
        }
        return res.text();
      }).then((t) => {
        if (!t) return;
        const parsed = parseDcText(t);
        if (!parsed) {
          console.error(
            "[dc-runtime] sibling fetch for <" + name + "/>:",
            url,
            "has no <x-dc> block \u2014 not a Design Component."
          );
          return;
        }
        if (parsed.props) r.propsMeta = parsed.props;
        if (parsed.preview) r.preview = parsed.preview;
        if (parsed.template && !r.html) updateHtml(name, parsed.template);
        if (parsed.js && !r.Logic) updateJs(name, parsed.js);
      }).catch(
        (e) => console.error(
          "[dc-runtime] sibling fetch for <" + name + "/> threw:",
          url,
          e
        )
      );
    }
    let rootName = null;
    function updateHtml(name, html) {
      const r = registry.get(name);
      r.html = html;
      if (name === rootName) {
        const mode = DESIGN_DOC_MODE_RE.exec(html)?.[1] ?? null;
        if (mode || !r.htmlStreaming) helmet.setDesignDocMode(mode);
      }
      try {
        r.tpl = compileTemplate(html, host);
      } catch (e) {
        console.error("[dc-runtime] template compile FAILED for", name, e);
      }
      registry.bump(name);
    }
    function updateJs(name, src) {
      const r = registry.get(name);
      const seq = r.jsSeq = (r.jsSeq || 0) + 1;
      try {
        const Cls = evalDcLogic(src);
        if (r.jsSeq !== seq) return;
        if (typeof Cls !== "function") {
          r.logicError = name + ".dc.html: <script data-dc-script> must define `class Component extends DCLogic`";
        } else {
          r.logicError = null;
          r.Logic = Cls;
        }
      } catch (e) {
        if (r.jsSeq !== seq) return;
        console.error(
          "[dc-runtime] logic class eval FAILED for",
          name,
          "\u2014 the template renders with props only.",
          e
        );
        r.logicError = name + ": " + (e instanceof Error && e.message ? e.message : String(e));
      }
      registry.bump(name);
    }
    function setStreaming(name, kind, on) {
      const r = registry.get(name);
      if (kind === "html") r.htmlStreaming = !!on;
      else r.jsStreaming = !!on;
      let any = false;
      for (const n in registry.entries) {
        const e = registry.entries[n];
        if (e && (e.htmlStreaming || e.jsStreaming)) {
          any = true;
          break;
        }
      }
      doc.documentElement.classList.toggle("sc-dc-streaming", any);
      registry.bump(name);
    }
    function dcUpdate(name, kind, content, streaming) {
      if (streaming) registry.get(name).fetched = true;
      if (kind === "html") {
        setStreaming(name, "html", !!streaming);
        updateHtml(name, content);
      } else if (kind === "js") {
        setStreaming(name, "js", !!streaming);
        if (!streaming) updateJs(name, content);
      } else if (kind === "props") {
        const { props, preview } = parseDataProps(content);
        const r = registry.get(name);
        r.propsMeta = props ?? void 0;
        r.preview = preview;
        registry.bump(name);
      }
    }
    function setProps(name, overrides) {
      registry.get(name).propOverrides = overrides && typeof overrides === "object" ? { ...overrides } : null;
      registry.bump(name);
    }
    function adoptParsed(name, parsed) {
      if (!parsed) return;
      const r = registry.get(name);
      if (parsed.props) r.propsMeta = parsed.props;
      if (parsed.preview) r.preview = parsed.preview;
      if (parsed.template) updateHtml(name, parsed.template);
      if (parsed.js) updateJs(name, parsed.js);
    }
    return {
      registry,
      getDC: factory.getDC,
      updateHtml,
      updateJs,
      dcUpdate,
      setProps,
      adoptParsed,
      setRootName: (name) => {
        rootName = name;
      },
      markFetched: (name) => {
        registry.get(name).fetched = true;
      },
      annotatedTemplate: (name) => {
        const r = registry.get(name);
        return r.tpl && r.tpl.__annotated || null;
      },
      templateSource: (name) => registry.get(name).html || null,
      StreamableLogic
    };
  }

  // src/index.ts
  var REACT_URL = "/assets/vendor/react.production.min.js";
  var REACT_SRI = "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z";
  var REACT_DOM_URL = "/assets/vendor/react-dom.production.min.js";
  var REACT_DOM_SRI = "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1";
  function hideRawTemplate() {
    const s = document.createElement("style");
    s.textContent = "x-dc{display:none!important}";
    document.head.appendChild(s);
  }
  function loadScript(src, integrity) {
    return new Promise((resolve2, reject) => {
      //! nosemgrep: create-script-element
      const s = document.createElement("script");
      s.src = src;
      s.integrity = integrity;
      s.crossOrigin = "anonymous";
      s.async = false;
      s.onload = () => resolve2();
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(s);
    });
  }
  function loadReactUmd() {
    const w = window;
    if (w.React && w.ReactDOM) return Promise.resolve();
    return Promise.all([
      loadScript(REACT_URL, REACT_SRI),
      loadScript(REACT_DOM_URL, REACT_DOM_SRI)
    ]).then(() => void 0);
  }
  function init() {
    const runtime = createRuntime(document);
    let rootName = "Root";
    const baseCss = document.createElement("style");
    baseCss.textContent = BASE_CSS;
    document.head.prepend(baseCss);
    const notifyHost = () => {
      if (window.parent === window) return;
      const r = runtime.registry.entries[rootName];
      try {
        window.parent.postMessage(
          {
            type: "__dc_booted",
            rootName,
            propsMeta: r && r.propsMeta || null,
            preview: r && r.preview || null
          },
          "*"
        );
      } catch {
      }
    };
    const api = {
      __dcUpdate: (name, kind, content, streaming) => {
        runtime.dcUpdate(name, kind, content, streaming);
        if (name === rootName && !streaming && kind === "props") notifyHost();
      },
      __dcSetProps: (name, overrides) => runtime.setProps(name, overrides),
      /** Name of the component currently mounted as the page root — DC tools
       *  push their template-stream here when targeting "the open page". */
      __dcRootName: () => rootName,
      /** Editor bridge — the encoded, `data-dc-tpl`-annotated template source.
       *  The host editor parses this into its own template DOM so it can map a
       *  rendered node (carrying the same `data-dc-tpl`) back to the source
       *  node that emitted it. Returns the encoded form (`<sc-comp>`,
       *  `sc-camel-*` attrs); the editor decodes on serialize. */
      __dcAnnotatedTemplate: (name) => runtime.annotatedTemplate(name),
      /** Editor bridge — the *original* (decoded) template source. */
      __dcTemplateSource: (name) => runtime.templateSource(name),
      __dcBoot: () => {
        rootName = boot(runtime, document) ?? rootName;
        notifyHost();
      },
      __dcRegistry: runtime.registry.entries,
      getDC: (name) => runtime.getDC(name),
      // `DCLogic` is the documented base class name; `StreamableLogic` is the
      // implementation alias kept for any project that already references it.
      DCLogic: runtime.StreamableLogic,
      StreamableLogic: runtime.StreamableLogic
    };
    Object.assign(window, api);
    window.__dcContentKeyed = true;
    if (document.readyState !== "loading") api.__dcBoot();
    else document.addEventListener("DOMContentLoaded", () => api.__dcBoot());
  }
  hideRawTemplate();
  loadReactUmd().then(init).catch((err) => {
    console.error("[dc] failed to load React or boot:", err);
    throw err;
  });
})();

/* === ACG: cableado de formularios publicos (newsletter, contacto, propuesta) === */
(function () {
  var CATS = ['Urbanismo y vivienda', 'Movilidad y transporte', 'Medio ambiente', 'Cultura y fiestas', 'Educación', 'Sanidad', 'Servicios sociales', 'Seguridad ciudadana', 'Economía local', 'Deportes', 'Turismo', 'Otro'];
  var BARR = ['Toda la ciudad', 'Centro', 'Playa-Grao', 'Beniopa', 'Benipeixcar', 'Santa Anna', 'Corea', 'Marchuquera', 'Otro barrio'];
  function lang() { try { return localStorage.getItem('acg_lang') === 'va' ? 'va' : 'es'; } catch (e) { return 'es'; } }
  function T(es, va) { return lang() === 'va' ? va : es; }
  function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function val(root, f) { var el = root.querySelector('[data-f="' + f + '"]'); return el ? String(el.value || '').trim() : ''; }
  function msgIn(form, text, ok) {
    var m = form.querySelector('.acg-form-msg');
    if (!m) { m = document.createElement('div'); m.className = 'acg-form-msg'; form.appendChild(m); }
    m.style.cssText = 'display:block;padding:12px 16px;border-radius:3px;font:600 14px Public Sans;' +
      (ok ? 'background:#E7F4EC;color:#1F7A43;border:1.5px solid #BFE3CC' : 'background:#FDECEC;color:#B3261E;border:1.5px solid #F2C7C4');
    m.textContent = text;
    if (m.scrollIntoView) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function busy(btn, on) {
    if (!btn) return;
    if (on) { btn.__h = btn.innerHTML; btn.disabled = true; btn.style.opacity = '.6'; btn.textContent = T('Enviando…', 'Enviant…'); }
    else { btn.disabled = false; btn.style.opacity = ''; if (btn.__h) btn.innerHTML = btn.__h; }
  }
  function post(url, body, token) {
    var h = { 'content-type': 'application/json' };
    if (token) h.authorization = 'Bearer ' + token;
    return fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  }
  function serverMsg(res, fallback) {
    return (res && res.d && res.d.error && res.d.error.message) ? res.d.error.message : fallback;
  }

  /* --- Newsletter (footer de todas las paginas) --- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.acg-nl-btn') : null;
    if (!btn) return;
    e.preventDefault();
    var row = btn.parentElement;
    var inp = row.querySelector('.acg-nl-in') || row.querySelector('input');
    var m = row.parentElement.querySelector('.acg-nl-msg');
    if (!m) { m = document.createElement('div'); m.className = 'acg-nl-msg'; row.insertAdjacentElement('afterend', m); }
    function fb(text, ok) { m.style.cssText = 'margin:-8px 0 12px;font:600 13px Public Sans;color:' + (ok ? '#7BD89B' : '#FFB3AD'); m.textContent = text; }
    var email = String(inp && inp.value || '').trim();
    if (!emailOk(email)) { fb(T('Escribe un correo válido', 'Escriu un correu vàlid'), false); return; }
    busy(btn, true);
    post('/api/newsletter', { email: email, lang: lang() })
      .then(function (r) {
        busy(btn, false);
        if (r.ok) { if (inp) inp.value = ''; fb(T('¡Hecho! Revisa tu correo y confirma la suscripción.', 'Fet! Revisa el teu correu i confirma la subscripció.'), true); }
        else fb(serverMsg(r, T('No se pudo procesar. Prueba más tarde.', 'No s’ha pogut processar. Prova més tard.')), false);
      })
      .catch(function () { busy(btn, false); fb(T('Sin conexión. Prueba más tarde.', 'Sense connexió. Prova més tard.'), false); });
  });

  /* --- Contacto --- */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.id !== 'acg-form-contacto') return;
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    var priv = form.querySelector('#privacy-check');
    var nombre = val(form, 'nombre'), apellidos = val(form, 'apellidos'), email = val(form, 'email'), mensaje = val(form, 'mensaje');
    var sel = form.querySelector('[data-f="asunto"]');
    var asunto = sel && sel.selectedIndex > -1 ? sel.options[sel.selectedIndex].text : '';
    if (nombre.length < 2) return msgIn(form, T('Escribe tu nombre (mínimo 2 letras).', 'Escriu el teu nom (mínim 2 lletres).'), false);
    if (!emailOk(email)) return msgIn(form, T('Escribe un correo válido.', 'Escriu un correu vàlid.'), false);
    if (mensaje.length < 10) return msgIn(form, T('El mensaje debe tener al menos 10 caracteres.', 'El missatge ha de tindre almenys 10 caràcters.'), false);
    if (priv && !priv.checked) return msgIn(form, T('Debes aceptar la política de privacidad.', 'Has d’acceptar la política de privacitat.'), false);
    busy(btn, true);
    post('/api/contacto', { nombre: nombre, apellidos: apellidos, email: email, asunto: asunto, mensaje: mensaje, hp: val(form, 'hp') })
      .then(function (r) {
        busy(btn, false);
        if (r.ok) {
          form.querySelectorAll('input[data-f],textarea[data-f]').forEach(function (el) { el.value = ''; });
          if (priv) priv.checked = false;
          msgIn(form, T('¡Mensaje enviado! Te responderemos en 24-48 h laborables.', 'Missatge enviat! Et respondrem en 24-48 h laborables.'), true);
        } else msgIn(form, serverMsg(r, T('No se pudo enviar. Prueba más tarde.', 'No s’ha pogut enviar. Prova més tard.')), false);
      })
      .catch(function () { busy(btn, false); msgIn(form, T('Sin conexión. Prueba más tarde.', 'Sense connexió. Prova més tard.'), false); });
  }, true);

  /* --- Crear propuesta: la gestiona /assets/acg-forms.js (con imágenes). Aquí se DESACTIVA
     este handler para no enviar el POST dos veces (causaba la propuesta duplicada). --- */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.id !== 'acg-form-propuesta') return;
    return; // duplicado desactivado: el envío lo hace acg-forms.js
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    var titulo = val(form, 'titulo'), desc = val(form, 'descripcion'), nombre = val(form, 'nombre'), email = val(form, 'email');
    var selC = form.querySelector('[data-f="categoria"]'), selB = form.querySelector('[data-f="barrio"]');
    var priv = form.querySelector('#priv-check'), anon = form.querySelector('#anon-check');
    var token = ''; try { token = localStorage.getItem('acg_session') || ''; } catch (err) {}
    if (!token) { msgIn(form, T('Debes iniciar sesión para enviar una propuesta. Ve a "Mi cuenta" y vuelve.', 'Has d’iniciar sessió per enviar una proposta. Vés a "El meu compte" i torna.'), false); return; }
    if (titulo.length < 5) return msgIn(form, T('El título debe tener al menos 5 caracteres.', 'El títol ha de tindre almenys 5 caràcters.'), false);
    if (desc.length < 30) return msgIn(form, T('Describe tu propuesta con al menos 30 caracteres.', 'Descriu la teua proposta amb almenys 30 caràcters.'), false);
    if (!selC || selC.selectedIndex < 1) return msgIn(form, T('Selecciona una categoría.', 'Selecciona una categoria.'), false);
    if (priv && !priv.checked) return msgIn(form, T('Debes aceptar la política de privacidad.', 'Has d’acceptar la política de privacitat.'), false);
    var categoria = CATS[selC.selectedIndex - 1] || 'Otro';
    var barrio = selB ? (BARR[selB.selectedIndex] || 'Toda la ciudad') : 'Toda la ciudad';
    busy(btn, true);
    post('/api/propuesta', { titulo: titulo, descripcion: desc, categoria: categoria, barrio: barrio, nombre: nombre, email: email, anonimo: !!(anon && anon.checked), hp: val(form, 'hp') }, token)
      .then(function (r) {
        busy(btn, false);
        if (r.ok) {
          form.querySelectorAll('input[data-f],textarea[data-f]').forEach(function (el) { el.value = ''; });
          if (priv) priv.checked = false;
          if (anon) anon.checked = false;
          if (selC) selC.selectedIndex = 0;
          msgIn(form, T('¡Propuesta enviada! Pasará a revisión del equipo antes de publicarse.', 'Proposta enviada! Passarà a revisió de l’equip abans de publicar-se.'), true);
        } else if (r.status === 401) {
          msgIn(form, T('Tu sesión ha caducado. Inicia sesión de nuevo en "Mi cuenta".', 'La teua sessió ha caducat. Inicia sessió de nou a "El meu compte".'), false);
        } else msgIn(form, serverMsg(r, T('No se pudo enviar. Prueba más tarde.', 'No s’ha pogut enviar. Prova més tard.')), false);
      })
      .catch(function () { busy(btn, false); msgIn(form, T('Sin conexión. Prueba más tarde.', 'Sense connexió. Prova més tard.'), false); });
  }, true);
})();

/* === ACG: buscador global real (sobre APIs publicas) === */
(function () {
  function lang() { try { return localStorage.getItem('acg_lang') === 'va' ? 'va' : 'es'; } catch (e) { return 'es'; } }
  function T(es, va) { return lang() === 'va' ? va : es; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  var TYPES = [
    { ep: '/api/proposals', label: ['Propuesta', 'Proposta'], color: '#1563C4', bg: '#EAF3FC',
      url: function (it) { return '/propuesta-ciudadana?id=' + encodeURIComponent(it.id); } },
    { ep: '/api/posts', label: ['Noticia', 'Notícia'], color: '#9A6208', bg: '#FBF0DC',
      url: function (it) { return it.href || '/actualidad'; } },
    { ep: '/api/events', label: ['Evento', 'Esdeveniment'], color: '#2E9E5B', bg: '#E7F4EC',
      url: function (it) { return it.href || '/agenda'; } },
    { ep: '/api/campaigns', label: ['Campaña', 'Campanya'], color: '#B3261E', bg: '#FDECEC',
      url: function (it) { return it.href || '/campanas'; } },
    { ep: '/api/actuaciones', label: ['Actuación', 'Actuació'], color: '#5C6B7A', bg: '#F0F4F9',
      url: function (it) { return it.href || '/mapa-actuaciones'; } }
  ];

  function itemText(it) {
    return norm([it.title, it.titulo, it.excerpt, it.desc, it.descripcion, it.cat, it.barrio].filter(Boolean).join(' '));
  }
  function itemTitle(it) { return it.title || it.titulo || ''; }
  function itemSub(it) { return it.excerpt || it.desc || it.descripcion || it.date || it.fecha || ''; }

  function ensureBox(anchor) {
    var box = document.getElementById('acg-srch-results');
    if (!box) {
      box = document.createElement('div');
      box.id = 'acg-srch-results';
      box.style.cssText = 'max-width:1080px;margin:26px auto 10px;padding:0 20px';
      anchor.insertAdjacentElement('afterend', box);
    }
    return box;
  }

  function render(box, q, groups, searching) {
    if (searching) {
      box.innerHTML = '<div style="text-align:center;color:#5C6B7A;font:600 15px Public Sans;padding:18px">' + T('Buscando…', 'Cercant…') + '</div>';
      return;
    }
    var total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    var h = '<div style="font:700 15px Public Sans;color:#0A2A5E;margin:4px 0 14px">' +
      (total ? (total + ' ' + T('resultados para', 'resultats per a') + ' “' + q + '”')
             : T('Sin resultados para', 'Sense resultats per a') + ' “' + q + '”. ' + T('Prueba con otra palabra.', 'Prova amb una altra paraula.')) + '</div>';
    groups.forEach(function (g) {
      if (!g.items.length) return;
      g.items.slice(0, 6).forEach(function (it) {
        h += '<a href="' + g.t.url(it) + '" style="display:block;background:#fff;border:1.5px solid #E9EEF4;border-radius:3px;padding:14px 18px;margin-bottom:10px;text-decoration:none" ' +
          'onmouseover="this.style.borderColor=\'#CFDDEC\'" onmouseout="this.style.borderColor=\'#E9EEF4\'">' +
          '<span style="display:inline-block;font:700 11px Public Sans;letter-spacing:.08em;text-transform:uppercase;color:' + g.t.color + ';background:' + g.t.bg + ';padding:3px 9px;border-radius:3px;margin-bottom:6px">' + (lang() === 'va' ? g.t.label[1] : g.t.label[0]) + '</span>' +
          '<div style="font:700 15.5px Public Sans;color:#0A2A5E">' + itemTitle(it) + '</div>' +
          (itemSub(it) ? '<div style="font:400 13.5px Public Sans;color:#5C6B7A;margin-top:3px">' + String(itemSub(it)).slice(0, 140) + '</div>' : '') +
          '</a>';
      });
    });
    box.innerHTML = h;
  }

  function doSearch() {
    var inp = document.querySelector('.acg-srch-in');
    if (!inp) return;
    var q = String(inp.value || '').trim();
    var hero = inp.closest('div[style*="border-radius"]') || inp.parentElement.parentElement;
    // ancla: el contenedor grande del hero (subir hasta seccion)
    var anchor = inp;
    for (var i = 0; i < 6 && anchor.parentElement; i++) {
      anchor = anchor.parentElement;
      if ((anchor.getAttribute('style') || '').indexOf('background') > -1 && anchor.offsetWidth > 600) break;
    }
    var box = ensureBox(anchor);
    if (q.length < 2) { box.innerHTML = '<div style="text-align:center;color:#5C6B7A;font:600 14px Public Sans;padding:10px">' + T('Escribe al menos 2 letras.', 'Escriu almenys 2 lletres.') + '</div>'; return; }
    render(box, q, [], true);
    var nq = norm(q);
    Promise.all(TYPES.map(function (t) {
      return fetch(t.ep + '?lang=' + lang()).then(function (r) { return r.ok ? r.json() : { items: [] }; }).catch(function () { return { items: [] }; });
    })).then(function (results) {
      var groups = results.map(function (d, i) {
        var items = (d.items || []).filter(function (it) { return itemText(it).indexOf(nq) > -1; });
        return { t: TYPES[i], items: items };
      });
      render(box, q, groups, false);
    });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.acg-srch-btn')) { e.preventDefault(); doSearch(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('acg-srch-in')) { e.preventDefault(); doSearch(); }
  });
})();

/* === ACG: imágenes con fundido — nunca se ve el icono de "imagen rota" mientras cargan === */
(function () {
  var LOADED = {};
  function fix(img) {
    if (img.getAttribute('data-acg-img')) return;
    img.setAttribute('data-acg-img', '1');
    var src = img.currentSrc || img.src || '';
    if ((img.complete && img.naturalWidth) || LOADED[src]) { img.style.opacity = '1'; return; }  // ya cargada/cacheada: sin fundido
    img.style.opacity = '0';
    img.style.transition = 'opacity .35s ease';
    img.addEventListener('load', function () { LOADED[img.currentSrc || img.src || ''] = 1; img.style.opacity = '1'; });
    img.addEventListener('error', function () { img.style.opacity = '0'; });                      // rota: no mostrar icono
  }
  function scanAll() { var im = document.querySelectorAll('img'); for (var i = 0; i < im.length; i++) fix(im[i]); }
  scanAll();
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var a = muts[i].addedNodes;
        for (var k = 0; k < a.length; k++) {
          var nd = a[k]; if (!nd || nd.nodeType !== 1) continue;
          if (nd.tagName === 'IMG') fix(nd);
          else if (nd.querySelectorAll) { var im2 = nd.querySelectorAll('img'); for (var j = 0; j < im2.length; j++) fix(im2[j]); }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();

// Recuperación de contraseña: Supabase redirige a la raíz con #access_token…&type=recovery.
// Este bloque captura ese hash y muestra el formulario para fijar la nueva contraseña.
(function () {
  var h = location.hash || '';
  if (h.indexOf('access_token') === -1 && h.indexOf('error_description') === -1) return;
  var p = {};
  h.replace(/^#/, '').split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > -1) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
  });
  var VA = (localStorage.getItem('acg_lang') || 'es') === 'va';
  function T(es, va) { return VA ? va : es; }
  var SUPA = 'https://msbrdowdkwqrrdlfeztj.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zYnJkb3dka3dxcnJkbGZlenRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NDc5NTAsImV4cCI6MjA5OTAyMzk1MH0.ByomcWyS0YiQHg8KjdYvx32vxwa1ilGZOE-1aD0TRR0';

  function overlay(inner) {
    var ov = document.createElement('div');
    ov.id = 'acg-recovery';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,42,94,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML = '<div style="background:#fff;border-radius:3px;max-width:400px;width:100%;padding:28px 26px;font-family:Public Sans,Arial,sans-serif;box-shadow:0 24px 60px rgba(10,42,94,.35)">' + inner + '</div>';
    document.body.appendChild(ov);
    return ov;
  }

  function arrancar() {
    if (!p.access_token) {
      var msg = p.error_description || T('El enlace no es válido o ha caducado.', 'L’enllaç no és vàlid o ha caducat.');
      var ov0 = overlay(
        '<h3 style="margin:0 0 10px;color:#0A2A5E;font-size:19px">' + T('Enlace caducado', 'Enllaç caducat') + '</h3>' +
        '<p style="margin:0 0 18px;color:#33414F;font-size:14.5px;line-height:1.6">' + msg + ' ' + T('Vuelve a pedir el correo de recuperación.', 'Torna a demanar el correu de recuperació.') + '</p>' +
        '<button id="acg-rec-cerrar" style="background:#0A2A5E;color:#fff;border:0;border-radius:3px;padding:11px 20px;font-weight:700;cursor:pointer;width:100%">' + T('Entendido', 'Entés') + '</button>');
      ov0.querySelector('#acg-rec-cerrar').onclick = function () { ov0.remove(); };
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    if (p.type !== 'recovery') {
      // Confirmación de cuenta o enlace mágico: guardar sesión y avisar.
      try {
        localStorage.setItem('acg_session', p.access_token);
        if (p.refresh_token) localStorage.setItem('acg_refresh', p.refresh_token);
      } catch (err) {}
      history.replaceState(null, '', location.pathname + location.search);
      var esAlta = p.type === 'signup' || p.type === 'invite';
      var ov1 = overlay(
        '<h3 style="margin:0 0 10px;color:#0A2A5E;font-size:19px">' + (esAlta ? T('Cuenta confirmada ✓', 'Compte confirmat ✓') : T('Sesión iniciada ✓', 'Sessió iniciada ✓')) + '</h3>' +
        '<p style="margin:0 0 18px;color:#33414F;font-size:14.5px;line-height:1.6">' + (esAlta
          ? T('Tu correo queda verificado y tu sesión iniciada. Ya puedes participar: proponer, votar y comentar.', 'El teu correu queda verificat i la teua sessió iniciada. Ja pots participar: proposar, votar i comentar.')
          : T('Has entrado con tu enlace de acceso.', 'Has entrat amb el teu enllaç d’accés.')) + '</p>' +
        '<div style="display:flex;gap:10px">' +
        '<a href="/cuenta" style="flex:1;background:#1563C4;color:#fff;border-radius:3px;padding:12px 0;font-weight:700;text-align:center;text-decoration:none">' + T('Ir a mi cuenta', 'Anar al meu compte') + '</a>' +
        '<button id="acg-rec-seguir" style="flex:1;background:#EEF2F7;color:#0A2A5E;border:0;border-radius:3px;padding:12px 0;font-weight:700;cursor:pointer">' + T('Seguir aquí', 'Seguir ací') + '</button></div>');
      ov1.querySelector('#acg-rec-seguir').onclick = function () { ov1.remove(); };
      return;
    }
    var ov = overlay(
      '<h3 style="margin:0 0 6px;color:#0A2A5E;font-size:19px">' + T('Nueva contraseña', 'Nova contrasenya') + '</h3>' +
      '<p style="margin:0 0 16px;color:#5C6B7A;font-size:13.5px">' + T('Elige la nueva contraseña de tu cuenta (mínimo 8 caracteres).', 'Tria la nova contrasenya del teu compte (mínim 8 caràcters).') + '</p>' +
      '<input id="acg-rec-p1" type="password" autocomplete="new-password" placeholder="' + T('Nueva contraseña', 'Nova contrasenya') + '" style="width:100%;box-sizing:border-box;border:1.5px solid #D7E0EA;border-radius:3px;padding:12px 14px;font-size:14.5px;margin-bottom:10px">' +
      '<input id="acg-rec-p2" type="password" autocomplete="new-password" placeholder="' + T('Repite la contraseña', 'Repeteix la contrasenya') + '" style="width:100%;box-sizing:border-box;border:1.5px solid #D7E0EA;border-radius:3px;padding:12px 14px;font-size:14.5px;margin-bottom:14px">' +
      '<div id="acg-rec-msg" style="min-height:18px;color:#C0392B;font-size:13px;margin-bottom:8px"></div>' +
      '<button id="acg-rec-ok" style="background:#1563C4;color:#fff;border:0;border-radius:3px;padding:12px 20px;font-weight:700;cursor:pointer;width:100%;font-size:15px">' + T('Guardar contraseña', 'Guardar contrasenya') + '</button>');
    var msgEl = ov.querySelector('#acg-rec-msg');
    ov.querySelector('#acg-rec-ok').onclick = function () {
      var v1 = ov.querySelector('#acg-rec-p1').value, v2 = ov.querySelector('#acg-rec-p2').value;
      if (v1.length < 8) { msgEl.textContent = T('Mínimo 8 caracteres.', 'Mínim 8 caràcters.'); return; }
      if (v1 !== v2) { msgEl.textContent = T('Las contraseñas no coinciden.', 'Les contrasenyes no coincideixen.'); return; }
      var btn = this; btn.disabled = true; btn.style.opacity = '.6'; msgEl.textContent = '';
      fetch(SUPA + '/auth/v1/user', {
        method: 'PUT',
        headers: { apikey: ANON, authorization: 'Bearer ' + p.access_token, 'content-type': 'application/json' },
        body: JSON.stringify({ password: v1 })
      }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); }).then(function (res) {
        if (res.s >= 200 && res.s < 300) {
          try {
            localStorage.setItem('acg_session', p.access_token);
            if (p.refresh_token) localStorage.setItem('acg_refresh', p.refresh_token);
          } catch (err) {}
          history.replaceState(null, '', location.pathname + location.search);
          ov.firstChild.innerHTML = '<h3 style="margin:0 0 10px;color:#0A2A5E;font-size:19px">' + T('Contraseña actualizada ✓', 'Contrasenya actualitzada ✓') + '</h3>' +
            '<p style="margin:0 0 18px;color:#33414F;font-size:14.5px;line-height:1.6">' + T('Ya puedes usar tu nueva contraseña. Tu sesión ha quedado iniciada.', 'Ja pots usar la teua nova contrasenya. La teua sessió ha quedat iniciada.') + '</p>' +
            '<button style="background:#0A2A5E;color:#fff;border:0;border-radius:3px;padding:11px 20px;font-weight:700;cursor:pointer;width:100%" onclick="document.getElementById(\'acg-recovery\').remove()">' + T('Perfecto', 'Perfecte') + '</button>';
        } else {
          btn.disabled = false; btn.style.opacity = '1';
          msgEl.textContent = (res.j && (res.j.msg || res.j.message || res.j.error_description)) || T('No se pudo guardar. Inténtalo de nuevo.', 'No s’ha pogut guardar. Torna-ho a intentar.');
        }
      }).catch(function () {
        btn.disabled = false; btn.style.opacity = '1';
        msgEl.textContent = T('Error de red. Inténtalo de nuevo.', 'Error de xarxa. Torna-ho a intentar.');
      });
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();

// CTAs funcionales: Compartir, Confirmar asistencia y Descargar PDF (antes eran solo estética).
(function () {
  var VA = (function () { try { return (localStorage.getItem('acg_lang') || 'es') === 'va'; } catch (e) { return false; } })();
  function aviso(msg) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0A2A5E;color:#fff;padding:12px 22px;border-radius:3px;font:700 14px Public Sans,sans-serif;z-index:99999;box-shadow:0 10px 30px rgba(10,42,94,.35)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function asistencia(slug) {
    var old = document.getElementById('acg-asist'); if (old) old.remove();
    if (!slug) { var m0 = location.pathname.match(/^\/agenda\/([a-z0-9-]+)/); slug = m0 ? m0[1] : ''; }
    if (!slug) { aviso(VA ? 'Obri l’acte per a inscriure’t' : 'Abre el acto para inscribirte'); return; }
    var titulo = (document.title || '').split('—')[0].trim();
    var ov = document.createElement('div');
    ov.id = 'acg-asist';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,42,94,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML = '<div style="background:#fff;border-radius:3px;max-width:400px;width:100%;padding:26px 24px;font-family:Public Sans,Arial,sans-serif">'
      + '<h3 style="margin:0 0 6px;color:#0A2A5E;font-size:18px">' + (VA ? 'Confirma la teua assistència' : 'Confirma tu asistencia') + '</h3>'
      + '<p style="margin:0 0 14px;color:#5C6B7A;font-size:13.5px">' + (VA ? 'T’apuntem a: ' : 'Te apuntamos a: ') + '<b>' + titulo.replace(/</g, '&lt;') + '</b></p>'
      + '<input id="acg-as-n" placeholder="' + (VA ? 'El teu nom' : 'Tu nombre') + '" style="width:100%;box-sizing:border-box;border:1.5px solid #D7E0EA;border-radius:3px;padding:11px 13px;font-size:14px;margin-bottom:9px">'
      + '<input id="acg-as-e" type="email" placeholder="' + (VA ? 'El teu correu' : 'Tu correo') + '" style="width:100%;box-sizing:border-box;border:1.5px solid #D7E0EA;border-radius:3px;padding:11px 13px;font-size:14px;margin-bottom:12px">'
      + '<div id="acg-as-m" style="min-height:16px;color:#C0392B;font-size:12.5px;margin-bottom:6px"></div>'
      + '<div style="display:flex;gap:10px"><button id="acg-as-ok" style="flex:1;background:#1563C4;color:#fff;border:0;border-radius:3px;padding:12px 0;font-weight:700;cursor:pointer">' + (VA ? 'Confirmar' : 'Confirmar') + '</button>'
      + '<button id="acg-as-no" style="flex:1;background:#EEF2F7;color:#42525F;border:0;border-radius:3px;padding:12px 0;font-weight:700;cursor:pointer">' + (VA ? 'Cancel·lar' : 'Cancelar') + '</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#acg-as-no').onclick = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector('#acg-as-ok').onclick = function () {
      var n = ov.querySelector('#acg-as-n').value.trim(), em = ov.querySelector('#acg-as-e').value.trim();
      var m = ov.querySelector('#acg-as-m');
      if (n.length < 2) { m.textContent = VA ? 'Escriu el teu nom' : 'Escribe tu nombre'; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { m.textContent = VA ? 'Correu no vàlid' : 'Correo no válido'; return; }
      var btn = this; btn.disabled = true;
      var h = { 'content-type': 'application/json' };
      try { var tk = localStorage.getItem('acg_session'); if (tk) h.authorization = 'Bearer ' + tk; } catch (e2) {}
      fetch('/api/inscripcion', {
        method: 'POST', headers: h,
        body: JSON.stringify({ eventSlug: slug, nombre: n, email: em, lang: VA ? 'va' : 'es' })
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        if (r.j && r.j.ok) { ov.remove(); aviso(VA ? 'Inscripció feta. T’hem enviat la confirmació per correu ✓' : 'Inscripción hecha. Te hemos enviado la confirmación por correo ✓'); }
        else if (r.j && r.j.error && r.j.error.code === 'no_inscribible') { ov.remove(); aviso(VA ? 'Este acte és informatiu: vine directament, sense inscripció' : 'Este acto es informativo: ven directamente, sin inscripción'); }
        else { btn.disabled = false; m.textContent = (r.j && r.j.error && r.j.error.message) || (VA ? 'No s’ha pogut enviar' : 'No se pudo enviar'); }
      }).catch(function () { btn.disabled = false; m.textContent = 'Error'; });
    };
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('button,a');
    if (!el) return;
    var t = (el.textContent || '').trim().toLowerCase();
    var alb = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase();
    if (t === 'compartir' || t === 'compartir en redes' || t === 'compartir en xarxes' || alb.indexOf('compartir') === 0) {
      e.preventDefault();
      if (navigator.share) navigator.share({ title: document.title, url: location.href }).catch(function () {});
      else { try { navigator.clipboard.writeText(location.href); aviso(VA ? 'Enllaç copiat ✓' : 'Enlace copiado ✓'); } catch (err) {} }
      return;
    }
    if (t === 'confirmar asistencia' || t === 'confirmar assistència') { e.preventDefault(); asistencia(el.getAttribute('data-slug') || ''); return; }
    if (el.hasAttribute && el.hasAttribute('data-slug') && el.getAttribute('data-slug')) {
      var sl = el.getAttribute('data-slug');
      if (t.indexOf('inscri') === 0) { e.preventDefault(); asistencia(sl); return; }
      if (t.indexOf('más informaci') === 0 || t.indexOf('més informaci') === 0) { e.preventDefault(); location.href = '/agenda/' + sl; return; }
    }
    if (t.indexOf('descargar pdf') === 0 || t.indexOf('descarregar pdf') === 0 || t.indexOf('descargar programa') === 0 || t.indexOf('descarregar programa') === 0) {
      e.preventDefault(); window.open('/programa-electoral?print=1', '_blank'); return;
    }
  }, true);
  // Llegada con ?print=1: abrir el diálogo de imprimir/guardar como PDF cuando cargue el contenido.
  if (/[?&]print=1/.test(location.search)) setTimeout(function () { window.print(); }, 1800);
})();

// Analítica propia: página vista + clicks a redes sociales (sid pseudónimo, sin cookies de terceros).
(function () {
  if (location.pathname.indexOf('/admin') === 0) return;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  var sid = '';
  try {
    sid = localStorage.getItem('acg_sid') || '';
    if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('acg_sid', sid); }
  } catch (err) {}
  function hit(t, extra) {
    var data = { t: t, p: location.pathname, sid: sid, l: (function () { try { return localStorage.getItem('acg_lang') || 'es'; } catch (e) { return 'es'; } })(), r: document.referrer || '' };
    if (extra) for (var k in extra) data[k] = extra[k];
    try {
      var body = JSON.stringify(data);
      if (navigator.sendBeacon) navigator.sendBeacon('/api/hit', body);
      else fetch('/api/hit', { method: 'POST', body: body, keepalive: true });
    } catch (err) {}
  }
  // Red social de ORIGEN de la visita (referrer o utm_source/fbclid/igshid)
  var REDIN = [['facebook.', 'facebook'], ['fb.me', 'facebook'], ['instagram.', 'instagram'], ['l.instagram', 'instagram'], ['tiktok.', 'tiktok'], ['youtube.', 'youtube'], ['youtu.be', 'youtube'], ['twitter.', 'x'], ['t.co/', 'x'], ['x.com', 'x'], ['whatsapp.', 'whatsapp'], ['wa.me', 'whatsapp'], ['t.me', 'telegram'], ['telegram.', 'telegram'], ['linkedin.', 'linkedin']];
  function redEntrante() {
    try {
      var q = location.search || '';
      var m = q.match(/[?&]utm_source=([^&]+)/i);
      if (m) {
        var u = decodeURIComponent(m[1]).toLowerCase();
        for (var i = 0; i < REDIN.length; i++) if (u.indexOf(REDIN[i][1]) === 0 || u.indexOf(REDIN[i][0]) > -1) return REDIN[i][1];
        return u.slice(0, 20);
      }
      if (/[?&]fbclid=/.test(q)) return 'facebook';
      if (/[?&]igshid=/.test(q)) return 'instagram';
      var r = (document.referrer || '').toLowerCase();
      if (r) for (var j = 0; j < REDIN.length; j++) if (r.indexOf(REDIN[j][0]) > -1) return REDIN[j][1];
    } catch (er) {}
    return '';
  }
  var rin = redEntrante();
  hit('pv', rin ? { red: rin } : null);
  var REDES = [['facebook.com', 'facebook'], ['instagram.com', 'instagram'], ['twitter.com', 'x'], ['x.com', 'x'], ['youtube.com', 'youtube'], ['tiktok.com', 'tiktok'], ['t.me', 'telegram'], ['wa.me', 'whatsapp'], ['whatsapp.com', 'whatsapp'], ['linkedin.com', 'linkedin']];
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.href || '';
    for (var i = 0; i < REDES.length; i++) {
      if (href.indexOf(REDES[i][0]) > -1) { hit('social', { red: REDES[i][1] }); break; }
    }
  }, true);
})();

// Volver atras restaura la posicion de scroll (el runtime pinta tarde y el navegador no puede solo).
(function () {
  var KEY = 'acg_scroll_' + location.pathname + location.search;
  var t;
  window.addEventListener('scroll', function () {
    clearTimeout(t);
    t = setTimeout(function () { try { sessionStorage.setItem(KEY, String(window.scrollY || 0)); } catch (e) {} }, 120);
  }, { passive: true });
  var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  if (nav.type === 'back_forward') {
    var y = 0; try { y = Number(sessionStorage.getItem(KEY) || 0); } catch (e) {}
    if (y > 0) {
      var n = 0;
      var iv = setInterval(function () {
        window.scrollTo(0, y);
        if (Math.abs((window.scrollY || 0) - y) < 4 || ++n > 25) clearInterval(iv);
      }, 200);
    }
  }
})();

/* anti-FOUC: cache-first para datos remotos */
;(function(){
  // Antes servía la última versión cacheada al instante (podía verse "vieja" 1 frame antes de la fresca).
  // Ahora NO se usa caché en el arranque: cada página muestra ESQUELETO gris hasta que llega lo real/fresco.
  window.__cfGet=function(){ return null; };
  // Purga cualquier caché de contenido antigua (acg_c_*) que un build viejo pudiera repintar.
  try{ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf('acg_c_')===0) localStorage.removeItem(k); } }catch(e){}
})();
