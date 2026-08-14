'use strict';

const el = id => document.getElementById(id);

async function refresh() {
  let st;
  try { st = await chrome.runtime.sendMessage({type: 'ui-status'}); }
  catch (e) { return; }
  if (!st) return;

  const tasksDiv = el('tasks');
  const sig = JSON.stringify([st.tasks, st.running]);
  if (tasksDiv.dataset.sig !== sig) {
    tasksDiv.dataset.sig = sig;
    tasksDiv.textContent = '';
    for (const t of st.tasks || []) {
      const b = document.createElement('button');
      b.className = 'run';
      b.textContent = t.key ? `${t.name}  (${t.key})` : t.name;
      b.disabled = st.running;
      b.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({type: 'ui-run', task: t.name});
        setTimeout(refresh, 150);
      });
      tasksDiv.appendChild(b);
    }
    if (!(st.tasks || []).length)
      tasksDiv.textContent = st.empty
        ? 'No configuration - Ctrl+Shift+S saves the shown page as-is. Open Configuration to set folders or paste an adapter.'
        : 'No tasks in the configuration.';
  }

  el('stop').hidden = !st.running;
  el('status').textContent = st.running
      ? `Running "${st.task}"… ${st.saved} file(s) saved`
      : (st.saved ? `Idle. Last run saved ${st.saved} file(s).` : 'Idle.');

  const log = el('log');
  const text = (st.log || []).join('\n');
  if (log.textContent !== text) {
    log.textContent = text;
    log.scrollTop = log.scrollHeight;
  }
}

el('stop').addEventListener('click', () => chrome.runtime.sendMessage({type: 'ui-stop'}));
el('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'ui-clear-log'});
  refresh();
});
el('options').addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

refresh();
setInterval(refresh, 700);
