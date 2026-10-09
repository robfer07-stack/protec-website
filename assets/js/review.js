/* ==========================================================================
   ProTec Dental Laboratory — review.js  (PREVIEW-ONLY review / feedback tool)

   Lets the owner point at any part of a page, write what should change, and
   keep those notes as a list in this browser. Nothing is sent anywhere:
   no GitHub issue, no bot, no server. Copy and Download stay on this computer.

   When it runs (otherwise this file does nothing at all):
     • the site is on *.github.io (the GitHub Pages preview), or
     • the URL contains ?review=1 (this also remembers the choice in
       localStorage, so it stays on while you click between pages).
     • ?review=0 switches it off again (also on github.io).
   On the live HostGator domain it stays invisible unless someone adds
   ?review=1 — and you can delete this file + its <script> tag at go-live.

   How it works:
     1. "Review" button (bottom-right) → pick mode. Hover (or Tab / arrow
        keys) to highlight an element; click / tap / Enter selects it.
        Esc or the "Cancel" button leaves pick mode.
     2. A panel asks "What should change?" + optional priority. Notes are
        kept in localStorage (survive refresh, shared across pages and
        versions) and shown as numbered pins on the page.
     3. "Notes" opens the full list. Each note shows its page, version,
        section or element, comment, priority, and date. Edit, delete, or
        mark done. Click a note on the current page to jump to its element.
     4. "Copy list" puts Markdown on the clipboard. "Download" saves a .md
        file in the browser. Neither uploads anything.

   All UI lives inside a Shadow DOM so the site's CSS can't affect it (and it
   can't affect the site). No dependencies. No network calls.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     0. Config + activation check
     --------------------------------------------------------------------- */
  var CONFIG = {
    snippetLength: 120,
    storageKey: "protecReview.comments.v1",
    flagKey: "protecReview.enabled",
    brand: "#f04725"
  };

  // localStorage can throw (Safari private mode, blocked storage) — wrap it.
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function isActive() {
    var param = null;
    try { param = new URLSearchParams(window.location.search).get("review"); } catch (e) { /* old browser */ }
    if (param === "1" || param === "true" || param === "on") { store.set(CONFIG.flagKey, "1"); return true; }
    if (param === "0" || param === "false" || param === "off") { store.set(CONFIG.flagKey, "0"); return false; }
    var flag = store.get(CONFIG.flagKey);
    if (flag === "1") return true;
    if (flag === "0") return false;
    return /(^|\.)github\.io$/i.test(window.location.hostname);
  }

  if (!isActive()) return;
  if (window.__protecReviewLoaded) return; // never initialise twice
  window.__protecReviewLoaded = true;


  /* ---------------------------------------------------------------------
     1. State
     --------------------------------------------------------------------- */
  var host, root;            // shadow host + shadow root
  var els = {};              // references to UI nodes
  var comments = [];         // [{id, url, path, selector, tag, label, snippet, section, comment, priority, viewport, created, updated, done, doneAt}]
  var picking = false;       // pick mode on?
  var candidate = null;      // element currently highlighted in pick mode
  var draft = null;          // comment being created/edited in the form
  var repick = null;         // {id, comment, priority} when re-picking the element of an existing/unsaved comment
  var spotlight = null;      // element briefly highlighted after clicking a note
  var spotlightId = null;    // id of the note being highlighted
  var spotlightTimer = null;
  var rafPending = false;

  var PRIORITIES = [
    { value: "nice", label: "Nice to have" },
    { value: "important", label: "Important" },
    { value: "must", label: "Must fix" }
  ];

  function load() {
    try {
      var data = JSON.parse(store.get(CONFIG.storageKey) || "[]");
      comments = Array.isArray(data) ? data : [];
    } catch (e) { comments = []; }
  }
  function save() { store.set(CONFIG.storageKey, JSON.stringify(comments)); }

  // Re-sync if comments change in another tab (e.g. two preview pages open).
  window.addEventListener("storage", function (e) {
    if (e.key === CONFIG.storageKey) { load(); renderAll(); }
  });

  /* ---------------------------------------------------------------------
     2. Small helpers
     --------------------------------------------------------------------- */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v; // only ever used with static markup
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }

  function cleanText(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function truncate(s, n) { s = cleanText(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function isOurs(node) {
    // true if an event/node belongs to the review UI (inside our shadow host)
    return !!node && (node === host || (host && host.contains(node)));
  }
  function eventIsOurs(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    return path.indexOf(host) !== -1;
  }

  function pageLabel(path) {
    // "/protec-website/services.html" -> "services.html", "/" -> "index.html"
    var last = String(path || "").split("/").pop();
    return last || "index.html";
  }

  // Design comparison: /v2/ and /v3/ are alternate versions; everything else is Version 1.
  function siteVersion(path) {
    var p = "/" + String(path || "");
    if (/\/v3(\/|$)/.test(p)) return "3";
    if (/\/v2(\/|$)/.test(p)) return "2";
    return "1";
  }

  function priorityLabel(v) {
    for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].value === v) return PRIORITIES[i].label;
    return "";
  }

  function viewportInfo() {
    var w = window.innerWidth, hgt = window.innerHeight;
    var kind = w < 600 ? "mobile" : w < 921 ? "tablet" : "desktop";
    var dpr = window.devicePixelRatio || 1;
    return w + "×" + hgt + " (" + kind + (dpr !== 1 ? ", @" + (Math.round(dpr * 100) / 100) + "x" : "") + ")";
  }

  function timestamp() {
    // Local time with offset, e.g. "2026-10-08 22:41 (UTC+11:00, Australia/Sydney)"
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    off = Math.abs(off);
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* ignore */ }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes()) +
      " (UTC" + sign + pad(Math.floor(off / 60)) + ":" + pad(off % 60) + (tz ? ", " + tz : "") + ")";
  }

  /* ---------------------------------------------------------------------
     3. Describing an element: selector, snippet, label, section
     --------------------------------------------------------------------- */
  // Classes that only reflect state/animation — useless in a selector.
  var IGNORE_CLASS = /^(is-|has-|js-|reveal$|active$|open$|visible$)/;

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function isUnique(sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  }

  // One step of a selector path: tag + first meaningful class + :nth-of-type when needed.
  function segment(el) {
    var tag = el.tagName.toLowerCase();
    var seg = tag;
    var cls = Array.prototype.filter.call(el.classList || [], function (c) { return !IGNORE_CLASS.test(c); })[0];
    if (cls) seg += "." + cssEscape(cls);
    var parent = el.parentElement;
    if (parent) {
      var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
      if (same.length > 1) seg += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
    }
    return seg;
  }

  // Shortest unique selector: an id if there is one, else a short path anchored
  // on the nearest ancestor with an id (or <body>).
  function buildSelector(el) {
    if (el.id && isUnique("#" + cssEscape(el.id))) return "#" + cssEscape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node !== el && node.id && isUnique("#" + cssEscape(node.id))) {
        parts.unshift("#" + cssEscape(node.id));
        break;
      }
      if (node === document.body) { parts.unshift("body"); break; }
      parts.unshift(segment(node));
      // Stop early as soon as the path is unique (keeps selectors short).
      var sel = parts.join(" > ");
      if (parts.length >= 2 && isUnique(sel)) return sel;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function findBySelector(sel) {
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  // Visible text for an element (alt text for images, etc.)
  function snippetOf(el) {
    var tag = el.tagName.toLowerCase();
    var text = "";
    if (tag === "img") text = el.getAttribute("alt") || el.getAttribute("src");
    else if (tag === "input" || tag === "textarea" || tag === "select") {
      var lab = el.id && document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      text = (lab ? lab.textContent + " — " : "") + (el.getAttribute("placeholder") || el.value || el.name || "");
    } else if (tag === "svg") text = el.getAttribute("aria-label") || (el.closest("a,button") ? el.closest("a,button").getAttribute("aria-label") : "") || "(icon)";
    else text = el.innerText || el.textContent || el.getAttribute("aria-label") || "";
    return truncate(text, CONFIG.snippetLength) || "(no text)";
  }

  // Short human label for highlight tag: "h2.section-title"
  function shortLabel(el) {
    var tag = el.tagName.toLowerCase();
    var cls = Array.prototype.filter.call(el.classList || [], function (c) { return !IGNORE_CLASS.test(c); })[0];
    return tag + (el.id ? "#" + el.id : cls ? "." + cls : "");
  }

  // Nearest heading that gives context, e.g. which section the element is in.
  function sectionOf(el) {
    if (el.closest(".site-header")) return "Site header / menu";
    if (el.closest(".topbar")) return "Top bar";
    if (el.closest(".site-footer")) return "Footer";
    var sec = el.closest("section, header, footer, nav, aside, article, main");
    if (!sec) return "";
    var tag = sec.tagName.toLowerCase();
    var hd = sec.querySelector("h1, h2, h3");
    return hd ? truncate(hd.textContent, 60) : (sec.id ? "#" + sec.id : tag);
  }

  // Map the raw event target to something sensible to select.
  function normaliseTarget(el) {
    if (!el || el.nodeType !== 1) return null;
    var svg = el.closest && el.closest("svg");
    if (svg) el = svg;                      // never select a lone <path>
    // Treat links and buttons as one unit (e.g. tapping the hamburger lines or a
    // link's icon selects the whole button/link, which is what people mean).
    var control = el.closest && el.closest("a[href], button, summary, label");
    if (control && control !== el) el = control;
    if (el === document.documentElement || el === document.body) return null;
    if (isOurs(el)) return null;
    return el;
  }

  /* ---------------------------------------------------------------------
     4. Build the UI (inside a shadow root)
     --------------------------------------------------------------------- */
  var CSS_TEXT = [
    ":host{all:initial}",
    "*,*::before,*::after{box-sizing:border-box}",
    ".ui{--b:" + CONFIG.brand + ";--b6:#d93b1b;--ink:#12161d;--muted:#5d6673;--line:#e3e7ec;font:14px/1.45 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}",
    "button,textarea,input{font:inherit;color:inherit}",
    "[hidden]{display:none!important}",
    ".sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}",
    ":focus-visible{outline:3px solid #2563eb;outline-offset:2px}",

    /* floating buttons */
    ".fab-wrap{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));z-index:2147483000;display:flex;gap:8px;align-items:center;pointer-events:none}",
    ".fab-wrap>*{pointer-events:auto}",
    ".fab{display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 16px;border-radius:999px;border:0;cursor:pointer;font-weight:700;font-size:14px;letter-spacing:.01em;background:var(--b);color:#fff;box-shadow:0 8px 24px -8px rgba(240,71,37,.7),0 2px 6px rgba(18,22,29,.18);transition:transform .15s,background .15s}",
    ".fab:hover{background:var(--b6);transform:translateY(-1px)}",
    ".fab svg{width:18px;height:18px;flex:none}",
    ".fab--ghost{background:#fff;color:var(--ink);box-shadow:0 6px 18px -6px rgba(18,22,29,.35),0 0 0 1px var(--line)}",
    ".fab--ghost:hover{background:#f5f7f9}",
    ".count{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--b);color:#fff;font-size:12px;font-weight:700}",
    ".fab[aria-pressed='true']{background:var(--ink)}",

    /* pick-mode bar */
    ".bar{position:fixed;left:50%;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 58px);transform:translateX(-50%);z-index:2147483001;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 20px);padding:8px 8px 8px 16px;border-radius:999px;background:var(--ink);color:#fff;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);font-weight:500}",
    ".bar b{color:#ffb4a3;font-weight:700}",
    ".bar kbd{font:600 12px/1 ui-monospace,monospace;padding:3px 6px;border-radius:5px;background:rgba(255,255,255,.14)}",
    ".bar button{min-height:34px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;cursor:pointer;font-weight:600}",
    ".bar button:hover{background:#fff;color:var(--ink)}",
    // On phones the bar replaces the floating buttons while picking (it has its own Cancel).
    "@media (max-width:600px){.fab--ghost .fab-text{display:none}.fab--ghost{padding:0 12px}.bar .kbd-hint{display:none}.bar{font-size:13px;left:10px;right:10px;transform:none;bottom:max(10px,env(safe-area-inset-bottom));border-radius:14px}.picking .fab-wrap{display:none}}",

    /* highlight */
    ".hl{position:fixed;z-index:2147482990;pointer-events:none;border:2px solid var(--b);background:rgba(240,71,37,.08);border-radius:4px;transition:all .06s linear}",
    ".hl-label{position:fixed;z-index:2147482991;pointer-events:none;max-width:min(80vw,420px);padding:3px 8px;border-radius:5px;background:var(--b);color:#fff;font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 10px -4px rgba(0,0,0,.4)}",
    ".hl-label span{opacity:.8;font-weight:400}",
    ".hl--selected{border-style:solid;background:rgba(240,71,37,.12)}",

    /* pins */
    ".pin-box{position:fixed;z-index:2147482980;pointer-events:none;border:2px dashed rgba(240,71,37,.7);border-radius:4px}",
    ".pin{position:fixed;z-index:2147482985;display:grid;place-items:center;width:22px;height:22px;margin:0;padding:0;border-radius:50% 50% 50% 4px;border:2px solid #fff;background:var(--b);color:#fff;font:700 11px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 10px -3px rgba(0,0,0,.45)}",
    ".pin:hover,.pin.is-current{background:var(--ink);transform:scale(1.08)}",
    ".picking .pin{pointer-events:none;opacity:.55}",

    /* panel */
    ".panel{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:calc(max(14px,env(safe-area-inset-bottom)) + 56px);z-index:2147483002;width:min(420px,calc(100vw - 28px));max-height:min(640px,calc(100vh - 100px));display:flex;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 30px 60px -20px rgba(18,22,29,.45),0 0 0 1px rgba(18,22,29,.08);overflow:hidden}",
    "@media (max-width:600px){.panel{left:0;right:0;bottom:0;width:100%;max-height:72vh;border-radius:16px 16px 0 0;padding-bottom:env(safe-area-inset-bottom)}}",
    ".p-head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--line);background:#fbfbfc}",
    ".p-head h2{margin:0;font:800 15px/1.2 Manrope,Inter,system-ui,sans-serif;flex:1}",
    ".p-head h2 small{display:block;font:500 12px/1.3 Inter,system-ui,sans-serif;color:var(--muted);margin-top:2px}",
    ".dot{width:10px;height:10px;border-radius:50%;background:var(--b);flex:none}",
    ".icon-btn{display:grid;place-items:center;width:34px;height:34px;border-radius:8px;border:0;background:transparent;cursor:pointer;color:var(--muted)}",
    ".icon-btn:hover{background:#eef0f3;color:var(--ink)}",
    ".icon-btn svg{width:18px;height:18px}",
    ".p-body{padding:14px 16px;overflow:auto;flex:1 1 auto;min-height:0}",
    ".p-head,.p-foot{flex:none}",
    ".el-actions{display:flex;flex-wrap:wrap;gap:4px 16px;margin:-4px 0 12px;font-size:13px}",
    ".p-foot{padding:12px 16px 14px;border-top:1px solid var(--line);background:#fbfbfc}",
    ".btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--b);background:var(--b);color:#fff;font-weight:700;cursor:pointer}",
    ".btn svg{width:16px;height:16px;flex:none}",
    ".btn:hover{background:var(--b6);border-color:var(--b6)}",
    ".btn[disabled]{opacity:.45;cursor:not-allowed}",
    ".btn--ghost{background:#fff;color:var(--ink);border-color:#c9cfd6}",
    ".btn--ghost:hover{background:#f1f3f5;border-color:#aeb6bf}",
    ".btn--block{width:100%}",
    ".btn--sm{min-height:32px;padding:0 10px;font-size:13px;border-radius:8px}",
    ".link-btn{border:0;background:none;padding:2px 0;color:var(--b6);font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px}",
    ".link-btn:hover{color:var(--ink)}",
    ".row{display:flex;gap:8px;flex-wrap:wrap}",
    ".row+.row{margin-top:8px}",
    ".row>.btn{flex:1}",
    ".hint{margin:8px 0 0;font-size:12.5px;color:var(--muted)}",
    ".hint strong{color:var(--ink)}",
    ".empty{margin:4px 0 0;color:var(--muted)}",
    ".empty strong{color:var(--ink)}",

    /* element preview */
    ".el{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:#f5f7f9;border:1px solid var(--line);margin-bottom:12px}",
    ".tag{flex:none;padding:2px 7px;border-radius:6px;background:var(--ink);color:#fff;font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}",
    ".el-text{min-width:0;flex:1}",
    ".el-snip{margin:0;font-weight:600;overflow-wrap:anywhere}",
    ".el-sel{margin:3px 0 0;font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);overflow-wrap:anywhere}",
    "label.lbl,legend.lbl{display:block;font-weight:700;margin:0 0 6px;padding:0}",
    "textarea{display:block;width:100%;min-height:96px;resize:vertical;padding:10px 12px;border-radius:10px;border:1px solid #c9cfd6;background:#fff;line-height:1.45}",
    "textarea:focus{outline:none;border-color:var(--b);box-shadow:0 0 0 3px rgba(240,71,37,.2)}",
    "fieldset{border:0;margin:14px 0 4px;padding:0;min-width:0}",
    ".seg{display:flex;gap:6px;flex-wrap:wrap}",
    ".seg label{position:relative;flex:1;min-width:92px}",
    ".seg input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}",
    ".seg span{display:block;padding:7px 8px;border-radius:9px;border:1px solid #c9cfd6;text-align:center;font-size:13px;font-weight:600;cursor:pointer;user-select:none}",
    ".seg input:checked+span{border-color:var(--b);background:rgba(240,71,37,.1);color:#b4300f}",
    ".seg input[value='must']:checked+span{background:var(--b);color:#fff}",
    ".seg input:focus-visible+span{outline:3px solid #2563eb;outline-offset:2px}",
    ".err{color:#b4300f;font-size:12.5px;margin:6px 0 0}",

    /* list */
    "ol.list{list-style:none;margin:0;padding:0;display:grid;gap:10px}",
    ".item{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#fff}",
    ".item.is-current{border-color:var(--b);box-shadow:0 0 0 3px rgba(240,71,37,.12)}",
    ".item--done{background:#f6f7f8}",
    ".item-main{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;width:100%;margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;border-radius:8px}",
    ".item-main--jump{cursor:pointer}",
    ".item-main--jump:hover .item-text{text-decoration:underline;text-underline-offset:2px}",
    ".num{grid-row:1 / -1;align-self:start;display:grid;place-items:center;width:24px;height:24px;border-radius:50% 50% 50% 4px;background:var(--b);color:#fff;font-weight:700;font-size:12px}",
    ".num.other{background:#aeb6bf}",
    ".num.done{background:#8b939e}",
    ".item-meta{font-size:12px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
    ".item-where,.item-el{font-size:12.5px;overflow-wrap:anywhere}",
    ".item-where{font-weight:700}",
    ".item-el{color:var(--muted)}",
    ".item-text{margin:2px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}",
    ".item--done .item-text{color:var(--muted);text-decoration:line-through}",
    ".item-date{font-size:12px;color:var(--muted)}",
    ".badge{padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;background:#eef0f3;color:var(--ink)}",
    ".badge--important{background:#fff1d6;color:#8a5a00}",
    ".badge--must{background:var(--b);color:#fff}",
    ".badge--done{background:#ecfaf1;color:#146c36}",
    ".item-actions{display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:13px}",
    ".item-actions .link-btn{min-height:32px}",
    "@media (max-width:600px){.item-actions .link-btn{min-height:44px}}",
    ".group{margin:14px 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}",
    ".group:first-child{margin-top:0}",
    ".pin--done{background:#8b939e}",
    "@media (prefers-reduced-motion:reduce){*{transition:none!important}}"
  ].join("\n");

  var ICONS = {
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
  };

  function init() {
    load();

    host = document.createElement("protec-review");
    host.setAttribute("data-protec-review", "");
    root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host; // ancient browsers: no isolation
    var style = document.createElement("style");
    style.textContent = CSS_TEXT;
    root.appendChild(style);

    els.ui = h("div", { class: "ui" });
    root.appendChild(els.ui);

    // Screen-reader announcements
    els.live = h("div", { class: "sr", role: "status", "aria-live": "polite" });

    // Highlight box + label (pick mode / current selection)
    els.hl = h("div", { class: "hl", hidden: true });
    els.hlLabel = h("div", { class: "hl-label", hidden: true, "aria-hidden": "true" });

    // Pins layer
    els.pins = h("div", { class: "pins" });

    // Pick-mode bar
    els.bar = h("div", { class: "bar", hidden: true, role: "region", "aria-label": "Pick mode" }, [
      h("span", { html: "<b>Pick mode</b> — click or tap the part of the page you want changed" }),
      h("span", { class: "kbd-hint", html: "<kbd>Esc</kbd> cancel" }),
      h("button", { type: "button", text: "Cancel", onclick: function () { stopPicking(true); } })
    ]);

    // Floating buttons
    els.listBtn = h("button", {
      class: "fab fab--ghost", type: "button", hidden: true, "aria-haspopup": "dialog", "aria-expanded": "false",
      onclick: function () { if (els.panel.hidden) openPanel("list"); else closePanel(); }
    });
    els.reviewBtn = h("button", {
      class: "fab", type: "button", "aria-pressed": "false",
      title: "Point at part of the page and leave a change request",
      onclick: function () { if (picking) stopPicking(true); else startPicking(); }
    });
    els.reviewBtn.innerHTML = ICONS.pen + "<span>Review</span>";
    els.fabs = h("div", { class: "fab-wrap" }, [els.listBtn, els.reviewBtn]);

    // Panel (dialog, non-modal so the page stays usable)
    els.panelTitle = h("h2", { id: "pr-title" });
    els.panelBody = h("div", { class: "p-body" });
    els.panelFoot = h("div", { class: "p-foot" });
    els.panel = h("div", { class: "panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "pr-title", hidden: true }, [
      h("div", { class: "p-head" }, [
        h("span", { class: "dot", "aria-hidden": "true" }),
        els.panelTitle,
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close review panel", html: ICONS.close, onclick: function () { closePanel(); } })
      ]),
      els.panelBody,
      els.panelFoot
    ]);
    els.panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); closePanel(); }
    });

    [els.pins, els.hl, els.hlLabel, els.bar, els.panel, els.fabs, els.live].forEach(function (n) { els.ui.appendChild(n); });
    document.body.appendChild(host);

    // Keep pins/highlight glued to elements while scrolling/resizing/animating.
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(schedule).observe(document.body);
    window.addEventListener("load", schedule);
    // Reveal-on-scroll animations move elements for ~0.6s; re-measure after.
    document.addEventListener("transitionend", schedule, true);

    renderAll();
  }

  function announce(msg) { els.live.textContent = ""; setTimeout(function () { els.live.textContent = msg; }, 30); }

  /* ---------------------------------------------------------------------
     5. Positioning (highlight + pins)
     --------------------------------------------------------------------- */
  function schedule() {
    if (rafPending) return;
    rafPending = true;
    window.requestAnimationFrame(function () { rafPending = false; positionAll(); });
  }

  function visibleRect(el) {
    if (!el || !el.isConnected) return null;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return r;
  }

  function placeHighlight(el, selected) {
    var r = visibleRect(el);
    if (!r) { els.hl.hidden = true; els.hlLabel.hidden = true; return; }
    els.hl.hidden = false;
    els.hl.classList.toggle("hl--selected", !!selected);
    els.hl.style.left = r.left - 3 + "px";
    els.hl.style.top = r.top - 3 + "px";
    els.hl.style.width = r.width + 6 + "px";
    els.hl.style.height = r.height + 6 + "px";

    els.hlLabel.hidden = false;
    els.hlLabel.innerHTML = "";
    els.hlLabel.appendChild(document.createTextNode(shortLabel(el) + " "));
    els.hlLabel.appendChild(h("span", { text: Math.round(r.width) + "×" + Math.round(r.height) }));
    // Label above the box, or inside the top edge if there's no room.
    var top = r.top - 26;
    if (top < 4) top = Math.max(4, r.top + 4);
    var left = Math.min(Math.max(4, r.left - 3), window.innerWidth - els.hlLabel.offsetWidth - 4);
    els.hlLabel.style.top = top + "px";
    els.hlLabel.style.left = Math.max(4, left) + "px";
  }

  function positionAll() {
    if (!els.ui) return;
    // Highlight: pick-mode candidate, the element being commented on, or a note just opened.
    if (picking && candidate) placeHighlight(candidate, false);
    else if (draft && draft.el) placeHighlight(draft.el, true);
    else if (spotlight) placeHighlight(spotlight, true);
    else { els.hl.hidden = true; els.hlLabel.hidden = true; }

    // Pins
    Array.prototype.forEach.call(els.pins.querySelectorAll("[data-id]"), function (pin) {
      var c = byId(pin.getAttribute("data-id"));
      var el = c && findBySelector(c.selector);
      var r = visibleRect(el);
      var box = els.pins.querySelector('.pin-box[data-for="' + pin.getAttribute("data-id") + '"]');
      if (!r) { pin.hidden = true; if (box) box.hidden = true; return; }
      pin.hidden = false;
      // Centre the pin on the element's top-left corner so it covers as little
      // of the element (e.g. a small button) as possible.
      pin.style.left = Math.min(Math.max(2, r.left - 11), window.innerWidth - 26) + "px";
      pin.style.top = Math.max(2, r.top - 11) + "px";
      if (box) {
        box.hidden = false;
        box.style.left = r.left - 2 + "px"; box.style.top = r.top - 2 + "px";
        box.style.width = r.width + 4 + "px"; box.style.height = r.height + 4 + "px";
      }
    });
  }

  /* ---------------------------------------------------------------------
     6. Pick mode
     --------------------------------------------------------------------- */
  function startPicking() {
    if (picking) return;
    closePanel(true);
    clearSpotlight();
    picking = true;
    els.ui.classList.add("picking");
    els.bar.hidden = false;
    els.reviewBtn.setAttribute("aria-pressed", "true");
    els.reviewBtn.querySelector("span").textContent = "Picking…";
    document.documentElement.style.cursor = "crosshair";

    // Capture-phase listeners on window run before the site's own handlers,
    // so we can stop links/buttons/menus from reacting while picking.
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("click", onPickClick, true);
    window.addEventListener("submit", swallow, true);
    window.addEventListener("keydown", onPickKey, true);
    document.addEventListener("focusin", onPickFocus, true);

    candidate = null;
    announce("Pick mode on. Click or tap the part of the page you want changed. Or use Tab and arrow keys, then Enter. Escape cancels.");
    schedule();
  }

  function stopPicking(cancelled) {
    if (!picking) return;
    picking = false;
    candidate = null;
    els.ui.classList.remove("picking");
    els.bar.hidden = true;
    els.reviewBtn.setAttribute("aria-pressed", "false");
    els.reviewBtn.querySelector("span").textContent = "Review";
    document.documentElement.style.cursor = "";
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("click", onPickClick, true);
    window.removeEventListener("submit", swallow, true);
    window.removeEventListener("keydown", onPickKey, true);
    document.removeEventListener("focusin", onPickFocus, true);
    if (cancelled) {
      announce("Pick mode cancelled.");
      if (repick && repick.id) { var keepId = repick.id; repick = null; editComment(keepId); return; }
      repick = null;
      els.reviewBtn.focus();
    }
    schedule();
  }

  function setCandidate(el) {
    el = normaliseTarget(el);
    if (!el || el === candidate) return;
    candidate = el;
    schedule();
  }

  function onPointerMove(e) {
    if (e.pointerType === "touch") return; // touch has no hover; tap selects
    if (eventIsOurs(e)) return;
    setCandidate(e.target);
  }

  function swallow(e) { if (!eventIsOurs(e)) { e.preventDefault(); e.stopPropagation(); } }

  function onPickClick(e) {
    if (eventIsOurs(e)) return;      // our own buttons keep working
    e.preventDefault();               // don't follow links / submit / toggle menus
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    // Keyboard "click" (Enter on a focused link) has no coordinates — use candidate.
    var el = (e.detail === 0 && candidate) ? candidate : normaliseTarget(e.target);
    if (el) selectElement(el);
  }

  function onPickFocus(e) { if (!isOurs(e.target)) setCandidate(e.target); }

  function onPickKey(e) {
    var k = e.key;
    if (eventIsOurs(e)) {
      if (k === "Escape") { e.preventDefault(); stopPicking(true); return; }
      // Arrow keys while focus is still on our "Review" button: leave the button
      // so the following Enter selects the highlighted element (not the button).
      if (/^Arrow(Up|Down|Left|Right)$/.test(k)) { var a = root.activeElement || document.activeElement; if (a && a.blur) a.blur(); }
      else return;
    }
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); stopPicking(true); return; }
    if (k === "Enter" || k === " ") {
      e.preventDefault(); e.stopPropagation();
      var el = candidate || normaliseTarget(document.activeElement) || document.querySelector("main");
      if (el) selectElement(el);
      return;
    }
    // Arrow keys walk the DOM: ↑ parent, ↓ first child, ←/→ siblings.
    var cur = candidate || normaliseTarget(document.activeElement) || document.querySelector("main") || document.body.firstElementChild;
    var next = null;
    if (k === "ArrowUp") next = cur.parentElement;
    else if (k === "ArrowDown") next = firstVisibleChild(cur);
    else if (k === "ArrowLeft") next = cur.previousElementSibling;
    else if (k === "ArrowRight") next = cur.nextElementSibling;
    else return;
    e.preventDefault(); e.stopPropagation();
    next = normaliseTarget(next) || cur;
    candidate = next;
    if (visibleRect(next)) next.scrollIntoView({ block: "nearest" });
    announce(shortLabel(next) + ": " + snippetOf(next));
    schedule();
  }

  function firstVisibleChild(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (!isOurs(c) && visibleRect(c)) return c;
    }
    return null;
  }

  /* ---------------------------------------------------------------------
     7. Comments: create / edit / delete
     --------------------------------------------------------------------- */
  function byId(id) { for (var i = 0; i < comments.length; i++) if (comments[i].id === id) return comments[i]; return null; }
  function indexOf(id) { for (var i = 0; i < comments.length; i++) if (comments[i].id === id) return i; return -1; }

  function selectElement(el) {
    stopPicking(false);
    clearSpotlight();
    draft = describe(el);
    draft.el = el;
    if (repick) { draft.id = repick.id; draft.comment = repick.comment; draft.priority = repick.priority; repick = null; }
    openPanel("form");
  }

  function describe(el) {
    return {
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      label: shortLabel(el),
      snippet: snippetOf(el),
      section: sectionOf(el)
    };
  }

  function editComment(id) {
    var c = byId(id);
    if (!c) return;
    stopPicking(false);
    clearSpotlight();
    var el = c.path === location.pathname ? findBySelector(c.selector) : null;
    draft = { id: c.id, selector: c.selector, tag: c.tag, label: c.label, snippet: c.snippet, section: c.section, comment: c.comment, priority: c.priority, el: el };
    if (el && visibleRect(el)) el.scrollIntoView({ block: "center", behavior: motion() });
    openPanel("form");
  }

  function saveDraft(text, priority) {
    var now = timestamp();
    if (draft.id) {
      var c = byId(draft.id);
      if (c) {
        c.comment = text; c.priority = priority;
        c.selector = draft.selector; c.tag = draft.tag; c.label = draft.label; c.snippet = draft.snippet; c.section = draft.section;
        c.updated = now;
      }
    } else {
      comments.push({
        id: uid(),
        url: location.origin + location.pathname,
        path: location.pathname,
        selector: draft.selector, tag: draft.tag, label: draft.label, snippet: draft.snippet, section: draft.section,
        comment: text, priority: priority,
        viewport: viewportInfo(),
        created: now
      });
    }
    save();
    draft = null;
    renderAll();
    openPanel("list");
    announce("Note saved. " + comments.length + " note" + (comments.length === 1 ? "" : "s") + " in this browser.");
  }

  function deleteComment(id) {
    var i = indexOf(id);
    if (i === -1) return;
    comments.splice(i, 1);
    save();
    renderAll();
    openPanel("list");
    announce("Note deleted.");
  }

  function toggleDone(id) {
    var c = byId(id);
    if (!c) return;
    var now = timestamp();
    c.done = !c.done;
    c.updated = now;
    if (c.done) c.doneAt = now;
    else c.doneAt = "";
    save();
    renderAll();
    announce(c.done ? "Note marked done." : "Note marked not done.");
  }

  /* ---------------------------------------------------------------------
     8. Rendering
     --------------------------------------------------------------------- */
  function renderAll() {
    if (!els.ui) return;
    // Floating "comments" button
    var n = comments.length;
    els.listBtn.hidden = n === 0;
    els.listBtn.innerHTML = ICONS.list + '<span class="fab-text">Notes</span>';
    els.listBtn.appendChild(h("span", { class: "count", text: String(n) }));
    els.listBtn.setAttribute("aria-label", n + " review note" + (n === 1 ? "" : "s") + " — open list");

    // Pins for comments on THIS page (number = position in the full list)
    els.pins.innerHTML = "";
    comments.forEach(function (c, i) {
      if (c.path !== location.pathname) return;
      els.pins.appendChild(h("div", { class: "pin-box", "data-for": c.id, hidden: true }));
      els.pins.appendChild(h("button", {
        class: "pin" + (c.done ? " pin--done" : "") + ((draft && draft.id === c.id) || spotlightId === c.id ? " is-current" : ""), type: "button", "data-id": c.id, hidden: true,
        "aria-label": "Note " + (i + 1) + (c.done ? ", done" : "") + ": " + truncate(c.comment, 60) + " — edit",
        title: truncate(c.comment, 100), text: String(i + 1),
        onclick: function () { editComment(c.id); }
      }));
    });
    if (!els.panel.hidden) renderPanel(els.panel.getAttribute("data-view"));
    schedule();
  }

  function openPanel(view) {
    els.panel.hidden = false;
    els.panel.setAttribute("data-view", view);
    els.listBtn.setAttribute("aria-expanded", "true");
    renderPanel(view);
    // Move focus into the panel for keyboard / screen-reader users.
    var target = view === "form" ? els.panelBody.querySelector("textarea") : els.panel.querySelector(".p-body button, .p-foot .btn, .icon-btn");
    if (target) target.focus({ preventScroll: true });
    schedule();
  }

  function closePanel(silent) {
    if (els.panel.hidden) return;
    els.panel.hidden = true;
    els.listBtn.setAttribute("aria-expanded", "false");
    draft = null;
    renderAll();
    if (!silent) (els.listBtn.hidden ? els.reviewBtn : els.listBtn).focus();
  }

  function renderPanel(view) {
    var scroll = els.panelBody.scrollTop;
    els.panelBody.innerHTML = "";
    els.panelFoot.innerHTML = "";
    els.panelFoot.hidden = false;
    if (view === "form" && draft) renderForm();
    else renderList();
    if (view !== "form") els.panelBody.scrollTop = scroll;
  }

  function renderForm() {
    var isEdit = !!draft.id;
    var num = isEdit ? indexOf(draft.id) + 1 : comments.length + 1;
    els.panelTitle.innerHTML = "";
    els.panelTitle.appendChild(document.createTextNode((isEdit ? "Edit note " : "New note ") + num));
    els.panelTitle.appendChild(h("small", { text: "Version " + siteVersion(isEdit ? byId(draft.id).path : location.pathname) + " · " + pageLabel(isEdit ? byId(draft.id).path : location.pathname) + (draft.section ? " · " + draft.section : "") }));

    var errEl = h("p", { class: "err", hidden: true, id: "pr-err" });
    var ta = h("textarea", { id: "pr-text", maxlength: "2000", rows: "4", "aria-describedby": "pr-err", placeholder: "e.g. Make this heading bigger, change the wording to …, swap this photo" });
    ta.value = draft.comment || "";

    var seg = h("div", { class: "seg" });
    PRIORITIES.forEach(function (p) {
      var input = h("input", { type: "radio", name: "pr-priority", value: p.value });
      if (draft.priority === p.value) input.checked = true;
      // Clicking a selected priority again clears it (priority is optional).
      input.addEventListener("click", function () {
        if (input.getAttribute("data-was") === "1") { input.checked = false; input.setAttribute("data-was", "0"); }
        else { Array.prototype.forEach.call(seg.querySelectorAll("input"), function (o) { o.setAttribute("data-was", "0"); }); input.setAttribute("data-was", "1"); }
      });
      if (input.checked) input.setAttribute("data-was", "1");
      seg.appendChild(h("label", null, [input, h("span", { text: p.label })]));
    });

    var parentBtn = draft.el && draft.el.parentElement && normaliseTarget(draft.el.parentElement)
      ? h("button", { class: "link-btn", type: "button", text: "Select bigger area", onclick: function () {
          var p = normaliseTarget(draft.el.parentElement);
          if (!p) return;
          var keep = { id: draft.id, comment: ta.value, priority: checkedPriority() };
          draft = describe(p); draft.el = p; draft.id = keep.id; draft.comment = keep.comment; draft.priority = keep.priority;
          renderPanel("form"); schedule();
          els.panelBody.querySelector("textarea").focus();
        } })
      : null;
    var repickBtn = h("button", { class: "link-btn", type: "button", text: "Pick something else", onclick: function () {
      // Keep the text typed so far; the next pick updates this same comment.
      repick = { id: draft.id || null, comment: ta.value, priority: checkedPriority() };
      startPicking();
    } });

    function checkedPriority() {
      var c = seg.querySelector("input:checked");
      return c ? c.value : "";
    }

    var form = h("form", { novalidate: true }, [
      h("div", { class: "el" }, [
        h("span", { class: "tag", text: "<" + draft.tag + ">" }),
        h("div", { class: "el-text" }, [
          h("p", { class: "el-snip", text: "“" + draft.snippet + "”" }),
          h("p", { class: "el-sel", text: draft.selector })
        ])
      ]),
      (isEdit && !draft.el) ? null : h("div", { class: "el-actions" }, [parentBtn, repickBtn]),
      h("label", { class: "lbl", for: "pr-text", text: "What should change?" }),
      ta,
      errEl,
      h("fieldset", null, [h("legend", { class: "lbl", text: "Priority (optional)" }), seg]),
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = cleanMultiline(ta.value);
      if (!text) { errEl.hidden = false; errEl.textContent = "Please describe the change first."; ta.focus(); return; }
      saveDraft(text, checkedPriority());
    });
    // Ctrl/Cmd+Enter saves from the textarea.
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit")); }
    });
    els.panelBody.appendChild(form);

    els.panelFoot.appendChild(h("div", { class: "row" }, [
      h("button", { class: "btn btn--ghost", type: "button", text: "Cancel", onclick: function () {
        draft = null; renderAll(); if (comments.length) openPanel("list"); else closePanel();
      } }),
      h("button", { class: "btn", type: "button", text: isEdit ? "Save changes" : "Add note", onclick: function () {
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
      } })
    ]));
    els.panelFoot.appendChild(h("p", { class: "hint", html: "Tip: <strong>Ctrl/⌘ + Enter</strong> saves. The note stays in this browser. Nothing is sent." }));
  }

  function cleanMultiline(s) { return String(s || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }

  function renderList() {
    var doneCount = comments.filter(function (c) { return c.done; }).length;
    var summary = comments.length
      ? comments.length + " note" + (comments.length === 1 ? "" : "s") + (doneCount ? " · " + doneCount + " done" : "") + " · saved in this browser"
      : "Nothing saved yet";
    els.panelTitle.innerHTML = "";
    els.panelTitle.appendChild(document.createTextNode("Change notes"));
    els.panelTitle.appendChild(h("small", { text: summary }));

    if (!comments.length) {
      els.panelBody.appendChild(h("p", { class: "empty", html: "Press <strong>Add a note</strong>, then click the part of the page you want changed. Notes stay in this browser." }));
    } else {
      // Group by page: this page first, then the others. Every note still carries its own page and version.
      var pages = [];
      comments.forEach(function (c) { if (pages.indexOf(c.path) === -1) pages.push(c.path); });
      pages.sort(function (a, b) { return (b === location.pathname) - (a === location.pathname); });
      pages.forEach(function (path) {
        var here = path === location.pathname;
        els.panelBody.appendChild(h("p", { class: "group", text: "Version " + siteVersion(path) + " · " + pageLabel(path) + (here ? " (this page)" : "") }));
        var ol = h("ol", { class: "list" });
        comments.forEach(function (c, i) {
          if (c.path !== path) return;
          ol.appendChild(renderNote(c, i, here));
        });
        els.panelBody.appendChild(ol);
      });
    }

    var addBtn = h("button", { class: "btn btn--ghost btn--block", type: "button", onclick: function () { startPicking(); } });
    addBtn.innerHTML = ICONS.pen + "<span>Add a note</span>";
    var copyBtn = h("button", {
      class: "btn btn--ghost", type: "button",
      disabled: comments.length ? null : true,
      "aria-label": "Copy the note list to the clipboard"
    });
    copyBtn.innerHTML = ICONS.copy + '<span class="btn-label">Copy list</span>';
    copyBtn.addEventListener("click", function () { copyList(copyBtn); });
    var downloadBtn = h("button", {
      class: "btn btn--ghost", type: "button",
      disabled: comments.length ? null : true,
      "aria-label": "Download the note list as a Markdown file"
    });
    downloadBtn.innerHTML = ICONS.download + "<span>Download</span>";
    downloadBtn.addEventListener("click", function () { downloadList(); });
    els.panelFoot.appendChild(h("div", { class: "row" }, [addBtn]));
    els.panelFoot.appendChild(h("div", { class: "row" }, [copyBtn, downloadBtn]));
    els.panelFoot.appendChild(h("p", { class: "hint", text: "Copy and Download stay on this computer. Nothing is uploaded or sent." }));
  }

  function renderNote(c, i, here) {
    var n = i + 1;
    var where = c.section ? String(c.section) : "";
    var elementLine = "Element: <" + (c.tag || "element") + "> “" + truncate(c.snippet, 80) + "”";
    var mainKids = [
      h("span", { class: "num" + (c.done ? " done" : here ? "" : " other"), "aria-hidden": "true", text: String(n) }),
      h("div", { class: "item-meta" }, [
        h("span", { text: "Version " + siteVersion(c.path) + " · " + pageLabel(c.path) }),
        h("span", { class: "badge" + (c.priority ? " badge--" + c.priority : ""), text: c.priority ? priorityLabel(c.priority) : "No priority" }),
        c.done ? h("span", { class: "badge badge--done", text: "Done" }) : null
      ]),
      where ? h("div", { class: "item-where", text: "Section: " + where }) : null,
      h("div", { class: "item-el", text: elementLine }),
      h("p", { class: "item-text", text: c.comment || "" }),
      h("div", { class: "item-date", text: displayDate(c) })
    ];

    var main;
    if (here) {
      main = h("div", {
        class: "item-main item-main--jump", role: "button", tabindex: "0",
        "aria-label": "Show note " + n + " on this page"
      }, mainKids);
      main.addEventListener("click", function () { flash(c); });
      main.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flash(c); }
      });
    } else {
      main = h("div", { class: "item-main" }, mainKids);
    }

    var del = h("button", { class: "link-btn", type: "button", text: "Delete", "aria-label": "Delete note " + n });
    del.addEventListener("click", function () {
      if (del.getAttribute("data-armed") === "1") { deleteComment(c.id); return; }
      del.setAttribute("data-armed", "1"); del.textContent = "Tap again to delete";
      setTimeout(function () { if (del.isConnected) { del.setAttribute("data-armed", "0"); del.textContent = "Delete"; } }, 4000);
    });
    var actions = h("div", { class: "item-actions" }, [
      h("button", {
        class: "link-btn", type: "button", text: here ? "Edit" : "Edit text",
        "aria-label": "Edit note " + n,
        onclick: function () { editComment(c.id); }
      }),
      h("button", {
        class: "link-btn", type: "button",
        text: c.done ? "Mark not done" : "Mark done",
        "aria-label": c.done ? "Mark note " + n + " not done" : "Mark note " + n + " done",
        onclick: function () { toggleDone(c.id); }
      }),
      (!here && c.url) ? h("a", { class: "link-btn", href: c.url, text: "Open page" }) : null,
      del
    ]);
    return h("li", { class: "item" + (c.done ? " item--done" : ""), "data-id": c.id }, [main, actions]);
  }

  function shortWhen(ts) {
    var m = String(ts || "").match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    return m ? m[1] : cleanText(ts);
  }

  function displayDate(c) {
    var created = shortWhen(c.created);
    if (!created) return "Date not recorded";
    if (c.done && c.doneAt) return created + " · done " + shortWhen(c.doneAt);
    if (c.updated) return created + " · edited " + shortWhen(c.updated);
    return created;
  }

  function motion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"; }
    catch (e) { return "smooth"; }
  }

  function clearSpotlight() {
    spotlight = null;
    spotlightId = null;
    if (spotlightTimer) { clearTimeout(spotlightTimer); spotlightTimer = null; }
  }

  // True when the open panel leaves too little of the element on screen to see the highlight.
  function coveredByPanel(elRect, panelRect) {
    var left = Math.max(elRect.left, 0);
    var right = Math.min(elRect.right, window.innerWidth);
    var top = Math.max(elRect.top, 0);
    var bottom = Math.min(elRect.bottom, window.innerHeight);
    if (right - left < 8 || bottom - top < 8) return true;
    var ix1 = Math.max(left, panelRect.left);
    var iy1 = Math.max(top, panelRect.top);
    var ix2 = Math.min(right, panelRect.right);
    var iy2 = Math.min(bottom, panelRect.bottom);
    var overlap = (ix2 > ix1 && iy2 > iy1) ? (ix2 - ix1) * (iy2 - iy1) : 0;
    var visible = (right - left) * (bottom - top) - overlap;
    return visible < 120 * 48;
  }

  // Scroll to the note's element and highlight it. If the panel covers it, close the panel.
  function flash(c) {
    if (!c || c.path !== location.pathname) return;
    var el = findBySelector(c.selector);
    if (!el || !visibleRect(el)) { announce("That element isn't visible on this page right now."); return; }
    clearSpotlight();
    spotlight = el;
    spotlightId = c.id;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: motion() });
    schedule();
    announce("Showing " + (c.section || c.label || "the selected element") + ".");
    var token = spotlightId;
    spotlightTimer = setTimeout(function () {
      if (spotlightId !== token || !spotlight) return;
      if (els.panel.hidden || els.panel.getAttribute("data-view") !== "list") { schedule(); return; }
      var er = spotlight.getBoundingClientRect();
      var pr = els.panel.getBoundingClientRect();
      if (coveredByPanel(er, pr)) closePanel(true);
      else schedule();
    }, motion() === "auto" ? 40 : 480);
    setTimeout(function () {
      if (spotlightId !== token) return;
      spotlight = null;
      spotlightId = null;
      var pin = els.pins.querySelector('.pin[data-id="' + token + '"]');
      if (pin) pin.classList.remove("is-current");
      schedule();
    }, 2000);
  }

  /* ---------------------------------------------------------------------
     9. Take the list away locally (clipboard or a file). Nothing is uploaded.
     --------------------------------------------------------------------- */
  function mdEscape(s) { return String(s || "").replace(/`/g, "'"); }

  function listMarkdown() {
    var doneCount = comments.filter(function (c) { return c.done; }).length;
    var lines = [];
    lines.push("# Website change notes");
    lines.push("");
    lines.push("Saved in this browser only. Nothing was sent.");
    lines.push("");
    lines.push(comments.length + " note" + (comments.length === 1 ? "" : "s") + " · " + (comments.length - doneCount) + " open · " + doneCount + " done");
    lines.push("");
    comments.forEach(function (c, i) {
      var first = truncate(cleanText(String(c.comment || "").split("\n")[0]), 80) || "Note";
      lines.push("---");
      lines.push("");
      lines.push("## " + (i + 1) + ". " + first);
      lines.push("");
      lines.push(String(c.comment || "").split("\n").map(function (l) { return "> " + l; }).join("\n"));
      lines.push("");
      lines.push("- **Status:** " + (c.done ? "Done" : "Open"));
      lines.push("- **Page:** " + pageLabel(c.path) + " (`" + mdEscape(c.path) + "`)");
      lines.push("- **Version:** " + siteVersion(c.path));
      lines.push("- **Section:** " + (c.section ? mdEscape(c.section) : "—"));
      lines.push("- **Element:** `<" + mdEscape(c.tag) + ">` — “" + mdEscape(c.snippet) + "”");
      lines.push("- **Selector:** `" + mdEscape(c.selector) + "`");
      lines.push("- **Priority:** " + (c.priority ? priorityLabel(c.priority) : "Not set"));
      lines.push("- **Date:** " + (c.created || "Unknown") + (c.updated ? " · updated " + c.updated : ""));
      if (c.viewport) lines.push("- **Viewport:** " + c.viewport);
      lines.push("");
    });
    return lines.join("\n");
  }

  function copyList(btn) {
    copyText(listMarkdown()).then(function (ok) {
      var label = btn.querySelector(".btn-label");
      if (label) label.textContent = ok ? "Copied" : "Copy failed";
      announce(ok ? "Change list copied to the clipboard." : "Could not copy. Use Download instead.");
      setTimeout(function () { if (label && label.isConnected) label.textContent = "Copy list"; }, 2000);
    });
  }

  function downloadList() {
    var blob = new Blob([listMarkdown()], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "protec-review-notes.md";
    a.rel = "noopener";
    root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 1500);
    announce("Change list downloaded as a Markdown file. Nothing was uploaded.");
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  /* ---------------------------------------------------------------------
     10. Start (at the end, so every variable above is initialised)
     --------------------------------------------------------------------- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
