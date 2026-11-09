// Roda os cenários da demo contra um Postgres comum via psql (útil sem PGlite).
// Uso: DATABASE_URL=postgres://… node demo/check-postgres.mjs   (banco vazio e descartável)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SCENARIOS, SEED_EPILOGUE, SEED_PRELUDE, SQL_FILES, adapt, stepScript, verdict } from './scenarios.mjs';

const url = process.env.DATABASE_URL;
if (!url) { console.error('defina DATABASE_URL'); process.exit(2); }
const psql = (sql) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', url], { input: `\\set VERBOSITY verbose\n${sql}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

for (const file of SQL_FILES) psql(adapt(readFileSync(file, 'utf8')));
psql(SEED_PRELUDE + '\n' + readFileSync('supabase_seed.sql', 'utf8') + '\n' + SEED_EPILOGUE);

let failed = 0;
for (const scenario of SCENARIOS) {
  console.log(`\n${scenario.title.pt}`);
  for (const step of scenario.steps) {
    let outcome;
    try {
      const out = psql(stepScript(step)).trim().split('\n').filter(Boolean).pop();
      outcome = { ok: true, rows: JSON.parse(out) };
    } catch (error) {
      const text = String(error.stderr || error.message);
      const match = text.match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)/);
      outcome = { ok: false, code: match?.[1], message: match?.[2] ?? text.trim() };
    }
    const pass = verdict(step, outcome);
    if (!pass) failed++;
    console.log(`  ${pass ? '✓' : '✗'} ${step.title.pt} → ${outcome.ok ? JSON.stringify(outcome.rows) : `${outcome.code} ${outcome.message}`}`);
  }
}
process.exit(failed ? 1 : 0);
