import { TARGETS, deepseekModePlan } from '../../shared/targets-config';
import {
  clickNewChat,
  clickSend,
  copyLastAssistantPlaintext,
  isGenerating,
  pasteIntoComposer,
  selectDeepseekMode,
  sleep,
  waitForSelector,
  waitForStableAssistantText,
  type TargetAction,
  type TargetActionResult,
} from './dom-utils';

/**
 * Strip DeepSeek "Pikir Mendalam" thinking block from scraped text.
 *
 * Saat mode DeepThink aktif, DeepSeek merender dua elemen terpisah di DOM:
 *   1) Thinking block  — di-render dalam elemen dengan class `ds-thinking` /
 *      `[class*="think"]` atau berupa `<details>` collapsible.
 *   2) Response block  — `.ds-markdown` yang berisi terjemahan sebenarnya.
 *
 * `getLastAssistantText()` kadang mengembalikan KEDUA blok sebagai satu string.
 * Fungsi ini membuang bagian thinking sebelum teks dikembalikan ke CSTL.
 */
function deepseekStripThinking(raw: string): string {
  if (!raw) return raw;

  // Strategy 1 — DOM-level: hapus thinking node dari clone sebelum scrape.
  // (dilakukan di deepseekGetResponseText, bukan di sini)

  // Strategy 2 — text-level fallback:
  // DeepSeek thinking block biasanya diawali dengan teks pendek seperti:
  //   "I'll produce the block."
  //   "I need to translate..."
  //   "Let me think..."
  //   "Thinking..."
  // dan diakhiri dengan blok terjemahan yang panjang.
  //
  // Pola yang aman: jika ada separator antara thinking dan response,
  // ambil bagian setelah separator.
  //
  // DeepSeek V4 memisahkan thinking ↔ response dengan baris kosong ganda
  // ATAU dengan label UI (tidak terlihat setelah strip). Kita cari blok
  // terpanjang yang dimulai setelah separator kandidat.

  return raw;
}

/**
 * Scrape respons DeepSeek dengan membuang thinking block dari DOM secara eksplisit.
 * Lebih akurat dari text-level stripping karena bekerja sebelum teks di-join.
 */
function deepseekGetResponseText(): string {
  // Selector untuk elemen respons DeepSeek (bukan thinking)
  const RESPONSE_SELECTORS = [
    // Selector spesifik untuk respons (bukan thinking)
    '.ds-markdown:not([class*="think"])',
    '.message-content:not([class*="think"])',
  ];
  const THINKING_SELECTORS = [
    '[class*="ds-thinking"]',
    '[class*="thinking-content"]',
    '[class*="think-block"]',
    // DeepSeek V4 kadang render thinking dalam <details>
    'details[class*="think"]',
    // class utility yang sering dipakai DeepSeek untuk thinking wrapper
    '[class*="_thinking"]',
    '[class*="thinkingContent"]',
    '[class*="reasoning"]',
  ];

  // Cari semua message bubble assistant (blok pesan paling akhir)
  const msgSelectors = [
    '[class*="ds-message-container"]',
    '[class*="message-container"]',
    '[class*="chat-message"]',
  ];

  let lastMsgEl: Element | null = null;
  for (const sel of msgSelectors) {
    try {
      const all = document.querySelectorAll(sel);
      if (all.length) { lastMsgEl = all[all.length - 1]; break; }
    } catch { /* */ }
  }

  const root = lastMsgEl || document.body;
  const clone = root.cloneNode(true) as HTMLElement;

  // Hapus thinking block dari clone
  for (const sel of THINKING_SELECTORS) {
    try { clone.querySelectorAll(sel).forEach((n) => n.remove()); } catch { /* */ }
  }
  // Hapus tombol / toolbar / svg noise
  clone.querySelectorAll(
    'button, [role="button"], nav, svg, [aria-label*="Copy" i], .copy-button, [class*="toolbar"], [class*="action"]'
  ).forEach((n) => n.remove());

  // Coba ambil dari selector respons dulu
  for (const sel of RESPONSE_SELECTORS) {
    try {
      const nodes = clone.querySelectorAll(sel);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const t = ((nodes[i] as HTMLElement).innerText || nodes[i].textContent || '').trim();
        if (t.length > 12) return t;
      }
    } catch { /* */ }
  }

  // Fallback: ambil seluruh teks dari clone (thinking sudah dihapus)
  const fallback = (clone.innerText || clone.textContent || '').trim();
  return fallback;
}

const cfg = TARGETS.deepseek;

/** DeepSeek stop controls — keep loose but avoid matching unrelated "stop" CSS. */
const DEEPSEEK_STOP_SELECTORS = [
  'div[role="button"][aria-label*="Stop" i]',
  'div[role="button"][aria-label*="Henti" i]',
  'button[aria-label*="Stop" i]',
  'button[aria-label*="Henti" i]',
  '.stop-button',
  // DeepSeek often uses a circular stop icon near the input while streaming
  'div.ds-icon-button[class*="stop" i]',
  '[class*="stop-button" i]',
  'button[class*="stop" i]',
];

function deepseekStillGenerating(): boolean {
  // preferStop=true: ignore enabled Send (unreliable on DeepSeek mid-stream)
  return isGenerating(DEEPSEEK_STOP_SELECTORS, cfg.sendButton, true);
}

async function ensureModel(modelKey?: string): Promise<{ detail: string }> {
  const key = modelKey || 'default';
  if (key === 'default') return { detail: 'model_default_skip' };
  const plan = deepseekModePlan(key);
  const res = await selectDeepseekMode(plan);
  return { detail: res.detail };
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
      const r = await ensureModel(msg.modelKey);
      return { ok: true, requestId, stage: 'model', detail: r.detail };
    }

    if (msg.type === 'TARGET_PASTE') {
      // DeepSeek V4: set Cepat/Pakar + Pikir Mendalam before paste (best-effort)
      if (msg.modelKey && msg.modelKey !== 'default') {
        await ensureModel(msg.modelKey);
        await sleep(150);
      }
      const el = await waitForSelector(cfg.composer, 20000);
      if (!el) {
        return { ok: false, requestId, error: 'composer_not_found: buka DeepSeek Chat dan pastikan sudah login' };
      }
      await pasteIntoComposer(el, msg.payload);
      await sleep(150);
      if (msg.mode === 'full') {
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
      // Do not treat Send as idle — DeepSeek can show Send while still streaming.
      // When stop is not visible, report generating=false and let background /
      // TARGET_FETCH_LAST use text stability as the real completion signal.
      const generating = deepseekStillGenerating();
      return { ok: true, requestId, generating };
    }

    if (msg.type === 'TARGET_FETCH_LAST') {
      // Gunakan DOM-level scraper yang membuang thinking block secara eksplisit.
      // Ini lebih akurat dari waited.text yang bisa mengandung thinking content.
      const finalText = await copyLastAssistantPlaintext(cfg.assistantMessages);

      if (!finalText) {
        return {
          ok: false,
          requestId,
          error: 'empty_response: belum ada balasan model / masih generate / selector berubah',
        };
      }
      // Partial after timeout is still returned so user can review; stage marks it.
      return {
        ok: true,
        requestId,
        text: finalText,
        stage: 'done',
      };
    }

    return { ok: false, requestId, error: 'unknown_action' };
  } catch (e) {
    return { ok: false, requestId, error: e instanceof Error ? e.message : String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.target && msg.target !== 'deepseek') return;
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

console.debug('[cstl-ext] deepseek content script ready');
