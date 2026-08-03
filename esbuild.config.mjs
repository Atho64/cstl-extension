import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const dist = join(__dirname, 'dist');

function copyStatic() {
  mkdirSync(join(dist, 'popup'), { recursive: true });
  mkdirSync(join(dist, 'icons'), { recursive: true });
  mkdirSync(join(dist, 'content', 'targets'), { recursive: true });

  // manifest
  cpSync(join(__dirname, 'manifest.json'), join(dist, 'manifest.json'));
  // popup html/css
  cpSync(join(__dirname, 'src/popup/popup.html'), join(dist, 'popup/popup.html'));
  cpSync(join(__dirname, 'src/popup/popup.css'), join(dist, 'popup/popup.css'));
  // icons
  const iconsDir = join(__dirname, 'public/icons');
  if (existsSync(iconsDir)) {
    for (const name of ['icon16.png', 'icon48.png', 'icon128.png']) {
      const src = join(iconsDir, name);
      if (existsSync(src)) cpSync(src, join(dist, 'icons', name));
    }
  }
}

const entryPoints = {
  background: 'src/background.ts',
  'content/cstl-bridge': 'src/content/cstl-bridge.ts',
  'content/targets/gemini': 'src/content/targets/gemini.ts',
  'content/targets/deepseek': 'src/content/targets/deepseek.ts',
  'content/targets/meta': 'src/content/targets/meta.ts',
  'content/targets/chatgpt': 'src/content/targets/chatgpt.ts',
  'content/targets/qwen': 'src/content/targets/qwen.ts',
  'content/targets/arena': 'src/content/targets/arena.ts',
  'popup/popup': 'src/popup/popup.ts',
};

const buildOptions = {
  entryPoints,
  bundle: true,
  outdir: dist,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
  entryNames: '[dir]/[name]',
};

async function run() {
  copyStatic();
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('watching...');
  } else {
    await esbuild.build(buildOptions);
    copyStatic();
    console.log('build ok → dist/');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
