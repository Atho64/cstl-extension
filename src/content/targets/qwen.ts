import { TARGETS } from '../../shared/targets-config';
import { chooseBestQwenResponse, normalizeQwenResponseText } from '../../shared/text-utils';
import {
  clickNewChat,
  clickSend,
  isGenerating,
  pasteIntoComposer,
  sleep,
  waitForSelector,
  type TargetAction,
  type TargetActionResult,
} from './dom-utils';

const cfg = TARGETS.qwen;

const QWEN_STOP_SELECTORS = [
  'button[aria-label*="Stop" i]',
  'button[aria-label*="Henti" i]',
  'button[title*="Stop" i]',
  '[data-testid*="stop" i]',
];

function qwenStillGenerating(): boolean {
  return isGenerating(QWEN_STOP_SELECTORS, cfg.sendButton, false);
}

function getQwenResponseText(): string {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const selector of cfg.assistantMessages) {
    try {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
      for (let i = nodes.length - 1; i >= 0; i--) {
        const clone = nodes[i].cloneNode(true) as HTMLElement;
        clone.querySelectorAll(
          'script, style, noscript, button, [role="button"], svg, [aria-label*="Copy" i], [class*="toolbar" i], [class*="action" i]'
        ).forEach((node) => node.remove());
        const text = normalizeQwenResponseText(clone.innerText || clone.textContent || '');
        if (text.length > 12 && !seen.has(text)) {
          seen.add(text);
          candidates.push(text);
        }
      }
    } catch { /* selector fallback */ }
  }
  return chooseBestQwenResponse(candidates);
}

async function waitForStableQwenResponse(): Promise<{ text: string; stable: boolean; reason: string }> {
  const deadline = Date.now() + 90000;
  let previous = '';
  let stableSince = 0;
  let sawGrowth = false;
  let samples = 0;
  while (Date.now() < deadline) {
    if (qwenStillGenerating()) {
      stableSince = 0;
      await sleep(350);
      continue;
    }
    const current = getQwenResponseText();
    if (current && current === previous) {
      samples++;
      if (!stableSince) stableSince = Date.now();
      // Qwen can pause briefly between streamed chunks; require a longer
      // quiet window and several identical samples before scraping.
      if (samples >= 12 && Date.now() - stableSince >= 6000) return { text: current, stable: true, reason: 'stable' };
    } else {
      if (current.length > previous.length) sawGrowth = true;
      previous = current;
      stableSince = current ? Date.now() : 0;
      samples = 0;
    }
    await sleep(350);
  }
  return { text: getQwenResponseText(), stable: false, reason: sawGrowth ? 'timeout_with_partial' : 'timeout' };
}

async function handle(msg: TargetAction): Promise<TargetActionResult> {
  const requestId = msg.requestId;
  try {
    if (msg.type === 'TARGET_NEW_CHAT') {
      const result = await clickNewChat(cfg.newChatLabels);
      return { ok: result.ok, requestId, stage: 'new_chat', detail: result.detail, error: result.ok ? undefined : result.detail };
    }

    if (msg.type === 'TARGET_SELECT_MODEL') {
      return { ok: true, requestId, stage: 'model', detail: 'qwen_model_default_skip' };
    }

    if (msg.type === 'TARGET_PASTE') {
      const composer = await waitForSelector(cfg.composer, 20000);
      if (!composer) {
        return { ok: false, requestId, error: 'composer_not_found: buka Qwen Studio dan pastikan sudah login' };
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
      return { ok: true, requestId, generating: qwenStillGenerating() };
    }

    if (msg.type === 'TARGET_FETCH_LAST') {
      const waited = await waitForStableQwenResponse();
      const text = waited.text;
      if (!text) return { ok: false, requestId, error: 'empty_response: belum ada balasan Qwen / masih generate / selector berubah' };
      return {
        ok: true,
        requestId,
        text,
        stage: waited.stable ? 'done' : 'done_partial',
        error: waited.stable ? undefined : `scrape_${waited.reason}`,
      };
    }

    return { ok: false, requestId, error: 'unknown_action' };
  } catch (error) {
    return { ok: false, requestId, error: error instanceof Error ? error.message : String(error) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.target && msg.target !== 'qwen') return;
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

console.debug('[cstl-ext] qwen content script ready');
