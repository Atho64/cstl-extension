import { TARGETS } from '../../shared/targets-config';
import {
  clickNewChat,
  clickSend,
  isGenerating,
  sleep,
  waitForSelector,
  waitForStableAssistantText,
  type TargetAction,
  type TargetActionResult,
} from './dom-utils';

const cfg = TARGETS.chatgpt;

/** ChatGPT stop controls */
const CHATGPT_STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop" i]',
  'button[aria-label*="Henti" i]',
  'button[aria-label*="Stop streaming" i]',
];

function chatgptStillGenerating(): boolean {
  return isGenerating(CHATGPT_STOP_SELECTORS, cfg.sendButton, false);
}

/**
 * Paste teks ke ChatGPT's ProseMirror editor.
 *
 * ChatGPT menggunakan ProseMirror (bukan <textarea> biasa), sehingga
 * pendekatan execCommand('insertText') atau textContent= tidak akan
 * diterima sebagai input oleh React/ProseMirror.
 *
 * Cara yang benar: dispatch ClipboardEvent 'paste' dengan DataTransfer berisi teks.
 * ProseMirror mendengarkan event 'paste' dan menanganinya secara internal.
 */
async function pasteIntoChatGPT(el: HTMLElement, text: string): Promise<boolean> {
  el.focus();
  await sleep(80);

  // Pilih semua teks yang ada terlebih dahulu
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch { /* */ }

  // Method 1 — ClipboardEvent paste (ProseMirror mendengarkan event ini)
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasteEv = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    // ProseMirror mencegat paste dan memanggil preventDefault().
    // Jika event di-cancel (return false), berarti ProseMirror berhasil menangani.
    const notCancelled = el.dispatchEvent(pasteEv);
    await sleep(120);

    // Cek apakah teks berhasil masuk
    const content = (el.innerText || el.textContent || '').trim();
    if (!notCancelled || content.length > 0) {
      // Event di-cancel oleh ProseMirror = sukses, atau konten sudah ada
      return true;
    }
  } catch { /* */ }

  // Method 2 — execCommand insertText (fallback)
  try {
    // Hapus konten lama dulu
    document.execCommand('selectAll', false);
    const ok = document.execCommand('insertText', false, text);
    if (ok) {
      await sleep(80);
      return true;
    }
  } catch { /* */ }

  // Method 3 — Set via input event (React-style)
  try {
    // Clear existing
    el.innerHTML = '';
    // Set sebagai paragraph agar ProseMirror tidak bingung
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(80);
    return true;
  } catch { /* */ }

  return false;
}

/**
 * Scrape respons ChatGPT, buang semua noise (script, buttons, dll).
 * Selector utama: div[data-message-author-role="assistant"]
 */
function chatgptGetResponseText(): string {
  // Selector paling spesifik untuk respons ChatGPT
  const RESPONSE_SELECTORS = [
    // Konten markdown di dalam message assistant
    'div[data-message-author-role="assistant"] .markdown',
    // Seluruh message bubble assistant (jika .markdown tidak ada)
    'div[data-message-author-role="assistant"] [class*="prose"]',
    'div[data-message-author-role="assistant"]',
    // Conversation turn article
    'article[data-testid*="conversation-turn-"]:last-of-type .markdown',
  ];

  // Cari semua kandidat dari yang paling spesifik
  for (const sel of RESPONSE_SELECTORS) {
    try {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(sel));
      // Ambil dari belakang (respons terakhir)
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        const clone = node.cloneNode(true) as HTMLElement;
        // Buang script, style, button, icon noise
        clone.querySelectorAll(
          'script, style, noscript, button, [role="button"], svg, [aria-label*="Copy" i], [data-testid*="copy" i], [class*="action"], [class*="toolbar"]'
        ).forEach((n) => n.remove());
        const t = (clone.innerText || clone.textContent || '').trim();
        if (t.length > 12) return t;
      }
    } catch { /* */ }
  }

  return '';
}

async function handle(msg: TargetAction): Promise<TargetActionResult> {
  const requestId = msg.requestId;
  try {
    if (msg.type === 'TARGET_NEW_CHAT') {
      const r = await clickNewChat(cfg.newChatLabels);
      return {
        ok: r.ok,
        requestId,
        stage: 'new_chat',
        detail: r.detail,
        error: r.ok ? undefined : r.detail,
      };
    }

    if (msg.type === 'TARGET_SELECT_MODEL') {
      // Model selection not supported (requires ChatGPT Plus)
      return { ok: true, requestId, stage: 'model', detail: 'chatgpt_model_skip' };
    }

    if (msg.type === 'TARGET_PASTE') {
      const el = await waitForSelector(cfg.composer, 20000);
      if (!el) {
        return {
          ok: false,
          requestId,
          error: 'composer_not_found: buka ChatGPT dan pastikan sudah login',
        };
      }

      const ok = await pasteIntoChatGPT(el as HTMLElement, msg.payload);
      if (!ok) {
        return {
          ok: false,
          requestId,
          error: 'paste_failed: gagal paste ke ChatGPT composer',
        };
      }

      await sleep(150);

      if (msg.mode === 'full') {
        // Perlu delay lebih setelah paste sebelum kirim agar ChatGPT mengaktifkan tombol Send
        await sleep(300);
        const sent = clickSend(cfg.sendButton);
        if (!sent) {
          return {
            ok: true,
            requestId,
            stage: 'pasted',
            error: 'paste_ok_send_failed: teks ter-paste, kirim manual',
          };
        }
        return { ok: true, requestId, stage: 'submitted' };
      }
      return { ok: true, requestId, stage: 'pasted' };
    }

    if (msg.type === 'TARGET_SUBMIT') {
      const sent = clickSend(cfg.sendButton);
      if (!sent) return { ok: false, requestId, error: 'send_button_not_found' };
      return { ok: true, requestId, stage: 'submitted' };
    }

    if (msg.type === 'TARGET_CHECK_GENERATING') {
      const generating = chatgptStillGenerating();
      return { ok: true, requestId, generating };
    }

    if (msg.type === 'TARGET_FETCH_LAST') {
      const waited = await waitForStableAssistantText(cfg.assistantMessages, {
        timeoutMs: 90000,
        pollMs: 350,
        stableMs: 1800,
        minChars: 12,
        isStillGenerating: chatgptStillGenerating,
      });

      // Gunakan DOM scraper khusus yang lebih presisi (buang script/button noise)
      const domText = chatgptGetResponseText();
      const finalText = domText.trim() || waited.text.trim();

      if (!finalText) {
        return {
          ok: false,
          requestId,
          error: 'empty_response: belum ada balasan ChatGPT / masih generate / selector berubah',
        };
      }
      return {
        ok: true,
        requestId,
        text: finalText,
        stage: waited.stable ? 'done' : 'done_partial',
        error: waited.stable ? undefined : `scrape_${waited.reason}`,
      };
    }

    return { ok: false, requestId, error: 'unknown_action' };
  } catch (e) {
    return { ok: false, requestId, error: e instanceof Error ? e.message : String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.target && msg.target !== 'chatgpt') return;
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

console.debug('[cstl-ext] chatgpt content script ready');
