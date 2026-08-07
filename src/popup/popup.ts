import {
  CSTL_EXT_PROTOCOL,
  DEFAULT_SETTINGS,
  type CopasMode,
  type CopasTargetId,
  type DeepseekModelKey,
  type MetaModelKey,
  type ExtSettings,
  type GeminiModelKey,
} from '../shared/protocol';
import { TARGETS } from '../shared/targets-config';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const targetEl = $('target') as HTMLSelectElement;
const modeEl = $('mode') as HTMLSelectElement;
const geminiModelEl = $('geminiModel') as HTMLSelectElement;
const deepseekModelEl = $('deepseekModel') as HTMLSelectElement;
const metaModelEl = $('metaModel') as HTMLSelectElement;
const newTabEveryEl = $('newTabEvery') as HTMLInputElement;
const statusEl = $('status');
const verEl = $('ver');
const btnFetch = $('btnFetch');
const btnOpen = $('btnOpen');
const btnResetCount = $('btnResetCount');
const geminiModelLabel = $('geminiModelLabel');
const deepseekModelLabel = $('deepseekModelLabel');
const metaModelLabel = $('metaModelLabel');

function rid(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function setStatus(t: string) {
  statusEl.textContent = t;
}

function syncModelVisibility() {
  const t = targetEl.value;
  geminiModelLabel.style.display = t === 'gemini' ? '' : 'none';
  deepseekModelLabel.style.display = t === 'deepseek' ? '' : 'none';
  metaModelLabel.style.display = t === 'meta' ? '' : 'none';
  // ChatGPT: no model selector needed
}

function summarize(s: ExtSettings): string {
  const model = s.target === 'deepseek'
    ? `deepseek=${s.deepseekModel}`
    : s.target === 'gemini' ? `gemini=${s.geminiModel}`
    : s.target === 'chatgpt' ? 'chatgpt=default'
    : s.target === 'qwen' ? 'qwen=default'
    : s.target === 'freebuff' ? 'freebuff=default' : 'default';
  const resolvedModel = s.target === 'arena' ? 'arena=manual' : model;
  const n = s.newTabEvery || 0;
  const tab =
    n <= 0 ? 'lanjut chat sama' : n === 1 ? 'New Chat tiap request' : `New Chat tiap ${n} request`;
  const c = s.sendCounts || {};
  return `Target: ${s.target}\nMode: ${s.mode}\nModel: ${resolvedModel}\nChat: ${tab}\nCounter: gemini=${c.gemini || 0}, deepseek=${c.deepseek || 0}, meta=${c.meta || 0}, chatgpt=${c.chatgpt || 0}, qwen=${c.qwen || 0}, arena=${c.arena || 0}, freebuff=${c.freebuff || 0}`;
}

async function load() {
  verEl.textContent = `v${chrome.runtime.getManifest().version}`;
  const res = await chrome.runtime.sendMessage({
    v: CSTL_EXT_PROTOCOL,
    type: 'COPAS_GET_SETTINGS',
    requestId: rid(),
  });
  const s: ExtSettings = res?.settings || DEFAULT_SETTINGS;
  targetEl.value = (s.target === 'deepseek' || s.target === 'meta' || s.target === 'chatgpt' || s.target === 'qwen' || s.target === 'arena' || s.target === 'freebuff') ? s.target : 'gemini';
  modeEl.value = s.mode === 'full' ? 'full' : 'semi';
  geminiModelEl.value = s.geminiModel || 'default';
  // normalize legacy thinking → pro_think
  const gm = String(s.geminiModel || 'default');
  if (gm === 'thinking') geminiModelEl.value = 'pro_think';
  else geminiModelEl.value = geminiModelEl.querySelector(`option[value="${gm}"]`) ? gm : 'default';
  // normalize legacy chat/reasoner → cepat / pakar_think
  const ds = String(s.deepseekModel || 'default');
  if (ds === 'chat') deepseekModelEl.value = 'cepat';
  else if (ds === 'reasoner') deepseekModelEl.value = 'pakar_think';
  else deepseekModelEl.value = deepseekModelEl.querySelector(`option[value="${ds}"]`)
    ? ds
    : 'default';
  metaModelEl.value = metaModelEl.querySelector(`option[value="${s.metaModel || 'default'}"]`)
    ? (s.metaModel || 'default')
    : 'default';
  newTabEveryEl.value = String(s.newTabEvery ?? 0);
  syncModelVisibility();
  setStatus(summarize(s));
}

async function persist() {
  const settings = {
    target: targetEl.value as CopasTargetId,
    mode: modeEl.value as CopasMode,
    geminiModel: geminiModelEl.value as GeminiModelKey,
    deepseekModel: deepseekModelEl.value as DeepseekModelKey,
    metaModel: metaModelEl.value as MetaModelKey,
    newTabEvery: Math.max(0, Math.min(100, Math.floor(Number(newTabEveryEl.value) || 0))),
  };
  const res = await chrome.runtime.sendMessage({
    v: CSTL_EXT_PROTOCOL,
    type: 'COPAS_SET_SETTINGS',
    requestId: rid(),
    settings,
  });
  const s: ExtSettings = res?.settings || { ...DEFAULT_SETTINGS, ...settings };
  setStatus(`Disimpan.\n${summarize(s)}`);
}

targetEl.addEventListener('change', () => {
  syncModelVisibility();
  void persist();
});
modeEl.addEventListener('change', () => void persist());
geminiModelEl.addEventListener('change', () => void persist());
deepseekModelEl.addEventListener('change', () => void persist());
metaModelEl.addEventListener('change', () => void persist());
newTabEveryEl.addEventListener('change', () => void persist());

btnFetch.addEventListener('click', async () => {
  setStatus('Mengambil hasil…');
  const res = await chrome.runtime.sendMessage({
    v: CSTL_EXT_PROTOCOL,
    type: 'COPAS_FETCH_RESULT',
    requestId: rid(),
    target: targetEl.value as CopasTargetId,
  });
  if (res?.ok && res.text) {
    setStatus(`OK (${res.text.length} char)\n\n${res.text.slice(0, 280)}${res.text.length > 280 ? '…' : ''}`);
    try {
      await navigator.clipboard.writeText(res.text);
      setStatus(statusEl.textContent + '\n\n(disalin ke clipboard)');
    } catch {
      /* */
    }
  } else {
    setStatus(`Gagal: ${res?.error || 'unknown'}`);
  }
});

btnOpen.addEventListener('click', async () => {
  const id = targetEl.value as CopasTargetId;
  const url = TARGETS[id].url;
  if (id === 'arena') {
    const existing = await chrome.tabs.query({ url: ['https://arena.ai/text/direct*', 'https://arena.ai/c/*'] });
    if (existing[0]?.id != null) await chrome.tabs.update(existing[0].id, { active: true });
    else await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.create({ url });
});

btnResetCount.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({
    v: CSTL_EXT_PROTOCOL,
    type: 'COPAS_SET_SETTINGS',
    requestId: rid(),
    settings: { sendCounts: { gemini: 0, deepseek: 0, meta: 0, chatgpt: 0, qwen: 0, arena: 0, freebuff: 0 } },
  });
  const s: ExtSettings = res?.settings || DEFAULT_SETTINGS;
  setStatus(`Counter di-reset.\n${summarize(s)}`);
});

void load();
