// Lance les tests unitaires dans Node : node test/run-unit.mjs
import { runAll } from "../testkit.js";
import { SPECS } from "../specs.js";

let loadError = null;
try { await import("./core.test.js"); } catch (e) { loadError = e; }
if (loadError) { console.error("✗ Impossible de charger les tests :", loadError.message); process.exit(1); }

const results = await runAll();
const known = new Set(SPECS.map((s) => s.id));
let failed = 0;
for (const r of results) {
  if (!known.has(r.specId)) { console.log(`✗ [${r.specId}] spec inconnue — ${r.name}`); failed++; continue; }
  if (r.ok) console.log(`✓ [${r.specId}] ${r.name}`);
  else { failed++; console.log(`✗ [${r.specId}] ${r.name}\n    → ${r.error}`); }
}
console.log(`\n${results.length - failed}/${results.length} tests unitaires OK`);
process.exit(failed ? 1 : 0);
