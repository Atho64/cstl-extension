/** Protocol version — bump if breaking */
export const CSTL_EXT_PROTOCOL = 1 as const;

export type CopasTargetId = 'gemini' | 'deepseek' | 'meta' | 'chatgpt' | 'clipboard';

export type CopasMode = 'semi' | 'full';

/** Logical model keys (UI labels resolved in targets-config). */
/** Gemini web: Flash-Lite / Flash / Pro × thinking on|off */
export type GeminiModelKey =
  | 'default'
  | 'flash_lite'
  | 'flash'
  | 'pro'
  | 'flash_lite_think'
  | 'flash_think'
  | 'pro_think'
  // legacy
  | 'thinking';
/** DeepSeek V4 UI: Mode Cepat/Pakar + optional Pikir Mendalam. */
export type DeepseekModelKey =
  | 'default'
  | 'cepat'
  | 'pakar'
  | 'cepat_think'
  | 'pakar_think'
  // legacy aliases (normalized on load)
  | 'chat'
  | 'reasoner';
export type MetaModelKey = 'default' | 'instant' | 'berpikir';
export type CopasModelKey = GeminiModelKey | DeepseekModelKey | string;

export interface CopasSendRequest {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_SEND';
  requestId: string;
  target: CopasTargetId;
  mode: CopasMode;
  payload: string;
  meta?: {
    lineCount?: number;
    projectName?: string;
    formatHint?: string;
  };
}

export interface CopasPingRequest {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_PING';
  requestId: string;
}

export interface CopasCancelRequest {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_CANCEL';
  requestId: string;
}

export interface CopasFetchResultRequest {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_FETCH_RESULT';
  requestId: string;
  target?: CopasTargetId;
}

export interface CopasGetSettingsRequest {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_GET_SETTINGS';
  requestId: string;
}

export interface CopasSetSettingsRequest {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_SET_SETTINGS';
  requestId: string;
  settings: Partial<ExtSettings>;
}

export interface ExtSettings {
  target: CopasTargetId;
  mode: CopasMode;
  /** Preferred Gemini model (best-effort UI selection). */
  geminiModel: GeminiModelKey;
  /** Preferred DeepSeek model (best-effort UI selection). */
  deepseekModel: DeepseekModelKey;
  /** Meta AI mode: Instant or Berpikir (reasoning). */
  metaModel: MetaModelKey;
  /**
   * Open a fresh LLM tab every N successful SEND requests.
   * 0 = always reuse existing tab
   * 1 = new tab every request
   * N = new tab every N requests
   */
  newTabEvery: number;
  /** Per-target send counters (for newTabEvery). */
  sendCounts?: Partial<Record<'gemini' | 'deepseek' | 'meta' | 'chatgpt', number>>;
}

export type CstlToExtMessage =
  | CopasSendRequest
  | CopasPingRequest
  | CopasCancelRequest
  | CopasFetchResultRequest
  | CopasGetSettingsRequest
  | CopasSetSettingsRequest;

export interface CopasPongResponse {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_PONG';
  requestId: string;
  ok: true;
  extensionVersion: string;
  capabilities: {
    targets: CopasTargetId[];
    modes: CopasMode[];
    geminiModels?: GeminiModelKey[];
    deepseekModels?: DeepseekModelKey[];
    metaModels?: MetaModelKey[];
  };
  settings?: ExtSettings;
}

export interface CopasStatusEvent {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_STATUS';
  requestId: string;
  stage:
    | 'accepted'
    | 'finding_tab'
    | 'pasted'
    | 'submitted'
    | 'waiting_response'
    | 'done'
    | 'error'
    | 'cancelled';
  detail?: string;
}

export interface CopasResultResponse {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_RESULT';
  requestId: string;
  ok: boolean;
  text?: string;
  error?: string;
}

export interface CopasSettingsResponse {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_SETTINGS';
  requestId: string;
  ok: true;
  settings: ExtSettings;
}

export interface CopasBridgeReady {
  v: typeof CSTL_EXT_PROTOCOL;
  type: 'COPAS_BRIDGE_READY';
}

export type ExtToCstlMessage =
  | CopasPongResponse
  | CopasStatusEvent
  | CopasResultResponse
  | CopasSettingsResponse
  | CopasBridgeReady;

export const SOURCE_APP = 'cstl-app';
export const SOURCE_EXT = 'cstl-extension';

export const DEFAULT_SETTINGS: ExtSettings = {
  target: 'gemini',
  mode: 'semi',
  geminiModel: 'default',
  deepseekModel: 'default',
  metaModel: 'default',
  newTabEvery: 0,
  sendCounts: { gemini: 0, deepseek: 0, meta: 0, chatgpt: 0 },
};

export const CAPABLE_TARGETS: CopasTargetId[] = ['gemini', 'deepseek', 'meta', 'chatgpt'];
export const CAPABLE_MODES: CopasMode[] = ['semi', 'full'];
export const GEMINI_MODEL_KEYS: GeminiModelKey[] = [
  'default',
  'flash_lite',
  'flash',
  'pro',
  'flash_lite_think',
  'flash_think',
  'pro_think',
];

export const DEEPSEEK_MODEL_KEYS: DeepseekModelKey[] = [
  'default',
  'cepat',
  'pakar',
  'cepat_think',
  'pakar_think',
];
export const META_MODEL_KEYS: MetaModelKey[] = ['default', 'instant', 'berpikir'];

/** Map old setting values → current Gemini keys. */
export function normalizeGeminiModelKey(raw: unknown): GeminiModelKey {
  const k = String(raw || 'default');
  if (k === 'thinking') return 'pro_think';
  if (k === 'flash-lite' || k === 'flashlite' || k === 'lite') return 'flash_lite';
  if (
    k === 'default' ||
    k === 'flash_lite' ||
    k === 'flash' ||
    k === 'pro' ||
    k === 'flash_lite_think' ||
    k === 'flash_think' ||
    k === 'pro_think'
  ) {
    return k;
  }
  return 'default';
}

/** Map old setting values → current DeepSeek V4 keys. */
export function normalizeDeepseekModelKey(raw: unknown): DeepseekModelKey {
  const k = String(raw || 'default');
  if (k === 'chat' || k === 'v3' || k === 'instant') return 'cepat';
  if (k === 'reasoner' || k === 'deepthink' || k === 'r1') return 'pakar_think';
  if (k === 'expert') return 'pakar';
  if (
    k === 'default' ||
    k === 'cepat' ||
    k === 'pakar' ||
    k === 'cepat_think' ||
    k === 'pakar_think'
  ) {
    return k;
  }
  return 'default';
}

export function normalizeNewTabEvery(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function hasKey<T extends string>(arr: readonly T[], key: string): key is T {
  return arr.indexOf(key as T) >= 0;
}

export function mergeSettings(partial: Partial<ExtSettings> | undefined, base: ExtSettings = DEFAULT_SETTINGS): ExtSettings {
  const next: ExtSettings = {
    target: base.target,
    mode: base.mode,
    geminiModel: base.geminiModel,
    deepseekModel: base.deepseekModel,
    metaModel: base.metaModel,
    newTabEvery: base.newTabEvery,
    sendCounts: { ...(base.sendCounts || {}) },
  };
  if (!partial) return next;

  if (partial.target === 'gemini' || partial.target === 'deepseek' || partial.target === 'meta' || partial.target === 'chatgpt' || partial.target === 'clipboard') {
    next.target = partial.target;
  }
  if (partial.mode === 'semi' || partial.mode === 'full') next.mode = partial.mode;
  if (partial.geminiModel !== undefined) {
    next.geminiModel = normalizeGeminiModelKey(partial.geminiModel);
  }
  if (partial.deepseekModel !== undefined) {
    next.deepseekModel = normalizeDeepseekModelKey(partial.deepseekModel);
  }
  if (partial.metaModel !== undefined) {
    const k = String(partial.metaModel);
    next.metaModel = k === 'instant' || k === 'berpikir' ? k : 'default';
  }
  if (partial.newTabEvery !== undefined) {
    next.newTabEvery = normalizeNewTabEvery(partial.newTabEvery);
  }
  if (partial.sendCounts && typeof partial.sendCounts === 'object') {
    next.sendCounts = {
      gemini: Math.max(0, Math.floor(Number(partial.sendCounts.gemini) || 0)),
      deepseek: Math.max(0, Math.floor(Number(partial.sendCounts.deepseek) || 0)),
      meta: Math.max(0, Math.floor(Number(partial.sendCounts.meta) || 0)),
      chatgpt: Math.max(0, Math.floor(Number(partial.sendCounts.chatgpt) || 0)),
    };
  }
  return next;
}
