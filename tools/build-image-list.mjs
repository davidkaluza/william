// Erstellt images/list.json mit allen Bildern aus images/ (außer splash.png).
// Läuft automatisch beim Veröffentlichen (GitHub Action), lokal: node tools/build-image-list.mjs
import { readdirSync, writeFileSync } from 'node:fs';

const files = readdirSync('images')
  .filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f) && f.toLowerCase() !== 'splash.png')
  .sort((a, b) => a.localeCompare(b));

writeFileSync('images/list.json', JSON.stringify(files, null, 2) + '\n');
console.log(`images/list.json: ${files.length} Bild(er)`);
