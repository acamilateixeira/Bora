// Monta o banco do Bora em um PGlite (Postgres em WebAssembly) e roda passos.
import { PEOPLE, SEED_EPILOGUE, SEED_PRELUDE, SQL_FILES, adapt, stepScript } from './scenarios.mjs';

export const PGLITE_VERSION = '0.2.17';

/** readFile(path) devolve o texto do arquivo (fetch no navegador, fs no Node). */
export async function createDatabase(PGlite, readFile) {
  const db = await PGlite.create();
  for (const file of SQL_FILES) await db.exec(adapt(await readFile(file)));
  await db.exec(`${SEED_PRELUDE}\n${await readFile('supabase_seed.sql')}\n${SEED_EPILOGUE}`);
  return db;
}

export async function runStep(db, step) {
  const started = performance.now();
  try {
    const results = await db.exec(stepScript(step));
    const result = results.find((r) => r.fields?.some((f) => f.name === 'rows'));
    return { ok: true, rows: JSON.parse(result?.rows?.[0]?.rows ?? '[]'), ms: Math.round(performance.now() - started) };
  } catch (error) {
    await db.exec('rollback').catch(() => undefined);
    return { ok: false, code: error.code ?? '', message: error.message ?? String(error), ms: Math.round(performance.now() - started) };
  }
}

/** SQL livre digitado na página, como a pessoa escolhida. */
export function freeStep(as, sql) {
  if (!PEOPLE[as]) throw new Error('unknown person');
  return { as, sql: sql.trim().replace(/;\s*$/, ''), expect: 'ok' };
}
