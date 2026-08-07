import { TARGETS } from '../../shared/targets-config';
import { chooseBestQwenResponse, normalizeQwenResponseText } from '../../shared/text-utils';
import {
  clickSend,
  copyLastAssistantPlaintext,
  isGenerating,
  pasteIntoComposer,
  sleep,
  waitForSelector,
  type TargetAction,
  type TargetActionResult,
} from './dom-utils';

const cfg = TARGETS.arena;
let responseBaseline = new Set<string>();
let lastSubmittedPayload = '';

const ARENA_STOP_SELECTORS = [
  'button[aria-label*="Stop" i]',
  'button[title*="Stop" i]',
  '[data-testid*="stop" i]',
];

function arenaStillGenerating(): boolean {
  return isGenerating(ARENA_STOP_SELECTORS, cfg.sendButton, true);
}

function collectArenaCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const selector of cfg.assistantMessages) {
    try {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(
          'script, style, noscript, button, [role="button"], svg, textarea, input, [aria-label*="Copy" i], [class*="toolbar" i], [class*="action" i]'
        ).forEach((child) => child.remove());
        let text = normalizeQwenResponseText(clone.innerText || clone.textContent || '');
        if (lastSubmittedPayload && text.includes(lastSubmittedPayload)) {
          text = normalizeQwenResponseText(text.replace(lastSubmittedPayload, ''));
        }
        if (text.length < 12 || responseBaseline.has(text) || seen.has(text)) continue;
        seen.add(text);
        candidates.push(text);
      }
    } catch { /* selector fallback */ }
  }
  return candidates;
}

function collectCurrentArenaTexts(): string[] {
  const previousBaseline = responseBaseline;
  responseBaseline = new Set();
  const texts = collectArenaCandidates();
  responseBaseline = previousBaseline;
  return texts;
}

function bestArenaResponse(): string {
  return chooseBestQwenResponse(collectArenaCandidates());
}

async function waitForStableArenaResponse(): Promise<{ text: string; stable: boolean; reason: string }> {
  const deadline = Date.now() + 90000;
  let previous = '';
  let stableSince = 0;
  let samples = 0;
  let sawGrowth = false;
  while (Date.now() < deadline) {
    if (arenaStillGenerating()) {
      stableSince = 0;
      samples = 0;
      await sleep(400);
      continue;
    }
    const current = bestArenaResponse();
    if (current && current === previous) {
      samples++;
      if (!stableSince) stableSince = Date.now();
      if (samples >= 10 && Date.now() - stableSince >= 5000) {
        return { text: current, stable: true, reason: 'stable' };
      }
    } else {
      if (current.length > previous.length) sawGrowth = true;
      previous = current;
      stableSince = current ? Date.now() : 0;
      samples = 0;
    }
    await sleep(400);
  }
  return { text: bestArenaResponse(), stable: false, reason: sawGrowth ? 'timeout_with_partial' : 'timeout' };
}

async function handle(msg: TargetAction): Promise<TargetActionResult> {
  const requestId = msg.requestId;
  try {
    if (msg.type === 'TARGET_NEW_CHAT') {
      return { ok: true, requestId, stage: 'new_chat', detail: 'arena_existing_chat_keep' };
    }
    if (msg.type === 'TARGET_SELECT_MODEL') {
      return { ok: true, requestId, stage: 'model', detail: 'arena_model_manual' };
    }
    if (msg.type === 'TARGET_PASTE') {
      const composer = await waitForSelector(cfg.composer, 15000);
      if (!composer) return { ok: false, requestId, error: 'composer_not_found: buka Arena Direct dan pilih model terlebih dahulu' };
      responseBaseline = new Set(collectCurrentArenaTexts());
      lastSubmittedPayload = msg.payload;
      await pasteIntoComposer(composer, msg.payload);
      await sleep(250);
      if (msg.mode === 'full') {
        const sent = clickSend(cfg.sendButton);
        if (!sent) return { ok: true, requestId, stage: 'pasted', error: 'paste_ok_send_failed: teks ter-paste, kirim manual' };
        return { ok: true, requestId, stage: 'submitted' };
      }
      return { ok: true, requestId, stage: 'pasted' };
    }
    if (msg.type === 'TARGET_SUBMIT') {
      const sent = clickSend(cfg.sendButton);
      return sent ? { ok: true, requestId, stage: 'submitted' } : { ok: false, requestId, error: 'send_button_not_found' };
    }
    if (msg.type === 'TARGET_CHECK_GENERATING') {
      return { ok: true, requestId, generating: arenaStillGenerating() };
    }
    if (msg.type === 'TARGET_FETCH_LAST') {
      const copied = await copyLastAssistantPlaintext(cfg.assistantMessages);
      if (!copied) return { ok: false, requestId, error: 'empty_response: tombol Copy Arena tidak menghasilkan plaintext' };
      return {
        ok: true,
        requestId,
        text: copied,
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
  if (msg.target && msg.target !== 'arena') return;
  if (
    msg.type === 'TARGET_PASTE' || msg.type === 'TARGET_FETCH_LAST' ||
    msg.type === 'TARGET_SUBMIT' || msg.type === 'TARGET_CHECK_GENERATING' ||
    msg.type === 'TARGET_SELECT_MODEL' || msg.type === 'TARGET_NEW_CHAT'
  ) {
    handle(msg as TargetAction).then(sendResponse);
    return true;
  }
});

console.debug('[cstl-ext] arena content script ready');
