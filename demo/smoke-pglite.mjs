// Teste do CI: roda todos os cenários no PGlite, como a página faz.
// Uso: PGLITE=/caminho/para/@electric-sql/pglite/dist/index.js node demo/smoke-pglite.mjs
import { readFile } from 'node:fs/promises';
import { createDatabase, runStep } from './engine.mjs';
import { SCENARIOS, verdict } from './scenarios.mjs';

const { PGlite } = await import(process.env.PGLITE);
const db = await createDatabase(PGlite, (file) => readFile(file, 'utf8'));
let failed = 0;
for (const scenario of SCENARIOS) {
  console.log(scenario.title.pt);
  for (const step of scenario.steps) {
    const outcome = await runStep(db, step);
    const pass = verdict(step, outcome);
    if (!pass) failed++;
    console.log(`  ${pass ? '✓' : '✗'} ${step.title.pt} → ${outcome.ok ? JSON.stringify(outcome.rows) : `${outcome.code} ${outcome.message}`}`);
  }
}
process.exit(failed ? 1 : 0);
