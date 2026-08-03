import type { CopasTargetId, DeepseekModelKey, GeminiModelKey } from './protocol';

export type TargetConfig = {
  id: CopasTargetId;
  label: string;
  url: string;
  matches: string[];
  /** CSS selectors — brittle; keep centralized */
  composer: string[];
  sendButton: string[];
  /** Selectors for assistant/model response blocks (last match wins) */
  assistantMessages: string[];
  /** Model picker open button candidates */
  modelPickerOpen: string[];
  /** Menu / list container after picker opens */
  modelMenu: string[];
  /** Labels for New Chat control (sidebar) */
  newChatLabels: string[];
};

export const TARGETS: Record<CopasTargetId, TargetConfig> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    url: 'https://gemini.google.com/app',
    matches: ['https://gemini.google.com/*'],
    composer: [
      'div.ql-editor.textarea[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="Enter" i]',
      'div[contenteditable="true"].ql-editor',
      'div[contenteditable="true"]',
    ],
    sendButton: [
      'button[aria-label*="Send" i]',
      'button[aria-label*="Kirim" i]',
      'button.send-button',
      'button[mattooltip*="Send" i]',
    ],
    assistantMessages: [
      'model-response .markdown',
      'message-content.model-response-text',
      '.model-response-text',
      '[data-message-author-role="model"]',
      'model-response',
      '.response-container',
    ],
    modelPickerOpen: [
      // Prefer explicit model switcher — avoid Settings / gear
      'button[data-test-id*="bard-mode" i]',
      'button[data-test-id*="model-switcher" i]',
      'button[data-test-id*="model-picker" i]',
      'button[aria-label*="Switch model" i]',
      'button[aria-label*="Ganti model" i]',
      'button[aria-label*="model picker" i]',
      'button[aria-label*="Choose a model" i]',
      'button[aria-label*="Pilih model" i]',
      // Model name chips in top bar (Flash / Pro / Gemini)
      'button[aria-label*="Flash" i]',
      'button[aria-label*="Pro" i]',
      'button[aria-label*="3.6" i]',
      'button[aria-label*="3.5" i]',
      // Avoid bare "Gemini" / "Settings" / haspopup that often hits account menu
    ],
    modelMenu: [
      '[role="menu"]',
      '[role="listbox"]',
      'mat-menu',
      '.mat-mdc-menu-panel',
      '[data-test-id*="model" i]',
      '[data-test-id*="bard-mode" i]',
    ],
    newChatLabels: [
      'baru',
      'new chat',
      'chat baru',
      'obrolan baru',
      'percakapan baru',
      'new conversation',
      'start new chat',
    ],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek Chat',
    url: 'https://chat.deepseek.com/',
    matches: ['https://chat.deepseek.com/*'],
    composer: [
      'textarea#chat-input',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="DeepSeek" i]',
      'div[contenteditable="true"]#chat-input',
      'textarea',
      'div[contenteditable="true"]',
    ],
    sendButton: [
      'button[aria-label*="Send" i]',
      'div[role="button"][aria-label*="Send" i]',
      'button[type="submit"]',
      'button[aria-label*="Kirim" i]',
    ],
    assistantMessages: [
      '.ds-markdown',
      '[class*="markdown"]',
      '.message-content',
      '[data-role="assistant"]',
      '.assistant-message',
    ],
    modelPickerOpen: [
      'button[aria-label*="model" i]',
      'div[role="button"][aria-label*="model" i]',
      'button[class*="model" i]',
      'div[class*="model-selector" i]',
      'div[class*="model" i][role="button"]',
      'button:has([class*="model" i])',
    ],
    modelMenu: [
      '[role="menu"]',
      '[role="listbox"]',
      '[class*="dropdown" i]',
      '[class*="popover" i]',
      '[class*="menu" i]',
    ],
    newChatLabels: [
      'obrolan baru',
      'chat baru',
      'new chat',
      'new conversation',
      'percakapan baru',
      'mulai obrolan baru',
    ],
  },
  meta: {
    id: 'meta',
    label: 'Meta AI',
    url: 'https://www.meta.ai/',
    matches: ['https://meta.ai/*', 'https://www.meta.ai/*'],
    composer: [
      '[data-testid="composer-input"]',
      'textarea[placeholder*="Ask Meta AI" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
      '[contenteditable="true"][role="textbox"]',
      'textarea',
      '[contenteditable="true"]',
    ],
    sendButton: [
      '[data-testid="composer-send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Kirim" i]',
      'button[type="submit"]',
      '[data-testid*="send" i]',
    ],
    assistantMessages: [
      '[data-testid*="assistant" i]',
      '[data-testid*="response" i]',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[class*="assistant" i] [class*="message" i]',
      '[class*="response" i]',
    ],
    modelPickerOpen: [
      '[data-testid="composer-mode-dropdown-button"]',
      'button[aria-label*="Instant" i]',
      'button[aria-label*="Instan" i]',
      'button[aria-label*="Berpikir" i]',
      '[role="button"][aria-label*="Instant" i]',
      '[role="button"][aria-label*="Berpikir" i]',
    ],
    modelMenu: [
      '[role="menu"]',
      '[role="listbox"]',
      '[class*="popover" i]',
      '[class*="menu" i]',
    ],
    newChatLabels: ['new chat', 'new conversation', 'chat baru', 'obrolan baru', 'mulai chat baru'],
  },
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    matches: ['https://chatgpt.com/*'],
    composer: [
      '#prompt-textarea',
      'div[contenteditable="true"]#prompt-textarea',
      'div[contenteditable="true"][aria-label*="Message" i]',
      'textarea[placeholder*="Message" i]',
      'div[contenteditable="true"]',
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Kirim" i]',
    ],
    assistantMessages: [
      'div[data-message-author-role="assistant"] .markdown',
      'div[data-message-author-role="assistant"]',
      'article[data-testid*="conversation-turn"] .markdown',
      '[class*="prose"]',
      '.markdown.prose',
    ],
    modelPickerOpen: [
      'button[id*="radix"][aria-haspopup="menu"]',
      'button[aria-label*="Model selector" i]',
      'button[aria-label*="ChatGPT" i]',
    ],
    modelMenu: [
      '[role="menu"]',
      '[role="listbox"]',
    ],
    newChatLabels: [
      'new chat',
      'chat baru',
      'obrolan baru',
      'new conversation',
      'mulai chat baru',
    ],
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen Studio',
    url: 'https://chat.qwen.ai/',
    matches: ['https://chat.qwen.ai/*'],
    composer: [
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Qwen" i]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    sendButton: [
      'button[aria-label*="Send" i]',
      'button[aria-label*="Kirim" i]',
      'button[type="submit"]',
      '[data-testid*="send" i]',
    ],
    assistantMessages: [
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[class*="assistant" i] [class*="markdown" i]',
      '[class*="message" i] [class*="markdown" i]',
      '[class*="response" i]',
    ],
    modelPickerOpen: [],
    modelMenu: [],
    newChatLabels: ['new chat', 'chat baru', 'obrolan baru', 'new conversation', 'start new chat'],
  },
  arena: {
    id: 'arena',
    label: 'Arena Direct',
    url: 'https://arena.ai/text/direct',
    matches: ['https://arena.ai/text/direct*', 'https://arena.ai/c/*'],
    composer: [
      'textarea[placeholder="Ask anything…"]',
      'textarea[placeholder*="Ask anything" i]',
      'textarea',
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
      'button[type="submit"]',
    ],
    assistantMessages: [
      'code.whitespace-pre-wrap.break-words',
      '.code-block_container__lbMX4 code',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[data-testid*="assistant" i]',
      '[class*="assistant" i]',
      '[class*="markdown" i]',
      'main article',
    ],
    modelPickerOpen: [],
    modelMenu: [],
    newChatLabels: ['new chat'],
  },
};

/** Search phrases used when clicking a model option (order = priority). */
export const GEMINI_MODEL_MATCHERS: Record<GeminiModelKey, string[]> = {
  default: [],
  // Prefer distinctive labels from current Gemini ID UI
  flash_lite: ['3.5 flash-lite', 'flash-lite', 'flash lite', 'jawaban tercepat'],
  flash: ['3.6 flash', 'flash', 'bantuan serbaguna'],
  pro: ['pro', 'matematika dan coding'],
  flash_lite_think: ['3.5 flash-lite', 'flash-lite', 'flash lite'],
  flash_think: ['3.6 flash', 'flash'],
  pro_think: ['pro', 'matematika dan coding'],
  thinking: ['pro'], // legacy → pro_think
};

/**
 * DeepSeek V4 (chat.deepseek.com) uses mode chips, not a classic model list:
 * - Mode: Cepat (Instant) | Pakar (Expert)
 * - Toggle: Pikir Mendalam (DeepThink)
 * Matchers below are used as click-label hints by selectDeepseekMode().
 */
export const DEEPSEEK_MODEL_MATCHERS: Record<DeepseekModelKey, string[]> = {
  default: [],
  cepat: ['cepat', 'instant', 'fast'],
  pakar: ['pakar', 'expert'],
  cepat_think: ['cepat', 'instant', 'pikir mendalam', 'deepthink'],
  pakar_think: ['pakar', 'expert', 'pikir mendalam', 'deepthink'],
  // legacy
  chat: ['cepat', 'instant'],
  reasoner: ['pakar', 'pikir mendalam'],
};

export const GEMINI_MODEL_LABELS: Record<GeminiModelKey, string> = {
  default: 'Default (jangan ganti)',
  flash_lite: '3.5 Flash-Lite (non-think)',
  flash: '3.6 Flash (non-think)',
  pro: 'Pro (non-think)',
  flash_lite_think: '3.5 Flash-Lite + Thinking',
  flash_think: '3.6 Flash + Thinking',
  pro_think: 'Pro + Thinking',
  thinking: 'Pro + Thinking (legacy)',
};

export const DEEPSEEK_MODEL_LABELS: Record<DeepseekModelKey, string> = {
  default: 'Default (jangan ganti)',
  cepat: 'Cepat / Instant (V4)',
  pakar: 'Pakar / Expert (V4)',
  cepat_think: 'Cepat + Pikir Mendalam',
  pakar_think: 'Pakar + Pikir Mendalam',
  chat: 'Cepat / Instant (legacy)',
  reasoner: 'Pakar + Think (legacy)',
};

export type GeminiModePlan = {
  /** Phrases to match the model row (Flash-Lite / Flash / Pro) */
  modelMatchers: string[];
  /** null = leave thinking toggle alone */
  thinking: boolean | null;
};

export function geminiModePlan(key: string): GeminiModePlan {
  switch (key) {
    case 'flash_lite':
      return {
        modelMatchers: ['3.5 flash-lite', 'flash-lite', 'flash lite', 'jawaban tercepat'],
        thinking: false,
      };
    case 'flash':
      return {
        modelMatchers: ['3.6 flash', 'bantuan serbaguna'],
        // Avoid bare "flash" first — it matches Flash-Lite too; use distinctive phrases
        thinking: false,
      };
    case 'pro':
      return {
        modelMatchers: ['matematika dan coding', 'pro'],
        thinking: false,
      };
    case 'flash_lite_think':
      return {
        modelMatchers: ['3.5 flash-lite', 'flash-lite', 'flash lite', 'jawaban tercepat'],
        thinking: true,
      };
    case 'flash_think':
      return {
        modelMatchers: ['3.6 flash', 'bantuan serbaguna'],
        thinking: true,
      };
    case 'pro_think':
    case 'thinking':
      return {
        modelMatchers: ['matematika dan coding', 'pro'],
        thinking: true,
      };
    default:
      return { modelMatchers: [], thinking: null };
  }
}

export type DeepseekModePlan = {
  mode: 'cepat' | 'pakar' | null;
  think: boolean | null; // null = leave as-is
};

export function deepseekModePlan(key: string): DeepseekModePlan {
  switch (key) {
    case 'cepat':
    case 'chat':
      return { mode: 'cepat', think: false };
    case 'pakar':
      return { mode: 'pakar', think: false };
    case 'cepat_think':
      return { mode: 'cepat', think: true };
    case 'pakar_think':
    case 'reasoner':
      return { mode: 'pakar', think: true };
    default:
      return { mode: null, think: null };
  }
}

export function getTargetConfig(id: CopasTargetId): TargetConfig | null {
  if (id === 'gemini' || id === 'deepseek' || id === 'meta' || id === 'chatgpt' || id === 'qwen' || id === 'arena') return TARGETS[id];
  return null;
}

export function tabMatchesTarget(url: string | undefined, id: CopasTargetId): boolean {
  if (!url) return false;
  const cfg = getTargetConfig(id);
  if (!cfg) return false;
  try {
    const u = new URL(url);
    if (id === 'gemini') return u.hostname === 'gemini.google.com';
    if (id === 'deepseek') return u.hostname === 'chat.deepseek.com';
    if (id === 'meta') return u.hostname === 'meta.ai' || u.hostname === 'www.meta.ai';
    if (id === 'chatgpt') return u.hostname === 'chatgpt.com';
    if (id === 'qwen') return u.hostname === 'chat.qwen.ai';
    if (id === 'arena') return u.hostname === 'arena.ai' && (u.pathname.startsWith('/text/direct') || u.pathname.startsWith('/c/'));
  } catch {
    return false;
  }
  return false;
}

export function modelMatchersFor(target: 'gemini' | 'deepseek', key: string): string[] {
  if (target === 'gemini') {
    return GEMINI_MODEL_MATCHERS[key as GeminiModelKey] || [];
  }
  return DEEPSEEK_MODEL_MATCHERS[key as DeepseekModelKey] || [];
}
