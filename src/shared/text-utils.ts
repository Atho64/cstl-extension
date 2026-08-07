export function restoreNumberedLineBreaks(text: string): string {
  const numberedMarkers = (text.match(/(?:^|\n)\d{1,6}\.\s/g) || []).length;
  const gluedMarkers = (text.match(/[^\n]\d{1,6}\.\s/g) || []).length;
  if (numberedMarkers + gluedMarkers < 2 && !/^\s*\d{1,6}\.\s/.test(text)) return text;
  return text.replace(/([^\n])(\d{1,6})\.\s/g, '$1\n$2. ');
}

function restoreSequentialNumberedLineBreaks(text: string): string {
  const first = text.match(/^\s*(\d{1,6})\.\s/);
  if (!first) return text;
  let expected = Number(first[1]) + 1;
  let restored = text;
  for (let i = 0; i < 1000; i++, expected++) {
    const pattern = new RegExp(`([^\\n])(${expected})\\.\\s`);
    if (!pattern.test(restored)) break;
    restored = restored.replace(pattern, '$1\n$2. ');
  }
  return restored;
}

/** Normalize Qwen's inline-rendered numbered translation blocks. */
export function normalizeQwenResponseText(raw: string): string {
  let text = raw.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
  // Qwen may append the prompt context in a tagged block; it is not output.
  text = text.replace(/\s*<background>[\s\S]*?<\/background>\s*$/i, '').trim();

  // Monaco's detached DOM can flatten its line-number gutter before the
  // content: "123...24251. First line2. Second line". Strip an exact
  // concatenated 1..N prefix when it is immediately followed by output line 1.
  const plaintextPrefix = text.match(/^(?:text\s*)?plaintext/i);
  const prefixOffset = plaintextPrefix?.[0].length || 0;
  const afterLabel = text.slice(prefixOffset).trimStart();
  let sequence = '';
  let gutterLength = 0;
  for (let n = 1; n <= 500 && sequence.length < afterLabel.length; n++) {
    sequence += String(n);
    if (afterLabel.startsWith(`${sequence}1. `)) gutterLength = sequence.length;
  }
  if (gutterLength > 0) text = afterLabel.slice(gutterLength);

  // Qwen renders code blocks as many adjacent spans. For AI Check this can
  // flatten the complete response into:
  // "plaintext123... [line 12]category: ...reason: ...correction: ...".
  // Remove the code-editor gutter prefix and restore structural newlines.
  const firstAiCheckBlock = text.search(/\[line\s+\d+\]/i);
  if (firstAiCheckBlock >= 0) {
    const prefix = text.slice(0, firstAiCheckBlock).replace(/\s+/g, ' ').trim();
    if (!prefix || /^(?:text\s*)?plaintext[\d\s]*$/i.test(prefix) || !/[A-Za-zÀ-ÿぁ-んァ-ン一-龯]/.test(prefix)) {
      text = text.slice(firstAiCheckBlock);
    }
    text = text
      .replace(/([^\n])(?=\[line\s+\d+\])/gi, '$1\n')
      .replace(/(\[line\s+\d+\])\s*(?=category\s*:)/gi, '$1\n')
      .replace(/([^\n])(?=reason\s*:)/gi, '$1\n')
      .replace(/([^\n])(?=(?:correction|text|name)\s*:)/gi, '$1\n');
  }

  // Glossary code blocks suffer from the same flattened-span rendering:
  // "plaintext123[character] A = B {...}[term] C = D {...}".
  // Only recognize CSTL's supported glossary types so brackets inside names
  // or descriptions are not split accidentally.
  const glossaryType = '(?:character|place|organization|item|ability|title|concept|term)';
  const firstGlossaryEntry = text.search(new RegExp(`\\[${glossaryType}\\]\\s*[^=\\n]+\\s*=`, 'i'));
  if (firstGlossaryEntry >= 0) {
    const prefix = text.slice(0, firstGlossaryEntry).replace(/\s+/g, ' ').trim();
    if (!prefix || /^(?:text\s*)?plaintext[\d\s]*$/i.test(prefix) || !/[A-Za-zÀ-ÿぁ-んァ-ン一-龯]/.test(prefix)) {
      text = text.slice(firstGlossaryEntry);
    }
    text = text.replace(new RegExp(`([^\\n])(?=\\[${glossaryType}\\]\\s*[^=\\n]+\\s*=)`, 'gi'), '$1\n');
  }

  // A run of line-number spans can be flattened before the real marker, e.g.
  // "123456789...2829 6035. Akari...". Discard that UI-number prefix.
  const markers = [...text.matchAll(/(\d{4,6})\.\s/g)];
  if (markers.length >= 2) {
    const second = Number(markers[1][1]);
    const expectedFirst = second - 1;
    const secondIndex = markers[1].index ?? text.length;
    const expectedMarker = `${expectedFirst}. `;
    const expectedIndex = text.lastIndexOf(expectedMarker, secondIndex);
    if (expectedIndex >= 0) {
      const prefix = text.slice(0, expectedIndex);
      if (!/[A-Za-zÀ-ÿぁ-んァ-ン一-龯]/.test(prefix)) text = text.slice(expectedIndex);
    }
  }
  const firstMarker = text.search(/\d{4,6}\.\s/);
  if (firstMarker > 0) {
    const prefix = text.slice(0, firstMarker);
    const normalizedPrefix = prefix.replace(/\s+/g, ' ').trim();
    const isUiNumberNoise = !/[A-Za-zÀ-ÿぁ-んァ-ン一-龯]/.test(prefix);
    const isPlaintextUiNoise = /^(?:text\s*)?plaintext[\d\s]*$/i.test(normalizedPrefix);
    if (isUiNumberNoise || isPlaintextUiNoise) text = text.slice(firstMarker);
  }

  // Qwen commonly glues markers: "1. ...2. ..." or "6035. ...6036. ...".
  text = restoreSequentialNumberedLineBreaks(text);
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/g, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function countNumberedTranslationLines(text: string): number {
  return (text.match(/(?:^|\n)\d{1,6}\.\s/g) || []).length;
}

export function countAiCheckBlocks(text: string): number {
  return (text.match(/(?:^|\n)\[line\s+\d+\](?:\n|$)/gi) || []).length;
}

export function countGlossaryEntries(text: string): number {
  return (text.match(/(?:^|\n)\[(?:character|place|organization|item|ability|title|concept|term)\]\s*[^=\n]+\s*=\s*\S+/gi) || []).length;
}

export function chooseBestQwenResponse(candidates: string[]): string {
  let best = '';
  let bestScore = -1;
  for (const raw of candidates) {
    const text = normalizeQwenResponseText(raw);
    if (!text) continue;
    const numbered = countNumberedTranslationLines(text);
    const aiCheckBlocks = countAiCheckBlocks(text);
    const glossaryEntries = countGlossaryEntries(text);
    // Numbered lines are the strongest signal. Length breaks ties between a
    // nested paragraph and its complete assistant-message parent.
    const score = Math.max(numbered, aiCheckBlocks, glossaryEntries) * 1_000_000 + Math.min(text.length, 999_999);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best;
}
