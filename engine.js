'use strict';

const SECTION_RE = /^\[(settings|context|task:[\w.-]+)\]\s*$/i;

const OPS = {
  href: `() => location.href`,

  textMatch: `(pattern) => {
    let re; try { re = new RegExp(pattern); } catch (e) { return ''; }
    const m = (document.body ? document.body.innerText : '').match(re);
    return m ? (m[1] !== undefined ? m[1] : m[0]) : '';
  }`,

  findText: `(pattern) => {
    let re;
    try { re = new RegExp(pattern); } catch (e) { return ''; }
    const pick = t => { const m = (t || '').match(re); return m ? m[0] : ''; };
    let v = '';
    try {
      for (let i = 0; i < sessionStorage.length && !v; i++)
        v = pick(sessionStorage.getItem(sessionStorage.key(i)));
    } catch (e) {}
    try {
      for (let i = 0; i < localStorage.length && !v; i++)
        v = pick(localStorage.getItem(localStorage.key(i)));
    } catch (e) {}
    if (!v) {
      for (const e of document.querySelectorAll('body *')) {
        if (e.children.length === 0 && (e.offsetWidth || e.offsetHeight)) {
          v = pick(e.textContent);
          if (v) break;
        }
      }
    }
    return v;
  }`,

  htmlMatches: `(pattern) => {
    let re;
    try { re = new RegExp(pattern, 'g'); } catch (e) { return []; }
    const html = document.documentElement.outerHTML;
    const out = [];
    let m;
    while ((m = re.exec(html)) && out.length < 50) {
      out.push(((m[1] !== undefined ? m[1] : m[0]) || '').replace(/\\s+/g, ' ').trim());
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }`,

  textRows: `(pattern) => {
    let re;
    try { re = new RegExp(pattern, 'gm'); } catch (e) { return []; }
    const text = document.body ? document.body.innerText : '';
    const safe = s => (s || '').replace(/\\//g, '–').replace(/\\s+/g, ' ').trim();
    const out = [];
    let m;
    while ((m = re.exec(text)) && out.length < 10000) {
      out.push({number: ((m.groups && m.groups.number) || '').trim(),
                title: safe(m.groups && m.groups.title)});
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out.filter(r => r.number);
  }`,

  state: `(counterPattern) => {
    const text = document.body ? document.body.innerText : '';
    let counterIndex = null, counterTotal = null;
    if (counterPattern) {
      try {
        const re = new RegExp(counterPattern, 'g');
        let m;
        while ((m = re.exec(text))) {
          const g = m.groups || {}, a = Number(g.index), b = Number(g.total);
          if (Number.isFinite(a) && Number.isFinite(b) && a <= b) {
            counterIndex = a;
            counterTotal = b;
            break;
          }
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      } catch (e) {}
    }
    const imgs = [...document.images];
    return {
      url: location.href,
      len: text.length,
      imgs: imgs.length,
      pending: imgs.filter(i => !i.complete).length,
      reloaded: typeof window.__gen === 'undefined',
      counterIndex, counterTotal,
    };
  }`,

  markReload: `() => { window.__gen = 1; return true; }`,

  annotate: `(sel, attr, field, beforeSel) => {
    let total = 0, added = 0;
    for (const el of document.querySelectorAll(sel)) {
      total++;
      if (el.querySelector('.ext-annotation')) continue;
      let vals = [];
      try {
        const data = JSON.parse(el.getAttribute(attr) || '[]');
        vals = [...new Set(data.map(d => d[field]).filter(Boolean))];
      } catch (e) { continue; }
      if (!vals.length) continue;
      const span = document.createElement('span');
      span.className = 'ext-annotation';
      span.textContent = ' [' + vals.join(', ') + ']';
      const before = beforeSel ? el.querySelector(beforeSel) : null;
      if (before) el.insertBefore(span, before); else el.appendChild(span);
      added++;
    }
    return {total, added};
  }`,

  textMode: `() => {
    document.documentElement.style.setProperty('filter', 'none', 'important');
    return true;
  }`,

  scrollTo: `(y) => {
    window.scrollTo(0, y === null ? document.body.scrollHeight : y);
    return true;
  }`,
};

function parseConfig(text) {
  const settings = {};
  const context = {};
  const tasks = [];
  const errors = [];
  let cur = null;
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const t = lines[ln].trim();
    if (t === '' || t.startsWith('#')) continue;
    const m = t.match(SECTION_RE);
    if (m) {
      const head = m[1].toLowerCase();
      if (head === 'settings') cur = settings;
      else if (head === 'context') cur = context;
      else {
        const name = m[1].slice('task:'.length);
        if (tasks.some(x => x.name === name))
          errors.push(`line ${ln + 1}: duplicate task "${name}"`);
        const task = {name, keys: {}};
        tasks.push(task);
        cur = task.keys;
      }
      continue;
    }
    if (!cur) { errors.push(`line ${ln + 1}: content outside of any section`); continue; }
    const eq = t.indexOf('=');
    if (eq < 1) { errors.push(`line ${ln + 1}: expected "key = value"`); continue; }
    cur[t.slice(0, eq).trim().toLowerCase()] = t.slice(eq + 1).trim();
  }
  return {settings, context, tasks, errors};
}

function parseHotkey(value) {
  const parts = value.toLowerCase().split(/[+\s]+/).filter(Boolean);
  const mods = {ctrl: false, alt: false, shift: false, meta: false};
  let key = null;
  for (const p of parts) {
    if (p in mods) { mods[p] = true; continue; }
    if (key !== null) throw new Error(`hotkey "${value}" has more than one key`);
    if (!/^([a-z0-9]|f([1-9]|1[0-2]))$/.test(p))
      throw new Error(`hotkey "${value}": unsupported key "${p}" `
                      + '(use a letter, a digit or f1-f12)');
    key = p;
  }
  if (!key) throw new Error(`hotkey "${value}" is missing the key`);
  if (!mods.ctrl && !mods.alt && !mods.meta)
    throw new Error(`hotkey "${value}" needs ctrl, alt or meta`);
  return (mods.ctrl ? 'ctrl+' : '') + (mods.alt ? 'alt+' : '')
       + (mods.shift ? 'shift+' : '') + (mods.meta ? 'meta+' : '') + key;
}

function parseSource(value) {
  const sp = value.indexOf(' ');
  const kind = (sp < 0 ? value : value.slice(0, sp)).toLowerCase();
  const rest = sp < 0 ? '' : value.slice(sp + 1).trim();
  if (kind === 'find') {
    if (!rest) throw new Error('"find" needs a regular expression');
    try { new RegExp(rest); } catch (e) { throw new Error('"find" pattern is not a valid regex'); }
    return {kind, pattern: rest};
  }
  if (kind === 'value') return {kind, value: rest};
  if (kind === 'text') {
    if (!rest) throw new Error('"text" needs a regular expression');
    try { new RegExp(rest); } catch (e) { throw new Error('"text" pattern is not a valid regex'); }
    return {kind, pattern: rest};
  }
  if (kind === 'match') {
    const m = rest.match(/^(.*\S)\s+(\d+)$/);
    if (!m) throw new Error('"match" needs: match REGEX N');
    try { new RegExp(m[1]); } catch (e) { throw new Error('"match" pattern is not a valid regex'); }
    return {kind, pattern: m[1], index: Number(m[2])};
  }
  if (kind === 'url') {
    if (!rest) throw new Error('"url" needs a regular expression');
    try { new RegExp(rest); } catch (e) { throw new Error('"url" pattern is not a valid regex'); }
    return {kind, pattern: rest};
  }
  throw new Error(`unknown source "${kind}" `
                  + '(use: find REGEX / text REGEX / match REGEX N / url REGEX / value LITERAL)');
}

// Named capture groups present in a pattern, e.g. "(?<number>...)" -> ["number"].
// A task's regex names which group is which, so the mapping is explicit in the
// configuration instead of being a positional convention hidden in the code.
function namedGroups(pattern) {
  return [...pattern.matchAll(/\(\?<([A-Za-z]\w*)>/g)].map(m => m[1]);
}

// The named groups each regex key must define.
const NAMED_GROUPS = {rows_pattern: ['number', 'title'], counter_pattern: ['index', 'total']};

// A current-page task saves the one shown page; every key except these is a
// field defined by a source (url/find/match/value), usable in folder/file.
const CP_RESERVED = new Set(['type', 'when', 'folder', 'file', 'hotkey', 'annotate']);

// A capture task reads fields from the page and remembers them (no download);
// every key except these is such a field.
const CAP_RESERVED = new Set(['type', 'when', 'hotkey']);

const TYPES = {
  'document-list': {
    required: ['list_url', 'document_url', 'rows_pattern', 'folder', 'file'],
    vars: {list_url: [], document_url: ['number'], folder: [],
           file: ['number', 'title', 'index', 'total']},
  },
  'numbered-pages': {
    required: ['page_url', 'counter_pattern', 'folder', 'file'],
    vars: {page_url: ['index_from0', 'index', 'total'], folder: [], file: ['index', 'total']},
  },
  'detect': {required: ['tasks'], vars: {}},
  'current-page': {required: ['folder', 'file'], vars: {}},
  'capture': {required: [], vars: {}},
};

function validateConfig(text) {
  const cfg = parseConfig(text);
  const errors = cfg.errors;
  cfg.sources = {};
  for (const [name, value] of Object.entries(cfg.context)) {
    try { cfg.sources[name] = parseSource(value); }
    catch (e) { errors.push(`[context] ${name}: ${e.message}`); }
  }
  const ctxNames = Object.keys(cfg.context);
  // Fields remembered by capture tasks; usable as placeholders like context.
  const capturedNames = [];
  for (const t of cfg.tasks)
    if ((t.keys.type || '').toLowerCase() === 'capture')
      for (const k of Object.keys(t.keys)) if (!CAP_RESERVED.has(k)) capturedNames.push(k);
  cfg.capturedNames = capturedNames;
  const hotkeys = {};
  for (const task of cfg.tasks) {
    const type = (task.keys.type || '').toLowerCase();
    task.type = type;
    const spec = TYPES[type];
    if (!spec) {
      errors.push(`[task:${task.name}] has unknown type "${task.keys.type || ''}" `
                  + `(use: ${Object.keys(TYPES).join(' / ')})`);
      continue;
    }
    for (const key of spec.required)
      if (!task.keys[key]) errors.push(`[task:${task.name}] is missing "${key}"`);
    if (type === 'current-page') {
      const fields = [];
      for (const [key, val] of Object.entries(task.keys)) {
        if (CP_RESERVED.has(key)) continue;
        try { parseSource(val); fields.push(key); }
        catch (e) { errors.push(`[task:${task.name}] ${key}: ${e.message}`); }
      }
      const allowed = [...fields, ...ctxNames, ...capturedNames];
      for (const key of ['folder', 'file']) {
        if (task.keys[key] === undefined) continue;
        for (const m of task.keys[key].matchAll(/\{(\w+)(?::\d+)?\}/g))
          if (!allowed.includes(m[1]))
            errors.push(`[task:${task.name}] ${key}: unknown placeholder {${m[1]}} `
                        + `(allowed: ${allowed.join(', ') || 'none'})`);
      }
      if (task.keys.annotate !== undefined) {
        try { parseAnnotate(task.keys.annotate); }
        catch (e) { errors.push(`[task:${task.name}] ${e.message}`); }
      }
    } else if (type === 'capture') {
      for (const [key, val] of Object.entries(task.keys)) {
        if (CAP_RESERVED.has(key)) continue;
        try { parseSource(val); }
        catch (e) { errors.push(`[task:${task.name}] ${key}: ${e.message}`); }
      }
      if (task.keys.hotkey === undefined && task.keys.when === undefined)
        errors.push(`[task:${task.name}] capture needs a hotkey or a when`);
    } else {
      for (const [key, flowVars] of Object.entries(spec.vars)) {
        if (task.keys[key] === undefined) continue;
        const allowed = [...flowVars, ...ctxNames, ...capturedNames];
        for (const m of task.keys[key].matchAll(/\{(\w+)(?::\d+)?\}/g))
          if (!allowed.includes(m[1]))
            errors.push(`[task:${task.name}] ${key}: unknown placeholder {${m[1]}} `
                        + `(allowed: ${allowed.join(', ') || 'none'})`);
      }
      for (const [key, need] of Object.entries(NAMED_GROUPS)) {
        if (task.keys[key] === undefined) continue;
        let names;
        try { new RegExp(task.keys[key]); names = namedGroups(task.keys[key]); }
        catch (e) { errors.push(`[task:${task.name}] ${key} is not a valid regex`); continue; }
        if (need.some(n => !names.includes(n)))
          errors.push(`[task:${task.name}] ${key} must define named groups `
                      + need.map(n => `(?<${n}>…)`).join(' and '));
      }
      if (task.keys.annotate !== undefined) {
        try { parseAnnotate(task.keys.annotate); }
        catch (e) { errors.push(`[task:${task.name}] ${e.message}`); }
      }
    }
    if (task.keys.when !== undefined) {
      try { parseSource(task.keys.when); }
      catch (e) { errors.push(`[task:${task.name}] when: ${e.message}`); }
    }
    if (task.keys.hotkey !== undefined) {
      try {
        const combo = parseHotkey(task.keys.hotkey);
        if (hotkeys[combo])
          errors.push(`[task:${task.name}] hotkey "${combo}" is already used `
                      + `by "${hotkeys[combo]}"`);
        else {
          hotkeys[combo] = task.name;
          task.hotkey = combo;
        }
      } catch (e) {
        errors.push(`[task:${task.name}] ${e.message}`);
      }
    }
  }
  for (const task of cfg.tasks) {
    if (task.type !== 'detect' || !task.keys.tasks) continue;
    for (const name of task.keys.tasks.split(/\s+/)) {
      const t = cfg.tasks.find(x => x.name === name);
      if (!t) errors.push(`[task:${task.name}] refers to unknown task "${name}"`);
      else if (!['document-list', 'numbered-pages', 'current-page'].includes(t.type))
        errors.push(`[task:${task.name}] cannot use task "${name}" of type "${t.type}"`);
    }
  }
  return cfg;
}

function render(tpl, vars) {
  return tpl.replace(/\{(\w+)(?::(\d+))?\}/g, (_, name, width) => {
    if (!(name in vars)) throw new Error(`unknown placeholder {${name}}`);
    const s = String(vars[name]);
    return width ? s.padStart(Number(width), '0') : s;
  });
}

function sanitizePath(path, aggressive = false) {
  const segs = path.split('/').map(s => s.trim()).filter(s => s !== '');
  const out = [];
  for (let s of segs) {
    s = s.replace(/[\x00-\x1f\\]/g, '-');
    if (aggressive) s = s.replace(/[<>:"|?*]/g, '-');
    s = s.replace(/[. ]+$/, '');
    if (s === '' || s === '.' || s === '..') s = '-';
    out.push(s);
  }
  if (!out.length) throw new Error('empty file path');
  return out.join('/');
}

function parseAnnotate(value) {
  const tokens = value.split(/\s+/);
  const at = tokens.findIndex(t => t.startsWith('@'));
  if (at < 1 || !tokens[at + 1])
    throw new Error('annotate must be: SELECTOR @attribute field [before SELECTOR]');
  const spec = {
    selector: tokens.slice(0, at).join(' '),
    attribute: tokens[at].slice(1),
    field: tokens[at + 1],
    before: null,
  };
  const rest = tokens.slice(at + 2);
  if (rest.length) {
    if (rest[0] !== 'before' || rest.length < 2)
      throw new Error('annotate must be: SELECTOR @attribute field [before SELECTOR]');
    spec.before = rest.slice(1).join(' ');
  }
  return spec;
}

async function getContext(cfg, io) {
  const ctx = io.loadCaptured ? {...(await io.loadCaptured())} : {};
  for (const [name, src] of Object.entries(cfg.sources)) {
    let v = '';
    if (src.kind === 'value') v = src.value;
    else if (src.kind === 'find') v = await io.op('findText', src.pattern);
    else if (src.kind === 'text') v = await io.op('textMatch', src.pattern);
    else if (src.kind === 'match')
      v = (await io.op('htmlMatches', src.pattern))[src.index - 1] || '';
    else if (src.kind === 'url') {
      const m = (await io.op('href')).match(new RegExp(src.pattern));
      v = m ? (m.length > 1 ? m.slice(1).join('') : m[0]) : '';
    }
    // slashes are legal in a URL but must not appear in folder / file names
    v = String(v).trim();
    if (src.kind !== 'url') v = v.replace(/\//g, '–');
    if (!v)
      throw new Error(`context variable "${name}" is empty `
                      + `(source: ${cfg.context[name]})`);
    ctx[name] = v;
  }
  return ctx;
}

async function waitSettled(io, opts) {
  const deadline = Date.now() + (opts.timeout || 30000);
  let prev = null;
  let stable = 0;
  while (Date.now() < deadline) {
    if (io.shouldAbort()) throw new Error('stopped by user');
    let st = null;
    try {
      st = await io.op('state', opts.counterPattern || '');
    } catch (e) {}
    if (st && opts.ready(st)) {
      if (prev && st.len === prev.len && st.imgs === prev.imgs) {
        stable++;
        if (stable >= 2) {
          await io.sleep(opts.settleMs || 800);
          return st;
        }
      } else {
        stable = 0;
      }
      prev = st;
    } else {
      prev = null;
      stable = 0;
    }
    await io.sleep(1000);
  }
  throw new Error(opts.what + ' did not settle in time');
}

async function annotateAll(io, spec) {
  for (let round = 0; round < 6; round++) {
    const r = await io.op('annotate', spec.selector, spec.attribute, spec.field, spec.before);
    if (!r || !r.added) break;
    await io.sleep(800);
  }
}

async function runDocumentList(task, cfg, io) {
  const s = task.keys;
  const ctx = await getContext(cfg, io);
  const rows = await io.op('textRows', s.rows_pattern);
  if (!rows.length)
    throw new Error('the document list is empty - open the page with the list first');
  const folder = render(s.folder, ctx);
  io.log(`${task.name}: ${rows.length} documents -> ${folder}`);
  const annotate = s.annotate ? parseAnnotate(s.annotate) : null;
  for (let i = 0; i < rows.length; i++) {
    if (io.shouldAbort()) throw new Error('stopped by user');
    const doc = rows[i];
    io.log(`[${i + 1}/${rows.length}] ${doc.number} ${doc.title}`);
    await io.navigate(render(s.document_url, {...ctx, number: doc.number}));
    await io.sleep(500);
    await io.op('markReload');
    await io.reload();
    await waitSettled(io, {
      what: `document ${doc.number}`,
      ready: st => st.url.includes(doc.number) && st.pending === 0
                   && st.len > 0 && st.reloaded,
    });
    if (annotate) {
      await annotateAll(io, annotate);
      await io.sleep(500);
    }
    const vars = {...ctx, number: doc.number, title: doc.title,
                  index: i + 1, total: rows.length};
    await io.print(sanitizePath(folder + '/' + render(s.file, vars)));
  }
  await io.navigate(render(s.list_url, ctx));
  await io.sleep(500);
  await io.reload();
}

async function runNumberedPages(task, cfg, io) {
  const s = task.keys;
  const ctx = await getContext(cfg, io);
  const first = await waitSettled(io, {
    what: 'the numbered page',
    counterPattern: s.counter_pattern,
    timeout: 12000,
    settleMs: 500,
    ready: st => st.counterIndex !== null && st.pending === 0,
  });
  const total = first.counterTotal;
  if (!total)
    throw new Error('no page counter found - open the page with the counter first');
  const folder = render(s.folder, ctx);
  io.log(`${task.name}: ${total} pages -> ${folder}`);
  for (let i = 1; i <= total; i++) {
    if (io.shouldAbort()) throw new Error('stopped by user');
    io.log(`[${i}/${total}] page ${i}`);
    await io.navigate(render(s.page_url,
                             {...ctx, index_from0: i - 1, index: i, total}));
    await io.sleep(500);
    await io.reload();
    await waitSettled(io, {
      what: `page ${i}`,
      counterPattern: s.counter_pattern,
      settleMs: 1000,
      ready: st => st.counterIndex === i && st.pending === 0,
    });
    await io.op('scrollTo', null);
    await io.sleep(1200);
    await io.op('scrollTo', null);
    await io.sleep(800);
    await io.op('scrollTo', 0);
    await io.sleep(600);
    const vars = {...ctx, index: i, total};
    await io.print(sanitizePath(folder + '/' + render(s.file, vars)));
  }
}

// Turn a URL template into a regex that recognises the current page and captures
// one flow field: context placeholders are substituted with their value, the
// captured one becomes a group, other flow placeholders become wildcards.
function urlToRegex(template, ctx, captureName) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re = '', last = 0, has = false;
  for (const m of template.matchAll(/\{(\w+)(?::\d+)?\}/g)) {
    re += esc(template.slice(last, m.index));
    const name = m[1];
    if (name === captureName) { re += '([^/]+)'; has = true; }
    else if (name in ctx) re += esc(ctx[name]);
    else re += (name === 'index_from0' ? '\\d+' : '[^/]+');
    last = m.index + m[0].length;
  }
  re += esc(template.slice(last));
  return has ? new RegExp(re) : null;
}

async function extractSource(io, srcStr) {
  const src = parseSource(srcStr);
  if (src.kind === 'value') return src.value;
  if (src.kind === 'find') return await io.op('findText', src.pattern);
  if (src.kind === 'text') return await io.op('textMatch', src.pattern);
  if (src.kind === 'match') return (await io.op('htmlMatches', src.pattern))[src.index - 1] || '';
  if (src.kind === 'url') {
    const m = (await io.op('href')).match(new RegExp(src.pattern));
    return m ? (m.length > 1 ? m.slice(1).join('') : m[0]) : '';
  }
  return '';
}

async function settleForPrint(io) {
  // Nudge lazy-loaded images (e.g. a drawing) into loading before printing.
  await io.op('scrollTo', null);
  await io.sleep(1200);
  await io.op('scrollTo', null);
  await io.sleep(800);
  await io.op('scrollTo', 0);
  await io.sleep(600);
}

// Save the one page currently shown. Every task key except type/when/folder/file/
// hotkey is a field: its value is a source (url/find/match/value), and the field
// becomes a {name} placeholder usable in folder and file.
async function runCurrentPage(task, cfg, io) {
  const s = task.keys;
  const ctx = await getContext(cfg, io);
  const vars = {...ctx};
  for (const [key, val] of Object.entries(s)) {
    if (CP_RESERVED.has(key)) continue;
    const src = parseSource(val);
    let v = String(await extractSource(io, val)).trim();
    if (src.kind !== 'url') v = v.replace(/\//g, '–');
    if (!v) throw new Error(`field "${key}" is empty (source: ${val})`);
    vars[key] = v;
  }
  for (const m of (s.folder + ' ' + s.file).matchAll(/\{(\w+)(?::\d+)?\}/g))
    if (!(m[1] in vars) && (cfg.capturedNames || []).includes(m[1]))
      throw new Error(`"{${m[1]}}" was not captured yet - run the capture task first`);
  io.log(`current: ${task.name} -> ${render(s.file, vars)}`);
  if (s.annotate) { await annotateAll(io, parseAnnotate(s.annotate)); await io.sleep(500); }
  await settleForPrint(io);
  await io.print(sanitizePath(render(s.folder, vars) + '/' + render(s.file, vars)));
}

// Read the field sources and remember them (persisted) for later saves; downloads
// nothing. Lets a single-page save reuse a path read once from a list page.
async function runCapture(task, _cfg, io) {
  const out = {};
  for (const [key, val] of Object.entries(task.keys)) {
    if (CAP_RESERVED.has(key)) continue;
    const src = parseSource(val);
    let v = String(await extractSource(io, val)).trim();
    if (src.kind !== 'url') v = v.replace(/\//g, '–');
    if (!v) throw new Error(`field "${key}" is empty (source: ${val})`);
    out[key] = v;
  }
  const prev = io.loadCaptured ? (await io.loadCaptured()) || {} : {};
  const changed = Object.keys(out).some(k => out[k] !== prev[k]);
  await io.saveCaptured(out);
  if (changed) io.log(`captured ${Object.entries(out).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

// Capture tasks that fire automatically (they carry a `when`): the page-side
// content script runs these on matching pages. Returns raw source strings so
// they can be re-evaluated there without the debugger.
function autoCaptureOf(cfg) {
  const out = [];
  for (const t of cfg.tasks) {
    if ((t.keys.type || '').toLowerCase() !== 'capture' || t.keys.when === undefined) continue;
    const fields = {};
    for (const [k, v] of Object.entries(t.keys)) if (!CAP_RESERVED.has(k)) fields[k] = v;
    out.push({name: t.name, when: t.keys.when, fields});
  }
  return out;
}

// Does this task apply to the shown page? An explicit `when` source (any type)
// decides; without it, fall back to the type's built-in signal.
async function taskApplies(t, io) {
  if (t.keys.when !== undefined)
    return !!String(await extractSource(io, t.keys.when)).trim();
  if (t.type === 'document-list')
    return (await io.op('textRows', t.keys.rows_pattern)).length > 0;
  if (t.type === 'numbered-pages')
    return (await io.op('state', t.keys.counter_pattern)).counterIndex !== null;
  if (t.type === 'current-page') return true;
  return false;
}

async function runDetect(task, cfg, io) {
  const names = task.keys.tasks.split(/\s+/).filter(Boolean);
  for (const name of names) {
    const t = cfg.tasks.find(x => x.name === name);
    if (!t) continue;
    if (await taskApplies(t, io)) {
      io.log(`detected: "${name}" (${t.type})`);
      return TYPE_RUNNERS[t.type](t, cfg, io);
    }
  }
  throw new Error(`the shown page matches none of: ${names.join(', ')}`);
}

const TYPE_RUNNERS = {
  'document-list': runDocumentList,
  'numbered-pages': runNumberedPages,
  'detect': runDetect,
  'current-page': runCurrentPage,
  'capture': runCapture,
};

if (typeof module !== 'undefined') {
  module.exports = {parseConfig, validateConfig, parseSource, parseHotkey, render,
                    sanitizePath, parseAnnotate,
                    namedGroups, getContext, waitSettled, urlToRegex, runDocumentList,
                    runNumberedPages, runDetect, runCurrentPage, runCapture, taskApplies,
                    autoCaptureOf, TYPE_RUNNERS, OPS};
}
