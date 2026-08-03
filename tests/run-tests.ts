import { deepseekModePlan, geminiModePlan } from '../src/shared/targets-config';
import { tabMatchesTarget } from '../src/shared/targets-config';
import { mergeSettings, normalizeGeminiModelKey } from '../src/shared/protocol';
import { chooseBestQwenResponse, normalizeQwenResponseText, restoreNumberedLineBreaks } from '../src/shared/text-utils';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(geminiModePlan('flash').modelMatchers[0] === '3.6 flash', 'Gemini Flash harus memakai label 3.6');
assert(geminiModePlan('flash_lite').modelMatchers[0] === '3.5 flash-lite', 'Flash-Lite harus memakai label 3.5');
assert(geminiModePlan('flash_think').thinking === true, 'Flash thinking harus aktif');
assert(deepseekModePlan('pakar_think').think === true, 'DeepSeek expert thinking harus aktif');
assert(normalizeGeminiModelKey('thinking') === 'pro_think', 'Setting Gemini legacy harus dimigrasikan');
assert(mergeSettings({ target: 'chatgpt' }).target === 'chatgpt', 'Target ChatGPT harus diterima');
assert(mergeSettings({ target: 'qwen' }).target === 'qwen', 'Target Qwen harus diterima');
assert(mergeSettings({ target: 'arena' }).target === 'arena', 'Target Arena harus diterima');
assert(tabMatchesTarget('https://arena.ai/c/example', 'arena'), 'Percakapan /c Arena harus dikenali sebagai tab target');

const restored = restoreNumberedLineBreaks('1. Satu2. Dua3. Tiga');
assert(restored === '1. Satu\n2. Dua\n3. Tiga', 'Nomor baris Meta yang menempel harus dipisah');
assert(restoreNumberedLineBreaks('Ini versi2. hasil akhir.') === 'Ini versi2. hasil akhir.', 'Prosa biasa tidak boleh dipecah');
assert(normalizeQwenResponseText('123456789101112131415 6035. Akari: "Hai"6036. Yukina: "Halo"') === '6035. Akari: "Hai"\n6036. Yukina: "Halo"', 'Respons Qwen inline harus dinormalisasi');
assert(normalizeQwenResponseText('12345678910111213141516171819202122232425262728296035. Akari: "Hai"6036. Yukina: "Halo"') === '6035. Akari: "Hai"\n6036. Yukina: "Halo"', 'Prefix digit Qwen yang menempel ke marker pertama harus dibuang');
assert(normalizeQwenResponseText('plaintext12345678910111213141516171819202122232425262728\n2 \n6035. Akari: "Hai"6036. Yukina: "Halo"') === '6035. Akari: "Hai"\n6036. Yukina: "Halo"', 'Label plaintext dan nomor UI Qwen harus dibuang');
assert(!normalizeQwenResponseText('6035. Akari: "Hai"<background>konteks</background>').includes('<background>'), 'Background Qwen harus dikeluarkan dari hasil');
assert(chooseBestQwenResponse([
  '6085. Aika: "Aman"\n6086. Kako: "Tidak mau kalah"',
  '6081. Baris satu6082. Baris dua6083. Baris tiga6084. Baris empat6085. Aika: "Aman"6086. Kako: "Tidak mau kalah"',
]).startsWith('6081.'), 'Scraper Qwen harus memilih container dengan baris terlengkap');

console.log('tests ok');
