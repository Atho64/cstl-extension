import { TARGETS, geminiModePlan } from '../../shared/targets-config';
import {
  clickNewChat,
  clickSend,
  isGenerating,
  pasteIntoComposer,
  selectGeminiMode,
  sleep,
  waitForSelector,
  waitForStableAssistantText,
  type TargetAction,
  type TargetActionResult,
} from './dom-utils';

const cfg = TARGETS.gemini;

const GEMINI_STOP_SELECTORS = [
  'button[aria-label*="Stop generating" i]',
  'button[aria-label*="Stop response" i]',
  'button[aria-label*="Stop streaming" i]',
  'button[aria-label*="Hentikan pembuatan" i]',
  'button[aria-label*="Hentikan respons" i]',
  '.stop-generating-button',
  '[data-testid="stop-button"]',
  'button[mattooltip*="Stop" i]',
];

function geminiStillGenerating(): boolean {
  // Gemini: enabled Send is a reliable idle signal (preferStop=false)
  return isGenerating(GEMINI_STOP_SELECTORS, cfg.sendButton, false);
}

async function ensureModel(modelKey?: string): Promise<{ detail: string }> {
  const key = modelKey || 'default';
  if (key === 'default') return { detail: 'model_default_skip' };
  const plan = geminiModePlan(key);
  const res = await selectGeminiMode(plan);
  return { detail: res.detail };
}

async function handle(msg: TargetAction): Promise<TargetActionResult> {
  const requestId = msg.requestId;
  try {
    if (msg.type === 'TARGET_NEW_CHAT') {
      const r = await clickNewChat(cfg.newChatLabels);
      return { ok: r.ok, requestId, stage: 'new_chat', detail: r.detail, error: r.ok ? undefined : r.detail };
    }

    if (msg.type === 'TARGET_SELECT_MODEL') {
      const r = await ensureModel(msg.modelKey);
      return { ok: true, requestId, stage: 'model', detail: r.detail };
    }

    if (msg.type === 'TARGET_PASTE') {
      if (msg.modelKey && msg.modelKey !== 'default') {
        await ensureModel(msg.modelKey);
        await sleep(150);
      }
      const el = await waitForSelector(cfg.composer, 20000);
      if (!el) {
        return { ok: false, requestId, error: 'composer_not_found: buka Gemini dan pastikan sudah login' };
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
      const generating = geminiStillGenerating();
      return { ok: true, requestId, generating };
    }

    if (msg.type === 'TARGET_FETCH_LAST') {
      // Also wait for text stability — Gemini can still paint late tokens
      // after Stop disappears / Send re-enables briefly.
      const waited = await waitForStableAssistantText(cfg.assistantMessages, {
        timeoutMs: 60000,
        pollMs: 350,
        stableMs: 1500,
        minChars: 12,
        isStillGenerating: geminiStillGenerating,
      });
      if (!waited.text.trim()) {
        return {
          ok: false,
          requestId,
          error: 'empty_response: belum ada balasan model / masih generate / selector berubah',
        };
      }
      return {
        ok: true,
        requestId,
        text: waited.text,
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
  if (msg.target && msg.target !== 'gemini') return;
  if (
    msg.type === 'TARGET_PASTE' ||
    msg.type === 'TARGET_FETCH_LAST' ||
    msg.type === 'TARGET_SUBMIT' ||
    msg.type === 'TARGET_CHECK_GENERATING' ||
    msg.type === 'TARGET_SELECT_MODEL' ||
    msg.type === 'TARGET_NEW_CHAT'
  ) {
    handle(msg as TargetAction).then(sendResponse);
    return true; // async
  }
});

console.debug('[cstl-ext] gemini content script ready');
