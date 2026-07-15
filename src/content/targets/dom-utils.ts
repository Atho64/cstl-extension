/** Shared DOM helpers for target content scripts */

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForSelector(
  selectors: string[],
  timeoutMs = 15000
): Promise<Element | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) return el;
      } catch {
        /* invalid selector */
      }
    }
    await sleep(200);
  }
  // last try without visibility
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch {
      /* */
    }
  }
  return null;
}

export function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

export function queryAll(selectors: string[]): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      });
    } catch {
      /* */
    }
  }
  return out;
}

/** Insert text into textarea or contenteditable */
export async function pasteIntoComposer(el: Element, text: string): Promise<void> {
  const anyEl = el as HTMLElement;
  anyEl.focus();
  await sleep(50);

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.focus();
    el.value = '';
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // React-style setter
    try {
      const proto = el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      /* */
    }
    return;
  }

  // contenteditable
  anyEl.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(anyEl);
  sel?.removeAllRanges();
  sel?.addRange(range);

  // Try execCommand first (still works in many apps)
  let ok = false;
  try {
    ok = document.execCommand('selectAll', false);
    ok = document.execCommand('insertText', false, text) || ok;
  } catch {
    ok = false;
  }

  if (!ok || !(anyEl.innerText || '').trim()) {
    anyEl.innerHTML = '';
    anyEl.textContent = text;
    anyEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    anyEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // beforeinput / input for frameworks
  anyEl.dispatchEvent(
    new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
  );
  anyEl.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
  );
}

export function clickSend(selectors: string[]): boolean {
  for (const sel of selectors) {
    try {
      const btn = document.querySelector(sel) as HTMLElement | null;
      if (btn && isVisible(btn) && !(btn as HTMLButtonElement).disabled) {
        btn.click();
        return true;
      }
    } catch {
      /* */
    }
  }
  // fallback: Enter key on focused composer
  const active = document.activeElement as HTMLElement | null;
  if (active) {
    active.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
    );
    return true;
  }
  return false;
}

// ─── UI noise patterns to strip from scraped text ───
const UI_NOISE_PATTERNS: RegExp[] = [
  /^(Copy|Salin|Menyalin)\s*$/gim,
  /^(Share|Bagikan|Berbagi)\s*$/gim,
  /^(Regenerate|Buat ulang|Regenerasi)\s*$/gim,
  /^(Edit|Sunting)\s*$/gim,
  /^(plaintext)\s*$/gim,
  /^(Show more|Tampilkan lebih|Baca selengkapnya)\s*$/gim,
  /^(Listen|Dengarkan|Putar)\s*$/gim,
  /^(Like|Suka)\s*$/gim,
  /^(Dislike|Tidak suka)\s*$/gim,
  /^(Report|Laporkan)\s*$/gim,
  /^(Good response|Respons bagus)\s*$/gim,
  /^(Bad response|Respons buruk)\s*$/gim,
  /^(Check understanding|Periksa pemahaman)\s*$/gim,
  /^(Retry|Coba lagi)\s*$/gim,
  /^(Drafts?|Draf)\s*$/gim,
  /^(Export|Ekspor|Unduh|Download)\s*$/gim,
  /^(More options|Opsi lainnya|Menu)\s*$/gim,
  /^\d+\s*\/\s*\d+\s*$/,  // pagination like "1/4"
  /^(Listen to audio|Dengarkan audio)\s*$/gim,
  /^(Read aloud|Baca keras-keras)\s*$/gim,
];

const UI_NOISE_WORDS = new Set([
  'plaintext', 'copy', 'salin', 'share', 'bagikan', 'regenerate', 'regenerasi',
  'edit', 'sunting', 'listen', 'dengarkan', 'like', 'suka', 'dislike',
  'report', 'laporkan', 'retry', 'coba lagi', 'draft', 'draf', 'export',
  'ekspor', 'unduh', 'download', 'menu', 'more', 'options', 'opsi', 'lainnya',
]);

function isUINoiseLine(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  if (!trimmed) return false;
  // single-word UI labels
  if (UI_NOISE_WORDS.has(trimmed)) return true;
  // check patterns
  for (const pat of UI_NOISE_PATTERNS) {
    pat.lastIndex = 0;
    if (pat.test(line)) return true;
  }
  // very short lines (< 4 chars) that aren't numbers/punctuation
  if (trimmed.length < 3 && !/^\d/.test(trimmed) && !/^[「」""''。、！？]/.test(trimmed)) return true;
  return false;
}

function cleanScrapedText(raw: string): string {
  let lines = raw.replace(/\r\n/g, '\n').split('\n');

  // Remove noise lines
  lines = lines.filter((line) => !isUINoiseLine(line));

  // Remove trailing/leading empty lines
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Remove common Gemini footer artifacts
  text = text.replace(/^(Plaintext|plaintext)\s*\n/gim, '');
  text = text.replace(/\n(Plaintext|plaintext)\s*$/gim, '');

  // Gemini sometimes exposes its "Gemini says" accessibility label and the
  // code-block language label as adjacent text nodes, without a newline:
  // "Gemini berkataPlaintext4301. ...". Only strip this at the start when a
  // recognizable translation payload follows, so normal response content is
  // never removed.
  text = text.replace(
    /^\s*(?:gemini\s*(?:berkata|says|said)\s*)?plaintext\s*(?=(?:\d+\s*[.)]|\[line\s+\d+\]|<\?xml\b|<lines\b|<line\s+num=|\{\s*"num"|\[\s*\d+\s*,))/i,
    ''
  );

  // Remove "Responses are AI-generated" type disclaimers
  text = text.replace(/^(Respons?e?s? (are|adalah) AI[- ]generated\.?|Responses? (are|adalah) generated by AI\.?)\s*$/gim, '');

  return text;
}

export function getLastAssistantText(selectors: string[]): string {
  const nodes = queryAll(selectors);
  // prefer last non-empty
  for (let i = nodes.length - 1; i >= 0; i--) {
    const t = normalizeMessageText(nodes[i]);
    if (t.trim().length > 0) return cleanScrapedText(t);
  }
  // broader fallback: last large text block in main
  const main = document.querySelector('main') || document.body;
  const candidates = Array.from(main.querySelectorAll('div, article, section, p'))
    .map((el) => ({ el, t: (el as HTMLElement).innerText || '' }))
    .filter((x) => x.t.trim().length > 80);
  if (candidates.length) {
    return cleanScrapedText(candidates[candidates.length - 1].t);
  }
  return '';
}

/** Same as getLastAssistantText, but ignore a just-submitted user message. */
export function getLastAssistantTextExcluding(selectors: string[], excluded: string): string {
  const excludedNorm = excluded.replace(/\s+/g, ' ').trim();
  const nodes = queryAll(selectors);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const t = normalizeMessageText(nodes[i]);
    const compact = t.replace(/\s+/g, ' ').trim();
    if (t.trim() && (!excludedNorm || compact !== excludedNorm)) return cleanScrapedText(t);
  }
  // Do not fall back to a broad page scrape here: for Meta AI that could
  // return the user's just-submitted prompt, which is worse than reporting
  // that the assistant selector needs updating.
  return '';
}

function normalizeMessageText(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement;
  // strip scripts / styles first (inline analytics scripts can leak into innerText fallbacks)
  clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  // strip buttons / toolbars / icons / mat-icons / svgs
  clone.querySelectorAll(
    'button, [role="button"], nav, svg, mat-icon, [aria-label*="Copy" i], [aria-label*="Share" i], [aria-label*="Regenerate" i], [aria-label*="Edit" i], [aria-label*="Listen" i], [data-testid*="copy" i], [data-testid*="share" i], [data-testid*="regenerate" i], .copy-button, .action-bar, .message-actions, .response-toolbar, [class*="toolbar"], [class*="action"]'
  ).forEach((n) => n.remove());
  let text = clone.innerText || clone.textContent || '';
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}


// ─── Generation detection helpers ───

/**
 * Check if the LLM is still generating a response.
 *
 * @param preferStop If true (DeepSeek), only trust a visible Stop control as
 *   "generating". Do NOT treat an enabled Send button as "done" — DeepSeek
 *   often leaves Send usable / visible while the stream is still writing, so
 *   early Send-based idle detection causes partial scrapes (plaintext mid-stream).
 *   If false (Gemini), an enabled Send is treated as a positive completion
 *   signal because Gemini hides/disables Send while streaming.
 */
export function isGenerating(
  generatingSelectors: string[],
  idleSelectors: string[],
  preferStop = false
): boolean {
  let stopVisible = false;
  for (const sel of generatingSelectors) {
    try {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el && isVisible(el)) {
        stopVisible = true;
        break;
      }
    } catch { /* */ }
  }
  if (stopVisible) return true;

  if (!preferStop) {
    // Gemini: enabled Send ≈ generation finished
    for (const sel of idleSelectors) {
      try {
        const el = document.querySelector(sel) as HTMLButtonElement | null;
        if (el && isVisible(el) && !el.disabled) return false;
      } catch { /* */ }
    }
  }

  // Unknown / no stop visible — caller should fall back to text stability.
  return false;
}

/**
 * Poll assistant text until length stops growing for `stableMs`, or timeout.
 * Prevents scraping while DeepSeek/Gemini still stream tokens into the DOM
 * (common symptom: code-block label "plaintext" appears, then body keeps growing).
 */
export async function waitForStableAssistantText(
  selectors: string[],
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    stableMs?: number;
    minChars?: number;
    isStillGenerating?: () => boolean;
  }
): Promise<{ text: string; stable: boolean; reason: string }> {
  const timeoutMs = opts?.timeoutMs ?? 120000;
  const pollMs = opts?.pollMs ?? 400;
  const stableMs = opts?.stableMs ?? 1800;
  const minChars = opts?.minChars ?? 8;
  const deadline = Date.now() + timeoutMs;

  let lastText = '';
  let lastLen = -1;
  let stableSince = 0;
  let sawGrowth = false;

  while (Date.now() < deadline) {
    if (opts?.isStillGenerating?.()) {
      // Reset stability while UI still shows generating
      stableSince = 0;
      lastLen = -1;
      await sleep(pollMs);
      continue;
    }

    const text = getLastAssistantText(selectors);
    const len = text.trim().length;

    if (len > lastLen && lastLen >= 0) sawGrowth = true;
    if (len > 0 && len === lastLen && text === lastText) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= stableMs && len >= minChars) {
        return { text, stable: true, reason: 'stable' };
      }
    } else {
      stableSince = len > 0 ? Date.now() : 0;
      lastText = text;
      lastLen = len;
    }

    await sleep(pollMs);
  }

  const finalText = getLastAssistantText(selectors);
  if (finalText.trim().length >= minChars) {
    return {
      text: finalText,
      stable: false,
      reason: sawGrowth ? 'timeout_with_partial' : 'timeout',
    };
  }
  return { text: finalText, stable: false, reason: 'empty_timeout' };
}

/**
 * Best-effort model selection via UI picker (Gemini-style dropdown).
 * Returns selected=true if an option matching one of `matchers` was clicked.
 * matchers empty → no-op success (keep current model).
 */
export async function selectModelInUi(
  openSelectors: string[],
  menuSelectors: string[],
  matchers: string[]
): Promise<{ selected: boolean; detail: string }> {
  if (!matchers.length) return { selected: true, detail: 'model_default_skip' };

  // Gemini: try label-based open first (avoid Settings / gear / account)
  let openBtn: Element | null = null;
  const preferredOpen = findByLabels(
    [
      'switch model',
      'ganti model',
      'choose a model',
      'pilih model',
      'model picker',
      'flash',
      'pro',
      '2.5 flash',
      '2.5 pro',
      '2.0 flash',
    ],
    48
  );
  if (preferredOpen && !looksLikeSettings(preferredOpen)) {
    openBtn = preferredOpen;
  }
  if (!openBtn) {
    for (const sel of openSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el) && !looksLikeSettings(el as HTMLElement)) {
          openBtn = el;
          break;
        }
      } catch { /* */ }
    }
  }
  if (!openBtn) return { selected: false, detail: 'model_picker_not_found' };

  (openBtn as HTMLElement).click();
  await sleep(400);

  const menuRoots: Element[] = [];
  for (const sel of menuSelectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => menuRoots.push(el));
    } catch { /* */ }
  }
  if (!menuRoots.length) menuRoots.push(document.body);

  const optionCandidates: HTMLElement[] = [];
  const optionSel = [
    '[role="menuitem"]',
    '[role="option"]',
    'button',
    'div[role="button"]',
    'li',
    'label',
    'mat-option',
    '[class*="option" i]',
    '[class*="item" i]',
  ].join(', ');

  for (const root of menuRoots) {
    try {
      root.querySelectorAll(optionSel).forEach((el) => {
        if (el instanceof HTMLElement && isVisible(el) && !looksLikeSettings(el)) {
          optionCandidates.push(el);
        }
      });
    } catch { /* */ }
  }

  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const phrase of matchers) {
    const p = norm(phrase);
    if (!p) continue;
    for (const el of optionCandidates) {
      const label = norm(
        `${el.getAttribute('aria-label') || ''} ${el.innerText || el.textContent || ''}`
      );
      if (!label || label.length > 120) continue;
      // Skip settings-ish items even inside menus
      if (/\b(settings|pengaturan|setting|akun|account|privacy|privasi)\b/.test(label)) continue;
      if (label.indexOf(p) >= 0) {
        el.click();
        await sleep(250);
        return { selected: true, detail: `model_selected:${phrase}` };
      }
    }
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { selected: false, detail: 'model_option_not_found' };
}

/**
 * Gemini model selection for current web UI:
 * 1) open model menu
 * 2) click Flash-Lite / Flash / Pro row
 * 3) set thinking toggle if present (Penalaran / Thinking / Thinking mode)
 */
export async function selectGeminiMode(plan: {
  modelMatchers: string[];
  thinking: boolean | null;
}): Promise<{ selected: boolean; detail: string }> {
  if (!plan.modelMatchers.length && plan.thinking === null) {
    return { selected: true, detail: 'model_default_skip' };
  }

  const parts: string[] = [];

  // Open picker — prefer current model chip / switcher labels
  let openBtn: HTMLElement | null = findByLabels(
    [
      'switch model',
      'ganti model',
      'choose a model',
      'pilih model',
      'model picker',
      'flash-lite',
      'flash lite',
      '3.5 flash',
      '3.1 flash-lite',
      '3.1 pro',
      'flash',
      'pro',
    ],
    64
  );
  if (openBtn && looksLikeSettings(openBtn)) openBtn = null;
  if (!openBtn) {
    // fallback CSS from config is handled by caller via selectModelInUi if needed
  }
  if (openBtn) {
    openBtn.click();
    await sleep(450);
  } else {
    // try generic menu open near top
    const any = findByLabels(['gemini'], 24);
    if (any && !looksLikeSettings(any)) {
      any.click();
      await sleep(450);
    }
  }

  const menuRoots: Element[] = [];
  for (const sel of [
    '[role="menu"]',
    '[role="listbox"]',
    'mat-menu',
    '.mat-mdc-menu-panel',
    '[data-test-id*="model" i]',
    '[data-test-id*="bard-mode" i]',
  ]) {
    try {
      document.querySelectorAll(sel).forEach((el) => menuRoots.push(el));
    } catch { /* */ }
  }
  if (!menuRoots.length) menuRoots.push(document.body);

  const optionCandidates: HTMLElement[] = [];
  const optionSel = [
    '[role="menuitem"]',
    '[role="option"]',
    'button',
    'div[role="button"]',
    'li',
    'label',
    'mat-option',
    '[class*="option" i]',
    '[class*="item" i]',
  ].join(', ');
  for (const root of menuRoots) {
    try {
      root.querySelectorAll(optionSel).forEach((el) => {
        if (el instanceof HTMLElement && isVisible(el) && !looksLikeSettings(el)) {
          optionCandidates.push(el);
        }
      });
    } catch { /* */ }
  }

  // Prefer longer/more specific matcher first (flash-lite before flash)
  const matchers = plan.modelMatchers.slice().sort((a, b) => b.length - a.length);
  let modelClicked = false;
  for (const phrase of matchers) {
    const p = normLabel(phrase);
    if (!p) continue;
    let best: { el: HTMLElement; score: number } | null = null;
    for (const el of optionCandidates) {
      const label = normLabel(
        `${el.getAttribute('aria-label') || ''} ${el.innerText || el.textContent || ''}`
      );
      if (!label || label.length > 160) continue;
      if (/\b(settings|pengaturan|akun|account)\b/.test(label)) continue;
      // If looking for plain Flash, skip Flash-Lite rows
      if (p === 'flash' || p === '3.5 flash' || p === 'bantuan serbaguna') {
        if (label.indexOf('flash-lite') >= 0 || label.indexOf('flash lite') >= 0) continue;
      }
      // If looking for Pro, skip non-pro flash rows
      if (p === 'pro' || p === '3.1 pro') {
        if (label.indexOf('flash') >= 0 && label.indexOf('pro') < 0) continue;
      }
      if (label.indexOf(p) >= 0) {
        const score = 1000 + p.length - Math.abs(label.length - p.length);
        if (!best || score > best.score) best = { el, score };
      }
    }
    if (best) {
      best.el.click();
      await sleep(350);
      parts.push(`model:${phrase}`);
      modelClicked = true;
      break;
    }
  }
  if (!modelClicked && plan.modelMatchers.length) parts.push('model_not_found');

  // Thinking is a 4th menu row under Pro: "Penalaran yang diperluas"
  // (checkbox-style). Just click it when desired state differs. Menu must stay open.
  if (plan.thinking !== null) {
    await sleep(250);
    // Gemini closes (or refreshes) this menu after a model row is selected.
    // Always perform the second model-selector click explicitly. Closing first
    // also prevents a still-visible old menu from making us skip that click.
    if (modelClicked) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(120);
      const picker = findByLabels(
        [
          'switch model',
          'ganti model',
          'choose a model',
          'pilih model',
          'model picker',
          'flash-lite',
          'flash lite',
          '3.5 flash',
          '3.1 flash-lite',
          '3.1 pro',
          'flash',
          'pro',
        ],
        64
      );
      if (picker && !looksLikeSettings(picker)) {
        picker.click();
        await sleep(450);
      }
    }

    // Re-scan menu after the picker was reopened (DOM may refresh)
    const thinkRoots: Element[] = [];
    for (const sel of [
      '[role="menu"]',
      '[role="listbox"]',
      'mat-menu',
      '.mat-mdc-menu-panel',
      '[data-test-id*="model" i]',
      '[data-test-id*="bard-mode" i]',
    ]) {
      try {
        document.querySelectorAll(sel).forEach((el) => thinkRoots.push(el));
      } catch { /* */ }
    }
    if (!thinkRoots.length) thinkRoots.push(document.body);

    const thinkPhrases = [
      'penalaran yang diperluas',
      'penalaran yang lebih luas',
      'penalaran diperluas',
      'pemecahan masalah kompleks',
      'extended thinking',
      'thinking mode',
      'thinking',
      'penalaran',
    ];

    let thinkEl: HTMLElement | null = null;
    let thinkLabel = '';
    for (const root of thinkRoots) {
      // Gemini's current menu renders the reasoning label inside plain div/span
      // elements (without role=menuitem). Search the text nodes too, then click
      // the nearest interactive row so this keeps working across UI variants.
      const nodes = root.querySelectorAll('*');
      for (const node of Array.from(nodes)) {
        if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
        const label = normLabel(
          `${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`
        );
        if (!label || label.length > 120) continue;
        // Must be the thinking row — not Flash/Pro model rows
        if (label.indexOf('flash') >= 0 || /\b3\.\d+\s*pro\b/.test(label) && label.indexOf('penalaran') < 0) {
          continue;
        }
        for (const phrase of thinkPhrases) {
          if (label.indexOf(phrase) >= 0) {
            const clickable = node.closest(
              '[role="menuitem"], [role="menuitemcheckbox"], [role="option"], [role="checkbox"], button, div[role="button"], li, label, mat-option'
            ) as HTMLElement | null;
            thinkEl = clickable || node;
            thinkLabel = normLabel(
              `${thinkEl.getAttribute('aria-label') || ''} ${thinkEl.innerText || thinkEl.textContent || ''}`
            );
            break;
          }
        }
        if (thinkEl) break;
      }
      if (thinkEl) break;
    }

    if (thinkEl) {
      const on = isGeminiThinkingOn(thinkEl);
      if (on !== plan.thinking) {
        // Prefer nested checkbox/switch if present; otherwise click the whole row
        const nested = thinkEl.querySelector(
          'input[type="checkbox"], [role="switch"], [role="checkbox"], [aria-checked]'
        ) as HTMLElement | null;
        (nested || thinkEl).click();
        await sleep(300);
        // If state still wrong, click the row once more (some UIs need row click)
        if (isGeminiThinkingOn(thinkEl) !== plan.thinking) {
          thinkEl.click();
          await sleep(250);
        }
      }
      parts.push(
        plan.thinking
          ? `think:on${on === plan.thinking ? ':already' : ''}`
          : `think:off${on === plan.thinking ? ':already' : ''}`
      );
    } else {
      parts.push('think_not_found');
    }
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  const ok = parts.some(
    (p) => p.indexOf('model:') === 0 || p.indexOf('think:') === 0
  );
  return { selected: ok, detail: parts.join(',') || 'no_action' };
}

function hasVisibleGeminiPicker(): boolean {
  for (const sel of [
    '[role="menu"]',
    '[role="listbox"]',
    'mat-menu',
    '.mat-mdc-menu-panel',
    '[data-test-id*="model" i]',
    '[data-test-id*="bard-mode" i]',
  ]) {
    try {
      if (Array.from(document.querySelectorAll(sel)).some((el) => isVisible(el))) {
        return true;
      }
    } catch { /* invalid selector */ }
  }
  return false;
}

/** Detect whether Gemini "Penalaran yang diperluas" row is currently enabled. */
function isGeminiThinkingOn(el: HTMLElement): boolean {
  const aria = (el.getAttribute('aria-checked') || el.getAttribute('aria-pressed') || '').toLowerCase();
  if (aria === 'true') return true;
  if (aria === 'false') return false;

  const nested = el.querySelector(
    'input[type="checkbox"], [role="switch"], [role="checkbox"], [aria-checked], [aria-pressed]'
  ) as HTMLElement | null;
  if (nested) {
    if (nested instanceof HTMLInputElement) return !!nested.checked;
    const ac = (nested.getAttribute('aria-checked') || nested.getAttribute('aria-pressed') || '').toLowerCase();
    if (ac === 'true') return true;
    if (ac === 'false') return false;
    if (isPressed(nested)) return true;
  }

  // Selected checkmark / active class on the thinking row
  if (el.querySelector('[class*="check" i], mat-icon, svg[data-testid*="check" i]')) {
    // Many menus always render an icon slot; only trust if aria/class says selected
  }
  const cls = (el.className || '').toString().toLowerCase();
  if (/\b(selected|active|checked|mdc-list-item--selected)\b/.test(cls)) return true;
  if (el.getAttribute('aria-selected') === 'true') return true;
  return isPressed(el);
}

function looksLikeSettings(el: HTMLElement): boolean {
  const t = normLabel(
    `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-test-id') || ''} ${el.innerText || el.textContent || ''}`
  );
  if (!t) return false;
  if (/\b(settings|pengaturan|setting|gear|account|akun|profile|profil|privacy|privasi)\b/.test(t)) {
    return true;
  }
  // pure gear icon buttons often have empty/short labels but aria-label settings
  return false;
}

/**
 * Click sidebar "New Chat" / "Obrolan Baru" / "Baru" — does NOT open a browser tab.
 */
export async function clickNewChat(labels: string[]): Promise<{ ok: boolean; detail: string }> {
  const want = (labels.length ? labels : ['new chat', 'obrolan baru', 'baru']).map(normLabel);
  // Prefer left sidebar region if present
  const roots: Element[] = [];
  for (const sel of ['nav', 'aside', '[class*="sidebar" i]', '[class*="side-bar" i]', 'header', 'body']) {
    try {
      document.querySelectorAll(sel).forEach((el) => roots.push(el));
    } catch { /* */ }
  }
  if (!roots.length) roots.push(document.body);

  const candidates: { el: HTMLElement; score: number }[] = [];
  for (const root of roots) {
    const nodes = root.querySelectorAll(
      'button, a, div[role="button"], [role="link"], span[role="button"]'
    );
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return;
      const aria = normLabel(node.getAttribute('aria-label') || '');
      const title = normLabel(node.getAttribute('title') || '');
      const testId = normLabel(node.getAttribute('data-testid') || node.getAttribute('data-test-id') || '');
      const text = normLabel(`${aria} ${title} ${node.innerText || node.textContent || ''}`);
      if (!text || text.length > 48) return;
      if (looksLikeSettings(node)) return;

      // DeepSeek renders history entries as clickable links/items in the same
      // sidebar as New Chat. Never treat a chat URL or an explicitly marked
      // history item as the New Chat control.
      const href = normLabel(node.getAttribute('href') || '');
      const marker = `${testId} ${normLabel(node.className?.toString() || '')}`;
      if (
        href.includes('/a/chat') ||
        /(^|[-_ ])history([-_ ]|$)|chat-item|conversation-item/.test(marker)
      ) return;

      for (const w of want) {
        if (text === w || text.indexOf(w) >= 0) {
          // Prefer shorter labels and items higher on page (new chat is usually top-left)
          const rect = node.getBoundingClientRect();
          // An exact accessible label is much more reliable than visible text
          // from a parent sidebar/history container.
          const exactControl = aria === w || title === w || testId === w || testId.includes('new-chat');
          const score =
            (exactControl ? 10000 : 2000) -
            text.length -
            Math.floor(rect.top) -
            Math.floor(rect.left / 10);
          candidates.push({ el: node, score });
          break;
        }
      }
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return { ok: false, detail: 'new_chat_not_found' };
  best.el.click();
  await sleep(600);
  return { ok: true, detail: `new_chat:${normLabel(best.el.innerText || best.el.getAttribute('aria-label') || '')}` };
}

function normLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function collectClickable(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<Element>();
  const sels = [
    'button',
    'div[role="button"]',
    '[role="tab"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="checkbox"]',
    'label',
    'span[role="button"]',
    // DeepSeek V4 toggle buttons (e.g. "Pikir Mendalam") are plain
    // <div tabindex="0" aria-pressed="..."> — no role="button".
    '[aria-pressed]',
  ];
  for (const sel of sels) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        if (seen.has(el)) return;
        if (!(el instanceof HTMLElement) || !isVisible(el)) return;
        seen.add(el);
        out.push(el);
      });
    } catch { /* */ }
  }
  return out;
}

function isPressed(el: HTMLElement): boolean {
  const aria = (el.getAttribute('aria-pressed') || el.getAttribute('aria-checked') || '').toLowerCase();
  if (aria === 'true') return true;
  const cls = (el.className || '').toString().toLowerCase();
  if (/\b(active|selected|checked|on|enabled|pressed)\b/.test(cls)) return true;
  // DeepSeek often uses data-state / data-active
  const ds = (el.getAttribute('data-state') || el.getAttribute('data-active') || '').toLowerCase();
  if (ds === 'on' || ds === 'true' || ds === 'checked' || ds === 'active') return true;
  return false;
}

function findByLabels(labels: string[], maxLen = 48): HTMLElement | null {
  const needles = labels.map(normLabel).filter(Boolean);
  if (!needles.length) return null;
  const nodes = collectClickable();
  // Prefer short, exact-ish labels (mode chips are short: "Cepat", "Pakar")
  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of nodes) {
    const text = normLabel(`${el.getAttribute('aria-label') || ''} ${el.innerText || el.textContent || ''}`);
    if (!text || text.length > maxLen) continue;
    for (const n of needles) {
      if (text === n) {
        return el; // exact
      }
      if (text.indexOf(n) >= 0) {
        const score = 1000 - text.length + n.length;
        if (!best || score > best.score) best = { el, score };
      }
    }
  }
  return best?.el || null;
}

/**
 * DeepSeek V4 mode selection:
 * 1) click Mode dropdown if present ("Mode Cepat" / "Mode Pakar") then pick Cepat/Pakar
 * 2) or click chip Cepat / Pakar directly
 * 3) set "Pikir Mendalam" toggle on/off as requested
 */
export async function selectDeepseekMode(plan: {
  mode: 'cepat' | 'pakar' | null;
  think: boolean | null;
}): Promise<{ selected: boolean; detail: string }> {
  if (!plan.mode && plan.think === null) {
    return { selected: true, detail: 'model_default_skip' };
  }

  const parts: string[] = [];

  if (plan.mode) {
    const want = plan.mode === 'cepat'
      ? ['cepat', 'instant', 'fast']
      : ['pakar', 'expert'];

    // Try open mode menu first (title "Mode Cepat" / "Mode Pakar")
    const modeOpen = findByLabels(['mode cepat', 'mode pakar', 'mode instant', 'mode expert', 'mode'], 40);
    if (modeOpen) {
      modeOpen.click();
      await sleep(300);
    }

    let modeBtn = findByLabels(want, 32);
    // If menu opened, options may be menuitems
    if (!modeBtn) {
      const menuItems = Array.from(
        document.querySelectorAll('[role="menuitem"], [role="option"], li, button, div[role="button"]')
      ).filter((el): el is HTMLElement => el instanceof HTMLElement && isVisible(el));
      for (const el of menuItems) {
        const t = normLabel(el.innerText || el.textContent || '');
        if (!t || t.length > 40) continue;
        if (want.some((w) => t === w || t.indexOf(w) >= 0)) {
          modeBtn = el;
          break;
        }
      }
    }

    if (modeBtn) {
      if (!isPressed(modeBtn)) {
        modeBtn.click();
        await sleep(250);
      } else {
        // already selected — click still ok for some UIs, but skip to avoid toggle-off
        await sleep(80);
      }
      parts.push(`mode:${plan.mode}`);
    } else {
      parts.push('mode_not_found');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
  }

  if (plan.think !== null) {
    // maxLen 60: tombol bisa punya teks gabungan aria-label + innerText
    const thinkBtn = findByLabels(
      ['pikir mendalam', 'deepthink', 'deep think', 'deep thinking', 'thinking'],
      60
    );
    if (thinkBtn) {
      const on = isPressed(thinkBtn);
      if (on !== plan.think) {
        thinkBtn.click();
        await sleep(250);
      }
      parts.push(plan.think ? 'think:on' : 'think:off');
    } else {
      parts.push('think_not_found');
    }
  }

  const ok = parts.some((p) => p.startsWith('mode:') || p.startsWith('think:'));
  return { selected: ok, detail: parts.join(',') || 'no_action' };
}

export type TargetAction =
  | {
      type: 'TARGET_PASTE';
      requestId: string;
      payload: string;
      mode: 'semi' | 'full';
      modelKey?: string;
    }
  | { type: 'TARGET_FETCH_LAST'; requestId: string }
  | { type: 'TARGET_SUBMIT'; requestId: string }
  | { type: 'TARGET_CHECK_GENERATING'; requestId: string }
  | { type: 'TARGET_SELECT_MODEL'; requestId: string; modelKey?: string }
  | { type: 'TARGET_NEW_CHAT'; requestId: string };

export type TargetActionResult = {
  ok: boolean;
  requestId: string;
  text?: string;
  error?: string;
  stage?: string;
  generating?: boolean;
  detail?: string;
};
