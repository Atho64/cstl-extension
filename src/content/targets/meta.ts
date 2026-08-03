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
import { restoreNumberedLineBreaks } from '../../shared/text-utils';

const cfg = TARGETS.meta;
let lastSubmittedPayload = '';
let messageBaseline = new Set<string>();
const META_STOP_SELECTORS = [
  'button[aria-label*="Stop" i]',
  'button[aria-label*="Hentikan" i]',
  '[data-testid*="stop" i]',
  '[class*="stop-generat" i]',
];

function metaStillGenerating(): boolean {
  return isGenerating(META_STOP_SELECTORS, cfg.sendButton, false);
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

async function selectMetaMode(mode: 'instant' | 'berpikir'): Promise<string> {
  const trigger = document.querySelector<HTMLElement>('[data-testid="composer-mode-dropdown-button"]');
  if (!trigger || !isVisible(trigger)) return 'meta_mode_trigger_not_found';

  // Meta/Radix opens this menu on pointerdown. HTMLElement.click() alone
  // does not reach that handler from an extension content script.
  trigger.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, buttons: 1, isPrimary: true, pointerType: 'mouse',
  }));
  trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
  trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
  trigger.click();
  const wanted = mode === 'berpikir' ? ['berpikir', 'thinking'] : ['instan', 'instant'];
  const optionSelector = [
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[data-radix-popper-content-wrapper] button',
    '[data-radix-popper-content-wrapper] [role="button"]',
  ].join(', ');

  // Meta mounts the menu in a portal after the trigger click. Poll instead of
  // assuming it exists in the next animation frame.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(optionSelector));
    for (const candidate of candidates) {
      if (candidate.closest('[aria-hidden="true"]')) continue;
      const label = compact(`${candidate.getAttribute('aria-label') ?? ''} ${candidate.innerText ?? candidate.textContent ?? ''}`).toLowerCase();
      // Meta concatenates nested labels without a separating space, e.g.
      // "BerpikirBerpikir lebih lama untuk jawaban lebih baik".
      if (!wanted.some((value) => label === value || label.startsWith(value))) continue;

      candidate.scrollIntoView({ block: 'nearest' });
      candidate.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      candidate.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      candidate.click();
      await sleep(180);
      return `meta_mode:${mode}`;
    }
    await sleep(150);
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return 'meta_mode_option_not_found';
}

/**
 * Meta AI often renders each numbered translation line as adjacent inline
 * spans / blocks, so innerText collapses to:
 *   "1. foo2. bar3. baz"
 * CSTL numbered format needs real newlines before each "N. " marker.
 * Also handles mid-line glue like "...sakura.2. Arisa:".
 */
function cleanMetaResponseText(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  // Meta adds progress/action labels immediately before the response text.
  text = text.replace(
    /^(?:Saya sedang menyusun|Generating|Thinking|Meta AI)?\s*(?:Text)?plaintext\s*/i,
    ''
  );
  // Accessibility / toolbar crumbs sometimes prefix the body.
  text = text.replace(/^(?:Copy|Salin|Share|Bagikan|Regenerate)\s*/i, '');
  text = restoreNumberedLineBreaks(text);
  // Drop empty lines created by over-eager splits, keep single blanks max.
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // If body starts with numbered CSTL lines, drop non-digit junk before first "N. ".
  text = text.replace(/^[^\d\n]{0,80}?(?=\d{1,6}\.\s)/, '');
  return text.trim();
}

/**
 * Paste into Meta AI composer (Lexical / contenteditable).
 *
 * Generic pasteIntoComposer does execCommand('insertText') AND then fires
 * InputEvent('input') with the same payload — Lexical often applies both,
 * so the user sees the prompt twice (one flattened, one with newlines).
 *
 * Prefer a single ClipboardEvent('paste') path (same idea as ChatGPT),
 * then one insertText fallback only if the composer is still empty.
 */
async function pasteIntoMetaComposer(el: HTMLElement, text: string): Promise<boolean> {
  el.focus();
  await sleep(60);

  // Clear any previous draft without double-writing the new payload.
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('selectAll', false);
    // Delete selection only — do not insert yet.
    document.execCommand('delete', false);
  } catch {
    /* */
  }
  await sleep(40);

  // Method 1 — ClipboardEvent paste (Lexical / React listen for this).
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    // Some editors also look at text/html; keep plain only to avoid double body.
    const pasteEv = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(pasteEv);
    await sleep(120);
    const after = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (after.length > 0) return true;
  } catch {
    /* */
  }

  // Method 2 — single insertText (no extra synthetic InputEvent after).
  try {
    el.focus();
    document.execCommand('selectAll', false);
    const ok = document.execCommand('insertText', false, text);
    await sleep(80);
    const after = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (ok && after.length > 0) return true;
  } catch {
    /* */
  }

  // Method 3 — last resort: assign text once + one input event.
  try {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
      );
    }
    await sleep(80);
    return (el.innerText || el.textContent || '').trim().length > 0;
  } catch {
    return false;
  }
}

function getMetaMessageTexts(): string[] {
  const selectors = [
    '[data-testid*="response" i]',
    '[data-testid*="assistant" i]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[class*="assistant-message" i]',
    '[class*="response-content" i]',
    '[class*="message-bubble" i]',
    '[class*="message-content" i]',
  ];
  const seen = new Set<Element>();
  const texts: string[] = [];

  for (const selector of selectors) {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (seen.has(node) || !isVisible(node)) continue;
      // Skip if an ancestor was already captured (avoid nested duplicates).
      let parentCaptured = false;
      for (const prev of seen) {
        if (prev.contains(node) && prev !== node) {
          parentCaptured = true;
          break;
        }
      }
      if (parentCaptured) continue;
      seen.add(node);
      const copy = node.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('button, [role="button"], svg, nav, script, style').forEach((child) => child.remove());
      // Prefer innerText (keeps visual breaks). cleanMetaResponseText restores
      // numbered CSTL lines if Meta collapses them into one line.
      const text = cleanMetaResponseText(copy.innerText || copy.textContent || '');
      if (text.length >= 3) texts.push(text);
    }
  }

  return texts;
}

function getNewMetaResponse(): string {
  const payload = compact(lastSubmittedPayload);
  const texts = getMetaMessageTexts();

  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const text = texts[index];
    if (messageBaseline.has(text) || compact(text) === payload) continue;

    const withoutPrompt = payload && compact(text).includes(payload)
      ? cleanMetaResponseText(text.replace(payload, ''))
      : text;
    if (withoutPrompt.length >= 3) return withoutPrompt;
  }

  return '';
}

async function handle(msg: TargetAction): Promise<TargetActionResult> {
  const requestId = msg.requestId;
  try {
    if (msg.type === 'TARGET_NEW_CHAT') {
      const r = await clickNewChat(cfg.newChatLabels);
      return { ok: r.ok, requestId, stage: 'new_chat', detail: r.detail, error: r.ok ? undefined : r.detail };
    }
    if (msg.type === 'TARGET_SELECT_MODEL') {
      return { ok: true, requestId, stage: 'model', detail: 'meta_model_default' };
    }
    if (msg.type === 'TARGET_PASTE') {
      // After a New Chat navigation, Meta can briefly leave the previous
      // composer in the DOM. Wait for the live composer before opening the
      // mode menu, otherwise the click targets a stale trigger.
      const el = await waitForSelector(cfg.composer, 20_000);
      if (!el) return { ok: false, requestId, error: 'composer_not_found: buka Meta AI dan pastikan sudah login' };

      if (msg.modelKey === 'instant' || msg.modelKey === 'berpikir') {
        const modeResult = await selectMetaMode(msg.modelKey);
        if (modeResult !== `meta_mode:${msg.modelKey}`) {
          return { ok: false, requestId, error: `${modeResult}: pilihan mode Meta AI tidak ditemukan` };
        }
        await sleep(200);
      }

      messageBaseline = new Set(getMetaMessageTexts());
      const pasted = await pasteIntoMetaComposer(el as HTMLElement, msg.payload);
      if (!pasted) {
        return { ok: false, requestId, error: 'paste_failed: gagal paste ke Meta AI composer' };
      }
      lastSubmittedPayload = msg.payload;
      await sleep(150);
      if (msg.mode === 'full') {
        if (!clickSend(cfg.sendButton)) {
          return { ok: true, requestId, stage: 'pasted', error: 'paste_ok_send_failed: teks ter-paste, kirim manual' };
        }
        return { ok: true, requestId, stage: 'submitted' };
      }
      return { ok: true, requestId, stage: 'pasted' };
    }
    if (msg.type === 'TARGET_SUBMIT') {
      return clickSend(cfg.sendButton)
        ? { ok: true, requestId, stage: 'submitted' }
        : { ok: false, requestId, error: 'send_button_not_found' };
    }
    if (msg.type === 'TARGET_CHECK_GENERATING') {
      return { ok: true, requestId, generating: metaStillGenerating() };
    }
    if (msg.type === 'TARGET_FETCH_LAST') {
      const waited = await waitForStableAssistantText(cfg.assistantMessages, {
        timeoutMs: 90_000, pollMs: 350, stableMs: 1_800, minChars: 12, isStillGenerating: metaStillGenerating,
      });
      const text = getNewMetaResponse();
      if (!text) return { ok: false, requestId, error: 'empty_response: belum ada respons Meta AI baru atau selector berubah' };
      return { ok: true, requestId, text, stage: waited.stable ? 'done' : 'done_partial' };
    }
    return { ok: false, requestId, error: 'unknown_action' };
  } catch (e) {
    return { ok: false, requestId, error: e instanceof Error ? e.message : String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || (msg.target && msg.target !== 'meta')) return;
  if (['TARGET_PASTE', 'TARGET_FETCH_LAST', 'TARGET_SUBMIT', 'TARGET_CHECK_GENERATING', 'TARGET_SELECT_MODEL', 'TARGET_NEW_CHAT'].includes(msg.type)) {
    handle(msg as TargetAction).then(sendResponse);
    return true;
  }
});

console.debug('[cstl-ext] meta content script ready');
