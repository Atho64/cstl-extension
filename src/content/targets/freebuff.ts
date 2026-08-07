import { TARGETS } from '../../shared/targets-config';
import {
  clickNewChat,
  clickSend,
  getLastAssistantText,
  isGenerating,
  pasteIntoComposer,
  sleep,
  waitForSelector,
  type TargetAction,
  type TargetActionResult,
} from './dom-utils';

const cfg = TARGETS.freebuff;

const FREEBUFF_STOP_SELECTORS = [
  'button[aria-label="Stop generating"]',
  'button[aria-label*="Stop" i]',
];

function freebuffStillGenerating(): boolean {
  // While streaming, Freebuff swaps the Send button for "Stop generating".
  // When idle, Send is visible + enabled → treated as done.
  return isGenerating(FREEBUFF_STOP_SELECTORS, cfg.sendButton, false);
}

function lastMarkdownNode(): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('div.chat-markdown'));
  for (let i = nodes.length - 1; i >= 0; i--) {
    if ((nodes[i].innerText || '').trim()) return nodes[i];
  }
  return null;
}

/**
 * Freebuff's code-block Copy control carries the full plaintext in its
 * aria-label ("Copy: <text>") and stays opacity-0 until hover, so we ignore
 * visibility. Strategy: click the site's Copy + read clipboard, fall back to
 * the aria-label text, then to a DOM scrape of .chat-markdown.
 */
async function fetchFreebuffResponse(timeoutMs = 5000): Promise<string> {
  const md = lastMarkdownNode();
  if (!md) throw new Error('empty_response: belum ada balasan Freebuff');

  // Locate the copy control inside the last response (code-block copy lives
  // inside .chat-markdown; card-level copy sits on an ancestor).
  let copy: HTMLButtonElement | null = null;
  let root: HTMLElement | null = md;
  for (let depth = 0; depth < 5 && root && !copy; depth++) {
    copy = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => (b.getAttribute('aria-label') || '').startsWith('Copy:')
    ) || null;
    root = root.parentElement;
  }

  if (copy) {
    try {
      const sentinel = `__CSTL_COPY_PENDING_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
      let sentinelArmed = false;
      try {
        await navigator.clipboard.writeText(sentinel);
        sentinelArmed = true;
      } catch { /* compare against previous value instead */ }
      const previous = sentinelArmed ? sentinel : await navigator.clipboard.readText().catch(() => '');
      copy.click();
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const text = await navigator.clipboard.readText();
          const normalized = text.replace(/\r\n/g, '\n').trim();
          if (normalized && normalized !== previous && !normalized.startsWith('__CSTL_COPY_PENDING_')) {
            return normalized;
          }
        } catch { /* clipboard not ready */ }
        await sleep(150);
      }
    } catch { /* fall through to aria-label */ }

    // Fallback: the aria-label itself contains "Copy: <full plaintext>"
    const aria = copy.getAttribute('aria-label') || '';
    if (aria.startsWith('Copy:')) {
      const text = aria.slice(5).replace(/\r\n/g, '\n').trim();
      if (text) return text;
    }
  }

  // Last resort: scrape the markdown node
  return getLastAssistantText(cfg.assistantMessages);
}

async function handle(msg: TargetAction): Promise<TargetActionResult> {
  const requestId = msg.requestId;
  try {
    if (msg.type === 'TARGET_NEW_CHAT') {
      const result = await clickNewChat(cfg.newChatLabels);
      return { ok: result.ok, requestId, stage: 'new_chat', detail: result.detail, error: result.ok ? undefined : result.detail };
    }

    if (msg.type === 'TARGET_SELECT_MODEL') {
      return { ok: true, requestId, stage: 'model', detail: 'freebuff_model_default_skip' };
    }

    if (msg.type === 'TARGET_PASTE') {
      const composer = await waitForSelector(cfg.composer, 20000);
      if (!composer) {
        return { ok: false, requestId, error: 'composer_not_found: buka freebuff.com/chat dan pastikan sudah login' };
      }
      await pasteIntoComposer(composer, msg.payload);
      await sleep(200);
      if (msg.mode === 'full') {
        const sent = clickSend(cfg.sendButton);
        if (!sent) return { ok: true, requestId, stage: 'pasted', error: 'paste_ok_send_failed: teks ter-paste, kirim manual' };
        return { ok: true, requestId, stage: 'submitted' };
      }
      return { ok: true, requestId, stage: 'pasted' };
    }

    if (msg.type === 'TARGET_SUBMIT') {
      const sent = clickSend(cfg.sendButton);
      return sent
        ? { ok: true, requestId, stage: 'submitted' }
        : { ok: false, requestId, error: 'send_button_not_found' };
    }

    if (msg.type === 'TARGET_CHECK_GENERATING') {
      return { ok: true, requestId, generating: freebuffStillGenerating() };
    }

    if (msg.type === 'TARGET_FETCH_LAST') {
      // Semi mode can hit "Ambil Hasil" while the stream is still running —
      // wait for generation to finish before scraping.
      const deadline = Date.now() + 120000;
      while (freebuffStillGenerating() && Date.now() < deadline) {
        await sleep(500);
      }
      const text = await fetchFreebuffResponse();
      if (!text) return { ok: false, requestId, error: 'empty_response: belum ada balasan Freebuff / selector berubah' };
      return {
        ok: true,
        requestId,
        text,
        stage: 'done',
      };
    }

    return { ok: false, requestId, error: 'unknown_action' };
  } catch (error) {
    return { ok: false, requestId, error: error instanceof Error ? error.message : String(error) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.target && msg.target !== 'freebuff') return;
  if (
    msg.type === 'TARGET_PASTE' ||
    msg.type === 'TARGET_FETCH_LAST' ||
    msg.type === 'TARGET_SUBMIT' ||
    msg.type === 'TARGET_CHECK_GENERATING' ||
    msg.type === 'TARGET_SELECT_MODEL' ||
    msg.type === 'TARGET_NEW_CHAT'
  ) {
    handle(msg as TargetAction).then(sendResponse);
    return true;
  }
});

console.debug('[cstl-ext] freebuff content script ready');
