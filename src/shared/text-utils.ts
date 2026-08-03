export function restoreNumberedLineBreaks(text: string): string {
  const numberedMarkers = (text.match(/(?:^|\n)\d{1,6}\.\s/g) || []).length;
  const gluedMarkers = (text.match(/[^\n]\d{1,6}\.\s/g) || []).length;
  if (numberedMarkers + gluedMarkers < 2 && !/^\s*\d{1,6}\.\s/.test(text)) return text;
  return text.replace(/([^\n])(\d{1,6})\.\s/g, '$1\n$2. ');
}

/** Normalize Qwen's inline-rendered numbered translation blocks. */
export function normalizeQwenResponseText(raw: string): string {
  let text = raw.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
  // Qwen may append the prompt context in a tagged block; it is not output.
  text = text.replace(/\s*<background>[\s\S]*?<\/background>\s*$/i, '').trim();

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

  // Qwen commonly glues markers: "6035. ...6036. ...".
  text = text.replace(/([^\n])(\d{4,6})\.\s/g, '$1\n$2. ');
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/g, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function countNumberedTranslationLines(text: string): number {
  return (text.match(/(?:^|\n)\d{4,6}\.\s/g) || []).length;
}

export function chooseBestQwenResponse(candidates: string[]): string {
  let best = '';
  let bestScore = -1;
  for (const raw of candidates) {
    const text = normalizeQwenResponseText(raw);
    if (!text) continue;
    const numbered = countNumberedTranslationLines(text);
    // Numbered lines are the strongest signal. Length breaks ties between a
    // nested paragraph and its complete assistant-message parent.
    const score = numbered * 1_000_000 + Math.min(text.length, 999_999);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best;
}
