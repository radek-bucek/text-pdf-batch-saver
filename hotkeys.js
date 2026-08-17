'use strict';

// Injected into every page (and re-injected into already-open tabs on install).
// Guard against running twice in one page.
if (!window.__tpbsHotkeys) {
  window.__tpbsHotkeys = true;

  // After the extension reloads, this content script may keep running with an
  // invalidated context; chrome.runtime.sendMessage then throws synchronously
  // (so a .catch on the promise is not enough). Bail out cleanly in that case.
  const alive = () => {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  };
  const send = payload => {
    if (!alive()) return;
    try { chrome.runtime.sendMessage(payload).catch(() => {}); } catch (e) {}
  };

  let hotkeyMap = {};
  if (alive()) {
    chrome.storage.local.get('hotkeyMap')
      .then(st => { hotkeyMap = st.hotkeyMap || {}; }).catch(() => {});
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.hotkeyMap) hotkeyMap = changes.hotkeyMap.newValue || {};
      });
    } catch (e) {}
  }

  const comboOf = e => {
    if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
    let key = (e.key || '').toLowerCase();
    if (!/^([a-z0-9]|f([1-9]|1[0-2]))$/.test(key)) {
      const code = e.code || '';
      if (/^Digit\d$/.test(code)) key = code.slice(5);
      else if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
      else if (/^Numpad\d$/.test(code)) key = code.slice(6);
      else return null;
    }
    return (e.ctrlKey ? 'ctrl+' : '') + (e.altKey ? 'alt+' : '')
         + (e.shiftKey ? 'shift+' : '') + (e.metaKey ? 'meta+' : '') + key;
  };

  window.addEventListener('keydown', e => {
    if (!alive()) return;
    const combo = comboOf(e);
    if (!combo) return;
    const task = hotkeyMap[combo];
    if (task) {
      e.preventDefault();
      e.stopPropagation();
      send({type: 'hotkey', task});
      return;
    }
    // Built-in fallback: only when the configuration defines no hotkeys at all,
    // Ctrl+Shift+S saves the shown page as-is.
    if (Object.keys(hotkeyMap).length === 0 && combo === 'ctrl+shift+s') {
      e.preventDefault();
      e.stopPropagation();
      send({type: 'builtin-save'});
    }
  }, true);

  // --- auto-capture: remember fields from pages matching a capture task's `when`.
  // Mirrors the engine's url/find/match/value sources; runs page-side (no debugger).
  const evalSource = str => {
    const sp = str.indexOf(' ');
    const kind = (sp < 0 ? str : str.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? '' : str.slice(sp + 1).trim();
    try {
      if (kind === 'value') return rest;
      if (kind === 'url') {
        const m = location.href.match(new RegExp(rest));
        return m ? (m.length > 1 ? m.slice(1).join('') : m[0]) : '';
      }
      if (kind === 'find') {
        const re = new RegExp(rest);
        const pick = t => { const m = (t || '').match(re); return m ? m[0] : ''; };
        let v = '';
        try { for (let i = 0; i < sessionStorage.length && !v; i++) v = pick(sessionStorage.getItem(sessionStorage.key(i))); } catch (e) {}
        try { for (let i = 0; i < localStorage.length && !v; i++) v = pick(localStorage.getItem(localStorage.key(i))); } catch (e) {}
        if (!v) for (const el of document.querySelectorAll('body *'))
          if (el.children.length === 0 && (el.offsetWidth || el.offsetHeight)) { v = pick(el.textContent); if (v) break; }
        return v;
      }
      if (kind === 'text') {
        const m = (document.body ? document.body.innerText : '').match(new RegExp(rest));
        return m ? (m[1] !== undefined ? m[1] : m[0]) : '';
      }
      if (kind === 'match') {
        const mm = rest.match(/^(.*\S)\s+(\d+)$/);
        if (!mm) return '';
        const re = new RegExp(mm[1], 'g');
        const html = document.documentElement.outerHTML;
        const out = []; let m;
        while ((m = re.exec(html)) && out.length < 50) {
          out.push(((m[1] !== undefined ? m[1] : m[0]) || '').replace(/\s+/g, ' ').trim());
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        return out[Number(mm[2]) - 1] || '';
      }
    } catch (e) {}
    return '';
  };

  let autoCap = [], lastLogged = {};
  const doAutoCapture = () => {
    if (!alive() || !autoCap.length) return false;
    const out = {};
    for (const def of autoCap) {
      if (!String(evalSource(def.when || '') || '').trim()) continue;
      const vals = {}; let ok = true;
      for (const [k, src] of Object.entries(def.fields || {})) {
        let v = String(evalSource(src) || '').trim();
        if (src.trim().split(/\s+/)[0].toLowerCase() !== 'url') v = v.replace(/\//g, '–');
        if (!v) { ok = false; break; }
        vals[k] = v;
      }
      if (ok) Object.assign(out, vals);
    }
    if (!Object.keys(out).length) return false;
    // Decide "changed" synchronously against an in-page snapshot, so several
    // re-fires from one navigation can't each read stale storage and double-log.
    const changed = Object.keys(out).some(k => out[k] !== lastLogged[k]);
    lastLogged = {...lastLogged, ...out};
    try {
      chrome.storage.local.get('captured').then(st =>
        chrome.storage.local.set({captured: {...(st.captured || {}), ...out}})).catch(() => {});
    } catch (e) {}
    if (changed) send({type: 'log', text: 'captured ' + Object.entries(out).map(([k, v]) => k + '=' + v).join(', ')});
    return true;
  };
  // The SPA re-renders after a route change; retry briefly until the fields appear.
  // Only one retry chain runs at a time (a new navigation cancels the previous).
  let capTimer = null;
  const scheduleAutoCapture = () => {
    if (capTimer) clearTimeout(capTimer);
    let tries = 0;
    const tick = () => { capTimer = null; if (alive() && !doAutoCapture() && ++tries < 8) capTimer = setTimeout(tick, 500); };
    capTimer = setTimeout(tick, 300);
  };

  if (alive()) {
    chrome.storage.local.get('autoCapture')
      .then(st => { autoCap = st.autoCapture || []; scheduleAutoCapture(); }).catch(() => {});
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.autoCapture) autoCap = changes.autoCapture.newValue || [];
      });
    } catch (e) {}
    window.addEventListener('hashchange', scheduleAutoCapture);
    window.addEventListener('popstate', scheduleAutoCapture);
  }
}
