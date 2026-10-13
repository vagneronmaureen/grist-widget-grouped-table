/* ==========================================================================
   Vue groupée DSFR (éditable) — widget personnalisé Grist
   - Regroupement sur 1 ou 2 niveaux imbriqués (volets dépliants)
   - Ordre des groupes : A→Z, Z→A, effectif ↑/↓ ou manuel (glisser-déposer)
   - Édition des cellules avec un éditeur adapté au type de colonne Grist :
       Texte, Numérique/Entier, Booléen (case à cocher), Date (calendrier),
       Date & heure, Choix (liste), Liste de choix (cases à cocher),
       Référence (saisie avec complétion), Liste de références
   - Ajout de lignes pré-remplies avec les valeurs du groupe
   - Design : Système de design de l'État (DSFR)

   Accès requis : "full" (nécessaire pour modifier les données et lire les
   types / options des colonnes dans les métadonnées du document).
   ========================================================================== */
(function () {
  'use strict';

  var EMPTY_LABEL = '(vide)';
  var SEP = '\u0001';
  var DEFAULTS = { group1: '', group2: '', sort1: 'az', sort2: 'az', order1: [], order2: [], open1: 'none', open2: 'none' };

  var state = {
    records: [],
    columns: [],
    meta: {},
    tableId: null,
    cursorId: null,
    opts: Object.assign({}, DEFAULTS, { colWidths: {} }),
    touched: new Map(),     // clé de groupe -> true/false (choix de l'utilisateur)
    force: null,            // 'all' | 'none' après « Tout déplier / replier »
    knownKeys: [],
    editing: null,
    pendingRender: false,
    sig: null,
    focusCell: null,
  };

  /* ------------------------------------------------------------------ */
  /* Utilitaires DOM                                                    */
  /* ------------------------------------------------------------------ */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) appendKids(el, arguments[i]);
    return el;
  }
  function appendKids(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { appendKids(el, k); }); return; }
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function $(id) { return document.getElementById(id); }

  var msgTimer = null;
  function showMsg(text, type) {
    var box = $('alert');
    if (!box) return;
    box.innerHTML = '';
    box.append(h('div', { class: 'fr-alert fr-alert--' + (type || 'error') + ' fr-alert--sm', role: 'alert' }, h('p', null, text)));
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { box.innerHTML = ''; }, 7000);
  }

  /* ------------------------------------------------------------------ */
  /* Métadonnées des colonnes (type, options)                           */
  /* ------------------------------------------------------------------ */
  function parseJSON(s) { try { return s ? JSON.parse(s) : {}; } catch (e) { return {}; } }

  function mkMeta(id, label, type, wo, readOnly) {
    var t = String(type || 'Text');
    var i = t.indexOf(':');
    var base = i > -1 ? t.slice(0, i) : t;
    var arg = i > -1 ? t.slice(i + 1) : '';
    var w = wo || {};
    var m = {
      id: id, label: label || id, type: t, base: base, arg: arg, widget: w,
      readOnly: !!readOnly,
      choices: Array.isArray(w.choices) ? w.choices : [],
      choiceOptions: w.choiceOptions || {},
      tz: base === 'DateTime' ? (arg || null) : null,
      refTable: (base === 'Ref' || base === 'RefList') ? arg : null,
      refVisible: null, refLabels: new Map(), refOptions: [],
    };
    if (['Attachments', 'Id', 'ManualSortPos', 'PositionNumber'].indexOf(base) !== -1) m.readOnly = true;
    return m;
  }

  function inferMeta(col) {
    var sample = null;
    for (var i = 0; i < state.records.length; i++) {
      var v = state.records[i][col];
      if (v !== null && v !== undefined && v !== '') { sample = v; break; }
    }
    var type = 'Text';
    if (typeof sample === 'boolean') type = 'Bool';
    else if (typeof sample === 'number') type = 'Numeric';
    else if (Array.isArray(sample)) type = 'ChoiceList';
    var m = mkMeta(col, col, type, {}, false);
    m.inferred = true;
    return m;
  }

  function metaFor(col) {
    if (!state.meta[col]) state.meta[col] = inferMeta(col);
    return state.meta[col];
  }

  function loadRef(m) {
    return grist.docApi.fetchTable(m.refTable).then(function (t) {
      var vc = m.refVisible && t[m.refVisible] ? m.refVisible : null;
      var labels = new Map(), opts = [];
      for (var i = 0; i < t.id.length; i++) {
        var lbl = vc ? plainText(t[vc][i]) : String(t.id[i]);
        labels.set(t.id[i], lbl);
        opts.push({ id: t.id[i], label: lbl });
      }
      opts.sort(function (a, b) { return a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' }); });
      m.refLabels = labels; m.refOptions = opts;
    }).catch(function () { /* table de référence illisible */ });
  }

  function loadMeta() {
    if (!(window.grist && grist.docApi && grist.docApi.fetchTable)) return Promise.resolve();
    return Promise.resolve().then(function () {
      if (grist.selectedTable && grist.selectedTable.getTableId) return grist.selectedTable.getTableId();
      return grist.getSelectedTableId();
    }).then(function (tid) {
      state.tableId = tid;
      return Promise.all([grist.docApi.fetchTable('_grist_Tables'), grist.docApi.fetchTable('_grist_Tables_column')]);
    }).then(function (res) {
      var T = res[0], C = res[1];
      var ti = T.tableId.indexOf(state.tableId);
      if (ti < 0) throw new Error('Table introuvable');
      var tref = T.id[ti];
      var byId = {};
      for (var i = 0; i < C.id.length; i++) byId[C.id[i]] = i;
      var meta = {}, refs = [];
      for (var j = 0; j < C.id.length; j++) {
        if (C.parentId[j] !== tref) continue;
        var colId = C.colId[j];
        if (String(colId).indexOf('gristHelper_') === 0) continue;
        var readOnly = !!C.isFormula[j] && !!C.formula[j];
        var m = mkMeta(colId, C.label[j], C.type[j], parseJSON(C.widgetOptions[j]), readOnly);
        if (m.refTable) {
          var vi = C.visibleCol ? C.visibleCol[j] : 0;
          m.refVisible = vi && byId[vi] !== undefined ? C.colId[byId[vi]] : null;
          refs.push(m);
        }
        meta[colId] = m;
      }
      state.meta = meta;
      return Promise.all(refs.map(loadRef));
    }).catch(function (e) {
      if (window.console) console.warn('Métadonnées indisponibles, types déduits des valeurs :', e);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Valeurs : normalisation, affichage, encodage                       */
  /* ------------------------------------------------------------------ */
  var LIST_BASES = ['ChoiceList', 'RefList', 'Attachments'];

  function normVal(m, v) {
    if (Array.isArray(v)) {
      if (v[0] === 'L') return v.slice(1);
      if (LIST_BASES.indexOf(m.base) === -1 && typeof v[0] === 'string' && v[0].length === 1) return '#' + (v[1] || 'Erreur');
    }
    return v;
  }

  function plainText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
    if (Array.isArray(v)) return v.map(plainText).filter(Boolean).join(', ');
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }

  function epochOf(v) {
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime() / 1000;
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v)) {
      var t = Date.parse(v.length === 10 ? v + 'T00:00:00Z' : v);
      return isNaN(t) ? null : t / 1000;
    }
    return null;
  }

  function tzParts(ms, tz) {
    var f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    var o = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function safeTz(tz) { try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return tz; } catch (e) { return 'UTC'; } }

  function epochToDateTimeInput(sec, tz) {
    var p = tzParts(sec * 1000, safeTz(tz || 'UTC'));
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
  }
  function wallToEpoch(str, tz) {
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(str);
    if (!m) return null;
    var asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var z = safeTz(tz || 'UTC');
    var guess = asUtc;
    for (var i = 0; i < 2; i++) {
      var p = tzParts(guess, z);
      var shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      guess = asUtc - (shown - guess);
    }
    return Math.round(guess / 1000);
  }

  function fmtNum(m, n) {
    var w = m.widget || {};
    var o = {};
    if (w.numMode === 'currency') { o.style = 'currency'; o.currency = w.currency || 'EUR'; }
    else if (w.numMode === 'percent') o.style = 'percent';
    else if (w.numMode === 'scientific') o.notation = 'scientific';
    else o.useGrouping = w.numMode === 'decimal';
    var dec = typeof w.decimals === 'number' ? w.decimals : null;
    var maxd = typeof w.maxDecimals === 'number' ? w.maxDecimals : null;
    if (m.base === 'Int' && dec === null) { o.maximumFractionDigits = 0; }
    else {
      if (dec !== null) o.minimumFractionDigits = dec;
      o.maximumFractionDigits = maxd !== null ? Math.max(maxd, dec || 0) : Math.max(dec === null ? 10 : dec, 10);
      if (w.numMode === 'currency' && dec === null && maxd === null) { delete o.maximumFractionDigits; }
    }
    try { return n.toLocaleString('fr-FR', o); } catch (e) { return String(n); }
  }

  function displayText(col, rawIn) {
    var m = metaFor(col);
    var raw = normVal(m, rawIn);
    if (raw === null || raw === undefined || raw === '') return '';
    switch (m.base) {
      case 'Bool': return raw ? 'Oui' : 'Non';
      case 'Date': {
        var s = epochOf(raw);
        return s === null ? plainText(raw) : new Date(s * 1000).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
      }
      case 'DateTime': {
        var t = epochOf(raw);
        if (t === null) return plainText(raw);
        try { return new Date(t * 1000).toLocaleString('fr-FR', { timeZone: safeTz(m.tz || 'UTC'), dateStyle: 'short', timeStyle: 'short' }); }
        catch (e) { return plainText(raw); }
      }
      case 'Numeric': case 'Int':
        return typeof raw === 'number' ? fmtNum(m, raw) : plainText(raw);
      case 'Ref':
        if (!raw) return '';
        return m.refLabels.has(raw) ? m.refLabels.get(raw) : String(raw);
      case 'RefList':
        return (Array.isArray(raw) ? raw : []).map(function (id) { return m.refLabels.has(id) ? m.refLabels.get(id) : String(id); }).join(', ');
      case 'Attachments':
        return Array.isArray(raw) && raw.length ? raw.length + ' pièce' + (raw.length > 1 ? 's' : '') + ' jointe' + (raw.length > 1 ? 's' : '') : '';
      default: return plainText(raw);
    }
  }

  function encode(m, v) {
    if (m.base === 'ChoiceList' || m.base === 'RefList') {
      return Array.isArray(v) && v.length ? ['L'].concat(v) : null;
    }
    return v;
  }

  function emptyOf(m) {
    if (m.base === 'Ref') return 0;
    if (m.base === 'Text' || m.base === 'Choice') return '';
    return null;
  }

  function canon(m, v) {
    if (v === undefined || v === null || v === '') return 'null';
    if (m.base === 'Ref' && v === 0) return 'null';
    if (Array.isArray(v) && !v.length) return 'null';
    return JSON.stringify(v);
  }

  /* ------------------------------------------------------------------ */
  /* Enregistrement dans Grist                                          */
  /* ------------------------------------------------------------------ */
  function commitValue(rec, col, val) {
    var m = metaFor(col);
    var old = normVal(m, rec[col]);
    if (canon(m, old) === canon(m, val)) return;
    var enc = encode(m, val);
    rec[col] = enc;
    var fields = {};
    fields[col] = enc;
    Promise.resolve(grist.selectedTable.update({ id: rec.id, fields: fields })).catch(function (e) {
      showMsg('Modification refusée : ' + (e && e.message ? e.message : e));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Regroupement et tri                                                */
  /* ------------------------------------------------------------------ */
  function groupBy(rows, col) {
    var m = metaFor(col);
    var isList = m.base === 'ChoiceList' || m.base === 'RefList';
    var map = new Map();
    function put(label, empty, raw, sortRaw, r) {
      var g = map.get(label);
      if (!g) { g = { label: label, empty: empty, sortRaw: sortRaw, raw: raw, rows: [] }; map.set(label, g); }
      g.rows.push(r);
    }
    rows.forEach(function (r) {
      var raw = normVal(m, r[col]);
      if (isList) {
        // une ligne apparaît dans chaque groupe correspondant à l'une de ses valeurs
        var items = Array.isArray(raw) ? raw : [];
        if (!items.length) { put(EMPTY_LABEL, true, null, EMPTY_LABEL, r); return; }
        items.forEach(function (it) {
          var lbl = m.base === 'RefList' ? (m.refLabels.has(it) ? m.refLabels.get(it) : String(it)) : String(it);
          put(lbl, false, [it], lbl, r);
        });
        return;
      }
      var label = displayText(col, r[col]);
      var empty = label === '';
      if (empty) label = EMPTY_LABEL;
      var numeric = typeof raw === 'number' && m.base !== 'Ref' && m.base !== 'Bool';
      put(label, empty, raw, numeric ? raw : label, r);
    });
    return Array.from(map.values());
  }

  /* Tous les groupes possibles d'une colonne : ceux des données + toutes les
     valeurs disponibles (choix, lignes de la table liée, Oui/Non) + « (vide) » */
  function allGroups(col) {
    var groups = groupBy(state.records, col);
    var have = new Set(groups.map(function (g) { return g.label; }));
    var m = metaFor(col);
    var extra = [];
    function add(label, empty) {
      if (label === '' || label === null || label === undefined || have.has(label)) return;
      have.add(label);
      extra.push({ label: label, empty: !!empty, sortRaw: label, raw: null, rows: [], unused: true });
    }
    if (m.base === 'Choice' || m.base === 'ChoiceList') m.choices.forEach(function (c) { add(String(c)); });
    else if (m.base === 'Ref' || m.base === 'RefList') m.refOptions.forEach(function (o) { add(o.label); });
    else if (m.base === 'Bool') { add('Oui'); add('Non'); }
    add(EMPTY_LABEL, true);
    return groups.concat(extra);
  }

  function cmpAlpha(a, b) {
    var x = a.sortRaw, y = b.sortRaw;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' });
  }

  function orderGroups(groups, mode, manual) {
    var list = groups.slice();
    var emptyGroup = list.filter(function (g) { return g.empty; });
    var normal = list.filter(function (g) { return !g.empty; });

    if (mode === 'manual') {
      var idx = new Map();
      (manual || []).forEach(function (lbl, i) { idx.set(lbl, i); });
      normal.sort(function (a, b) {
        var ia = idx.has(a.label) ? idx.get(a.label) : Infinity;
        var ib = idx.has(b.label) ? idx.get(b.label) : Infinity;
        if (ia !== ib) return ia - ib;
        return cmpAlpha(a, b);
      });
      var emptyIdx = idx.has(EMPTY_LABEL) ? idx.get(EMPTY_LABEL) : -1;
      if (emptyGroup.length && emptyIdx >= 0) {
        var pos = 0;
        while (pos < normal.length && (idx.has(normal[pos].label) ? idx.get(normal[pos].label) : Infinity) < emptyIdx) pos++;
        normal.splice.apply(normal, [pos, 0].concat(emptyGroup));
        return normal;
      }
      return normal.concat(emptyGroup);
    }

    if (mode === 'za') normal.sort(function (a, b) { return cmpAlpha(b, a); });
    else if (mode === 'count_desc') normal.sort(function (a, b) { return b.rows.length - a.rows.length || cmpAlpha(a, b); });
    else if (mode === 'count_asc') normal.sort(function (a, b) { return a.rows.length - b.rows.length || cmpAlpha(a, b); });
    else normal.sort(cmpAlpha);
    return normal.concat(emptyGroup);
  }

  /* ------------------------------------------------------------------ */
  /* Options du widget                                                  */
  /* ------------------------------------------------------------------ */
  function save() {
    try { grist.setOptions(JSON.parse(JSON.stringify(state.opts))); } catch (e) { /* hors Grist */ }
  }
  function colLabel(id) { var m = state.meta[id]; return m && m.label ? m.label : String(id).replace(/_/g, ' '); }
  function validCol(c) { return !!c && state.columns.indexOf(c) !== -1; }
  function g1() { return validCol(state.opts.group1) ? state.opts.group1 : ''; }
  function g2() { return g1() && validCol(state.opts.group2) && state.opts.group2 !== g1() ? state.opts.group2 : ''; }

  /* ------------------------------------------------------------------ */
  /* Barre d'outils                                                     */
  /* ------------------------------------------------------------------ */
  function fillColSelect(sel, current, exclude) {
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, '— Aucun —'));
    state.columns.forEach(function (c) {
      if (c === exclude) return;
      sel.append(h('option', { value: c }, colLabel(c)));
    });
    sel.value = current || '';
    if (sel.value !== (current || '')) sel.value = '';
  }

  var SORT_NAMES = { az: 'A → Z', za: 'Z → A', count_desc: 'effectif ↓', count_asc: 'effectif ↑', manual: 'ordre manuel' };

  function updateRecap() {
    var el = $('recap');
    if (!el) return;
    el.textContent = '';
    if (!g1()) {
      el.append(h('span', { class: 'gv-recap__none' }, 'Aucun regroupement — roue dentée pour configurer'));
      return;
    }
    el.append(h('span', { class: 'gv-recap__sep' }, 'Regroupé par'));
    el.append(h('span', { class: 'fr-tag fr-tag--sm' }, colLabel(g1()) + ' · ' + SORT_NAMES[state.opts.sort1]));
    if (g2()) {
      el.append(h('span', { class: 'gv-recap__sep', 'aria-hidden': 'true' }, '›'));
      el.append(h('span', { class: 'fr-tag fr-tag--sm' }, colLabel(g2()) + ' · ' + SORT_NAMES[state.opts.sort2]));
    }
  }

  function updateToolbar() {
    updateRecap();
    var o = state.opts;
    fillColSelect($('g1'), g1(), '');
    fillColSelect($('g2'), g2(), g1());
    $('g2').disabled = !g1();
    $('s1').value = o.sort1; $('s2').value = o.sort2;
    $('oc1').value = o.open1 || 'none'; $('oc2').value = o.open2 || 'none';
    $('oc1').disabled = !g1();
    $('oc2').disabled = !g2();
    $('s1').disabled = !g1();
    $('s2').disabled = !g2();
    $('o1').hidden = !(g1() && o.sort1 === 'manual');
    $('o2').hidden = !(g2() && o.sort2 === 'manual');
    $('grp2').hidden = !g1();
    $('expand').disabled = $('collapse').disabled = !g1();
  }

  /* ------------------------------------------------------------------ */
  /* Rendu des cellules                                                 */
  /* ------------------------------------------------------------------ */
  function pill(text, opt) {
    var el = h('span', { class: 'gv-pill' }, text);
    if (opt && (opt.fillColor || opt.textColor)) {
      el.setAttribute('style', (opt.fillColor ? 'background:' + opt.fillColor + ';' : '') + (opt.textColor ? 'color:' + opt.textColor + ';' : ''));
    }
    return el;
  }

  function renderCell(td, rec, col) {
    var m = metaFor(col);
    var raw = normVal(m, rec[col]);
    td.textContent = '';
    td.className = 'gv-td' + (m.readOnly ? ' is-ro' : '') + (m.base === 'Numeric' || m.base === 'Int' ? ' gv-num' : '');
    switch (m.base) {
      case 'Bool': {
        var cb = h('input', { type: 'checkbox', class: 'gv-cb', 'aria-label': colLabel(col) });
        cb.checked = !!raw;
        cb.disabled = m.readOnly;
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function () { commitValue(rec, col, cb.checked); });
        td.append(cb);
        break;
      }
      case 'Choice': {
        var txt = plainText(raw);
        if (txt) td.append(pill(txt, m.choiceOptions[txt]));
        break;
      }
      case 'ChoiceList':
        (Array.isArray(raw) ? raw : []).forEach(function (c) { td.append(pill(String(c), m.choiceOptions[c])); });
        break;
      case 'RefList':
        (Array.isArray(raw) ? raw : []).forEach(function (id) { td.append(pill(m.refLabels.has(id) ? m.refLabels.get(id) : String(id))); });
        break;
      default:
        td.textContent = displayText(col, rec[col]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Édition des cellules                                               */
  /* ------------------------------------------------------------------ */
  function flushPending() {
    if (state.pendingRender && !state.editing && !$('dlg').open) { state.pendingRender = false; render(); }
  }

  function requestRender() {
    if (state.editing || $('dlg').open) { state.pendingRender = true; return; }
    render();
  }

  function makeInput(type, value, cls) {
    var el = h('input', { type: type, class: 'fr-input ' + (cls || '') });
    el.value = value;
    return el;
  }

  function startEdit(td, rec, col, initialChar) {
    var m = metaFor(col);
    if (m.readOnly || m.base === 'Bool') return;
    if (state.editing) { if (state.editing.td === td) return; state.editing.finish(true); }

    var raw = normVal(m, rec[col]);
    // dirty : l'utilisateur a réellement modifié la valeur ; sans cela, on ne réécrit jamais la cellule
    var ed = { td: td, rec: rec, col: col, done: false, dirty: initialChar !== undefined, node: null, popup: null, read: null, cleanup: null };
    var popupType = m.base === 'ChoiceList' || m.base === 'RefList';

    function showError(msg) {
      if (ed.node) { ed.node.classList.add('fr-input--error'); ed.node.title = msg; }
      showMsg(msg, 'warning');
    }

    ed.finish = function (saveIt) {
      if (ed.done) return true;
      if (saveIt && !ed.dirty) saveIt = false;   // rien n'a été modifié : on referme sans écrire
      var val;
      if (saveIt) {
        var r = ed.read();
        if (r.error) { showError(r.error); return false; }
        val = r.value;
      }
      ed.done = true;
      if (ed.cleanup) ed.cleanup();
      if (ed.popup && ed.popup.parentNode) ed.popup.parentNode.removeChild(ed.popup);
      state.editing = null;
      if (saveIt) commitValue(rec, col, val);
      renderCell(td, rec, col);
      state.focusCell = { id: rec.id, col: col };
      td.focus();
      flushPending();
      return true;
    };

    /* blur : on enregistre si la valeur est valide, sinon on annule */
    function onBlurSave() {
      setTimeout(function () {
        if (ed.done) return;
        if (!ed.finish(true)) ed.finish(false);
      }, 0);
    }
    function keyHandler(allowShiftEnter) {
      return function (e) {
        if (e.key === 'Escape') { e.preventDefault(); ed.finish(false); }
        else if (e.key === 'Enter' && !(allowShiftEnter && e.shiftKey)) { e.preventDefault(); ed.finish(true); }
        else if (e.key === 'Tab') { e.preventDefault(); ed.finish(true); }
      };
    }

    function inline(node) {
      ed.node = node;
      node.addEventListener('input', function () { ed.dirty = true; });
      node.addEventListener('change', function () { ed.dirty = true; });
      td.textContent = '';
      td.className = 'gv-td is-editing';
      td.append(node);
      node.focus();
      if (node.select && node.tagName !== 'SELECT') { try { node.select(); } catch (e) {} }
    }

    switch (m.base) {
      case 'Numeric': case 'Int': {
        var isPct = m.widget && m.widget.numMode === 'percent';
        var txt = typeof raw === 'number' ? String(isPct ? Math.round(raw * 1e10) / 1e8 : raw).replace('.', ',') : plainText(raw);
        var inp = makeInput('text', initialChar !== undefined ? initialChar : txt);
        inp.setAttribute('inputmode', 'decimal');
        inp.addEventListener('keydown', keyHandler(false));
        inp.addEventListener('blur', onBlurSave);
        ed.read = function () {
          var s = inp.value.trim().replace(/\s/g, '').replace(',', '.');
          if (s === '') return { value: null };
          var n = Number(s);
          if (isNaN(n)) return { error: 'Nombre invalide' };
          if (isPct) n = Math.round(n * 1e8) / 1e10;
          if (m.base === 'Int' && !Number.isInteger(n)) return { error: 'Un entier est attendu' };
          return { value: n };
        };
        inline(inp);
        if (initialChar !== undefined) { try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} }
        break;
      }
      case 'Date': {
        var s0 = epochOf(raw);
        var di = makeInput('date', s0 === null ? '' : new Date(s0 * 1000).toISOString().slice(0, 10));
        di.addEventListener('keydown', keyHandler(false));
        di.addEventListener('blur', onBlurSave);
        ed.read = function () {
          if (!di.value) return { value: null };
          var p = /^(\d{4})-(\d\d)-(\d\d)$/.exec(di.value);
          if (!p) return { error: 'Date invalide' };
          return { value: Date.UTC(+p[1], +p[2] - 1, +p[3]) / 1000 };
        };
        inline(di);
        try { if (di.showPicker) di.showPicker(); } catch (e) {}
        break;
      }
      case 'DateTime': {
        var s1 = epochOf(raw);
        var dti = makeInput('datetime-local', s1 === null ? '' : epochToDateTimeInput(s1, m.tz));
        dti.addEventListener('keydown', keyHandler(false));
        dti.addEventListener('blur', onBlurSave);
        ed.read = function () {
          if (!dti.value) return { value: null };
          var e = wallToEpoch(dti.value, m.tz);
          return e === null ? { error: 'Date et heure invalides' } : { value: e };
        };
        inline(dti);
        try { if (dti.showPicker) dti.showPicker(); } catch (e) {}
        break;
      }
      case 'Choice': {
        var cur = plainText(raw);
        var sel = h('select', { class: 'fr-select' });
        sel.append(h('option', { value: '' }, ''));
        var choices = m.choices.slice();
        if (cur && choices.indexOf(cur) === -1) choices.push(cur);
        choices.forEach(function (c) { sel.append(h('option', { value: c }, c)); });
        sel.value = cur;
        sel.addEventListener('keydown', keyHandler(false));
        sel.addEventListener('change', function () { ed.dirty = true; ed.finish(true); });
        sel.addEventListener('blur', onBlurSave);
        ed.read = function () { return { value: sel.value }; };
        inline(sel);
        try { if (sel.showPicker) sel.showPicker(); } catch (e) {}
        break;
      }
      case 'Ref': {
        var listId = 'gv-dl-' + col.replace(/[^A-Za-z0-9_-]/g, '_');
        var old = document.getElementById(listId);
        if (old) old.remove();
        var dl = h('datalist', { id: listId });
        m.refOptions.forEach(function (o) { dl.append(h('option', { value: o.label })); });
        document.body.append(dl);
        var ri = makeInput('text', raw ? (m.refLabels.has(raw) ? m.refLabels.get(raw) : String(raw)) : '');
        ri.setAttribute('list', listId);
        ri.setAttribute('placeholder', 'Rechercher…');
        ri.addEventListener('keydown', keyHandler(false));
        ri.addEventListener('blur', onBlurSave);
        ed.cleanup = function () { dl.remove(); };
        ed.read = function () {
          var v = ri.value.trim();
          if (!v) return { value: 0 };
          var low = v.toLowerCase();
          var hit = m.refOptions.filter(function (o) { return o.label === v; })[0] ||
                    m.refOptions.filter(function (o) { return o.label.toLowerCase() === low; })[0];
          return hit ? { value: hit.id } : { error: 'Valeur inconnue : choisissez un élément de la liste' };
        };
        inline(ri);
        break;
      }
      case 'ChoiceList': case 'RefList': {
        var isRef = m.base === 'RefList';
        var current = Array.isArray(raw) ? raw.slice() : [];
        var options = isRef
          ? m.refOptions.map(function (o) { return { id: o.id, label: o.label }; })
          : m.choices.map(function (c) { return { id: c, label: c }; });
        current.forEach(function (c) {
          if (!options.some(function (o) { return o.id === c; })) options.push({ id: c, label: isRef ? String(c) : String(c) });
        });
        var chosen = new Set(current);
        var box = h('div', { class: 'gv-pop', role: 'dialog', 'aria-label': 'Choisir des valeurs' });
        var filter = options.length > 8 ? h('input', { type: 'search', class: 'fr-input gv-pop__filter', placeholder: 'Filtrer…' }) : null;
        var ul = h('ul', { class: 'gv-pop__list' });
        var rows = options.map(function (o, i) {
          var id = 'gv-opt-' + i;
          var cb = h('input', { type: 'checkbox', id: id, class: 'gv-cb' });
          cb.checked = chosen.has(o.id);
          cb.addEventListener('change', function () { ed.dirty = true; if (cb.checked) chosen.add(o.id); else chosen.delete(o.id); });
          var li = h('li', null, h('label', { for: id }, cb, ' ', isRef ? o.label : pill(o.label, m.choiceOptions[o.label])));
          li._label = o.label.toLowerCase();
          ul.append(li);
          return li;
        });
        if (filter) filter.addEventListener('input', function () {
          var q = filter.value.trim().toLowerCase();
          rows.forEach(function (li) { li.hidden = q && li._label.indexOf(q) === -1; });
        });
        var okBtn = h('button', { type: 'button', class: 'fr-btn fr-btn--sm', onclick: function () { ed.finish(true); } }, 'Valider');
        var cancelBtn = h('button', { type: 'button', class: 'fr-btn fr-btn--secondary fr-btn--sm', onclick: function () { ed.finish(false); } }, 'Annuler');
        box.append(filter, ul, h('div', { class: 'gv-pop__foot' }, cancelBtn, okBtn));
        box.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); ed.finish(false); }
          else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.type !== 'checkbox') { e.preventDefault(); ed.finish(true); }
        });
        document.body.append(box);
        ed.popup = box;
        var rect = td.getBoundingClientRect();
        var top = rect.bottom + 2, left = rect.left;
        box.style.left = Math.max(4, Math.min(left, window.innerWidth - box.offsetWidth - 8)) + 'px';
        box.style.top = top + 'px';
        if (top + box.offsetHeight > window.innerHeight) box.style.top = Math.max(4, rect.top - box.offsetHeight - 2) + 'px';
        var outside = function (e) { if (!box.contains(e.target) && !td.contains(e.target)) ed.finish(true); };
        setTimeout(function () { document.addEventListener('mousedown', outside, true); }, 0);
        ed.cleanup = function () { document.removeEventListener('mousedown', outside, true); };
        ed.read = function () {
          return { value: options.filter(function (o) { return chosen.has(o.id); }).map(function (o) { return o.id; }) };
        };
        td.classList.add('is-editing');
        (filter || box.querySelector('input') || okBtn).focus();
        break;
      }
      default: {
        // Texte, Any, etc.
        var isAny = m.base === 'Any';
        var ta = h('textarea', { class: 'fr-input gv-ta', rows: '1' });
        ta.value = initialChar !== undefined ? initialChar : plainText(raw);
        var fit = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; };
        ta.addEventListener('input', fit);
        ta.addEventListener('keydown', keyHandler(true));
        ta.addEventListener('blur', onBlurSave);
        ed.read = function () {
          var s = ta.value;
          if (isAny) {
            var t = s.trim();
            if (t === '') return { value: null };
            if (/^-?\d+([.,]\d+)?$/.test(t)) return { value: Number(t.replace(',', '.')) };
          }
          return { value: s };
        };
        inline(ta);
        fit();
        if (initialChar !== undefined) { try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {} }
      }
    }
    if (popupType) ed.node = null;
    state.editing = ed;
  }

  /* ------------------------------------------------------------------ */
  /* Tableaux                                                           */
  /* ------------------------------------------------------------------ */
  function tableColumns() {
    var hide = [g1(), g2()].filter(Boolean);
    var cols = state.columns.filter(function (c) { return hide.indexOf(c) === -1; });
    return cols.length ? cols : state.columns;
  }

  function focusNeighbour(td, dRow, dCol) {
    var tr = td.parentNode, table = tr.parentNode;
    var ci = Array.prototype.indexOf.call(tr.children, td);
    var target = null;
    if (dRow) {
      var other = dRow > 0 ? tr.nextElementSibling : tr.previousElementSibling;
      if (other) target = other.children[ci];
    } else {
      target = tr.children[ci + dCol];
    }
    if (target) { target.focus(); }
    return !!target;
  }

  /* ---- Largeur des colonnes (partagée par tous les tableaux, enregistrée dans les options) ---- */
  var MIN_COL_W = 50;

  function defaultColWidth(col) {
    var b = metaFor(col).base;
    if (b === 'Bool') return 90;
    if (b === 'Numeric' || b === 'Int' || b === 'Date') return 120;
    if (b === 'DateTime') return 150;
    return 180;
  }
  function colWidth(col) {
    var w = state.opts.colWidths && state.opts.colWidths[col];
    return typeof w === 'number' && w >= MIN_COL_W ? w : defaultColWidth(col);
  }
  function fitTable(t) {
    var sum = 0;
    t.querySelectorAll('col').forEach(function (c) { sum += parseInt(c.style.width, 10) || 0; });
    t.style.width = sum + 'px';
  }
  function applyWidthDom(col) {
    document.querySelectorAll('col[data-col]').forEach(function (c) {
      if (c.getAttribute('data-col') === col) c.style.width = colWidth(col) + 'px';
    });
    document.querySelectorAll('.gv-table table').forEach(fitTable);
  }

  function resizer(col) {
    var el = h('span', {
      class: 'gv-rz', role: 'separator', 'aria-orientation': 'vertical',
      title: 'Glisser pour redimensionner · double-clic : largeur par défaut',
    });
    el.addEventListener('click', function (e) { e.stopPropagation(); });
    el.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      delete state.opts.colWidths[col];
      applyWidthDom(col);
      save();
    });
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var startX = e.clientX, startW = colWidth(col);
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      el.classList.add('is-active');
      document.body.classList.add('is-resizing');
      function move(ev) {
        state.opts.colWidths[col] = Math.max(MIN_COL_W, Math.round(startW + ev.clientX - startX));
        applyWidthDom(col);
      }
      function up() {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('is-active');
        document.body.classList.remove('is-resizing');
        save();
      }
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    return el;
  }

  function buildTable(rows, cols, caption) {
    var colgroup = h('colgroup', null, cols.map(function (c) {
      return h('col', { 'data-col': c, style: 'width:' + colWidth(c) + 'px' });
    }));
    var thead = h('thead', null, h('tr', null, cols.map(function (c) {
      return h('th', { scope: 'col', title: metaFor(c).type },
        h('span', { class: 'gv-th-lbl' }, colLabel(c)), resizer(c));
    })));
    var tbody = h('tbody');
    rows.forEach(function (r) {
      var tr = h('tr', { 'data-id': r.id, class: r.id === state.cursorId ? 'is-cursor' : '' });
      cols.forEach(function (c) {
        var td = h('td', { tabindex: '0', 'data-id': r.id, 'data-col': c });
        renderCell(td, r, c);
        td.addEventListener('click', function () {
          try { grist.setCursorPos({ rowId: r.id }); } catch (e) { /* hors Grist */ }
        });
        td.addEventListener('dblclick', function () { startEdit(td, r, c); });
        td.addEventListener('keydown', function (e) {
          if (e.target !== td) return;
          var m = metaFor(c);
          if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(td, r, c); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); focusNeighbour(td, 1, 0); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); focusNeighbour(td, -1, 0); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); focusNeighbour(td, 0, 1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); focusNeighbour(td, 0, -1); }
          else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (!m.readOnly && m.base !== 'Attachments') { e.preventDefault(); commitValue(r, c, m.base === 'Bool' ? false : emptyOf(m)); renderCell(td, r, c); }
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey &&
                     ['Text', 'Numeric', 'Int', 'Any'].indexOf(m.base) !== -1 && !m.readOnly) {
            e.preventDefault(); startEdit(td, r, c, e.key);
          }
        });
        tr.append(td);
      });
      tbody.append(tr);
    });
    var table = h('table', null, h('caption', { class: 'fr-sr-only' }, caption), colgroup, thead, tbody);
    fitTable(table);
    return h('div', { class: 'fr-table fr-table--sm gv-table' },
      h('div', { class: 'fr-table__wrapper' },
        h('div', { class: 'fr-table__container' },
          h('div', { class: 'fr-table__content' }, table))));
  }

  function badge(n) {
    return h('span', { class: 'fr-badge fr-badge--sm fr-badge--blue-ecume fr-badge--no-icon gv-count' }, String(n));
  }

  function lazyBody(isOpen, fill) {
    var body = h('div', { class: 'gv-body' });
    body.hidden = !isOpen;
    var filled = false;
    function ensure() { if (!filled) { filled = true; body.append(fill()); } }
    if (isOpen) ensure();
    return { body: body, show: function (open) { if (open) ensure(); body.hidden = !open; } };
  }

  /* État plié/déplié : choix manuel de l'utilisateur, sinon règle par défaut du niveau */
  function isOpenKey(key, level, idx) {
    if (state.touched.has(key)) return state.touched.get(key);
    var mode = state.force || state.opts['open' + level];
    return mode === 'all' || (mode === 'first' && idx === 0);
  }

  function resetOpen() { state.touched.clear(); state.force = null; }

  function toggleKey(key, btn, lb) {
    var open = btn.getAttribute('aria-expanded') !== 'true';
    state.touched.set(key, open);
    btn.setAttribute('aria-expanded', String(open));
    lb.show(open);
  }

  function renderLevel2(parentLabel, rows, cols) {
    var col2 = g2();
    var groups = orderGroups(groupBy(rows, col2), state.opts.sort2, state.opts.order2);
    var wrap = h('div', { class: 'gv-subs' });
    groups.forEach(function (g, gi) {
      var key = '2:' + parentLabel + SEP + g.label;
      var isOpen = isOpenKey(key, 2, gi);
      var lb = lazyBody(isOpen, function () {
        return buildTable(g.rows, cols, parentLabel + ' — ' + g.label);
      });
      var btn = h('button', { type: 'button', class: 'gv-sub__btn', 'aria-expanded': String(isOpen) },
        h('span', { class: 'fr-icon-arrow-right-s-line fr-icon--sm gv-chevron', 'aria-hidden': 'true' }),
        h('span', { class: 'gv-sub__title' }, g.label),
        badge(g.rows.length));
      btn.addEventListener('click', function () { toggleKey(key, btn, lb); });
      wrap.append(h('div', { class: 'gv-sub' }, btn, lb.body));
    });
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Rendu principal                                                    */
  /* ------------------------------------------------------------------ */
  function render() {
    try { renderMain(); } catch (e) { reportError("affichage", e); }
  }

  function renderMain() {
    var root = $('content');
    var sy = window.scrollY;
    root.innerHTML = '';
    state.knownKeys = [];
    updateToolbar();

    var cols = tableColumns();

    if (!state.records.length) {
      $('summary').textContent = '0 enregistrement';
      root.append(h('p', { class: 'gv-empty' }, state.columns.length ? 'Aucun enregistrement à afficher.' : 'En attente des données…'));
      return;
    }

    if (!g1()) {
      $('summary').textContent = state.records.length + ' enregistrements';
      root.append(h('div', { class: 'fr-callout fr-callout--sm gv-hint' },
        h('p', { class: 'fr-callout__text' }, 'Cliquez sur la roue dentée pour choisir la ou les colonnes de regroupement.')));
      root.append(buildTable(state.records, state.columns, 'Tous les enregistrements'));
      restoreView(sy);
      return;
    }

    var col1 = g1();
    var groups = orderGroups(groupBy(state.records, col1), state.opts.sort1, state.opts.order1);
    $('summary').textContent = groups.length + ' groupe' + (groups.length > 1 ? 's' : '') + ' · ' +
      state.records.length + ' enregistrement' + (state.records.length > 1 ? 's' : '');

    var ul = h('ul', { class: 'fr-accordions-group gv-groups' });
    groups.forEach(function (g, gi) {
      var key = '1:' + g.label;
      var isOpen = isOpenKey(key, 1, gi);
      var lb = lazyBody(isOpen, function () {
        return g2() ? renderLevel2(g.label, g.rows, cols) : buildTable(g.rows, cols, g.label);
      });
      var btn = h('button', { type: 'button', class: 'fr-accordion__btn', 'aria-expanded': String(isOpen) },
        h('span', { class: 'gv-acc__title' }, g.label), badge(g.rows.length));
      btn.addEventListener('click', function () { toggleKey(key, btn, lb); });
      ul.append(h('li', null,
        h('section', { class: 'fr-accordion gv-acc' },
          h('h3', { class: 'fr-accordion__title' }, btn),
          lb.body)));
    });
    root.append(ul);
    restoreView(sy);
  }

  function restoreView(sy) {
    window.scrollTo(0, sy);
    var f = state.focusCell;
    if (f) {
      state.focusCell = null;
      var sel = 'td[data-id="' + f.id + '"][data-col="' + String(f.col).replace(/"/g, '\\"') + '"]';
      var td = document.querySelector(sel);
      if (td) td.focus({ preventScroll: true });
    }
  }

  function highlightCursor() {
    document.querySelectorAll('tr.is-cursor').forEach(function (tr) { tr.classList.remove('is-cursor'); });
    if (state.cursorId == null) return;
    document.querySelectorAll('tr[data-id="' + state.cursorId + '"]').forEach(function (tr) { tr.classList.add('is-cursor'); });
  }

  /* ------------------------------------------------------------------ */
  /* Boîte de dialogue : ordre manuel                                   */
  /* ------------------------------------------------------------------ */
  function labelsForLevel(level) {
    var col = level === 1 ? g1() : g2();
    var mode = level === 1 ? state.opts.sort1 : state.opts.sort2;
    var manual = level === 1 ? state.opts.order1 : state.opts.order2;
    return orderGroups(allGroups(col), mode, manual).map(function (g) { return g.label; });
  }

  function unusedLabels(col) {
    var used = new Set(groupBy(state.records, col).map(function (g) { return g.label; }));
    return used;
  }

  function openOrderDialog(level) {
    var col = level === 1 ? g1() : g2();
    if (!col) return;
    var working = labelsForLevel(level);
    var usedSet = unusedLabels(col);
    var dragFrom = null;

    $('dlg-title').textContent = 'Ordre des groupes — ' + colLabel(col) + (level === 2 ? ' (2ᵉ niveau)' : '');
    var list = $('dlg-list');

    function move(from, to) {
      if (to < 0 || to >= working.length || from === to) return;
      var item = working.splice(from, 1)[0];
      working.splice(to, 0, item);
      draw();
    }

    function draw() {
      list.innerHTML = '';
      working.forEach(function (lbl, i) {
        var li = h('li', { class: 'gv-order__item' + (usedSet.has(lbl) ? '' : ' is-unused'), draggable: 'true' },
          h('span', { class: 'gv-order__handle', 'aria-hidden': 'true', title: 'Glisser pour déplacer' }, '⋮⋮'),
          h('span', { class: 'gv-order__label' }, lbl),
          h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary-no-outline fr-btn--sm fr-icon-arrow-up-line', title: 'Monter',
            disabled: i === 0, onclick: function () { move(i, i - 1); } }, 'Monter'),
          h('button', { type: 'button', class: 'fr-btn fr-btn--tertiary-no-outline fr-btn--sm fr-icon-arrow-down-line', title: 'Descendre',
            disabled: i === working.length - 1, onclick: function () { move(i, i + 1); } }, 'Descendre'));
        li.addEventListener('dragstart', function (e) { dragFrom = i; li.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch (x) {} });
        li.addEventListener('dragend', function () { li.classList.remove('is-dragging'); });
        li.addEventListener('dragover', function (e) { e.preventDefault(); li.classList.add('is-over'); });
        li.addEventListener('dragleave', function () { li.classList.remove('is-over'); });
        li.addEventListener('drop', function (e) { e.preventDefault(); li.classList.remove('is-over'); if (dragFrom !== null) move(dragFrom, i); dragFrom = null; });
        list.append(li);
      });
    }
    draw();

    $('dlg-az').onclick = function () {
      working = orderGroups(allGroups(col), 'az').map(function (g) { return g.label; }); draw();
    };
    $('dlg-save').onclick = function () {
      state.opts['order' + level] = working.slice();
      state.opts['sort' + level] = 'manual';
      save(); $('dlg').close(); render();
    };
    $('dlg-cancel').onclick = function () { $('dlg').close(); requestRender(); };
    $('dlg').showModal();
  }

  /* ------------------------------------------------------------------ */
  /* Événements                                                         */
  /* ------------------------------------------------------------------ */
  function wire() {
    $('gear').addEventListener('click', function () { updateToolbar(); $('cfg').showModal(); });
    $('cfg-close').addEventListener('click', function () { $('cfg').close(); });
    $('cfg-reset-widths').addEventListener('click', function () {
      state.opts.colWidths = {}; save(); render();
    });
    $('cfg').addEventListener('click', function (e) { if (e.target === $('cfg')) $('cfg').close(); });
    $('cfg').addEventListener('close', function () { flushPending(); });
    $('g1').addEventListener('change', function (e) {
      state.opts.group1 = e.target.value;
      if (state.opts.group2 === state.opts.group1) state.opts.group2 = '';
      resetOpen(); save(); render();
    });
    $('g2').addEventListener('change', function (e) {
      state.opts.group2 = e.target.value; resetOpen(); save(); render();
    });
    [1, 2].forEach(function (lvl) {
      $('oc' + lvl).addEventListener('change', function (e) {
        state.opts['open' + lvl] = e.target.value; resetOpen(); save(); render();
      });
      $('s' + lvl).addEventListener('change', function (e) {
        state.opts['sort' + lvl] = e.target.value; save(); render();
        if (e.target.value === 'manual' && !(state.opts['order' + lvl] || []).length) openOrderDialog(lvl);
      });
      $('o' + lvl).addEventListener('click', function () { openOrderDialog(lvl); });
    });
    // « Tout déplier / replier » : temporaire, la règle par défaut revient au prochain changement de configuration
    $('expand').addEventListener('click', function () { state.touched.clear(); state.force = 'all'; render(); });
    $('collapse').addEventListener('click', function () { state.touched.clear(); state.force = 'none'; render(); });
  }

  /* ------------------------------------------------------------------ */
  /* Données Grist                                                      */
  /* ------------------------------------------------------------------ */
  /* Les erreurs sont affichées dans le widget (bandeau rouge) au lieu de rester silencieuses */
  function reportError(where, e) {
    var msg = e && e.message ? e.message : String(e);
    if (window.console) console.error('[Vue groupée DSFR] ' + where, e);
    showMsg('Erreur (' + where + ') : ' + msg, 'error');
  }
  function safe(where, fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { reportError(where, e); }
    };
  }

  function init() {
    window.addEventListener('error', function (e) { reportError('script', e.error || e.message); });
    window.addEventListener('unhandledrejection', function (e) { reportError('promesse', e.reason); });

    if (typeof grist === 'undefined') {
      $('content').append(h('p', { class: 'gv-empty' }, 'L\'API Grist n\'a pas pu être chargée (grist-plugin-api.js).'));
      return;
    }
    if (window.parent === window) {
      $('content').append(h('div', { class: 'fr-callout gv-hint' },
        h('p', { class: 'fr-callout__text' }, 'Cette page doit être ouverte comme widget personnalisé dans Grist, pas directement dans le navigateur : elle reçoit les données depuis Grist.')));
      return;
    }

    try { grist.ready({ requiredAccess: 'full' }); } catch (e) { reportError('grist.ready', e); }
    try { wire(); } catch (e) { reportError('initialisation', e); }

    grist.onOptions(safe('options', function (opts) {
      state.opts = Object.assign({}, DEFAULTS, opts || {});
      state.opts.colWidths = (state.opts.colWidths && typeof state.opts.colWidths === 'object' && !Array.isArray(state.opts.colWidths))
        ? Object.assign({}, state.opts.colWidths) : {};
      if (!Array.isArray(state.opts.order1)) state.opts.order1 = [];
      if (!Array.isArray(state.opts.order2)) state.opts.order2 = [];
      requestRender();
    }));

    setTimeout(function () {
      if (!state.gotRecords) {
        showMsg('Aucune donnée reçue de Grist. Vérifiez dans le panneau du widget : la table source est bien sélectionnée, ' +
                'et l\'accès est « Accès complet au document ».', 'warning');
      }
    }, 5000);

    grist.onRecords(safe('données', function (records) {
      state.gotRecords = true;
      state.records = records || [];
      if (state.records.length) {
        state.columns = Object.keys(state.records[0]).filter(function (k) {
          return k !== 'id' && k.indexOf('gristHelper_') !== 0;
        });
      }
      var sig = state.columns.join('|');
      var firstOrChanged = sig !== state.sig;
      state.sig = sig;
      requestRender();
      if (firstOrChanged && state.columns.length) {
        loadMeta().then(function () { requestRender(); });
      }
    }), { includeColumns: 'shown' });

    grist.onRecord(safe('curseur', function (rec) {
      state.cursorId = rec ? rec.id : null;
      highlightCursor();
    }));

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
