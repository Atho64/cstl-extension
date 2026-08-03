import {
  CAPABLE_MODES,
  CAPABLE_TARGETS,
  CSTL_EXT_PROTOCOL,
  DEFAULT_SETTINGS,
  DEEPSEEK_MODEL_KEYS,
  GEMINI_MODEL_KEYS,
  META_MODEL_KEYS,
  mergeSettings,
  type CopasMode,
  type CopasTargetId,
  type CstlToExtMessage,
  type ExtSettings,
  type ExtToCstlMessage,
} from './shared/protocol';
import { TARGETS, getTargetConfig, tabMatchesTarget } from './shared/targets-config';

const EXT_VERSION = chrome.runtime.getManifest().version;

type Job = {
  requestId: string;
  target: CopasTargetId;
  mode: CopasMode;
  payload: string;
  tabId?: number;
  stage: string;
  createdAt: number;
  cancelled: boolean;
};

const jobs = new Map<string, Job>();
let latestRequestId: string | null = null;
const latestRequestByTarget = new Map<CopasTargetId, string>();

// Track active full-auto polling so cancel can stop it
const activePollers = new Map<string, { cancelled: boolean }>();

function pruneJobs(): void {
  if (jobs.size <= 100) return;
  const stale = [...jobs.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, jobs.size - 100);
  for (const job of stale) {
    if (activePollers.has(job.requestId)) continue;
    jobs.delete(job.requestId);
    if (latestRequestByTarget.get(job.target) === job.requestId) {
      latestRequestByTarget.delete(job.target);
    }
  }
}

async function loadSettings(): Promise<ExtSettings> {
  const data = await chrome.storage.sync.get([
    'target',
    'mode',
    'geminiModel',
    'deepseekModel',
    'metaModel',
    'newTabEvery',
    'sendCounts',
  ]);
  return mergeSettings(data as Partial<ExtSettings>, DEFAULT_SETTINGS);
}

async function saveSettings(partial: Partial<ExtSettings>): Promise<ExtSettings> {
  const cur = await loadSettings();
  const next = mergeSettings(partial, cur);
  await chrome.storage.sync.set({
    target: next.target,
    mode: next.mode,
    geminiModel: next.geminiModel,
    deepseekModel: next.deepseekModel,
    metaModel: next.metaModel,
    newTabEvery: next.newTabEvery,
    sendCounts: next.sendCounts || { gemini: 0, deepseek: 0, meta: 0, chatgpt: 0, qwen: 0, arena: 0 },
  });
  return next;
}

function modelKeyFor(settings: ExtSettings, target: CopasTargetId): string {
  if (target === 'deepseek') return settings.deepseekModel || 'default';
  if (target === 'meta') return settings.metaModel || 'default';
  if (target === 'gemini') return settings.geminiModel || 'default';
  return 'default';
}

function pong(requestId: string, settings?: ExtSettings): ExtToCstlMessage {
  return {
    v: CSTL_EXT_PROTOCOL,
    type: 'COPAS_PONG',
    requestId,
    ok: true,
    extensionVersion: EXT_VERSION,
    capabilities: {
      targets: CAPABLE_TARGETS,
      modes: CAPABLE_MODES,
      geminiModels: GEMINI_MODEL_KEYS,
      deepseekModels: DEEPSEEK_MODEL_KEYS,
      metaModels: META_MODEL_KEYS,
    },
    settings,
  };
}

function status(requestId: string, stage: any, detail?: string): ExtToCstlMessage {
  return {
    v: CSTL_EXT_PROTOCOL,
    type: 'COPAS_STATUS',
    requestId,
    stage,
    detail,
  };
}

function result(requestId: string, ok: boolean, text?: string, error?: string): ExtToCstlMessage {
  return {
    v: CSTL_EXT_PROTOCOL,
    type: 'COPAS_RESULT',
    requestId,
    ok,
    text,
    error,
  };
}

/**
 * Decide whether this send should start a fresh chat (New Chat button),
 * NOT a new browser tab.
 * newTabEvery (name kept for settings compat):
 *   0 = reuse current chat
 *   1 = New Chat every request
 *   N = New Chat every N requests
 */
async function shouldStartNewChat(target: CopasTargetId): Promise<{
  forceNew: boolean;
  count: number;
  every: number;
  settings: ExtSettings;
}> {
  const settings = await loadSettings();
  const every = settings.newTabEvery || 0;
  const counts = { gemini: 0, deepseek: 0, meta: 0, chatgpt: 0, qwen: 0, arena: 0, ...(settings.sendCounts || {}) };
  const nextCount = (counts[target] || 0) + 1;
  counts[target] = nextCount;
  await saveSettings({ sendCounts: counts });

  if (every <= 0) {
    return { forceNew: false, count: nextCount, every, settings: await loadSettings() };
  }
  // Every Nth request (including the first when count==N, 2N, ...)
  // Also fire on first request when every===1.
  const forceNew = every === 1 ? true : nextCount % every === 0;
  return { forceNew, count: nextCount, every, settings: await loadSettings() };
}

async function findOrCreateTab(target: CopasTargetId): Promise<number> {
  const cfg = getTargetConfig(target);
  if (!cfg) throw new Error('unknown_target');

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => tabMatchesTarget(t.url, target));
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      try {
        await chrome.windows.update(existing.windowId, { focused: true });
      } catch {
        /* */
      }
    }
    return existing.id;
  }

  if (target === 'arena') {
    throw new Error('arena_tab_not_found: buka https://arena.ai/text/direct dan pilih model terlebih dahulu');
  }

  const tab = await chrome.tabs.create({ url: cfg.url, active: true });
  if (tab.id == null) throw new Error('tab_create_failed');
  await waitTabComplete(tab.id, 30000);
  await sleep(900);
  return tab.id;
}

function waitTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab_load_timeout'));
    }, timeoutMs);

    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (t.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * DeepSeek's sidebar controls are rendered dynamically and its history rows can
 * look identical to the New Chat control. Navigating the existing target tab
 * to the canonical chat URL is the same user-visible result as New Chat, but
 * does not depend on a fragile sidebar selector or open a browser tab.
 */
async function startFreshDeepseekChat(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { url: TARGETS.deepseek.url });
  await waitTabComplete(tabId, 30000);
  // Let DeepSeek hydrate the composer before TARGET_PASTE is delivered.
  await sleep(900);
}

async function sendToTab(
  tabId: number,
  message: Record<string, unknown>
): Promise<any> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    // content script maybe not injected yet — try scripting inject
    const target = message.target as CopasTargetId;
    const file =
      target === 'deepseek'
        ? 'content/targets/deepseek.js'
        : target === 'meta'
          ? 'content/targets/meta.js'
        : target === 'chatgpt'
          ? 'content/targets/chatgpt.js'
        : target === 'qwen'
          ? 'content/targets/qwen.js'
        : target === 'arena'
          ? 'content/targets/arena.js'
        : target === 'gemini'
          ? 'content/targets/gemini.js'
          : null;
    if (file) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [file],
        });
        await sleep(200);
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (e2) {
        throw new Error(
          e2 instanceof Error ? e2.message : 'content_script_inject_failed'
        );
      }
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ─── Send status update to CSTL page (via content bridge) ───
async function pushStatus(requestId: string, stage: any, detail?: string): Promise<void> {
  // Send to all CSTL origin tabs
  try {
    const tabs = await chrome.tabs.query({});
    const cstlTabs = tabs.filter((t) => {
      try {
        const u = new URL(t.url || '');
        return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === 'atho64.github.io';
      } catch { return false; }
    });
    for (const t of cstlTabs) {
      if (t.id != null) {
        chrome.tabs.sendMessage(t.id, status(requestId, stage, detail)).catch(() => {});
      }
    }
  } catch { /* */ }
}

// ─── Full auto: paste + send + poll for done + scrape + return ───
async function fullAutoFlow(
  requestId: string,
  target: CopasTargetId,
  tabId: number,
  payload: string,
  poller: { cancelled: boolean },
  modelKey: string
): Promise<ExtToCstlMessage> {
  // 1. Paste + submit
  await pushStatus(requestId, 'finding_tab', 'Menyiapkan tab LLM...');
  if (poller.cancelled) return result(requestId, false, undefined, 'cancelled');

  const pasteRes = await sendToTab(tabId, {
    type: 'TARGET_PASTE',
    target,
    requestId,
    payload,
    mode: 'full',
    modelKey,
  });

  if (!pasteRes?.ok) {
    return result(requestId, false, undefined, pasteRes?.error || 'paste_failed');
  }
  if (poller.cancelled) return result(requestId, false, undefined, 'cancelled');

  if (pasteRes.stage !== 'submitted') {
    // paste ok but send failed — return semi state
    return status(requestId, 'pasted', 'Teks ter-paste tapi gagal auto-send. Kirim manual lalu Ambil Hasil.');
  }

  await pushStatus(requestId, 'submitted', 'Pesan terkirim. Menunggu respons...');
  // Give the stream time to start so we don't treat pre-send idle as "done".
  await sleep(target === 'deepseek' ? 1800 : target === 'qwen' ? 3000 : 1200);

  // 2. Wait until UI stops reporting "generating".
  // DeepSeek's Stop control is flaky; TARGET_FETCH_LAST also waits for text
  // stability, so we only use this loop as a soft pre-wait, not the sole signal.
  const pollTimeout = target === 'arena' ? 120000 : 180000;
  const pollInterval = 800;
  const deadline = Date.now() + pollTimeout;
  let sawGenerating = false;
  let idleStreak = 0;
  let pollCount = 0;
  // DeepSeek: require several consecutive idle samples before trusting UI.
  // Gemini: one idle sample is usually enough (Send re-enable is solid).
  const idleNeeded = target === 'deepseek' ? 4 : target === 'qwen' ? 5 : 2;

  while (Date.now() < deadline) {
    if (poller.cancelled) {
      return result(requestId, false, undefined, 'cancelled');
    }

    const checkRes = await sendToTab(tabId, {
      type: 'TARGET_CHECK_GENERATING',
      target,
      requestId,
    });

    const generating = !!(checkRes?.ok && checkRes.generating === true);
    if (generating) {
      sawGenerating = true;
      idleStreak = 0;
    } else {
      idleStreak++;
      // Only exit early once we have seen generating at least once, OR after a
      // longer idle streak (response already finished before we started polling).
      if (idleStreak >= idleNeeded && (sawGenerating || idleStreak >= idleNeeded + 3)) {
        break;
      }
    }

    pollCount++;
    if (pollCount % 5 === 0) {
      const elapsed = Math.round((pollCount * pollInterval) / 1000);
      await pushStatus(requestId, 'waiting_response', `Menunggu respons... (${elapsed}s)`);
    }

    await sleep(pollInterval);
  }

  if (poller.cancelled) return result(requestId, false, undefined, 'cancelled');

  // 3. Scrape with text-stability wait (handles mid-stream "plaintext" labels)
  await pushStatus(requestId, 'waiting_response', 'Mengambil teks (menunggu stabil)...');

  const fetchRes = await sendToTab(tabId, {
    type: 'TARGET_FETCH_LAST',
    target,
    requestId,
  });

  if (!fetchRes?.ok || !fetchRes.text) {
    return result(requestId, false, undefined, fetchRes?.error || 'scrape_failed_after_generation');
  }

  // 4. Return result (partial is still ok — text was best-effort stable)
  const job = jobs.get(requestId);
  if (job) job.stage = fetchRes.stage === 'done_partial' ? 'done_partial' : 'done';
  return result(requestId, true, fetchRes.text);
}

async function handleSend(msg: Extract<CstlToExtMessage, { type: 'COPAS_SEND' }>): Promise<ExtToCstlMessage> {
  const settings = await loadSettings();
  const target = msg.target || settings.target;
  const mode = msg.mode || settings.mode;
  const modelKey = modelKeyFor(settings, target);

  // Cancel any previous active poller
  const prev = activePollers.get(msg.requestId);
  if (prev) prev.cancelled = true;

  const poller = { cancelled: false };
  activePollers.set(msg.requestId, poller);

  const job: Job = {
    requestId: msg.requestId,
    target,
    mode,
    payload: msg.payload,
    stage: 'accepted',
    createdAt: Date.now(),
    cancelled: false,
  };
  jobs.set(msg.requestId, job);
  latestRequestId = msg.requestId;
  latestRequestByTarget.set(target, msg.requestId);
  pruneJobs();

  try {
    const chatPolicy = target === 'arena'
      ? { forceNew: false, count: 0, every: 0, settings }
      : await shouldStartNewChat(target);
    const tabId = await findOrCreateTab(target);
    job.tabId = tabId;
    job.stage = 'finding_tab';

    if (chatPolicy.forceNew) {
      await pushStatus(
        msg.requestId,
        'finding_tab',
        `Obrolan baru (#${chatPolicy.count}, tiap ${chatPolicy.every || 1} req)...`
      );
      if (target === 'deepseek') {
        // Deterministic in-tab New Chat: reset the existing DeepSeek tab to
        // its blank-chat route instead of guessing a sidebar button.
        await startFreshDeepseekChat(tabId);
      } else if (target === 'chatgpt') {
        // ChatGPT: navigate to root URL for a fresh chat
        await chrome.tabs.update(tabId, { url: TARGETS.chatgpt.url });
        await waitTabComplete(tabId, 30000);
        await sleep(1000);
      } else if (target === 'qwen') {
        await chrome.tabs.update(tabId, { url: TARGETS.qwen.url });
        await waitTabComplete(tabId, 30000);
        await sleep(1000);
      } else {
        const nc = await sendToTab(tabId, {
          type: 'TARGET_NEW_CHAT',
          target,
          requestId: msg.requestId,
        });
        if (!nc?.ok) {
          await pushStatus(
            msg.requestId,
            'finding_tab',
            `New chat gagal (${nc?.detail || nc?.error || 'unknown'}), lanjut chat aktif`
          );
        } else {
          await sleep(500);
        }
      }
    }

    if (mode === 'full') {
      // Full auto: paste + send + poll + scrape → return result
      const res = await fullAutoFlow(msg.requestId, target, tabId, msg.payload, poller, modelKey);
      activePollers.delete(msg.requestId);
      return res;
    }

    // Semi mode: paste only
    const pasteRes = await sendToTab(tabId, {
      type: 'TARGET_PASTE',
      target,
      requestId: msg.requestId,
      payload: msg.payload,
      mode: 'semi',
      modelKey,
    });

    if (!pasteRes?.ok) {
      job.stage = 'error';
      activePollers.delete(msg.requestId);
      return result(msg.requestId, false, undefined, pasteRes?.error || 'paste_failed');
    }

    job.stage = 'pasted';
    activePollers.delete(msg.requestId);
    return status(
      msg.requestId,
      'pasted',
      'Teks sudah di-paste. Kirim manual di tab LLM, lalu Ambil Hasil.'
    );
  } catch (e) {
    activePollers.delete(msg.requestId);
    job.stage = 'error';
    return result(msg.requestId, false, undefined, e instanceof Error ? e.message : String(e));
  }
}

async function handleFetch(
  msg: Extract<CstlToExtMessage, { type: 'COPAS_FETCH_RESULT' }>
): Promise<ExtToCstlMessage> {
  const settings = await loadSettings();
  const requestedTarget = msg.target || settings.target;
  const targetRequestId = latestRequestByTarget.get(requestedTarget);
  const priorJob = jobs.get(msg.requestId)
    || (targetRequestId ? jobs.get(targetRequestId) : undefined)
    || (latestRequestId ? jobs.get(latestRequestId) : undefined);
  const target = msg.target || priorJob?.target || settings.target;

  try {
    let tabId = priorJob?.tabId;
    if (tabId == null) {
      tabId = await findOrCreateTab(target);
    } else {
      try {
        await chrome.tabs.get(tabId);
      } catch {
        tabId = await findOrCreateTab(target);
      }
    }

    const fetchRes = await sendToTab(tabId, {
      type: 'TARGET_FETCH_LAST',
      target,
      requestId: msg.requestId,
    });

    if (!fetchRes?.ok) {
      return result(msg.requestId, false, undefined, fetchRes?.error || 'fetch_failed');
    }
    if (priorJob) priorJob.stage = 'done';
    return result(msg.requestId, true, fetchRes.text || '');
  } catch (e) {
    return result(msg.requestId, false, undefined, e instanceof Error ? e.message : String(e));
  }
}

async function route(msg: CstlToExtMessage): Promise<ExtToCstlMessage> {
  switch (msg.type) {
    case 'COPAS_PING': {
      const settings = await loadSettings();
      return pong(msg.requestId, settings);
    }
    case 'COPAS_GET_SETTINGS': {
      const settings = await loadSettings();
      return {
        v: CSTL_EXT_PROTOCOL,
        type: 'COPAS_SETTINGS',
        requestId: msg.requestId,
        ok: true,
        settings,
      };
    }
    case 'COPAS_SET_SETTINGS': {
      const settings = await saveSettings(msg.settings || {});
      return {
        v: CSTL_EXT_PROTOCOL,
        type: 'COPAS_SETTINGS',
        requestId: msg.requestId,
        ok: true,
        settings,
      };
    }
    case 'COPAS_SEND':
      return handleSend(msg);
    case 'COPAS_FETCH_RESULT':
      return handleFetch(msg);
    case 'COPAS_CANCEL': {
      // Cancel active poller
      const p = activePollers.get(msg.requestId);
      if (p) p.cancelled = true;
      const job = jobs.get(msg.requestId);
      if (job) job.stage = 'cancelled';
      activePollers.delete(msg.requestId);
      return status(msg.requestId, 'cancelled');
    }
    default:
      return result('unknown', false, undefined, 'unknown_message_type');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || !msg.type) return;
  if (sender.id !== chrome.runtime.id) return;
  if (msg.v !== CSTL_EXT_PROTOCOL || typeof msg.requestId !== 'string') return;
  route(msg as CstlToExtMessage)
    .then(sendResponse)
    .catch((e) =>
      sendResponse(
        result(
          (msg as any).requestId || 'err',
          false,
          undefined,
          e instanceof Error ? e.message : String(e)
        )
      )
    );
  return true;
});

console.debug('[cstl-ext] background ready', EXT_VERSION);
