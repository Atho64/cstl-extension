import {
  CAPABLE_MODES,
  CAPABLE_TARGETS,
  CSTL_EXT_PROTOCOL,
  DEFAULT_SETTINGS,
  SOURCE_APP,
  SOURCE_EXT,
  type CstlToExtMessage,
  type ExtSettings,
  type ExtToCstlMessage,
} from '../shared/protocol';

function replyToPage(msg: ExtToCstlMessage): void {
  window.postMessage({ source: SOURCE_EXT, msg }, '*');
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== SOURCE_APP) return;
  const msg = data.msg as CstlToExtMessage | undefined;
  if (!msg || typeof msg !== 'object' || !msg.type) return;

  chrome.runtime.sendMessage(msg, (response) => {
    const err = chrome.runtime.lastError;
    if (err) {
      replyToPage({
        v: CSTL_EXT_PROTOCOL,
        type: 'COPAS_STATUS',
        requestId: (msg as { requestId?: string }).requestId || 'unknown',
        stage: 'error',
        detail: err.message || 'extension_runtime_error',
      });
      return;
    }
    if (response) {
      replyToPage(response as ExtToCstlMessage);
    }
  });
});

// Push events from background → page
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (
    msg.type === 'COPAS_STATUS' ||
    msg.type === 'COPAS_RESULT' ||
    msg.type === 'COPAS_PONG' ||
    msg.type === 'COPAS_SETTINGS'
  ) {
    replyToPage(msg as ExtToCstlMessage);
  }
});

// Announce ready
replyToPage({ v: CSTL_EXT_PROTOCOL, type: 'COPAS_BRIDGE_READY' });
console.debug('[cstl-ext] CSTL bridge ready');

// silence unused import warnings in some builds
void CAPABLE_MODES;
void CAPABLE_TARGETS;
void DEFAULT_SETTINGS;
void SOURCE_APP;
