# CSTL Auto Copas Extension

Browser extension (Chrome/Edge/Quetta Android — MV3) yang bekerja bersama CSTL PWA untuk auto copy-paste terjemahan ke tab LLM.

## Cara Install

1. Build extension:
   ```
   cd cstl-extension
   npm install
   npm run build
   ```
2. Buka Chrome/Edge/Quetta → `chrome://extensions`
3. Aktifkan **Developer mode** (kanan atas)
4. Klik **Load unpacked** → pilih folder `dist/`
5. Extension "CSTL Auto Copas" muncul di daftar

> **Android (Quetta Browser):** Download Quetta dari Play Store, buka `quetta://extensions`, aktifkan Developer mode, lalu Load unpacked dari folder `dist/`.

## Cara Pakai

1. Buka CSTL (localhost dev atau atho64.github.io/cstl)
2. Status "Extension terhubung" muncul di bawah tombol Auto Translate / Auto Ekstrak / Auto Cek
3. Atur target & mode di popup extension (klik icon extension)
4. Pilih baris yang ingin diproses
5. Klik **Auto Copas**
   - Mode Semi: teks di-paste ke composer LLM, kamu kirim manual
   - Mode Full: teks di-paste + tombol send diklik otomatis, hasil diambil & diterapkan

## Mode

- **Semi** (default): paste saja, user kirim sendiri. Lebih stabil, anti bot detection.
- **Full**: paste + auto submit + ambil hasil otomatis.

## Target yang Didukung

- Google Gemini (`gemini.google.com`)
- DeepSeek Chat (`chat.deepseek.com`)
- Meta AI (`meta.ai`)
- ChatGPT (`chatgpt.com`)

## Fitur per Tab

| Tab | Semi | Full |
|---|---|---|
| **Translate** | Paste prompt → kirim manual → Ambil Hasil | Auto loop per batch → terapkan terjemahan |
| **Glossary Extractor** ⚠️ BETA | Paste prompt → kirim manual → Ambil Hasil → Simpan manual | Auto loop per batch → auto-save ke Smart Glossary |
| **AI Check** ⚠️ BETA | Paste prompt → kirim manual → Ambil Hasil | Auto loop per batch → auto-parse + apply koreksi (atau pause per batch jika Review Mode aktif) |

> ⚠️ **BETA** — Glossary Extractor Auto Copas dan AI Check Auto Copas masih dalam tahap pengujian. Hasil auto-save/auto-apply mungkin perlu dikontrol ulang secara manual.

## Troubleshooting

- **"Extension belum terpasang"**: pastikan extension sudah di-load unpacked dan page CSTL di-refresh
- **"composer_not_found"**: buka tab target LLM dulu dan pastikan sudah login
- **"empty_response"**: belum ada balasan dari LLM, tunggu selesai lalu Ambil Hasil lagi
- **Selector berubah**: kalau UI LLM update, selector mungkin perlu update di `src/shared/targets-config.ts`
- **Build error**: jalankan `npm install` dulu sebelum `npm run build`

## Dev

```
npm run watch    # auto-rebuild on change
npm run typecheck
```

Setelah rebuild, klik "Reload" di chrome://extensions.

## Privasi

- Extension hanya beroperasi di tab Gemini, DeepSeek, Meta AI, ChatGPT, dan origin CSTL
- Tidak ada data yang di-upload ke server manapun
- Semua komunikasi terjadi lokal di browser
