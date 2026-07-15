# CSTL Auto Copas Extension

Browser extension (Chrome/Edge MV3) yang bekerja bersama CSTL PWA untuk auto copy-paste terjemahan ke tab LLM (Gemini, DeepSeek, Meta AI).

## Cara Install

1. Build extension:
   ```
   cd cstl-extension
   npm install
   npm run build
   ```
2. Buka Chrome/Edge → `chrome://extensions`
3. Aktifkan **Developer mode** (kanan atas)
4. Klik **Load unpacked** → pilih folder `dist/`
5. Extension "CSTL Auto Copas" muncul di daftar

## Cara Pakai

1. Buka CSTL (localhost dev atau atho64.github.io/cstl)
2. Status "Extension terhubung" muncul di tab Translate
3. Pilih baris yang belum diterjemahkan
4. Pilih target (Gemini / DeepSeek / Meta AI) dan mode (Semi / Full)
5. Klik **Auto Copas**
   - Mode Semi: teks di-paste ke composer LLM, kamu kirim manual
   - Mode Full: teks di-paste + tombol send diklik otomatis
6. Tunggu LLM selesai menjawab
7. Klik **Ambil Hasil** → teks balasan masuk ke paste area CSTL
8. Klik **Terapkan Terjemahan** seperti biasa

## Mode

- **Semi** (default): paste saja, user kirim sendiri. Lebih stabil, anti bot detection.
- **Full**: paste + auto submit. Lebih cepat tapi rapuh kalau UI berubah.

## Target yang Didukung

- Google Gemini (gemini.google.com)
- DeepSeek Chat (chat.deepseek.com)
- Meta AI (meta.ai)

## Troubleshooting

- **"Extension belum terpasang"**: pastikan extension sudah di-load unpacked dan page CSTL di-refresh
- **"composer_not_found"**: buka tab Gemini/DeepSeek/Meta AI dulu dan pastikan sudah login
- **"empty_response"**: belum ada balasan dari LLM, tunggu sampai selesai lalu Ambil Hasil lagi
- **Selector berubah**: kalau UI Gemini/DeepSeek/Meta AI update, selector mungkin perlu update di `src/shared/targets-config.ts`
- **Build error**: jalankan `npm install` dulu sebelum `npm run build`

## Dev

```
npm run watch    # auto-rebuild on change
npm run typecheck
```

Setelah rebuild, klik "Reload" di chrome://extensions.

## Privasi

- Extension hanya beroperasi di tab Gemini, DeepSeek, Meta AI, dan origin CSTL (localhost + atho64.github.io)
- Tidak ada data yang di-upload ke server manapun
- Semua komunikasi terjadi lokal di browser
