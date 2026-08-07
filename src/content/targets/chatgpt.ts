import { TARGETS } from '../../shared/targets-config';
import {
  clickNewChat,
  clickSend,
  copyLastAssistantPlaintext,
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

const TEXT_FIELD_LABELS = [
  'tampilkan di bidang teks',
  'tampilkan dalam bidang teks',
  'show in text field',
  'show in text editor',
  'open in text editor',
  'open in canvas',
  'edit in canvas',
];

function normalizedLabel(el: Element): string {
  return [
    (el as HTMLElement).innerText,
    el.textContent,
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function dispatchRealisticClick(el: HTMLElement): void {
  const eventInit: MouseEventInit = { bubbles: true, cancelable: true, view: window };
  try { el.dispatchEvent(new PointerEvent('pointerdown', eventInit)); } catch { /* */ }
  el.dispatchEvent(new MouseEvent('mousedown', eventInit));
  try { el.dispatchEvent(new PointerEvent('pointerup', eventInit)); } catch { /* */ }
  el.dispatchEvent(new MouseEvent('mouseup', eventInit));
  el.dispatchEvent(new MouseEvent('click', eventInit));
}

/** Open ChatGPT's text-field/canvas artifact when the response is collapsed. */
async function openLatestTextFieldIfPresent(): Promise<boolean> {
  const selectors = 'button, a, [role="button"], [tabindex="0"], [data-testid], div, span';
  const matches = Array.from(document.querySelectorAll<HTMLElement>(selectors))
    .map(el => ({ el, label: normalizedLabel(el) }))
    .filter(({ el, label }) => {
      if (!TEXT_FIELD_LABELS.some(candidate => label.includes(candidate))) return false;
      const textLength = label.length;
      return textLength >= 12 && textLength <= 180 && isVisible(el);
    })
    .sort((a, b) => a.label.length - b.label.length);

  for (const { el } of matches) {
    // React sometimes attaches the handler to an otherwise plain parent div.
    // A synthetic click on the text itself bubbles; if that does not open the
    // panel, retry its nearest ancestors one by one.
    let control: HTMLElement | null = el;
    for (let depth = 0; depth < 6 && control; depth++, control = control.parentElement) {
      control.scrollIntoView({ block: 'center', inline: 'center' });
      dispatchRealisticClick(control);
      await sleep(500);
      if (getOpenTextFieldText()) return true;
    }
    // The panel may need longer to mount even though the click succeeded.
    return true;
  }
  return false;
}

/**
 * Long prompts pasted into ChatGPT can become an attachment card instead of
 * editable composer text. Expand that card before clicking Send.
 */
async function expandComposerAttachment(composer: HTMLElement, payload: string): Promise<boolean> {
  const minimumExpandedLength = Math.min(200, Math.max(20, Math.floor(payload.length * 0.1)));
  const composerLength = () => (composer.innerText || composer.textContent || '').trim().length;
  if (composerLength() >= minimumExpandedLength) return true;

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const showButton = buttons.find(el => {
      const label = normalizedLabel(el);
      return TEXT_FIELD_LABELS.some(candidate => label === candidate || label.includes(candidate));
    });

    if (showButton && isVisible(showButton)) {
      showButton.scrollIntoView({ block: 'center', inline: 'center' });
      dispatchRealisticClick(showButton);

      const expandDeadline = Date.now() + 10000;
      while (Date.now() < expandDeadline) {
        if (composerLength() >= minimumExpandedLength) return true;
        await sleep(200);
      }
      return false;
    }

    // The attachment UI may mount shortly after the paste event.
    if (composerLength() >= minimumExpandedLength) return true;
    await sleep(200);
  }

  // Short prompts may remain directly in the editor without an attachment.
  return composerLength() > 0;
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

/** Read the largest visible editor opened by "Tampilkan di bidang teks". */
function collectTextFieldCandidates(root: Document | ShadowRoot, candidates: string[]): void {
  const selectors = [
    '[data-testid*="canvas" i] [contenteditable="true"]',
    '[data-testid*="text-editor" i] [contenteditable="true"]',
    '[class*="canvas" i] [contenteditable="true"]',
    '[class*="text-editor" i] [contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '.cm-content[contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea[data-testid*="canvas" i]',
    'textarea[class*="editor" i]',
    'textarea:not(#prompt-textarea)',
    '[data-testid*="canvas" i]',
    '[data-testid*="artifact" i]',
    '[class*="canvas" i] [class*="prose" i]',
    '[class*="artifact" i] [class*="prose" i]',
    'aside [class*="prose" i]',
    '[role="dialog"] [class*="prose" i]',
  ];
  const seen = new Set<Element>();
  for (const selector of selectors) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      if (seen.has(el) || !isVisible(el) || el.id === 'prompt-textarea' || el.closest('form')) continue;
      seen.add(el);
      const text = el instanceof HTMLTextAreaElement ? el.value : (el.innerText || el.textContent || '');
      const clean = text.replace(/\u00a0/g, ' ').trim();
      if (clean.length > 12 && !TEXT_FIELD_LABELS.some(label => clean.toLowerCase() === label)) candidates.push(clean);
    }
  }

  // Canvas may be mounted in an open shadow root.
  for (const host of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (host.shadowRoot) collectTextFieldCandidates(host.shadowRoot, candidates);
  }
}

function getOpenTextFieldText(): string {
  const candidates: string[] = [];
  collectTextFieldCandidates(document, candidates);

  // Some ChatGPT Canvas builds render the editor inside a same-origin iframe.
  for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))) {
    try {
      if (frame.contentDocument) collectTextFieldCandidates(frame.contentDocument, candidates);
    } catch { /* cross-origin frame; cannot inspect from this content script */ }
  }

  const composerText = (document.querySelector<HTMLElement>('#prompt-textarea')?.innerText || '').trim();
  const unique = Array.from(new Set(candidates)).filter(text => text !== composerText);
  return unique.sort((a, b) => b.length - a.length)[0] || '';
}

async function waitForOpenTextFieldText(timeoutMs = 30000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let best = '';
  let previous = '';
  let stableSince = 0;
  while (Date.now() < deadline) {
    const current = getOpenTextFieldText();
    if (current.length > best.length) best = current;
    if (current && current === previous) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 1500) return current;
    } else {
      previous = current;
      stableSince = current ? Date.now() : 0;
    }
    await sleep(250);
  }
  return best;
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

      // ChatGPT turns long pasted prompts into a document attachment. Click
      // "Tampilkan di bidang teks" first so the full prompt is restored into
      // #prompt-textarea before attempting to send it.
      const expanded = await expandComposerAttachment(el as HTMLElement, msg.payload);
      if (!expanded) {
        return {
          ok: false,
          requestId,
          error: 'composer_attachment_expand_failed: tombol Tampilkan di bidang teks ditemukan tetapi isi belum terbuka',
        };
      }

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
      const finalText = await copyLastAssistantPlaintext(cfg.assistantMessages);

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
