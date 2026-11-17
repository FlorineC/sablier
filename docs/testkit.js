// Mini framework de test, sans dépendance, utilisable dans Node et dans le navigateur.
const registry = [];

export function spec(specId, name, fn) {
  registry.push({ specId, name, fn });
}

export function getRegistered() {
  return registry.slice();
}

class AssertionError extends Error {}

function show(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

export function expect(actual) {
  const fail = (msg) => { throw new AssertionError(msg); };
  return {
    toBe(exp) { if (actual !== exp) fail(`attendu ${show(exp)}, obtenu ${show(actual)}`); },
    toEqual(exp) { if (!deepEqual(actual, exp)) fail(`attendu ${show(exp)}, obtenu ${show(actual)}`); },
    toBeTruthy() { if (!actual) fail(`attendu une valeur vraie, obtenu ${show(actual)}`); },
    toBeFalsy() { if (actual) fail(`attendu une valeur fausse, obtenu ${show(actual)}`); },
    toBeNull() { if (actual !== null) fail(`attendu null, obtenu ${show(actual)}`); },
    toContain(x) { if (!actual || !actual.includes(x)) fail(`${show(actual)} ne contient pas ${show(x)}`); },
    toHaveLength(n) { if (!actual || actual.length !== n) fail(`longueur attendue ${n}, obtenue ${actual && actual.length}`); },
    not: {
      toBe(exp) { if (actual === exp) fail(`ne devait pas valoir ${show(exp)}`); },
      toEqual(exp) { if (deepEqual(actual, exp)) fail(`ne devait pas égaler ${show(exp)}`); },
    },
  };
}

export async function runAll() {
  const results = [];
  for (const t of registry) {
    try { await t.fn(); results.push({ ...t, ok: true }); }
    catch (e) { results.push({ ...t, ok: false, error: e && e.message ? e.message : String(e) }); }
  }
  return results;
}
