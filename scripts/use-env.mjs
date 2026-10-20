// Switch the root .env between the local Supabase stack and the hosted project.
// Usage: node scripts/use-env.mjs <local|hosted> [path-to-env]
//
// The inactive set is kept in the same file as `# hosted: KEY=...` / `# local: KEY=...` lines, so no
// secrets are copied anywhere else. Restart `pnpm dev` afterwards: services read .env at startup.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KEYS = new Set([
  'SUPABASE_URL',
  'DOCKER_SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_JWKS_URL',
]);
const LINE = /^(?:# (?:(hosted|local): )?)?([A-Z_]+)=(.*)$/;

const target = process.argv[2];
if (target !== 'local' && target !== 'hosted') {
  console.error('Usage: node scripts/use-env.mjs <local|hosted> [path-to-env]');
  process.exit(1);
}
const file = resolve(process.argv[3] ?? new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const lines = readFileSync(file, 'utf8').split(/\r?\n/);

const parsed = lines.map((text) => {
  const m = LINE.exec(text);
  return m && KEYS.has(m[2]) ? { tag: m[1], key: m[2], value: m[3], commented: text.startsWith('#') } : null;
});

// Untagged keys are the active set; its mode is read off the active SUPABASE_URL.
const activeUrl = parsed.find((p) => p && !p.commented && p.key === 'SUPABASE_URL');
if (!activeUrl) {
  console.error('No active SUPABASE_URL line in .env.');
  process.exit(1);
}
const current = /127\.0\.0\.1|localhost/.test(activeUrl.value) ? 'local' : 'hosted';
if (current === target) {
  console.log(`.env already uses ${target} Supabase.`);
  process.exit(0);
}
// A plain `# KEY=` comment (no tag) is the inactive set, i.e. the mode we are not in.
const other = current === 'local' ? 'hosted' : 'local';
for (const p of parsed) if (p?.commented && !p.tag) p.tag = other;
if (!parsed.some((p) => p?.tag === target && p.key === 'SUPABASE_URL')) {
  console.error(`No "# ${target}: SUPABASE_URL=" line in .env to switch to.`);
  process.exit(1);
}

const out = lines.map((text, i) => {
  const p = parsed[i];
  if (!p) return text;
  if (!p.commented) return `# ${current}: ${p.key}=${p.value}`;
  if (p.tag === target) return `${p.key}=${p.value}`;
  return text;
});
writeFileSync(file, out.join('\n'));
console.log(`.env now uses ${target} Supabase. Restart \`pnpm dev\` to pick it up.`);
