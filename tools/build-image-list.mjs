// Erstellt list.json für images/ (Figuren am Rand) und hindernisse/ (Gegenstände auf der Straße).
// Läuft automatisch beim Veröffentlichen (GitHub Action), lokal: node tools/build-image-list.mjs
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';

for (const dir of ['images', 'hindernisse']) {
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir)
    .filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f) && f.toLowerCase() !== 'splash.png')
    .sort((a, b) => a.localeCompare(b));
  writeFileSync(`${dir}/list.json`, JSON.stringify(files, null, 2) + '\n');
  console.log(`${dir}/list.json: ${files.length} Bild(er)`);
}
