import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

async function copyDirIfExists(src: string, dest: string): Promise<void> {
  try {
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true, force: true });
}

async function run(): Promise<void> {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const gameSrc = path.join(rootDir, 'game');

  await fs.access(path.join(gameSrc, 'index.html'));
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(path.join(out, 'screenshots'), { recursive: true });
  await copyDirIfExists(gameSrc, path.join(out, 'game'));
  await copyDirIfExists(path.join(rootDir, 'screenshots'), path.join(out, 'screenshots'));

  const dossier = await buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  });

  const payload = typeof dossier === 'string' ? dossier : JSON.stringify(dossier, null, 2);
  await fs.writeFile(path.join(out, 'dossier.json'), payload, 'utf8');
  console.log(`Packaged Skyward Valkyrie dossier to ${out}`);
}

await run();
