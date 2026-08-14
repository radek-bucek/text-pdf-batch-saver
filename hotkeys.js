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
}
