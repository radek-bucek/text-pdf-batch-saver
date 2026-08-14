'use strict';
importScripts('engine.js');

const state = {
  running: false,
  task: '',
  abort: false,
  saved: 0,
  log: [],
};

chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});

function logLine(text) {
  state.log.push(text);
  if (state.log.length > 800) state.log.splice(0, state.log.length - 800);
  console.log(text);
}

async function getConfigText() {
  const st = await chrome.storage.local.get('configText');
  return st.configText || '';
}

let keepaliveTimer = null;
function keepalive(on) {
  if (on && !keepaliveTimer)
    keepaliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  if (!on && keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Create blob URLs so printed PDFs can be saved via chrome.downloads',
    });
  } catch (e) {
    if (!String(e.message || e).includes('single offscreen')) throw e;
  }
}

function waitForDownload(id, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; cleanup(); fn(arg); } };
    const onChanged = delta => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') finish(resolve);
      if (delta.state.current === 'interrupted')
        finish(reject, new Error('download interrupted'));
    };
    const timer = setTimeout(() => finish(reject, new Error('download timed out')), timeoutMs);
    const cleanup = () => { clearTimeout(timer); chrome.downloads.onChanged.removeListener(onChanged); };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({id}, items => {
      const it = items && items[0];
      if (it && it.state === 'complete') finish(resolve);
      if (it && it.state === 'interrupted') finish(reject, new Error('download interrupted'));
    });
  });
}

async function saveBase64Pdf(b64, filename, conflictAction) {
  await ensureOffscreen();
  const resp = await chrome.runtime.sendMessage({type: 'blob-url', b64});
  if (!resp || !resp.url) throw new Error('could not create a blob URL');
  const safe = sanitizePath(filename, true);   // Chrome's downloads API rejects <>:"|?* on every OS
  try {
    const id = await chrome.downloads.download(
        {url: resp.url, filename: safe, conflictAction, saveAs: false});
    await waitForDownload(id, 120000);
  } finally {
    chrome.runtime.sendMessage({type: 'revoke-blob-url', url: resp.url}).catch(() => {});
  }
  return safe;
}

function makeDebuggerIO(tabId, cfg) {
  const target = {tabId};
  const settings = cfg.settings || {};
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params || {});
  const evalJS = async code => {
    const r = await send('Runtime.evaluate',
                         {expression: code, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description
                      || r.exceptionDetails.text || 'JS error');
    return r.result ? r.result.value : undefined;
  };
  const io = {
    shouldAbort: () => state.abort,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    log: text => logLine(text),
    op: (name, ...args) => {
      if (!OPS[name]) throw new Error(`unknown operation "${name}"`);
      return evalJS(`(${OPS[name]})(${args.map(a => JSON.stringify(a ?? null)).join(', ')})`);
    },
    navigate: async url => { await send('Page.navigate', {url}); },
    reload: async () => { await send('Page.reload', {}); },
    print: async path => {
      await io.op('textMode');
      let opts = {printBackground: true, displayHeaderFooter: false,
                  paperWidth: 8.27, paperHeight: 11.69, preferCSSPageSize: true};
      if (settings.print_options) {
        try { opts = JSON.parse(settings.print_options); }
        catch (e) { throw new Error('print_options in [settings] is not valid JSON'); }
      }
      let pdf = null, lastError = null;
      for (let attempt = 0; attempt < 3 && !pdf; attempt++) {
        if (attempt) await io.sleep(2000);
        try { pdf = await send('Page.printToPDF', opts); }
        catch (e) { lastError = e; if (!String(e.message || e).includes('Printing failed')) throw e; }
      }
      if (!pdf) throw lastError || new Error('printToPDF failed');
      const saved = await saveBase64Pdf(pdf.data, path, settings.conflict || 'overwrite');
      state.saved++;
      chrome.action.setBadgeText({text: String(state.saved)});
      logLine(`saved: ${saved}`);
    },
    attach: async () => {
      await chrome.debugger.attach(target, '1.3');
      await send('Page.enable');
      await send('Runtime.enable');
      const m = (settings.viewport || '').match(/^(\d+)x(\d+)(?:@([\d.]+))?$/);
      if (m) await send('Emulation.setDeviceMetricsOverride',
                        {width: +m[1], height: +m[2],
                         deviceScaleFactor: m[3] ? +m[3] : 1, mobile: false});
    },
    detach: async () => {
      try { await send('Emulation.clearDeviceMetricsOverride'); } catch (e) {}
      try { await chrome.debugger.detach(target); } catch (e) {}
    },
  };
  return io;
}

async function runTaskByName(name, tabId, textOverride) {
  if (state.running) { logLine(`busy: task "${state.task}" is still running`); return; }
  const text = textOverride !== undefined ? textOverride : await getConfigText();
  if (!text.trim()) {
    logLine('no configuration - open the side panel and go to Configuration');
    return;
  }
  const cfg = validateConfig(text);
  if (cfg.errors.length) {
    logLine('config errors:');
    for (const e of cfg.errors) logLine('  ' + e);
    chrome.action.setBadgeText({text: 'ERR'});
    return;
  }
  const task = cfg.tasks.find(t => t.name === name);
  if (!task) { logLine(`no task named "${name}" in the configuration`); return; }
  let tab = tabId ? {id: tabId} : null;
  if (!tab) [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab || !tab.id) { logLine('no active tab'); return; }

  state.running = true;
  state.task = name;
  state.abort = false;
  state.saved = 0;
  chrome.action.setBadgeBackgroundColor({color: '#1a73e8'});
  chrome.action.setBadgeText({text: '…'});
  logLine(`=== task "${name}" started ===`);
  keepalive(true);
  let io = null;
  try {
    io = makeDebuggerIO(tab.id, cfg);
    await io.attach();
    await TYPE_RUNNERS[task.type](task, cfg, io);
    logLine(`=== task "${name}" finished: ${state.saved} file(s) saved ===`);
    chrome.action.setBadgeBackgroundColor({color: '#188038'});
    chrome.action.setBadgeText({text: String(state.saved)});
  } catch (e) {
    logLine(`=== task "${name}" FAILED: ${e.message} ===`);
    chrome.action.setBadgeBackgroundColor({color: '#d93025'});
    chrome.action.setBadgeText({text: 'ERR'});
  } finally {
    if (io) await io.detach();
    keepalive(false);
    state.running = false;
    state.task = '';
  }
}

chrome.debugger.onDetach.addListener((_source, reason) => {
  if (state.running) {
    state.abort = true;
    logLine(`debugger detached (${reason}) - stopping`);
  }
});

// hotkeyMap (combo -> task name) is read by the page content script; rebuild it
// whenever the stored config changes so the configured hotkeys stay in sync.
function hotkeyMapOf(cfg) {
  const map = {};
  for (const t of cfg.tasks) if (t.hotkey) map[t.hotkey] = t.name;
  return map;
}

async function refreshHotkeyMap() {
  const text = await getConfigText();
  const map = text.trim() ? hotkeyMapOf(validateConfig(text)) : {};
  await chrome.storage.local.set({hotkeyMap: map});
}

// The content script cannot inject itself into tabs that were already open when
// the extension (re)loaded; push it in so hotkeys work without reloading them.
async function injectIntoOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({url: ['http://*/*', 'https://*/*']});
    for (const t of tabs)
      chrome.scripting.executeScript({target: {tabId: t.id}, files: ['hotkeys.js']})
        .catch(() => {});
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener(() => { refreshHotkeyMap(); injectIntoOpenTabs(); });
chrome.runtime.onStartup.addListener(() => { refreshHotkeyMap(); injectIntoOpenTabs(); });
refreshHotkeyMap();

// Built-in fallback, only when the configuration is empty: print the shown page
// exactly as it is - no content analysis at all - into the folders from the GUI
// fields (skipping any left empty). The file name is the tab title + a timestamp.
async function builtinSave(tabId) {
  if (state.running) { logLine(`busy: task "${state.task}" is still running`); return; }
  let tab = null;
  try {
    tab = tabId ? await chrome.tabs.get(tabId)
                : (await chrome.tabs.query({active: true, currentWindow: true}))[0];
  } catch (e) {}
  if (!tab || !tab.id) { logLine('built-in save: no active tab'); return; }

  const folders = (await chrome.storage.local.get('folders')).folders || {};
  const dir = ['mainfolder', 'subfolder1', 'subfolder2']
    .map(k => (folders[k] || '').trim()).filter(Boolean);
  const stamp = new Date().toISOString().replace('T', ' ').replace(/:/g, '-').slice(0, 19);
  const title = (tab.title || '').replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim();
  const path = sanitizePath([...dir, (title ? title + ' ' : '') + stamp + '.pdf'].join('/'));

  state.running = true; state.task = '(built-in save)'; state.abort = false; state.saved = 0;
  chrome.action.setBadgeBackgroundColor({color: '#1a73e8'});
  chrome.action.setBadgeText({text: '…'});
  logLine('built-in Ctrl+Shift+S: saving the shown page as-is');
  keepalive(true);
  let io = null;
  try {
    io = makeDebuggerIO(tab.id, {settings: {}});
    await io.attach();
    await io.print(path);
    logLine(`=== built-in save finished: ${state.saved} file(s) saved ===`);
    chrome.action.setBadgeBackgroundColor({color: '#188038'});
    chrome.action.setBadgeText({text: String(state.saved)});
  } catch (e) {
    logLine(`=== built-in save FAILED: ${e.message} ===`);
    chrome.action.setBadgeBackgroundColor({color: '#d93025'});
    chrome.action.setBadgeText({text: 'ERR'});
  } finally {
    if (io) await io.detach();
    keepalive(false);
    state.running = false;
    state.task = '';
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.type !== 'hotkey' && msg.type !== 'builtin-save')) return false;
  const tabId = sender.tab && sender.tab.id;
  if (msg.type === 'hotkey') runTaskByName(msg.task, tabId);
  else builtinSave(tabId);
  sendResponse({ok: true});
  return false;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ui-')) return false;
  (async () => {
    switch (msg.type) {
      case 'ui-status': {
        const text = await getConfigText();
        const cfg = validateConfig(text);
        sendResponse({
          running: state.running, task: state.task, saved: state.saved,
          log: state.log.slice(-200),
          empty: !text.trim(),
          tasks: cfg.tasks.map(t => ({name: t.name, key: t.hotkey || ''})),
        });
        break;
      }
      case 'ui-run':
        runTaskByName(msg.task);
        sendResponse({ok: true});
        break;
      case 'ui-stop':
        state.abort = true;
        sendResponse({ok: true});
        break;
      case 'ui-clear-log':
        state.log = [];
        sendResponse({ok: true});
        break;
      case 'ui-config-get':
        sendResponse({text: await getConfigText()});
        break;
      case 'ui-config-set': {
        const v = validateConfig(msg.text);
        if (v.errors.length) { sendResponse({ok: false, errors: v.errors}); break; }
        await chrome.storage.local.set({configText: msg.text, hotkeyMap: hotkeyMapOf(v)});
        sendResponse({ok: true, tasks: v.tasks.map(t => t.name)});
        break;
      }
      default:
        sendResponse({});
    }
  })();
  return true;
});
