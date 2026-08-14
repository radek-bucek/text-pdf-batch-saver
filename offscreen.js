'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'blob-url') {
    const bytes = Uint8Array.from(atob(msg.b64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
    sendResponse({url});
    return false;
  }
  if (msg.type === 'revoke-blob-url') {
    URL.revokeObjectURL(msg.url);
    sendResponse({ok: true});
    return false;
  }
  return false;
});
