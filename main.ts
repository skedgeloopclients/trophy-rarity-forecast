// Entry point for the trophy-rarity forecast. Uses only Node 22's built-ins and makes no
// network calls: each .in case is parsed, forecast, and emitted as a matching .out file.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { forecast, type Case } from './lib/model.ts';

// Allow the harness to redirect input and output; fall back to the container defaults.
const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Create the output directory if needed and walk cases in a deterministic sorted order.
mkdirSync(OUTPUT_DIR, { recursive: true });
const files = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of files) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const trophies = forecast(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}
process.stdout.write(`trophy forecast: ${files.length} case(s)\n`);
