// Tests bout en bout (navigateur réel, Playwright) : node test/e2e.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { SPECS } from "../specs.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;
const T0 = new Date(2026, 10, 17, 9, 0, 0);

const browser = await chromium.launch();
const tests = [];
const spec = (id, name, fn) => tests.push({ id, name, fn });

// Base partagée simulée, conforme à l'API db (doc/get/set/onSnapshot).
const MOCK_DB = ({ initial }) => {
  const docs = new Map();
  if (initial) docs.set("app/state", initial);
  const listeners = new Map();
  const snap = (p) => ({ id: p.split("/").pop(), exists: docs.has(p), data: () => (docs.has(p) ? JSON.parse(JSON.stringify(docs.get(p))) : undefined), metadata: { fromCache: false, hasPendingWrites: false } });
  const emit = (p) => (listeners.get(p) || []).forEach((cb) => setTimeout(() => cb(snap(p)), 0));
  window.__dbWrites = [];
  window.__dbPush = (data) => { docs.set("app/state", data); emit("app/state"); };
  window.__dbDoc = () => docs.get("app/state");
  const db = {
    doc(p) {
      return {
        id: p.split("/").pop(), path: p,
        get: async () => snap(p),
        set: async (d) => { window.__dbWrites.push(JSON.parse(JSON.stringify(d))); docs.set(p, JSON.parse(JSON.stringify(d))); emit(p); },
        update: async () => {}, delete: async () => { docs.delete(p); emit(p); },
        onSnapshot(next) { const l = listeners.get(p) || []; l.push(next); listeners.set(p, l); setTimeout(() => next(snap(p)), 20); return () => {}; },
      };
    },
  };
  window.claude = { use: (name) => new Promise((r) => setTimeout(() => r(name === "db" ? db : null), 30)) };
};

async function open({ db, clock = true, storage } = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
  context.setDefaultTimeout(5000);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (clock) await page.clock.install({ time: T0 });
  if (db) await page.addInitScript(MOCK_DB, db);
  if (storage) await page.addInitScript((s) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("sablier.v2", s); sessionStorage.setItem("seeded", "1"); } }, storage);
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  if (clock) await page.clock.pauseAt(new Date(T0.getTime() + 1000));
  await page.waitForSelector("#app[data-ready='1']");
  if (db && clock) await page.clock.runFor(200); // laisse la base simulée répondre
  page.errors = errors;
  return page;
}
const add = async (page, text) => { await page.fill("#quickAdd", text); await page.press("#quickAdd", "Enter"); };
const card = (page, i) => page.locator("#taskList .task-card").nth(i);
const text = async (page, sel) => (await page.locator(sel).first().textContent()).trim();
// Titres de la liste ouverte : carte « Maintenant » puis file « À suivre ».
const titlesOf = (page) => page.evaluate(() => {
  const out = [];
  const hero = document.getElementById("nowCard");
  if (!hero.hidden && hero.dataset.taskId) out.push(document.getElementById("nowTitle").textContent.trim());
  document.querySelectorAll("#taskList .task-title").forEach((i) => out.push(i.value));
  return out;
});
async function menuFor(page, title) {
  if ((await text(page, "#nowTitle").catch(() => "")) === title && await page.locator("#nowCard").isVisible()) await page.click("#nowMenu");
  else {
    const n = await page.locator("#taskList .task-title").evaluateAll((els, t) => els.findIndex((e) => e.value === t), title);
    if (n < 0) throw new Error("tâche introuvable : " + title);
    await card(page, n).locator("[data-action=menu]").click();
  }
  await page.waitForSelector("#taskSheet:not([hidden])");
}
const chip = (page, name) => page.locator("#listBar .list-chip", { hasText: name });
const chipNames = (page) => page.locator("#listBar .list-chip .chip-name").allTextContents();
async function newList(page, name) {
  await page.click("#addList");
  await page.fill("#listName", name);
  await page.click("#listSave");
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg = "") { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg} attendu ${B}, obtenu ${A}`); }

// ================================================================ L — listes en parallèle
spec("L1", "créer, renommer, supprimer (et annuler) une liste", async () => {
  const p = await open();
  await newList(p, "Cuisine");
  eq(await chipNames(p), ["Ma liste", "Cuisine"]);
  eq(await chip(p, "Cuisine").getAttribute("aria-pressed"), "true");
  eq(await titlesOf(p), []);
  await p.click("#listMenu");
  await p.fill("#listName", "Cuisine du soir");
  await p.click("#listSave");
  eq(await chipNames(p), ["Ma liste", "Cuisine du soir"]);
  await p.click("#listMenu");
  await p.click("#listDelete");
  await p.click("#confirmOk");
  eq(await chipNames(p), ["Ma liste"]);
  await p.click("#toastUndo");
  eq(await chipNames(p), ["Ma liste", "Cuisine du soir"]);
  return p;
});
spec("L1", "la dernière liste ne peut pas être supprimée", async () => {
  const p = await open();
  await p.click("#listMenu");
  assert(await p.locator("#listDelete").isDisabled(), "bouton Supprimer désactivé attendu");
  return p;
});
spec("L2", "les pastilles changent de liste et montrent le minuteur", async () => {
  const p = await open();
  await add(p, "Emails 10m");
  await newList(p, "Cuisine");
  await add(p, "Cuire 5m");
  await chip(p, "Ma liste").click();
  eq(await titlesOf(p), ["Emails"]);
  await p.click("#nowToggle");
  await chip(p, "Cuisine").click();
  eq(await titlesOf(p), ["Cuire"]);
  await p.clock.runFor(30000);
  const c = chip(p, "Ma liste");
  assert(await c.evaluate((e) => e.classList.contains("running")), "pastille « en cours » attendue");
  eq((await c.locator(".chip-time").textContent()).trim(), "09:30");
  return p;
});
spec("L3", "deux listes tournent en même temps", async () => {
  const p = await open();
  await add(p, "Emails 10m");
  await p.click("#nowToggle");
  await newList(p, "Cuisine");
  await add(p, "Cuire 5m");
  await p.click("#nowToggle");
  await p.clock.runFor(60000);
  eq(await text(p, "#nowTimer"), "04:00");
  eq((await chip(p, "Ma liste").locator(".chip-time").textContent()).trim(), "09:00");
  return p;
});
spec("L4", "piloter les minuteurs des autres listes depuis la barre d'ensemble", async () => {
  const p = await open();
  await add(p, "Emails 10m"); await add(p, "Rapport 10m");
  await p.click("#nowToggle");
  await newList(p, "Cuisine");
  const row = p.locator("#others .other-row", { hasText: "Ma liste" });
  assert(await row.isVisible(), "ligne « Ma liste » visible");
  assert((await row.textContent()).includes("Emails"), "tâche en cours affichée");
  await row.locator("[data-action=toggle]").click(); // pause
  await p.clock.runFor(60000);
  eq((await row.locator(".other-timer").textContent()).trim(), "10:00");
  await row.locator("[data-action=done]").click();
  assert((await row.textContent()).includes("Rapport"), "la suivante prend la place");
  await row.locator(".other-main").click();
  eq(await chip(p, "Ma liste").getAttribute("aria-pressed"), "true");
  return p;
});
spec("L5", "déplacer une tâche vers une autre liste", async () => {
  const p = await open();
  await newList(p, "Cuisine");
  await chip(p, "Ma liste").click();
  await add(p, "Éplucher 5m"); await add(p, "Emails");
  await menuFor(p, "Éplucher");
  await p.locator("#taskSheet [data-ts=move]", { hasText: "Cuisine" }).click();
  eq(await titlesOf(p), ["Emails"]);
  await chip(p, "Cuisine").click();
  eq(await titlesOf(p), ["Éplucher"]);
  return p;
});

// ================================================================ A — tâches
spec("A1", "ajout rapide par Entrée, champ vidé, titre vide refusé", async () => {
  const p = await open();
  await add(p, "Emails");
  await add(p, "   ");
  eq(await titlesOf(p), ["Emails"]);
  eq(await p.inputValue("#quickAdd"), "");
  return p;
});
spec("A2", "durée reconnue + emoji suggéré", async () => {
  const p = await open();
  await add(p, "Emails 15m"); await add(p, "Rapport 1h30");
  eq(await titlesOf(p), ["Emails", "Rapport"]);
  eq(await text(p, "#nowEmoji"), "📧");
  assert((await text(p, "#nowMeta")).includes("15 min"), "durée 15 min dans la carte Maintenant");
  eq(await card(p, 0).locator(".task-minutes").inputValue(), "90");
  return p;
});
spec("A5", "édition en ligne dans la file + via le menu, conservée au rechargement", async () => {
  const p = await open();
  await add(p, "Premier"); await add(p, "Brouillon");
  await card(p, 0).locator(".task-title").fill("Version finale");
  await card(p, 0).locator(".task-title").press("Enter");
  await card(p, 0).locator(".task-minutes").fill("45");
  await card(p, 0).locator(".task-minutes").press("Tab");
  await menuFor(p, "Premier");
  await p.fill("#tsTitle", "Tout premier");
  await p.fill("#tsMinutes", "12");
  await p.locator("#tsEmojiGrid button", { hasText: "🎯" }).click();
  await p.click("#tsSave");
  await p.reload(); await p.waitForSelector("#app[data-ready='1']");
  eq(await titlesOf(p), ["Tout premier", "Version finale"]);
  eq(await text(p, "#nowEmoji"), "🎯");
  assert((await text(p, "#nowMeta")).includes("12 min"), "durée 12 min");
  eq(await card(p, 0).locator(".task-minutes").inputValue(), "45");
  return p;
});
spec("A6", "réordonner par glisser-déposer dans la file", async () => {
  const p = await open();
  for (const t of ["A", "B", "C", "D"]) await add(p, t);
  await card(p, 1).evaluate((e) => e.scrollIntoView({ block: "center" }));
  const handle = card(p, 0).locator(".drag-handle");
  const target = await card(p, 2).boundingBox();
  const hb = await handle.boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await p.mouse.down();
  await p.mouse.move(hb.x + 5, target.y + target.height - 4, { steps: 8 });
  await p.mouse.up();
  eq(await titlesOf(p), ["A", "C", "D", "B"]);
  return p;
});
spec("A6", "monter / descendre via le menu", async () => {
  const p = await open();
  for (const t of ["A", "B", "C"]) await add(p, t);
  await menuFor(p, "C");
  await p.click("#taskSheet [data-ts=up]");
  eq(await titlesOf(p), ["A", "C", "B"]);
  await menuFor(p, "A");
  await p.click("#taskSheet [data-ts=down]");
  eq(await titlesOf(p), ["C", "A", "B"]);
  return p;
});
spec("A7", "dupliquer", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  await menuFor(p, "A");
  await p.click("#taskSheet [data-ts=dup]");
  eq(await titlesOf(p), ["A", "A", "B"]);
  return p;
});
spec("A8", "supprimer puis annuler", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  await menuFor(p, "A");
  await p.click("#taskSheet [data-ts=delete]");
  eq(await titlesOf(p), ["B"]);
  await p.click("#toastUndo");
  eq(await titlesOf(p), ["A", "B"]);
  return p;
});
spec("A9", "cartes épurées : actions secondaires dans le menu ⋯", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  for (const a of ["top", "bottom", "later", "play", "menu"]) assert(await card(p, 0).locator(`[data-action=${a}]`).isVisible(), `bouton ${a} absent de la carte`);
  assert(await p.locator("#nowLater").isVisible(), "bouton Plus tard sur la carte Maintenant");
  await menuFor(p, "B");
  for (const a of ["up", "down", "dup", "later", "complete", "delete"]) assert(await p.locator(`#taskSheet [data-ts=${a}]`).count() === 1, `action ${a} absente`);
  await p.keyboard.press("Escape");
  assert(await p.locator("#taskSheet").isHidden(), "Échap ferme le menu");
  return p;
});

// ================================================================ U — hiérarchie
spec("U1", "carte « Maintenant » : prochaine tâche, puis tâche en cours", async () => {
  const p = await open();
  assert(await p.locator("#nowCard").isHidden(), "pas de carte sur liste vide");
  await add(p, "Emails 10m"); await add(p, "Rapport");
  eq(await text(p, "#nowLabel"), "Prochaine");
  assert((await text(p, "#nowToggle")).includes("Démarrer"), "bouton Démarrer");
  await p.click("#nowToggle");
  await p.clock.runFor(5000);
  eq(await text(p, "#nowLabel"), "En cours");
  eq(await text(p, "#nowTimer"), "09:55");
  await p.click("#nowToggle");
  eq(await text(p, "#nowLabel"), "En pause");
  return p;
});
spec("U2", "file « À suivre » numérotée", async () => {
  const p = await open();
  for (const t of ["A", "B", "C"]) await add(p, t);
  eq(await p.locator("#taskList .task-num").allTextContents(), ["2", "3"]);
  assert(await p.locator("#queueTitle").isVisible(), "titre « À suivre »");
  return p;
});
spec("U3", "récapitulatif compact avec barre de progression", async () => {
  const p = await open();
  await add(p, "A 10m"); await add(p, "B 10m");
  await p.click("#nowToggle");
  await p.clock.runFor(300000);
  const w = await p.locator("#listProgress .bar").evaluate((e) => parseFloat(e.style.width));
  assert(w > 24 && w < 26, `progression ~25 % attendue, obtenu ${w}`);
  return p;
});

// ================================================================ B — récap
spec("B1", "nombre de tâches et temps restant", async () => {
  const p = await open();
  await add(p, "A 15m"); await add(p, "B 1h30");
  const t = await text(p, "#listSummary");
  assert(t.includes("2 tâches") && t.includes("1 h 45"), `récap : ${t}`);
  return p;
});
spec("B2", "heure de fin estimée", async () => {
  const p = await open();
  await add(p, "A 1h30");
  assert((await text(p, "#listSummary")).includes("10:30"), "fin 10:30");
  return p;
});

// ================================================================ C — minuteur
spec("C1", "▶ sur une tâche de la file la passe en tête et la démarre", async () => {
  const p = await open();
  await add(p, "A 10m"); await add(p, "B 10m"); await add(p, "C 10m");
  await p.click("#nowToggle");
  await p.clock.runFor(30000);
  await card(p, 1).locator("[data-action=play]").click();
  eq(await titlesOf(p), ["C", "A", "B"]);
  await p.clock.runFor(10000);
  eq(await text(p, "#nowTimer"), "09:50");
  eq((await card(p, 0).locator(".task-timer").textContent()).trim(), "09:30");
  return p;
});
spec("C2", "pause / reprise, et survit au rechargement", async () => {
  const p = await open();
  await add(p, "A 10m");
  await p.click("#nowToggle");
  await p.clock.runFor(61000);
  eq(await text(p, "#nowTimer"), "08:59");
  await p.click("#nowToggle");
  await p.clock.runFor(120000);
  eq(await text(p, "#nowTimer"), "08:59");
  await p.click("#nowToggle");
  await p.clock.runFor(9000);
  await p.reload(); await p.waitForSelector("#app[data-ready='1']");
  await p.clock.runFor(1000);
  const t = await text(p, "#nowTimer");
  assert(["08:50", "08:49"].includes(t), `après rechargement : ${t}`);
  return p;
});
spec("C3", "+1 / +5 / −5 en mode focus", async () => {
  const p = await open();
  await add(p, "A 10m");
  await p.click("#nowToggle");
  await p.click("#nowFocus");
  await p.click("#focusPlus5"); eq(await text(p, "#focusTimer"), "15:00");
  await p.click("#focusPlus1"); eq(await text(p, "#focusTimer"), "16:00");
  await p.click("#focusMinus5"); eq(await text(p, "#focusTimer"), "11:00");
  return p;
});
spec("C4", "fin du temps : signal unique nommant la liste, puis dépassement", async () => {
  const p = await open();
  await p.click("#listMenu"); await p.fill("#listName", "Boulot"); await p.click("#listSave");
  await add(p, "Emails 1m");
  await p.click("#nowToggle");
  await p.clock.runFor(62000);
  eq(await text(p, "#nowTimer"), "+00:02");
  const toast = await text(p, "#toastMsg");
  assert(toast.includes("Boulot") && toast.includes("Emails"), `bandeau : ${toast}`);
  await p.clock.runFor(5000);
  eq(await p.evaluate(() => window.__sablierChimes), 1, "nombre de signaux");
  await p.click("#nowFocus");
  assert((await text(p, "#focusState")).includes("Temps écoulé"), "état « Temps écoulé »");
  await p.click("#focusPlus1");
  eq(await text(p, "#focusTimer"), "00:53");
  return p;
});
spec("C5", "terminer : la suivante démarre, l'historique garde le temps réel", async () => {
  const p = await open();
  await add(p, "A 10m"); await add(p, "B 10m");
  await p.click("#nowToggle");
  await p.clock.runFor(120000);
  await p.click("#nowDone");
  eq(await titlesOf(p), ["B"]);
  await p.clock.runFor(5000);
  eq(await text(p, "#nowTimer"), "09:55");
  await p.click("nav.tabbar [data-tab=done]");
  assert((await text(p, ".done-row")).includes("2 min"), "temps réel 2 min");
  return p;
});
spec("C6", "passer", async () => {
  const p = await open();
  for (const t of ["A", "B", "C"]) await add(p, t);
  await p.click("#nowToggle");
  await p.click("#nowFocus");
  await p.click("#focusSkip");
  eq(await text(p, "#focusTitle"), "B");
  await p.click("#focusBack");
  eq(await titlesOf(p), ["B", "C", "A"]);
  return p;
});
spec("C7", "mode focus : liste, titre, anneau, « Ensuite »", async () => {
  const p = await open();
  await add(p, "Emails 10m"); await add(p, "Rapport");
  await p.click("#nowToggle");
  await p.click("#nowFocus");
  eq(await text(p, "#focusList"), "Ma liste");
  eq(await text(p, "#focusTitle"), "Emails");
  assert((await text(p, "#focusNext")).includes("Rapport"), "Ensuite : Rapport");
  await p.clock.runFor(300000);
  const off = await p.locator("#ringProgress").evaluate((e) => parseFloat(e.style.strokeDashoffset));
  assert(off > 300 && off < 320, `anneau à moitié, offset ${off}`);
  return p;
});
spec("C8", "titre de l'onglet avec deux listes", async () => {
  const p = await open();
  await add(p, "Emails 10m");
  eq(await p.title(), "Sablier");
  await p.click("#nowToggle");
  await newList(p, "Cuisine");
  await add(p, "Cuire 5m");
  await p.click("#nowToggle");
  await p.clock.runFor(30000);
  const title = await p.title();
  assert(["04:30 · Cuire (+1)", "04:31 · Cuire (+1)"].includes(title), `titre : ${title}`); // ±1 s selon le tic du minuteur
  return p;
});

// ================================================================ D / E
spec("D1", "« Plus tard » en un clic (file et carte Maintenant), annulable", async () => {
  const p = await open();
  for (const t of ["A", "B", "C"]) await add(p, t);
  await card(p, 0).locator("[data-action=later]").click();
  eq(await titlesOf(p), ["A", "C"]);
  await p.click("#nowToggle");
  await p.click("#nowLater");
  eq(await titlesOf(p), ["C"]);
  await p.click("#toastUndo");
  eq(await titlesOf(p), ["A", "C"]);
  await p.click("nav.tabbar [data-tab=later]");
  eq(await p.locator(".later-row .row-title").allTextContents(), ["B"]);
  return p;
});
spec("D1", "« Plus tard » via le menu", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  await menuFor(p, "A");
  await p.click("#taskSheet [data-ts=later]");
  eq(await titlesOf(p), ["B"]);
  await p.click("nav.tabbar [data-tab=later]");
  eq(await p.locator(".later-row .row-title").allTextContents(), ["A"]);
  return p;
});
spec("D2", "réactiver dans la liste ouverte, supprimer", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  await menuFor(p, "A"); await p.click("#taskSheet [data-ts=later]");
  await menuFor(p, "B"); await p.click("#taskSheet [data-ts=later]");
  await newList(p, "Autre");
  await p.click("nav.tabbar [data-tab=later]");
  await p.locator(".later-row").nth(0).locator("[data-action=reactivate]").click();
  await p.locator(".later-row").nth(0).locator("[data-action=delete-later]").click();
  assert(await p.locator(".later-row").count() === 0, "Plus tard vide");
  await p.click("nav.tabbar [data-tab=list]");
  eq(await titlesOf(p), ["A"]);
  return p;
});
spec("E1", "historique : liste d'origine, estimé vs réel, total", async () => {
  const p = await open();
  await add(p, "A 10m"); await add(p, "B 5m");
  await p.click("#nowToggle");
  await p.clock.runFor(180000);
  await p.click("#nowDone");
  await p.clock.runFor(60000);
  await p.click("#nowDone");
  await p.click("nav.tabbar [data-tab=done]");
  eq(await p.locator(".done-row .row-title").allTextContents(), ["B", "A"]);
  assert((await text(p, ".done-row .row-sub")).includes("Ma liste"), "liste d'origine");
  assert((await text(p, "#doneStats")).includes("4 min"), "total 4 min");
  return p;
});
spec("E2", "rouvrir et vider (avec confirmation)", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  await menuFor(p, "A"); await p.click("#taskSheet [data-ts=complete]");
  await menuFor(p, "B"); await p.click("#taskSheet [data-ts=complete]");
  await p.click("nav.tabbar [data-tab=done]");
  await p.locator(".done-row").nth(0).locator("[data-action=reopen]").click();
  await p.click("#clearDone");
  await p.click("#confirmOk");
  assert(await p.locator(".done-row").count() === 0, "historique vide");
  await p.click("nav.tabbar [data-tab=list]");
  eq(await titlesOf(p), ["B"]);
  return p;
});
spec("E3", "célébration quand une liste est terminée", async () => {
  const p = await open();
  await add(p, "A");
  assert(await p.locator("#celebrate").isHidden(), "pas de célébration au départ");
  await p.click("#nowDone");
  assert(await p.locator("#celebrate").isVisible(), "célébration visible");
  return p;
});

// ================================================================ F — routines
async function createRoutineUI(p, name, steps) {
  await p.click("nav.tabbar [data-tab=routines]");
  await p.click("#newRoutineBtn");
  await p.fill("#reName", name);
  for (const s of steps) { await p.fill("#reAdd", s); await p.press("#reAdd", "Enter"); }
  await p.click("#reSave");
}
spec("F1", "créer une routine de zéro dans l'onglet Routines", async () => {
  const p = await open();
  await p.click("nav.tabbar [data-tab=routines]");
  await p.click("#newRoutineBtn");
  await p.click("#reSave");
  assert(await p.locator("#reError").isVisible(), "erreur si vide");
  await p.fill("#reName", "Matin");
  for (const s of ["Café 10m", "Emails 20m", "Bloc concentration 45"]) { await p.fill("#reAdd", s); await p.press("#reAdd", "Enter"); }
  eq(await p.locator("#reItems .re-title").evaluateAll((els) => els.map((e) => e.value)), ["Café", "Emails", "Bloc concentration"]);
  assert((await text(p, "#reTotal")).includes("1 h 15"), "total 1 h 15");
  await p.click("#reSave");
  eq(await p.locator(".routine-row .row-title").allTextContents(), ["Matin"]);
  assert((await text(p, ".routine-row .row-sub")).includes("3 étapes"), "3 étapes");
  return p;
});
spec("F2", "modifier une routine : renommer, réordonner, retirer ; Annuler abandonne", async () => {
  const p = await open();
  await createRoutineUI(p, "Matin", ["A 5m", "B 5m", "C 5m"]);
  await p.locator(".routine-row [data-action=edit]").click();
  await p.fill("#reName", "Matin v2");
  await p.locator("#reItems .re-item").nth(2).locator("[data-action=up]").click();
  await p.locator("#reItems .re-item").nth(0).locator("[data-action=remove]").click();
  await p.locator("#reItems .re-item").nth(0).locator(".re-min").fill("12");
  eq(await p.locator("#reItems .re-title").evaluateAll((els) => els.map((e) => e.value)), ["C", "B"]);
  await p.click("#reSave");
  eq(await p.locator(".routine-row .row-title").allTextContents(), ["Matin v2"]);
  assert((await text(p, ".routine-row .row-sub")).includes("17 min"), "durée 17 min");
  await p.locator(".routine-row [data-action=edit]").click();
  await p.fill("#reName", "Jamais enregistré");
  await p.click("#reCancel");
  eq(await p.locator(".routine-row .row-title").allTextContents(), ["Matin v2"]);
  return p;
});
spec("F3", "lancer : nouvelle liste démarrée, en parallèle de l'existante", async () => {
  const p = await open();
  await add(p, "Emails 30m");
  await p.click("#nowToggle");
  await createRoutineUI(p, "Cuisine", ["Éplucher 5m", "Cuire 20m"]);
  await p.locator(".routine-row [data-action=launch]").click();
  eq(await chipNames(p), ["Ma liste", "Cuisine"]);
  eq(await chip(p, "Cuisine").getAttribute("aria-pressed"), "true");
  eq(await titlesOf(p), ["Éplucher", "Cuire"]);
  await p.clock.runFor(60000);
  eq(await text(p, "#nowTimer"), "04:00");
  eq((await chip(p, "Ma liste").locator(".chip-time").textContent()).trim(), "29:00");
  return p;
});
spec("F4", "charger dans la liste ouverte : ajouter, remplacer (confirmation)", async () => {
  const p = await open();
  await add(p, "Existant");
  await createRoutineUI(p, "R", ["X", "Y"]);
  await p.locator(".routine-row [data-action=more]").click();
  await p.click("#routineMenu [data-rm=append]");
  eq(await titlesOf(p), ["Existant", "X", "Y"]);
  await p.click("nav.tabbar [data-tab=routines]");
  await p.locator(".routine-row [data-action=more]").click();
  await p.click("#routineMenu [data-rm=replace]");
  assert(await p.locator("#confirmSheet").isVisible(), "confirmation intégrée");
  await p.click("#confirmOk");
  eq(await titlesOf(p), ["X", "Y"]);
  return p;
});
spec("F5", "enregistrer la liste ouverte comme routine", async () => {
  const p = await open();
  await add(p, "Café 10m"); await add(p, "Emails 20m");
  await p.click("#listMenu");
  await p.click("#listToRoutine");
  await p.click("nav.tabbar [data-tab=routines]");
  eq(await p.locator(".routine-row .row-title").allTextContents(), ["Ma liste"]);
  assert((await text(p, ".routine-row .row-sub")).includes("30 min"), "30 min");
  return p;
});
spec("F6", "supprimer une routine (confirmation + annuler)", async () => {
  const p = await open();
  await createRoutineUI(p, "R", ["A"]);
  await p.locator(".routine-row [data-action=more]").click();
  await p.click("#routineMenu [data-rm=delete]");
  await p.click("#confirmOk");
  assert(await p.locator(".routine-row").count() === 0, "aucune routine");
  await p.click("#toastUndo");
  eq(await p.locator(".routine-row .row-title").allTextContents(), ["R"]);
  return p;
});

// ================================================================ G — persistance
spec("G1", "rechargement : listes, liste ouverte, plus tard, réglages", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  await menuFor(p, "B"); await p.click("#taskSheet [data-ts=later]");
  await newList(p, "Cuisine");
  await add(p, "Cuire");
  await p.click("nav.tabbar [data-tab=settings]");
  await p.locator("#setSound").uncheck();
  await p.reload(); await p.waitForSelector("#app[data-ready='1']");
  eq(await chipNames(p), ["Ma liste", "Cuisine"]);
  eq(await chip(p, "Cuisine").getAttribute("aria-pressed"), "true");
  await p.click("nav.tabbar [data-tab=list]");
  eq(await titlesOf(p), ["Cuire"]);
  await p.click("nav.tabbar [data-tab=settings]");
  assert(!(await p.locator("#setSound").isChecked()), "son désactivé conservé");
  await p.click("nav.tabbar [data-tab=later]");
  eq(await p.locator(".later-row .row-title").allTextContents(), ["B"]);
  return p;
});
spec("G2", "base partagée chargée au démarrage, jamais écrasée, puis alimentée", async () => {
  const saved = { version: 3, lists: [{ id: "l1", name: "Boulot", tasks: [{ id: "t1", emoji: "📝", title: "Depuis la base", minutes: 20 }] }], currentListId: "l1", updatedAtMs: 1000, writer: "autre" };
  const p = await open({ db: { initial: saved } });
  await p.waitForFunction(() => document.getElementById("nowTitle").textContent.includes("Depuis la base"));
  eq(await chipNames(p), ["Boulot"]);
  eq(await p.evaluate(() => window.__dbWrites.length), 0, "aucune écriture au démarrage");
  await add(p, "Nouvelle");
  await p.clock.runFor(2000);
  const doc = await p.evaluate(() => window.__dbDoc());
  eq(doc.lists[0].tasks.map((t) => t.title), ["Depuis la base", "Nouvelle"]);
  return p;
});
spec("G2", "base vide : l'état local y est écrit", async () => {
  const p = await open({ db: { initial: null } });
  await add(p, "Locale");
  await p.clock.runFor(2000);
  const doc = await p.evaluate(() => window.__dbDoc());
  eq(doc.lists[0].tasks.map((t) => t.title), ["Locale"]);
  return p;
});
spec("G3", "distant plus récent appliqué, plus ancien ignoré", async () => {
  const p = await open({ db: { initial: null } });
  await add(p, "Locale");
  await p.clock.runFor(2000);
  const mk = (title, ts) => ({ version: 3, lists: [{ id: "main", name: "Ma liste", tasks: [{ id: "x" + ts, title, minutes: 5 }] }], updatedAtMs: ts, writer: "autre" });
  await p.evaluate((d) => window.__dbPush(d), mk("Ancien", 1));
  await p.clock.runFor(100);
  eq(await titlesOf(p), ["Locale"]);
  await p.evaluate((d) => window.__dbPush({ ...d, updatedAtMs: Date.now() + 5000 }), mk("Distant", 2));
  await p.clock.runFor(100);
  eq(await titlesOf(p), ["Distant"]);
  return p;
});
spec("G4", "données v2 de la base affichées dans « Ma liste »", async () => {
  const v2 = { version: 2, tasks: [{ id: "a", emoji: "📝", title: "Préparer le point", minutes: 20 }], active: null, later: [], done: [], routines: [{ id: "r", name: "Routine du matin", items: [{ title: "Café", emoji: "☕", minutes: 10 }] }], settings: {}, updatedAtMs: 1794904738218 };
  const p = await open({ db: { initial: v2 } });
  await p.waitForFunction(() => document.getElementById("nowTitle").textContent.includes("Préparer"));
  eq(await chipNames(p), ["Ma liste"]);
  await p.click("nav.tabbar [data-tab=routines]");
  eq(await p.locator(".routine-row .row-title").allTextContents(), ["Routine du matin"]);
  return p;
});

// ================================================================ H / I
spec("H1", "réglages : enchaînement, durée par défaut, thème", async () => {
  const p = await open();
  await p.click("nav.tabbar [data-tab=settings]");
  await p.locator("#setAuto").uncheck();
  await p.fill("#setDefault", "40");
  await p.locator("#setDefault").press("Tab");
  await p.selectOption("#setTheme", "dark");
  eq(await p.evaluate(() => document.documentElement.dataset.theme), "dark");
  await p.click("nav.tabbar [data-tab=list]");
  await add(p, "A"); await add(p, "B");
  eq(await card(p, 0).locator(".task-minutes").inputValue(), "40");
  await p.click("#nowToggle");
  await p.click("#nowDone");
  await p.clock.runFor(5000);
  eq(await text(p, "#nowTimer"), "40:00", "la suivante reste en pause");
  return p;
});
spec("I1", "raccourcis N, Espace, Échap, [ ]", async () => {
  const p = await open();
  await add(p, "A 10m");
  await p.locator("#quickAdd").blur();
  await p.keyboard.press("n");
  eq(await p.evaluate(() => document.activeElement.id), "quickAdd");
  await p.locator("#quickAdd").blur();
  await p.keyboard.press("Space");
  await p.clock.runFor(10000);
  eq(await text(p, "#nowTimer"), "09:50");
  await p.click("#nowFocus");
  await p.keyboard.press("Space");
  await p.clock.runFor(10000);
  eq(await text(p, "#focusTimer"), "09:50");
  await p.keyboard.press("Escape");
  assert(await p.locator("#viewFocus").isHidden(), "Échap quitte le focus");
  await newList(p, "Deux");
  await p.locator("#quickAdd").blur();
  await p.keyboard.press("[");
  eq(await chip(p, "Ma liste").getAttribute("aria-pressed"), "true");
  await p.keyboard.press("]");
  eq(await chip(p, "Deux").getAttribute("aria-pressed"), "true");
  return p;
});

// ================================================================ v4
spec("C3", "changer le temps sur la carte « Maintenant » (boutons et saisie)", async () => {
  const p = await open();
  await add(p, "A 10m");
  await p.click("#nowPlus5"); eq(await text(p, "#nowTimer"), "15:00");
  await p.click("#nowMinus5"); eq(await text(p, "#nowTimer"), "10:00");
  await p.click("#nowPlus1"); eq(await text(p, "#nowTimer"), "11:00");
  await p.click("#nowToggle");
  await p.clock.runFor(60000);
  await p.click("#nowToggle");
  await p.click("#nowPlus5"); eq(await text(p, "#nowTimer"), "15:00");
  await p.click("#nowMinus5"); eq(await text(p, "#nowTimer"), "10:00");
  await p.fill("#quickAdd", "B 10m"); await p.press("#quickAdd", "Enter");
  await p.click("#nowToggle");
  await p.clock.runFor(60000);
  await p.click("#nowPlus5");
  eq(await text(p, "#nowTimer"), "14:00");
  return p;
});
spec("C3", "toucher le minuteur et taper le temps restant (carte et focus)", async () => {
  const p = await open();
  await add(p, "A 20m");
  await p.click("#nowTimer");
  assert(await p.locator("#nowTimerInput").isVisible(), "champ de saisie visible");
  eq(await p.evaluate(() => document.activeElement.id), "nowTimerInput");
  eq(await p.inputValue("#nowTimerInput"), "20:00");
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.type("35");
  await p.keyboard.press("Enter");
  eq(await text(p, "#nowTimer"), "35:00");
  await p.click("#nowToggle");
  await p.clock.runFor(61000);
  await p.click("#nowTimer");
  eq(await p.inputValue("#nowTimerInput"), "33:59");
  await p.fill("#nowTimerInput", "10");
  await p.press("#nowTimerInput", "Enter");
  eq(await text(p, "#nowTimer"), "10:00");
  await p.clock.runFor(5000);
  eq(await text(p, "#nowTimer"), "09:55");
  await p.click("#nowTimer");
  await p.fill("#nowTimerInput", "99");
  await p.press("#nowTimerInput", "Escape");
  eq(await text(p, "#nowTimer"), "09:55", "Échap annule");
  await p.click("#nowFocus");
  await p.click("#focusTimer");
  await p.fill("#focusTimerInput", "5");
  await p.press("#focusTimerInput", "Enter");
  eq(await text(p, "#focusTimer"), "05:00");
  return p;
});
async function dragTo(p, handle, target, dy = 0) {
  await handle.scrollIntoViewIfNeeded();
  const box0 = typeof target.boundingBox === "function" ? await target.boundingBox() : target;
  const box = { ...box0, y: Math.max(box0.y, 10), height: Math.min(box0.y + box0.height, 2000) - Math.max(box0.y, 10) };
  const hb = await handle.boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await p.mouse.down();
  await p.mouse.move(hb.x + 5, box.y + box.height / 2 + dy, { steps: 10 });
  await p.mouse.up();
}
spec("A10", "glisser une tâche de la file sur « Maintenant » quand la liste tourne", async () => {
  const p = await open();
  for (const t of ["A 10m", "B 10m", "C 10m"]) await add(p, t);
  await p.click("#nowToggle");
  await p.clock.runFor(30000);
  await dragTo(p, card(p, 1).locator(".drag-handle"), p.locator("#nowCard"));
  eq(await titlesOf(p), ["C", "A", "B"]);
  await p.clock.runFor(10000);
  eq(await text(p, "#nowLabel"), "En cours");
  eq(await text(p, "#nowTimer"), "09:50");
  eq((await card(p, 0).locator(".task-timer").textContent()).trim(), "09:30");
  return p;
});
spec("A10", "glisser sur « Maintenant » sans minuteur : devient la prochaine", async () => {
  const p = await open();
  for (const t of ["A", "B", "C"]) await add(p, t);
  await dragTo(p, card(p, 0).locator(".drag-handle"), p.locator("#nowCard"));
  eq(await titlesOf(p), ["B", "A", "C"]);
  eq(await text(p, "#nowLabel"), "Prochaine");
  return p;
});
spec("A11", "tout en haut / tout en bas en un clic sur la carte", async () => {
  const p = await open();
  for (const t of ["A", "B", "C", "D"]) await add(p, t);
  await p.click("#nowToggle");
  await card(p, 2).locator("[data-action=top]").click();
  eq(await titlesOf(p), ["A", "D", "B", "C"]);
  assert(await card(p, 0).locator("[data-action=top]").isDisabled(), "déjà tout en haut");
  await card(p, 0).locator("[data-action=bottom]").click();
  eq(await titlesOf(p), ["A", "B", "C", "D"]);
  assert(await card(p, 2).locator("[data-action=bottom]").isDisabled(), "déjà tout en bas");
  return p;
});
spec("A11", "tout en haut / tout en bas depuis le menu", async () => {
  const p = await open();
  for (const t of ["A", "B", "C", "D"]) await add(p, t);
  await p.click("#nowToggle");
  await menuFor(p, "D");
  await p.click("#taskSheet [data-ts=top]");
  eq(await titlesOf(p), ["A", "D", "B", "C"]);
  await menuFor(p, "D");
  await p.click("#taskSheet [data-ts=bottom]");
  eq(await titlesOf(p), ["A", "B", "C", "D"]);
  await menuFor(p, "A");
  assert(await p.locator("#taskSheet [data-ts=top]").isDisabled(), "tâche en cours : « Tout en haut » désactivé");
  return p;
});
spec("U4", "heure estimée sur chaque tâche", async () => {
  const p = await open();
  await add(p, "A 10m"); await add(p, "B 30m"); await add(p, "C 5m");
  assert((await text(p, "#nowEta")).includes("09:10"), "fin estimée de la tâche courante");
  eq((await card(p, 0).locator(".task-eta").textContent()).trim(), "09:10 → 09:40");
  eq((await card(p, 1).locator(".task-eta").textContent()).trim(), "09:40 → 09:45");
  await p.click("#nowToggle");
  await p.clock.runFor(120000);
  await p.click("#nowToggle"); // pause : le créneau glisse avec le temps
  await p.clock.runFor(180000);
  eq((await card(p, 0).locator(".task-eta").textContent()).trim(), "09:13 → 09:43");
  return p;
});
spec("L6", "flèches pour parcourir beaucoup de listes", async () => {
  const p = await open();
  assert(await p.locator("#listNext").isHidden(), "pas de flèche avec une seule liste");
  for (let i = 1; i <= 6; i++) await newList(p, `Liste longue numéro ${i}`);
  await chip(p, "Ma liste").click();
  assert(await p.locator("#listNext").isVisible(), "flèche › visible");
  assert(await p.locator("#listPrev").isHidden(), "flèche ‹ masquée au début");
  await p.click("#listNext");
  await p.waitForFunction(() => document.getElementById("listBar").scrollLeft > 0);
  assert(await p.locator("#listPrev").isVisible(), "flèche ‹ visible après défilement");
  for (let i = 0; i < 10; i++) if (await p.locator("#listNext").isVisible()) await p.click("#listNext");
  assert(await p.locator("#listNext").isHidden(), "flèche › masquée à la fin");
  return p;
});
spec("E4", "afficher les terminées en bas de la liste et les remettre", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  assert(await p.locator("#doneToggle").isHidden(), "pas d'interrupteur sans terminées");
  await p.click("#nowDone");
  eq(await titlesOf(p), ["B"]);
  assert((await text(p, "#doneToggle")).includes("Terminées (1)"), "compteur");
  assert(await p.locator(".list-done-row").count() === 0 || await p.locator(".list-done-row").first().isHidden(), "masquées par défaut");
  await p.click("#doneToggle");
  eq(await p.locator(".list-done-row .row-title").allTextContents(), ["A"]);
  await p.reload(); await p.waitForSelector("#app[data-ready='1']");
  eq(await p.locator(".list-done-row .row-title").allTextContents(), ["A"], "choix mémorisé");
  await p.locator(".list-done-row [data-action=restore]").click();
  eq(await titlesOf(p), ["B", "A"]);
  assert(await p.locator("#doneToggle").isHidden(), "plus de terminées dans cette liste");
  return p;
});

spec("A12", "ajouter une tâche en haut (bouton ⤒ ou Maj+Entrée)", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  await p.fill("#quickAdd", "Urgent 5m");
  await p.click("#quickAddTop");
  eq(await titlesOf(p), ["Urgent", "A", "B"]);
  eq(await p.inputValue("#quickAdd"), "");
  await p.click("#nowToggle");
  await p.fill("#quickAdd", "Encore plus urgent");
  await p.press("#quickAdd", "Shift+Enter");
  eq(await titlesOf(p), ["Urgent", "Encore plus urgent", "A", "B"]);
  await add(p, "Normal");
  eq((await titlesOf(p)).at(-1), "Normal");
  return p;
});

// ================================================================ v6
spec("U4", "créneau posé sur le bord de la carte, en gras", async () => {
  const p = await open();
  await add(p, "A 10m"); await add(p, "B 30m");
  const st = await card(p, 0).locator(".task-eta").evaluate((e) => {
    const cs = getComputedStyle(e), card = e.closest(".task-card").getBoundingClientRect(), r = e.getBoundingClientRect();
    return { pos: cs.position, weight: +cs.fontWeight, straddles: r.top < card.top && r.bottom > card.top,
      centered: Math.abs((r.left + r.right) / 2 - (card.left + card.right) / 2) < 3 };
  });
  assert(st.pos === "absolute" && st.weight >= 700 && st.straddles && st.centered, `étiquette centrée sur le bord attendue : ${JSON.stringify(st)}`);
  const hero = await p.locator("#nowEta").evaluate((e) => { const c = e.closest(".now-card").getBoundingClientRect(), r = e.getBoundingClientRect();
    return r.top < c.top && r.bottom > c.top && Math.abs((r.left + r.right) / 2 - (c.left + c.right) / 2) < 3; });
  assert(hero, "fin de la tâche courante centrée sur le bord de la carte");
  return p;
});
spec("U3", "temps restant de la liste en grand", async () => {
  const p = await open();
  await add(p, "A 15m"); await add(p, "B 1h30");
  eq(await text(p, "#listRemaining"), "1 h 45");
  eq(await text(p, "#listFinish"), "10:45");
  const size = await p.locator("#listRemaining").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  assert(size >= 20, `chiffre bien visible attendu (${size}px)`);
  return p;
});
spec("A9", "terminer et supprimer en un clic sur la carte (supprimer annulable)", async () => {
  const p = await open();
  for (const t of ["A", "B", "C"]) await add(p, t);
  await card(p, 0).locator("[data-action=delete]").click();
  eq(await titlesOf(p), ["A", "C"]);
  await p.click("#toastUndo");
  eq(await titlesOf(p), ["A", "B", "C"]);
  await card(p, 1).locator("[data-action=complete]").click();
  eq(await titlesOf(p), ["A", "B"]);
  await p.click("nav.tabbar [data-tab=done]");
  eq(await p.locator(".done-row .row-title").allTextContents(), ["C"]);
  return p;
});
spec("C10", "styles d'horloge : anneau, camembert, chiffres", async () => {
  const p = await open();
  await add(p, "A 10m");
  await p.click("#nowToggle");
  assert(await p.locator("#nowClock").isVisible(), "mini-horloge sur la carte");
  await p.click("nav.tabbar [data-tab=settings]");
  await p.selectOption("#setClock", "pie");
  await p.click("nav.tabbar [data-tab=list]");
  await p.click("#nowFocus");
  await p.clock.runFor(300000);
  assert(await p.locator("#focusPie").isVisible(), "camembert visible");
  assert(await p.locator("#focusRingSvg").isHidden(), "anneau masqué");
  const d = await p.locator("#pieWedge").getAttribute("d");
  assert(d && d.includes(" A"), `part de camembert tracée : ${d}`);
  await p.click("#focusBack");
  await p.click("nav.tabbar [data-tab=settings]");
  await p.selectOption("#setClock", "digital");
  await p.click("nav.tabbar [data-tab=list]");
  assert(await p.locator("#nowClock").isHidden(), "pas de mini-horloge en mode chiffres");
  await p.click("#nowFocus");
  assert(await p.locator("#focusPie").isHidden() && await p.locator("#focusRingSvg").isHidden(), "chiffres seuls");
  eq(await text(p, "#focusTimer"), "05:00");
  return p;
});
spec("H2", "changer la couleur d'accentuation (mémorisée)", async () => {
  const p = await open();
  const accent = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase());
  const before = await accent();
  await p.click("nav.tabbar [data-tab=settings]");
  await p.locator("#setAccent [data-accent=blue]").click();
  const blue = await accent();
  assert(blue !== before && blue.length > 0, `couleur changée (${before} → ${blue})`);
  await p.reload(); await p.waitForSelector("#app[data-ready='1']");
  eq(await accent(), blue);
  eq(await p.locator("#setAccent [aria-pressed=true]").getAttribute("data-accent"), "blue");
  return p;
});
spec("C11", "passage automatique à la tâche suivante à la fin du temps", async () => {
  const p = await open();
  await p.click("nav.tabbar [data-tab=settings]");
  await p.locator("#setAutoAdvance").check();
  await p.click("nav.tabbar [data-tab=list]");
  await add(p, "A 1m"); await add(p, "B 5m");
  await p.click("#nowToggle");
  await p.clock.runFor(65000);
  eq(await text(p, "#nowTitle"), "B");
  eq(await text(p, "#nowLabel"), "En cours");
  const t = await text(p, "#nowTimer");
  assert(["04:55", "04:56"].includes(t), `B a démarré à la fin de A : ${t}`);
  await p.click("nav.tabbar [data-tab=done]");
  assert((await text(p, ".done-row")).includes("1 min"), "A terminée avec 1 min");
  return p;
});
spec("F4", "réglage : charger une routine en haut de la liste", async () => {
  const p = await open();
  await add(p, "A"); await add(p, "B");
  await p.click("#nowToggle");
  await p.click("nav.tabbar [data-tab=settings]");
  await p.selectOption("#setRoutineInsert", "top");
  await createRoutineUI(p, "R", ["X", "Y"]);
  await p.locator(".routine-row [data-action=more]").click();
  assert((await text(p, "#routineMenu [data-rm=append]")).includes("en haut"), "libellé « en haut »");
  await p.click("#routineMenu [data-rm=append]");
  eq(await titlesOf(p), ["A", "X", "Y", "B"]);
  return p;
});

// ================================================================ v7
async function openPhone() {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  context.setDefaultTimeout(5000);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: T0 });
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.clock.pauseAt(new Date(T0.getTime() + 1000));
  await page.waitForSelector("#app[data-ready='1']");
  page.errors = errors;
  return page;
}
async function smallTargets(p, scope) {
  return p.evaluate((scope) => {
    const out = [];
    document.querySelectorAll(scope + " button, " + scope + " input, " + scope + " select").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest("[hidden]")) return;
      if (el.type === "checkbox") return;
      if (r.width < 40 || r.height < 40) out.push(`${el.id || el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
    });
    return out;
  }, scope);
}
spec("U5", "mobile : cibles ≥ 40 px, champs ≥ 16 px, pas de défilement horizontal", async () => {
  const p = await openPhone();
  await newList(p, "Cuisine");
  for (const t of ["Éplucher 10m", "Cuire le riz 18m", "Dresser 5m"]) await add(p, t);
  await p.click("#nowToggle");
  await chip(p, "Ma liste").click();
  await add(p, "Emails 15m"); await add(p, "Rapport 30m");
  await p.locator("#quickAdd").blur();
  const small = await smallTargets(p, "#app");
  assert(small.length === 0, "commandes trop petites : " + small.join(", "));
  const fonts = await p.evaluate(() => [...document.querySelectorAll("input")].filter((i) => i.getBoundingClientRect().width && i.type !== "checkbox").map((i) => parseFloat(getComputedStyle(i).fontSize)).filter((f) => f < 16));
  eq(fonts, [], "champs < 16 px");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `débordement horizontal de ${overflow}px`);
  await menuFor(p, "Rapport");
  const smallSheet = await smallTargets(p, "#taskSheet");
  assert(smallSheet.length === 0, "menu : commandes trop petites : " + smallSheet.join(", "));
  await p.keyboard.press("Escape");
  await p.click("nav.tabbar [data-tab=settings]");
  const smallSet = await smallTargets(p, "#viewSettings");
  assert(smallSet.length === 0, "réglages : commandes trop petites : " + smallSet.join(", "));
  const emojiIcons = await p.evaluate(() => [...document.querySelectorAll("nav.tabbar button")].filter((b) => !b.querySelector("svg")).length);
  eq(emojiIcons, 0, "onglets sans icône vectorielle");
  return p;
});
spec("C10", "horloges en grand : camembert du focus et miniature de la carte", async () => {
  const p = await openPhone();
  await add(p, "A 10m");
  await p.click("#nowToggle");
  await p.click("nav.tabbar [data-tab=settings]");
  await p.selectOption("#setClock", "pie");
  await p.click("nav.tabbar [data-tab=list]");
  const mini = await p.locator("#nowClock").boundingBox();
  assert(mini.width >= 64, `miniature trop petite : ${mini.width}px`);
  await p.click("#nowFocus");
  const vw = await p.evaluate(() => window.innerWidth);
  const pie = await p.locator("#focusPie").boundingBox();
  assert(pie.width >= vw * 0.74, `camembert trop petit : ${pie.width}px pour ${vw}px`);
  await p.click("#focusBack");
  await p.click("nav.tabbar [data-tab=settings]");
  await p.selectOption("#setClock", "ring");
  await p.click("nav.tabbar [data-tab=list]");
  await p.click("#nowFocus");
  const ring = await p.locator("#focusRingSvg").boundingBox();
  assert(ring.width >= vw * 0.74, `anneau trop petit : ${ring.width}px`);
  return p;
});
spec("H2", "toute l'interface suit la couleur choisie (plus rien de vert)", async () => {
  const p = await open();
  await add(p, "A 10m"); await add(p, "B");
  await p.click("#nowToggle");
  await newList(p, "Autre");
  await add(p, "C");
  await p.click("nav.tabbar [data-tab=settings]");
  const bgGreen = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.locator("#setAccent [data-accent=violet]").click();
  const bgViolet = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(bgGreen !== bgViolet, "le fond doit suivre la teinte");
  for (const tab of ["settings", "list"]) {
    await p.click(`nav.tabbar [data-tab=${tab}]`);
    const greens = await p.evaluate(() => {
      const isGreen = (c) => {
        const m = c && c.match(/rgba?\((\d+), (\d+), (\d+)/);
        if (!m) return false;
        const [r, g, b] = m.slice(1).map(Number);
        return g > r + 25 && g > b + 15; // dominante verte nette
      };
      const bad = [];
      document.querySelectorAll("#app *").forEach((el) => {
        if (!el.getBoundingClientRect().width || el.closest("#setAccent")) return; // les pastilles montrent chaque couleur
        const cs = getComputedStyle(el);
        for (const prop of ["color", "backgroundColor", "borderTopColor", "fill", "stroke"]) {
          if (prop === "borderTopColor" && parseFloat(cs.borderTopWidth) === 0) continue;
          if (isGreen(cs[prop])) bad.push(`${el.id || el.className.baseVal || el.className || el.tagName}.${prop}=${cs[prop]}`);
        }
      });
      return bad;
    });
    assert(greens.length === 0, `éléments encore verts (${tab}) : ` + greens.slice(0, 8).join(" | "));
  }
  return p;
});
spec("H3", "choisir un son le fait entendre ; la fin du temps utilise ce son", async () => {
  const p = await open();
  await p.click("nav.tabbar [data-tab=settings]");
  eq(await p.locator("#setSoundType option").count(), 5);
  await p.selectOption("#setSoundType", "bell");
  eq(await p.evaluate(() => window.__sablierLastSound), "bell");
  await p.selectOption("#setSoundType", "bowl");
  await p.click("#testSound");
  eq(await p.evaluate(() => window.__sablierLastSound), "bowl");
  await p.evaluate(() => { window.__sablierLastSound = null; });
  await p.click("nav.tabbar [data-tab=list]");
  await add(p, "A 1m");
  await p.click("#nowToggle");
  await p.clock.runFor(61000);
  eq(await p.evaluate(() => window.__sablierLastSound), "bowl");
  return p;
});

// ================================================================ v8
spec("C10", "carte « Maintenant » : grande horloge avec le temps au centre", async () => {
  const p = await openPhone();
  await add(p, "A 10m");
  await p.click("#nowToggle");
  const vw = await p.evaluate(() => window.innerWidth);
  const clock = await p.locator("#nowClock").boundingBox();
  assert(clock.width >= vw * 0.6, `horloge trop petite : ${clock.width}px pour ${vw}px`);
  const digits = await p.locator("#nowTimer").boundingBox();
  const cx = (b) => b.x + b.width / 2, cy = (b) => b.y + b.height / 2;
  assert(Math.abs(cx(digits) - cx(clock)) < 12 && Math.abs(cy(digits) - cy(clock)) < 12, "chiffres au centre de l'horloge");
  await p.locator("#nowClock").click({ position: { x: 24, y: clock.height / 2 } }); // sur le bord de l'horloge
  assert(await p.locator("#nowTimerInput").isVisible(), "toucher l'horloge ouvre la saisie");
  await p.keyboard.press("Escape");
  return p;
});
spec("C10", "cadran minuteur : 60 graduations, chiffres 0 à 55, part = minutes restantes", async () => {
  const p = await openPhone();
  await p.click("nav.tabbar [data-tab=settings]");
  await p.selectOption("#setClock", "pie");
  await p.click("nav.tabbar [data-tab=list]");
  await add(p, "A 30m");
  await p.click("#nowToggle");
  await p.clock.runFor(15 * 60000);
  eq(await p.locator("#nowClock .tick").count(), 60);
  eq(await p.locator("#nowClock .dial-num").allTextContents(), ["0", "5", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  const frac = await p.locator("#miniPie").getAttribute("data-frac");
  eq(frac, "0.25", "15 min restantes = un quart du cadran");
  await p.click("#nowFocus");
  eq(await p.locator("#focusPie .tick").count(), 60);
  const pie = await p.locator("#focusPie").boundingBox(), dg = await p.locator("#focusTimer").boundingBox();
  assert(Math.abs(pie.y + pie.height / 2 - (dg.y + dg.height / 2)) < 12, "chiffres au centre du cadran en focus");
  return p;
});
spec("H3", "sons : registre médium-aigu, non répétitifs, volume homogène", async () => {
  const p = await open();
  const stats = await p.evaluate(() => window.__sablierSoundStats());
  for (const [name, st] of Object.entries(stats)) {
    assert(st.minFreq >= 250, `${name} : note trop grave (${st.minFreq} Hz)`);
    assert(st.maxRepeat <= 2, `${name} : même note répétée ${st.maxRepeat} fois`);
    assert(st.duration <= 4.5, `${name} : trop long (${st.duration} s)`);
  }
  const peaks = await p.evaluate(() => window.__sablierRenderPeaks());
  const vals = Object.values(peaks);
  assert(Math.max(...vals) <= 0.95, "saturation : " + JSON.stringify(peaks));
  assert(Math.min(...vals) >= Math.max(...vals) * 0.5, "volumes trop différents : " + JSON.stringify(peaks));
  return p;
});

spec("A9", "disposition : ⤒/⤓ en colonne à gauche, actions libellées en bas à droite", async () => {
  const p = await openPhone();
  for (const t of ["A", "B", "C"]) await add(p, t);
  await p.locator("#quickAdd").blur();
  const c = card(p, 0);
  const top = await c.locator("[data-action=top]").boundingBox();
  const bottom = await c.locator("[data-action=bottom]").boundingBox();
  const title = await c.locator(".task-title").boundingBox();
  assert(top.x + top.width <= title.x && bottom.x + bottom.width <= title.x, "⤒/⤓ à gauche du titre");
  assert(Math.abs(top.x - bottom.x) < 2 && bottom.y > top.y, "⤒ au-dessus de ⤓");
  const labels = await c.locator(".quick-acts button").allTextContents();
  eq(labels.map((l) => l.trim()), ["Plus tard", "Fait", "Suppr.", "Modifier"]);
  const acts = await c.locator(".quick-acts").boundingBox(), card0 = await c.boundingBox();
  assert(acts.x + acts.width > card0.x + card0.width - 16, "actions alignées à droite");
  return p;
});

spec("C3", "toucher l'horloge par erreur ne fait rien perdre ; secondes acceptées", async () => {
  const p = await open();
  await add(p, "A 20m");
  await p.click("#nowToggle");
  await p.clock.runFor(18000);
  eq(await text(p, "#nowTimer"), "19:42");
  await p.click("#nowTimer");
  eq(await p.inputValue("#nowTimerInput"), "19:42");
  await p.click("#nowTitle"); // ferme sans modifier
  assert(await p.locator("#nowTimerInput").isHidden(), "champ refermé");
  await p.clock.runFor(2000);
  eq(await text(p, "#nowTimer"), "19:40", "aucune perte de progression");
  await p.click("#nowTimer");
  await p.press("#nowTimerInput", "Enter"); // Entrée sans modification
  eq(await text(p, "#nowTimer"), "19:40");
  await p.click("#nowTimer");
  await p.fill("#nowTimerInput", "5:30");
  await p.press("#nowTimerInput", "Enter");
  eq(await text(p, "#nowTimer"), "05:30");
  await p.click("#nowTimer");
  await p.fill("#nowTimerInput", "12.15");
  await p.press("#nowTimerInput", "Enter");
  eq(await text(p, "#nowTimer"), "12:15");
  await p.click("nav.tabbar [data-tab=done]");
  await p.click("nav.tabbar [data-tab=list]");
  assert((await text(p, "#nowMeta")).includes("20 s passées"), "temps passé conservé : " + await text(p, "#nowMeta"));
  return p;
});
spec("H3", "sons sobres : 2 notes max, ≤ 3 kHz, centrés (gauche = droite)", async () => {
  const p = await open();
  const stats = await p.evaluate(() => window.__sablierSoundStats());
  for (const [name, st] of Object.entries(stats)) {
    assert(st.notes <= 2, `${name} : ${st.notes} notes`);
    assert(st.maxFreq <= 3000, `${name} : composante trop aiguë (${st.maxFreq} Hz)`);
  }
  const bal = await p.evaluate(() => window.__sablierRenderBalance());
  for (const [name, b] of Object.entries(bal)) assert(Math.abs(b.left - b.right) <= 0.01 * Math.max(b.left, b.right), `${name} : déséquilibre G/D ${JSON.stringify(b)}`);
  const peaks = await p.evaluate(() => window.__sablierRenderPeaks());
  assert(Math.max(...Object.values(peaks)) <= 0.6, "volume trop fort : " + JSON.stringify(peaks));
  return p;
});

// ================================================================ v10
spec("G5", "exporter puis réimporter ses données", async () => {
  const p = await open();
  await add(p, "Garder 15m"); await add(p, "Aussi");
  await p.click("nav.tabbar [data-tab=settings]");
  await p.click("#exportData");
  const json = await p.inputValue("#dataText");
  assert(json.includes("Garder") && json.includes("routines"), "export complet");
  await p.click("#dataClose");
  await p.click("nav.tabbar [data-tab=list]");
  await menuFor(p, "Garder"); await p.click("#taskSheet [data-ts=delete]");
  eq(await titlesOf(p), ["Aussi"]);
  await p.click("nav.tabbar [data-tab=settings]");
  await p.click("#importData");
  await p.fill("#dataText", "n'importe quoi");
  await p.click("#dataApply");
  assert(await p.locator("#dataError").isVisible(), "erreur sur texte invalide");
  await p.fill("#dataText", json);
  await p.click("#dataApply");
  await p.click("#confirmOk");
  await p.click("nav.tabbar [data-tab=list]");
  eq(await titlesOf(p), ["Garder", "Aussi"]);
  return p;
});

const FIREBASE_MOCK = ({ users, docs }) => {
  const store = new Map(Object.entries(docs || {}));
  const accounts = { ...(users || {}) };
  const listeners = new Map();
  let current = null, authCbs = [];
  const snap = (path) => ({ exists: () => store.has(path), data: () => (store.has(path) ? JSON.parse(JSON.stringify(store.get(path))) : undefined) });
  const emit = (path) => (listeners.get(path) || []).forEach((cb) => setTimeout(() => cb(snap(path)), 0));
  const setUser = (u) => { current = u; authCbs.forEach((cb) => setTimeout(() => cb(u), 0)); };
  window.__fbWrites = [];
  window.__fbDoc = (path) => store.get(path);
  window.__SABLIER_FIREBASE_CONFIG = { apiKey: "test", projectId: "sablier-test" };
  window.__SABLIER_FIREBASE_MOCK = {
    initializeApp: (cfg) => ({ cfg }),
    getAuth: () => ({}),
    getFirestore: () => ({}),
    onAuthStateChanged: (auth, cb) => { authCbs.push(cb); setTimeout(() => cb(current), 0); return () => {}; },
    signInWithEmailAndPassword: async (auth, email, pw) => {
      const a = accounts[email];
      if (!a || a.pw !== pw) throw { code: "auth/invalid-credential" };
      setUser({ uid: a.uid, email }); return { user: current };
    },
    createUserWithEmailAndPassword: async (auth, email, pw) => {
      if (accounts[email]) throw { code: "auth/email-already-in-use" };
      if (pw.length < 6) throw { code: "auth/weak-password" };
      accounts[email] = { pw, uid: "u" + Object.keys(accounts).length + 1 };
      setUser({ uid: accounts[email].uid, email }); return { user: current };
    },
    signOut: async () => setUser(null),
    doc: (db, ...segs) => ({ path: segs.join("/") }),
    onSnapshot: (ref, next) => { const l = listeners.get(ref.path) || []; l.push(next); listeners.set(ref.path, l); setTimeout(() => next(snap(ref.path)), 10); return () => {}; },
    setDoc: async (ref, data) => { window.__fbWrites.push(ref.path); store.set(ref.path, JSON.parse(JSON.stringify(data))); emit(ref.path); },
  };
};
async function openFirebase(opts) {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
  context.setDefaultTimeout(5000);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(FIREBASE_MOCK, opts);
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app[data-ready='1']");
  page.errors = errors;
  return page;
}
spec("S1", "connexion : erreur en français, création de compte, déconnexion", async () => {
  const p = await openFirebase({ users: { "flo@ex.fr": { pw: "secret1", uid: "u1" } } });
  await p.waitForSelector("#authSheet:not([hidden])");
  await p.fill("#authEmail", "flo@ex.fr");
  await p.fill("#authPassword", "mauvais");
  await p.click("#authLogin");
  await p.waitForSelector("#authError:not([hidden])");
  assert((await text(p, "#authError")).toLowerCase().includes("incorrect"), "message d'erreur en français");
  await p.fill("#authEmail", "nouvelle@ex.fr");
  await p.fill("#authPassword", "motdepasse");
  await p.click("#authCreate");
  await p.waitForSelector("#authSheet", { state: "hidden" });
  await p.click("nav.tabbar [data-tab=settings]");
  eq(await text(p, "#accountEmail"), "nouvelle@ex.fr");
  await p.click("#signOut");
  await p.waitForSelector("#signIn:not([hidden])");
  return p;
});
spec("S1", "continuer sans compte : l'appli marche en local", async () => {
  const p = await openFirebase({});
  await p.waitForSelector("#authSheet:not([hidden])");
  await p.click("#authSkip");
  await add(p, "Locale");
  eq(await titlesOf(p), ["Locale"]);
  eq(await p.evaluate(() => window.__fbWrites.length), 0);
  return p;
});
spec("S2", "synchronisation Firestore : données du compte chargées puis mises à jour", async () => {
  const saved = { version: 3, lists: [{ id: "main", name: "Ma liste", tasks: [{ id: "t1", title: "Depuis le téléphone", minutes: 10 }] }], updatedAtMs: 1000 };
  const p = await openFirebase({ users: { "flo@ex.fr": { pw: "secret1", uid: "u1" } }, docs: { "users/u1": saved } });
  await p.waitForSelector("#authSheet:not([hidden])");
  await p.fill("#authEmail", "flo@ex.fr");
  await p.fill("#authPassword", "secret1");
  await p.click("#authLogin");
  await p.waitForFunction(() => document.getElementById("nowTitle").textContent.includes("Depuis le téléphone"));
  await add(p, "Depuis le web");
  await p.waitForFunction(() => (window.__fbDoc("users/u1").lists[0].tasks || []).length === 2);
  eq(await p.evaluate(() => [...new Set(window.__fbWrites)]), ["users/u1"]);
  await p.evaluate(() => { const d = window.__fbDoc("users/u1"); d.lists[0].tasks.push({ id: "t9", title: "Ajoutée ailleurs", minutes: 5 }); d.updatedAtMs = Date.now() + 1000; window.__SABLIER_FIREBASE_MOCK.setDoc({ path: "users/u1" }, d); });
  await p.waitForFunction(() => [...document.querySelectorAll("#taskList .task-title")].some((i) => i.value === "Ajoutée ailleurs"));
  return p;
});
spec("S3", "installable : manifeste, icônes et service worker", async () => {
  const p = await open({ clock: false });
  const href = await p.getAttribute('link[rel="manifest"]', "href");
  assert(href, "lien vers le manifeste");
  const m = await p.evaluate(async (h) => (await fetch(h)).json(), href);
  eq(m.name, "Sablier");
  const sizes = m.icons.map((i) => i.sizes);
  assert(sizes.includes("192x192") && sizes.includes("512x512"), "icônes 192 et 512");
  for (const i of m.icons) eq(await p.evaluate(async (src) => (await fetch(src)).status, i.src), 200, "icône " + i.src);
  const ok = await p.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 4000))]));
  assert(ok, "service worker actif");
  return p;
});
const CAPACITOR_MOCK = () => {
  let pending = [];
  window.__lnCalls = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { LocalNotifications: {
      requestPermissions: async () => { window.__lnCalls.push("perm"); return { display: "granted" }; },
      createChannel: async () => { window.__lnCalls.push("channel"); },
      getPending: async () => ({ notifications: pending.map((n) => ({ id: n.id })) }),
      cancel: async ({ notifications }) => { const ids = notifications.map((n) => n.id); pending = pending.filter((n) => !ids.includes(n.id)); },
      schedule: async ({ notifications }) => { pending = pending.concat(notifications); },
    } },
  };
  window.__lnPending = () => pending.map((n) => ({ title: n.title, body: n.body, at: new Date(n.schedule.at).getTime() }));
};
spec("N1", "appli Android : alarme programmée à la fin de la tâche, annulée en pause", async () => {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
  context.setDefaultTimeout(5000);
  const p = await context.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.clock.install({ time: T0 });
  await p.addInitScript(CAPACITOR_MOCK);
  await p.goto(URL_, { waitUntil: "domcontentloaded" });
  await p.clock.pauseAt(new Date(T0.getTime() + 1000));
  await p.waitForSelector("#app[data-ready='1']");
  await add(p, "Emails 10m");
  await p.click("#nowToggle");
  await p.clock.runFor(1000);
  const pend = await p.evaluate(() => window.__lnPending());
  eq(pend.length, 1);
  assert(pend[0].title.includes("Ma liste") && pend[0].body.includes("Emails"), JSON.stringify(pend[0]));
  eq(pend[0].at, T0.getTime() + 1000 + 10 * 60000);
  assert((await p.evaluate(() => window.__lnCalls)).includes("perm"), "permission demandée");
  await p.click("#nowPlus5");
  await p.clock.runFor(1000);
  eq((await p.evaluate(() => window.__lnPending()))[0].at, T0.getTime() + 1000 + 15 * 60000, "reprogrammée après +5");
  await p.click("#nowToggle"); // pause
  await p.clock.runFor(1000);
  eq(await p.evaluate(() => window.__lnPending().length), 0, "annulée en pause");
  return p;
});

// ---------------------------------------------------------------- exécution
const only = process.argv[2];
const known = new Set(SPECS.map((s) => s.id));
let failed = 0;
const results = [];
for (const t of tests) {
  if (only && !t.id.startsWith(only)) continue;
  let page;
  try {
    if (!known.has(t.id)) throw new Error("spec inconnue");
    page = await t.fn();
    if (page && page.errors.length) throw new Error("erreurs console : " + page.errors.join(" | "));
    console.log(`✓ [${t.id}] ${t.name}`);
    results.push({ specId: t.id, name: t.name, ok: true });
  } catch (e) {
    failed++;
    console.log(`✗ [${t.id}] ${t.name}\n    → ${e.message.split("\n").slice(0,6).join(" / ")}`);
    results.push({ specId: t.id, name: t.name, ok: false, error: e.message.split("\n")[0] });
  } finally {
    if (page) await page.context().close();
  }
}
fs.writeFileSync(path.join(ROOT, "e2e-results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 1));
console.log(`\n${results.length - failed}/${results.length} tests E2E OK`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
