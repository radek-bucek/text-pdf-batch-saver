'use strict';

const SECTION_RE = /^\[(settings|context|task:[\w.-]+)\]\s*$/i;

const OPS = {
  href: `() => location.href`,

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
      out.push({number: (m[1] || '').trim(), title: safe(m[2])});
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
          const a = Number(m[1]), b = Number(m[2]);
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
                  + '(use: find REGEX / match REGEX N / url REGEX / value LITERAL)');
}

function groupCount(pattern) {
  return new RegExp(pattern + '|').exec('').length - 1;
}

const TYPES = {
  'document-list': {
    required: ['list_url', 'document_url', 'rows_pattern', 'folder', 'file'],
    vars: {list_url: [], document_url: ['number'], folder: [],
           file: ['number', 'title', 'index', 'count']},
  },
  'numbered-pages': {
    required: ['page_url', 'counter_pattern', 'folder', 'file'],
    vars: {page_url: ['index0', 'index', 'count'], folder: [], file: ['index', 'count']},
  },
  'detect': {required: ['tasks'], vars: {}},
  'current-page': {required: ['tasks'], vars: {}},
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
    for (const [key, flowVars] of Object.entries(spec.vars)) {
      if (task.keys[key] === undefined) continue;
      const allowed = [...flowVars, ...ctxNames];
      for (const m of task.keys[key].matchAll(/\{(\w+)\}/g))
        if (!allowed.includes(m[1]))
          errors.push(`[task:${task.name}] ${key}: unknown placeholder {${m[1]}} `
                      + `(allowed: ${allowed.join(', ') || 'none'})`);
    }
    for (const key of ['rows_pattern', 'counter_pattern']) {
      if (task.keys[key] === undefined) continue;
      try {
        if (groupCount(task.keys[key]) < 2)
          errors.push(`[task:${task.name}] ${key} needs two capture groups`);
      } catch (e) {
        errors.push(`[task:${task.name}] ${key} is not a valid regex`);
      }
    }
    if (task.keys.annotate !== undefined) {
      try { parseAnnotate(task.keys.annotate); }
      catch (e) { errors.push(`[task:${task.name}] ${e.message}`); }
    }
    if (task.keys.document_title !== undefined) {
      try { parseSource(task.keys.document_title); }
      catch (e) { errors.push(`[task:${task.name}] document_title: ${e.message}`); }
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
    if ((task.type !== 'detect' && task.type !== 'current-page') || !task.keys.tasks) continue;
    for (const name of task.keys.tasks.split(/\s+/)) {
      const t = cfg.tasks.find(x => x.name === name);
      if (!t) errors.push(`[task:${task.name}] refers to unknown task "${name}"`);
      else if (t.type !== 'document-list' && t.type !== 'numbered-pages')
        errors.push(`[task:${task.name}] cannot use task "${name}" of type "${t.type}"`);
    }
  }
  return cfg;
}

function render(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`unknown placeholder {${name}}`);
    return String(vars[name]);
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

function padWidth(count) {
  return Math.max(2, String(count).length);
}

function pad(n, count) {
  return String(n).padStart(padWidth(count), '0');
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
  const ctx = {};
  for (const [name, src] of Object.entries(cfg.sources)) {
    let v = '';
    if (src.kind === 'value') v = src.value;
    else if (src.kind === 'find') v = await io.op('findText', src.pattern);
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
                  index: pad(i + 1, rows.length), count: pad(rows.length, rows.length)};
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
                             {...ctx, index0: i - 1, index: pad(i, total),
                              count: pad(total, total)}));
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
    const vars = {...ctx, index: pad(i, total), count: pad(total, total)};
    await io.print(sanitizePath(folder + '/' + render(s.file, vars)));
  }
}

// Turn a URL template into a regex that recognises the current page and captures
// one flow field: context placeholders are substituted with their value, the
// captured one becomes a group, other flow placeholders become wildcards.
function urlToRegex(template, ctx, captureName) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re = '', last = 0, has = false;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    re += esc(template.slice(last, m.index));
    const name = m[1];
    if (name === captureName) { re += '([^/]+)'; has = true; }
    else if (name in ctx) re += esc(ctx[name]);
    else re += (name === 'index0' ? '\\d+' : '[^/]+');
    last = m.index + m[0].length;
  }
  re += esc(template.slice(last));
  return has ? new RegExp(re) : null;
}

async function extractSource(io, srcStr) {
  const src = parseSource(srcStr);
  if (src.kind === 'value') return src.value;
  if (src.kind === 'find') return await io.op('findText', src.pattern);
  if (src.kind === 'match') return (await io.op('htmlMatches', src.pattern))[src.index - 1] || '';
  if (src.kind === 'url') {
    const m = (await io.op('href')).match(new RegExp(src.pattern));
    return m ? (m.length > 1 ? m.slice(1).join('') : m[0]) : '';
  }
  return '';
}

async function runCurrentPage(task, cfg, io) {
  const names = task.keys.tasks.split(/\s+/).filter(Boolean);
  const ctx = await getContext(cfg, io);
  const href = await io.op('href');
  for (const name of names) {
    const t = cfg.tasks.find(x => x.name === name);
    if (!t) continue;
    if (t.type === 'document-list') {
      const re = urlToRegex(t.keys.document_url, ctx, 'number');
      const m = re && href.match(re);
      if (!m) continue;
      const number = m[1];
      if (t.keys.annotate) {
        await annotateAll(io, parseAnnotate(t.keys.annotate));
        await io.sleep(500);
      }
      let title = t.keys.document_title ? await extractSource(io, t.keys.document_title) : '';
      title = String(title).replace(/\//g, '–').trim();
      io.log(`current: ${name} ${number} ${title}`.trim());
      const vars = {...ctx, number, title, index: '1', count: '1'};
      await io.print(sanitizePath(render(t.keys.folder, ctx) + '/' + render(t.keys.file, vars)));
      return;
    }
    if (t.type === 'numbered-pages') {
      const st = await io.op('state', t.keys.counter_pattern);
      if (st.counterIndex === null || !st.counterTotal) continue;
      io.log(`current: ${name} page ${st.counterIndex}/${st.counterTotal}`);
      const vars = {...ctx, index: pad(st.counterIndex, st.counterTotal),
                    count: pad(st.counterTotal, st.counterTotal)};
      await io.print(sanitizePath(render(t.keys.folder, ctx) + '/' + render(t.keys.file, vars)));
      return;
    }
  }
  throw new Error(`the shown page matches none of: ${names.join(', ')}`);
}

async function runDetect(task, cfg, io) {
  const names = task.keys.tasks.split(/\s+/).filter(Boolean);
  for (const name of names) {
    const t = cfg.tasks.find(x => x.name === name);
    if (!t) continue;
    if (t.type === 'document-list') {
      const rows = await io.op('textRows', t.keys.rows_pattern);
      if (rows.length) {
        io.log(`detected: "${name}" (${rows.length} list rows on the page)`);
        return runDocumentList(t, cfg, io);
      }
    } else if (t.type === 'numbered-pages') {
      const st = await io.op('state', t.keys.counter_pattern);
      if (st.counterIndex !== null) {
        io.log(`detected: "${name}" (page counter ${st.counterIndex}/${st.counterTotal})`);
        return runNumberedPages(t, cfg, io);
      }
    }
  }
  throw new Error(`the shown page matches none of: ${names.join(', ')}`);
}

const TYPE_RUNNERS = {
  'document-list': runDocumentList,
  'numbered-pages': runNumberedPages,
  'detect': runDetect,
  'current-page': runCurrentPage,
};

if (typeof module !== 'undefined') {
  module.exports = {parseConfig, validateConfig, parseSource, parseHotkey, render,
                    sanitizePath, padWidth, pad, parseAnnotate,
                    groupCount, getContext, waitSettled, urlToRegex, runDocumentList,
                    runNumberedPages, runDetect, runCurrentPage, TYPE_RUNNERS, OPS};
}
