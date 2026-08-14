'use strict';

const el = id => document.getElementById(id);
const FOLDER_IDS = ['mainfolder', 'subfolder1', 'subfolder2'];

function show(msg, ok) {
  const r = el('result');
  r.textContent = msg;
  r.className = ok ? 'ok' : 'err';
}

async function loadFolders() {
  const f = (await chrome.storage.local.get('folders')).folders || {};
  for (const id of FOLDER_IDS) el(id).value = f[id] || '';
}

async function saveFolders() {
  const f = {};
  for (const id of FOLDER_IDS) {
    const v = el(id).value.trim();
    if (v) f[id] = v;
  }
  await chrome.storage.local.set({folders: f});
}

async function load() {
  const resp = await chrome.runtime.sendMessage({type: 'ui-config-get'});
  const text = (resp && resp.text) || '';
  el('text').value = text;
  el('folders').hidden = !!text.trim();
  show('', true);
}

el('save').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({type: 'ui-config-set', text: el('text').value});
  if (resp && resp.ok) {
    show(`Saved. Tasks: ${resp.tasks.join(', ') || '(none)'}`, true);
    el('folders').hidden = !!el('text').value.trim();
  } else {
    show('Not saved - errors:\n' + ((resp && resp.errors) || ['unknown error']).join('\n'), false);
  }
});

el('reload').addEventListener('click', load);
for (const id of FOLDER_IDS) el(id).addEventListener('input', saveFolders);

loadFolders();
load();
