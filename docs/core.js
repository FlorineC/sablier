// Sablier — logique métier pure (aucun accès au DOM, au réseau ni à l'horloge :
// l'instant `now` est toujours passé en paramètre). Toutes les fonctions qui
// modifient l'état renvoient un NOUVEL état et laissent l'ancien intact ; si
// rien ne change, elles renvoient l'état d'origine (même référence).
//
// Modèle v3 : plusieurs listes, chacune avec ses tâches et son propre minuteur.
// Invariant : la tâche en cours d'une liste (active) est toujours en tête.

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 600;
export const ACCENTS = ["green", "blue", "violet", "pink", "orange", "red", "teal"];
export const CLOCK_STYLES = ["ring", "pie", "digital"];
export const SOUNDS = ["chime", "bell", "bowl", "marimba", "harp"];
const LEGACY_SOUNDS = { gong: "bowl", beep: "harp" };
const ROUTINE_INSERT = ["bottom", "top"];
export const DEFAULT_SETTINGS = Object.freeze({
  sound: true, autoStartNext: true, defaultMinutes: 25, theme: "auto", showDone: false,
  clockStyle: "ring", accent: "green", autoAdvance: false, routineInsert: "bottom", soundType: "chime",
});
const THEMES = ["auto", "light", "dark"];
const DEFAULT_EMOJI = "🧠";
const MAIN_LIST_ID = "main";
const MAIN_LIST_NAME = "Ma liste";

// ---------------------------------------------------------------- utilitaires
export function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
}
const clone = (s) => JSON.parse(JSON.stringify(s));
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pad2 = (n) => String(n).padStart(2, "0");

function toMinutes(v) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
  if (!Number.isFinite(n)) return null;
  return clamp(Math.round(n), MIN_MINUTES, MAX_MINUTES);
}

// Durée enregistrée : peut être non entière quand le temps restant a été
// saisi en cours de route (voir setRemaining). Bornée, arrondie au 1/10 000.
function toStoredMinutes(v) {
  const n = Number(v);
  if (typeof v !== "number" || !Number.isFinite(n)) return toMinutes(v);
  if (n <= 0) return MIN_MINUTES;
  return clamp(Math.round(n * 1e4) / 1e4, 1 / 60, MAX_MINUTES);
}
const totalSec = (t) => Math.round(t.minutes * 60);

// ---------------------------------------------------------------- état
function newList(id, name) {
  return { id, name, tasks: [], active: null, alertedTaskId: null };
}

export function createState() {
  return {
    version: 3,
    lists: [newList(MAIN_LIST_ID, MAIN_LIST_NAME)],
    currentListId: MAIN_LIST_ID,
    later: [],
    done: [],
    routines: [],
    settings: { ...DEFAULT_SETTINGS },
    updatedAtMs: 0,
    writer: null,
  };
}

function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_SETTINGS.sound,
    autoStartNext: typeof r.autoStartNext === "boolean" ? r.autoStartNext : DEFAULT_SETTINGS.autoStartNext,
    defaultMinutes: toMinutes(r.defaultMinutes) ?? DEFAULT_SETTINGS.defaultMinutes,
    theme: THEMES.includes(r.theme) ? r.theme : DEFAULT_SETTINGS.theme,
    showDone: typeof r.showDone === "boolean" ? r.showDone : DEFAULT_SETTINGS.showDone,
    clockStyle: CLOCK_STYLES.includes(r.clockStyle) ? r.clockStyle : DEFAULT_SETTINGS.clockStyle,
    accent: ACCENTS.includes(r.accent) ? r.accent : DEFAULT_SETTINGS.accent,
    autoAdvance: typeof r.autoAdvance === "boolean" ? r.autoAdvance : DEFAULT_SETTINGS.autoAdvance,
    routineInsert: ROUTINE_INSERT.includes(r.routineInsert) ? r.routineInsert : DEFAULT_SETTINGS.routineInsert,
    soundType: SOUNDS.includes(r.soundType) ? r.soundType : LEGACY_SOUNDS[r.soundType] || DEFAULT_SETTINGS.soundType,
  };
}

function normalizeTaskList(arr, seen, extra) {
  const out = [];
  for (const raw of Array.isArray(arr) ? arr : []) {
    if (!raw || typeof raw !== "object") continue;
    const title = String(raw.title ?? "").trim();
    if (!title) continue;
    let id = typeof raw.id === "string" && raw.id ? raw.id : uid();
    while (seen.has(id)) id = uid();
    seen.add(id);
    const spent = Number(raw.spentSec);
    const t = {
      id,
      emoji: String(raw.emoji ?? "").trim() || suggestEmoji(title),
      title,
      minutes: toStoredMinutes(raw.minutes) ?? DEFAULT_SETTINGS.defaultMinutes,
      spentSec: Number.isFinite(spent) && spent > 0 ? Math.floor(spent) : 0,
    };
    if (extra) extra(t, raw);
    out.push(t);
  }
  return out;
}

function normalizeItems(arr) {
  return normalizeTaskList(arr, new Set()).map(({ title, emoji, minutes }) => ({ title, emoji, minutes }));
}

function normalizeActive(list, rawActive) {
  const a = rawActive;
  if (a && typeof a === "object" && list.tasks.some((t) => t.id === a.taskId)) {
    list.active = { taskId: a.taskId, startedAtMs: Number.isFinite(a.startedAtMs) ? a.startedAtMs : null };
    pinActive(list);
  }
}

// Place la tâche en cours en tête de sa liste (mute `list`).
function pinActive(list) {
  if (!list.active) return;
  const i = list.tasks.findIndex((t) => t.id === list.active.taskId);
  if (i > 0) list.tasks.unshift(list.tasks.splice(i, 1)[0]);
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return createState();
  const s = createState();
  const seenTasks = new Set();
  const seenLists = new Set();

  if (Array.isArray(raw.lists)) {
    s.lists = raw.lists.filter((l) => l && typeof l === "object").map((l, i) => {
      let id = typeof l.id === "string" && l.id ? l.id : uid();
      while (seenLists.has(id)) id = uid();
      seenLists.add(id);
      const list = newList(id, String(l.name ?? "").trim() || `Liste ${i + 1}`);
      list.tasks = normalizeTaskList(l.tasks, seenTasks);
      normalizeActive(list, l.active);
      list.alertedTaskId = typeof l.alertedTaskId === "string" ? l.alertedTaskId : null;
      return list;
    });
    if (!s.lists.length) s.lists = [newList(MAIN_LIST_ID, MAIN_LIST_NAME)];
  } else {
    // v1 / v2 : une seule liste au premier niveau
    const list = newList(MAIN_LIST_ID, MAIN_LIST_NAME);
    list.tasks = normalizeTaskList(raw.tasks, seenTasks);
    if (raw.active) normalizeActive(list, raw.active);
    else if (raw.focus && typeof raw.focus === "object") {
      const f = raw.focus;
      const t = list.tasks.find((x) => x.id === f.taskId);
      if (t) {
        const spent = Number(f.totalSec) - Number(f.remainingSec);
        if (Number.isFinite(spent) && spent > 0) t.spentSec = Math.floor(spent);
        list.active = { taskId: t.id, startedAtMs: null };
        pinActive(list);
      }
    }
    list.alertedTaskId = typeof raw.alertedTaskId === "string" ? raw.alertedTaskId : null;
    s.lists = [list];
  }

  s.currentListId = s.lists.some((l) => l.id === raw.currentListId) ? raw.currentListId : s.lists[0].id;
  s.later = normalizeTaskList(raw.later ?? raw.notNow, seenTasks);
  s.done = normalizeTaskList(raw.done, seenTasks, (t, r) => {
    t.completedAtMs = Number.isFinite(r.completedAtMs) ? r.completedAtMs : 0;
    t.listId = typeof r.listId === "string" ? r.listId : s.lists[0].id;
    t.listName = typeof r.listName === "string" && r.listName ? r.listName : s.lists[0].name;
  });
  const rawRoutines = raw.routines ?? raw.presets;
  s.routines = (Array.isArray(rawRoutines) ? rawRoutines : [])
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ id: typeof r.id === "string" && r.id ? r.id : uid(), name: String(r.name ?? "").trim() || "Routine", items: normalizeItems(r.items) }))
    .filter((r) => r.items.length > 0);
  s.settings = normalizeSettings(raw.settings);
  s.updatedAtMs = Number.isFinite(raw.updatedAtMs) ? raw.updatedAtMs : 0;
  s.writer = typeof raw.writer === "string" ? raw.writer : null;
  return s;
}

// ---------------------------------------------------------------- saisie
export function parseDuration(input) {
  const str = String(input ?? "").trim().toLowerCase().replace(",", ".");
  if (!str) return null;
  let m = str.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*(?:m|mn|min|mins|minutes?)?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
  m = str.match(/^(\d+)\s*(?:m|mn|min|mins|minutes?|')?$/);
  if (m) return parseInt(m[1], 10);
  return null;
}

const TRAILING_DURATION = /\s+(\d+(?:[.,]\d+)?\s*h(?:\s*\d+\s*(?:m|mn|min|mins|minutes?)?)?|\d+\s*(?:m|mn|min|mins|minutes?|')|\d+)$/i;

export function parseQuickAdd(text) {
  const raw = String(text ?? "").trim();
  const m = raw.match(TRAILING_DURATION);
  if (m) {
    const title = raw.slice(0, m.index).trim();
    const minutes = parseDuration(m[1]);
    if (title && minutes !== null) return { title, minutes };
  }
  return { title: raw, minutes: null };
}

// ---------------------------------------------------------------- emoji
const EMOJI_DICTIONARY = [
  [["email", "mail", "mails", "courriel", "inbox", "boite mail"], "📧"],
  [["reunion", "meeting", "point equipe", "point d'equipe", "daily", "standup", "retro"], "🗓️"],
  [["telephone", "coup de fil", "appel"], "📞"],
  [["visio", "zoom", "teams", "meet"], "📹"],
  [["presentation", "slide", "slides", "pitch", "deck"], "📊"],
  [["code", "coder", "dev", "developpement", "bug", "debug", "refacto", "refactor", "review", "revue de code", "deploy", "pr "], "💻"],
  [["design", "maquette", "figma", "ui", "ux"], "🎨"],
  [["ecrire", "redaction", "rediger", "rapport", "compte rendu", "compte-rendu", "doc", "documentation", "article de blog"], "📝"],
  [["lire", "lecture", "livre", "article", "veille"], "📖"],
  [["projet", "planifier", "planning", "roadmap", "organiser", "prioriser"], "🗂️"],
  [["facture", "impot", "impots", "comptabilite", "budget", "banque", "finance", "compta", "virement"], "🧾"],
  [["administratif", "admin", "papier", "papiers", "dossier", "formulaire", "syndic", "assurance", "copro"], "📁"],
  [["formation", "cours", "apprendre", "apprentissage", "etudier", "revision", "reviser", "certif", "certification"], "🎓"],
  [["menage", "nettoyer", "nettoyage", "rangement", "ranger", "aspirateur", "vaisselle"], "🧹"],
  [["linge", "lessive", "repassage", "machine"], "🧺"],
  [["cuisine", "cuisiner", "repas", "recette", "diner", "dejeuner", "manger", "eplucher", "legumes", "cuire", "riz", "pates", "four"], "🍳"],
  [["courses", "supermarche", "epicerie"], "🛒"],
  [["jardin", "plante", "plantes", "arrosage", "arroser"], "🌱"],
  [["reparation", "reparer", "bricolage", "bricoler", "travaux"], "🔧"],
  [["animal", "chat", "chats", "chien", "veterinaire", "litiere"], "🐾"],
  [["famille", "enfant", "enfants", "parents"], "👪"],
  [["sport", "gym", "muscu", "musculation", "course a pied", "running", "entrainement", "salle"], "🏋️"],
  [["yoga", "meditation", "mediter", "respiration", "relaxation", "etirements"], "🧘"],
  [["medecin", "docteur", "dentiste", "pharmacie", "ordonnance", "kine"], "🩺"],
  [["dormir", "sieste", "repos", "sommeil"], "😴"],
  [["pause", "detente", "break", "cafe"], "☕"],
  [["marche", "promenade", "balade"], "🚶"],
  [["voyage", "vacances", "avion", "valise", "billet"], "✈️"],
  [["voiture", "conduire", "essence", "garage", "recharge"], "🚗"],
  [["train", "transport", "tram", "bus"], "🚆"],
  [["cadeau", "anniversaire", "fete"], "🎁"],
  [["musique", "piano", "guitare", "instrument", "repetition", "solfege"], "🎹"],
  [["appeler", "contacter", "relancer", "rappeler"], "☎️"],
  [["envoyer", "colis", "poste", "livraison"], "📦"],
  [["achat", "acheter", "commander", "commande"], "🛍️"],
  [["trier", "tri"], "🗃️"],
  [["echecs", "echec"], "♟️"],
  [["drag", "maquillage", "costume", "perruque"], "💄"],
];

function normalizeText(str) {
  return String(str ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’]/g, "'");
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPILED_EMOJI = EMOJI_DICTIONARY.flatMap(([kws, emoji]) =>
  kws.map((kw) => {
    const n = normalizeText(kw);
    return { len: n.length, emoji, re: new RegExp("(^|[^a-z0-9])" + escapeRe(n)) };
  })
);

export function suggestEmoji(title) {
  const norm = normalizeText(title);
  if (!norm.trim()) return DEFAULT_EMOJI;
  let best = null;
  for (const k of COMPILED_EMOJI) {
    if (k.re.test(norm) && (!best || k.len > best.len)) best = k;
  }
  return best ? best.emoji : DEFAULT_EMOJI;
}


// ---------------------------------------------------------------- accès
export function getList(state, listId) {
  return state.lists.find((l) => l.id === listId) || null;
}
export function currentList(state) {
  return getList(state, state.currentListId) || state.lists[0];
}
function locate(state, taskId) {
  for (const list of state.lists) {
    const idx = list.tasks.findIndex((t) => t.id === taskId);
    if (idx >= 0) return { list, idx, task: list.tasks[idx] };
  }
  return null;
}

// ---------------------------------------------------------------- listes
export function createList(state, name) {
  const s = clone(state);
  const list = newList(uid(), String(name ?? "").trim() || `Liste ${s.lists.length + 1}`);
  s.lists.push(list);
  s.currentListId = list.id;
  return s;
}
export function renameList(state, listId, name) {
  const n = String(name ?? "").trim();
  if (!n || !getList(state, listId)) return state;
  const s = clone(state);
  getList(s, listId).name = n;
  return s;
}
export function deleteList(state, listId) {
  const idx = state.lists.findIndex((l) => l.id === listId);
  if (idx < 0 || state.lists.length < 2) return state;
  const s = clone(state);
  s.lists.splice(idx, 1);
  if (s.currentListId === listId) s.currentListId = (s.lists[idx] || s.lists[idx - 1]).id;
  return s;
}
export function setCurrentList(state, listId) {
  if (!getList(state, listId) || state.currentListId === listId) return state;
  return { ...state, currentListId: listId };
}

// ---------------------------------------------------------------- tâches
export function addTask(state, listId, { title, minutes, emoji } = {}, { position = "bottom" } = {}) {
  const parsed = parseQuickAdd(title);
  if (!parsed.title || !getList(state, listId)) return state;
  const mins = toMinutes(minutes) ?? parsed.minutes;
  const s = clone(state);
  const list = getList(s, listId);
  const task = {
    id: uid(),
    emoji: String(emoji ?? "").trim() || suggestEmoji(parsed.title),
    title: parsed.title,
    minutes: mins !== null ? clamp(mins, MIN_MINUTES, MAX_MINUTES) : s.settings.defaultMinutes,
    spentSec: 0,
  };
  // « En haut » : juste après la tâche en cours, sinon en tête (devient la prochaine).
  if (position === "top") list.tasks.splice(list.active ? 1 : 0, 0, task);
  else list.tasks.push(task);
  return s;
}

export function updateTask(state, taskId, patch = {}) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { task: t } = locate(s, taskId);
  if ("title" in patch) { const v = String(patch.title ?? "").trim(); if (v) t.title = v; }
  if ("minutes" in patch) { const m = toMinutes(patch.minutes); if (m !== null) t.minutes = m; }
  if ("emoji" in patch) t.emoji = String(patch.emoji ?? "").trim() || suggestEmoji(t.title);
  return s;
}

export function deleteTask(state, taskId) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { list, idx } = locate(s, taskId);
  list.tasks.splice(idx, 1);
  if (list.active && list.active.taskId === taskId) list.active = null;
  return s;
}

export function duplicateTask(state, taskId) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { list, idx, task } = locate(s, taskId);
  list.tasks.splice(idx + 1, 0, { ...task, id: uid(), spentSec: 0 });
  return s;
}

export function moveTask(state, taskId, delta) {
  const loc = locate(state, taskId);
  if (!loc) return state;
  const j = loc.idx + delta;
  const minIdx = loc.list.active ? 1 : 0; // la tâche en cours reste en tête
  if (loc.idx < minIdx || j < minIdx || j >= loc.list.tasks.length) return state;
  const s = clone(state);
  const { list } = locate(s, taskId);
  const [t] = list.tasks.splice(loc.idx, 1);
  list.tasks.splice(j, 0, t);
  return s;
}

export function reorderTasks(state, listId, orderedIds) {
  if (!getList(state, listId)) return state;
  const s = clone(state);
  const list = getList(s, listId);
  const byId = new Map(list.tasks.map((t) => [t.id, t]));
  const out = [];
  for (const id of orderedIds) {
    const t = byId.get(id);
    if (t) { out.push(t); byId.delete(id); }
  }
  list.tasks = out.concat([...byId.values()]);
  pinActive(list);
  return s;
}

// Fait d'une tâche de la file la tâche courante (glisser sur « Maintenant »).
export function promoteTask(state, listId, taskId, now) {
  const l = getList(state, listId);
  if (!l) return state;
  const idx = l.tasks.findIndex((t) => t.id === taskId);
  if (idx <= 0) return state;
  if (listRunning(l)) return startTask(state, listId, taskId, now);
  const s = clone(state);
  const list = getList(s, listId);
  list.tasks.unshift(list.tasks.splice(idx, 1)[0]);
  if (list.active) list.active = { taskId, startedAtMs: null };
  return s;
}

// « Tout en haut » (tête de file, après la tâche en cours) / « Tout en bas ».
export function moveTaskToEdge(state, taskId, edge) {
  const loc = locate(state, taskId);
  if (!loc) return state;
  const minIdx = loc.list.active ? 1 : 0;
  if (loc.idx < minIdx) return state; // la tâche en cours ne bouge pas
  const target = edge === "top" ? minIdx : loc.list.tasks.length - 1;
  if (target === loc.idx) return state;
  const s = clone(state);
  const { list } = locate(s, taskId);
  const [t] = list.tasks.splice(loc.idx, 1);
  list.tasks.splice(target, 0, t);
  return s;
}

export function moveTaskToList(state, taskId, targetListId, now) {
  const loc = locate(state, taskId);
  if (!loc || !getList(state, targetListId) || loc.list.id === targetListId) return state;
  const s = clone(state);
  const { list, idx } = locate(s, taskId);
  if (list.active && list.active.taskId === taskId) { accumulate(list, now); list.active = null; }
  const [t] = list.tasks.splice(idx, 1);
  getList(s, targetListId).tasks.push(t);
  return s;
}

// ---------------------------------------------------------------- minuteur
const listRunning = (list) => !!(list && list.active && list.active.startedAtMs !== null && list.active.startedAtMs !== undefined);
const runningSecs = (list, now) => (listRunning(list) ? Math.max(0, Math.floor((now - list.active.startedAtMs) / 1000)) : 0);

// Verse le temps couru dans spentSec et met en pause (mute `list`).
function accumulate(list, now) {
  if (!listRunning(list)) return;
  const t = list.tasks.find((x) => x.id === list.active.taskId);
  if (t) t.spentSec += runningSecs(list, now);
  list.active.startedAtMs = null;
}

export function isRunning(state, listId) {
  return listRunning(getList(state, listId));
}
export function activeTask(state, listId) {
  const l = getList(state, listId);
  return l && l.active ? l.tasks.find((t) => t.id === l.active.taskId) || null : null;
}
export function activeLists(state) {
  return state.lists.filter((l) => l.active);
}

export function elapsedSec(state, taskId, now) {
  const loc = locate(state, taskId);
  if (!loc) return 0;
  return loc.task.spentSec + (loc.list.active && loc.list.active.taskId === taskId ? runningSecs(loc.list, now) : 0);
}
export function remainingSec(state, taskId, now) {
  const loc = locate(state, taskId);
  return loc ? totalSec(loc.task) - elapsedSec(state, taskId, now) : 0;
}

export function startTask(state, listId, taskId, now) {
  const l = getList(state, listId);
  if (!l) return state;
  const target = taskId || (l.active && l.active.taskId) || (l.tasks[0] && l.tasks[0].id);
  if (!target || !l.tasks.some((t) => t.id === target)) return state;
  if (listRunning(l) && l.active.taskId === target) return state;
  const s = clone(state);
  const list = getList(s, listId);
  accumulate(list, now);
  list.active = { taskId: target, startedAtMs: now };
  pinActive(list);
  return s;
}

export function pauseTask(state, listId, now) {
  if (!isRunning(state, listId)) return state;
  const s = clone(state);
  accumulate(getList(s, listId), now);
  return s;
}

export function toggleTimer(state, listId, now) {
  return isRunning(state, listId) ? pauseTask(state, listId, now) : startTask(state, listId, null, now);
}

// Ajuste la tâche en cours, ou la prochaine (tête de liste) si rien n'est en cours.
export function adjustTime(state, listId, deltaMin) {
  const l = getList(state, listId);
  if (!l || !l.tasks.length) return state;
  const s = clone(state);
  const list = getList(s, listId);
  const t = list.active ? list.tasks.find((x) => x.id === list.active.taskId) : list.tasks[0];
  t.minutes = clamp(t.minutes + deltaMin, MIN_MINUTES, MAX_MINUTES);
  list.alertedTaskId = null;
  return s;
}

// Passage automatique : chaque tâche dont le temps est écoulé est terminée à
// l'instant exact où il l'a été, et la suivante démarre à ce même instant.
export function advanceTimeUp(state, now) {
  const completed = [];
  if (!state.settings.autoAdvance) return { state, completed };
  let s = state;
  for (const { id } of state.lists) {
    for (let guard = 0; guard < 1000; guard++) {
      const list = getList(s, id);
      if (!listRunning(list)) break;
      const taskId = list.active.taskId;
      const rem = remainingSec(s, taskId, now);
      if (rem > 0) break;
      s = completeInternal(s, id, now + rem * 1000, taskId, true);
      completed.push({ listId: id, taskId });
    }
  }
  return { state: s, completed };
}

// « 19:42 », « 19.42 », « 19,42 », « 19 42 » → secondes ; « 19 » → 19 min ; « 1:02:03 » → h:mm:ss.
export function parseClock(input) {
  const str = String(input ?? "").trim();
  if (!str) return null;
  const parts = str.split(/\s*[:.,\s]\s*/).filter((x) => x !== "");
  if (!parts.length || parts.length > 3 || parts.some((x) => !/^\d+$/.test(x))) return null;
  const n = parts.map(Number);
  let sec;
  if (n.length === 1) sec = n[0] * 60;
  else if (n.length === 2) { if (n[1] > 59) return null; sec = n[0] * 60 + n[1]; }
  else { if (n[1] > 59 || n[2] > 59) return null; sec = n[0] * 3600 + n[1] * 60 + n[2]; }
  return sec > 0 ? sec : null;
}

// Fixe le temps RESTANT (en secondes) de la tâche en cours, ou de la prochaine.
export function setRemainingSec(state, listId, remainingSec, now) {
  const r = Number(remainingSec);
  const l = getList(state, listId);
  if (remainingSec === null || !Number.isFinite(r) || r < 1 || !l || !l.tasks.length) return state;
  const s = clone(state);
  const list = getList(s, listId);
  const t = list.active ? list.tasks.find((x) => x.id === list.active.taskId) : list.tasks[0];
  if (listRunning(list)) { accumulate(list, now); list.active.startedAtMs = now; }
  t.minutes = clamp(Math.round(((Math.min(r, MAX_MINUTES * 60) + t.spentSec) / 60) * 1e4) / 1e4, 1 / 60, MAX_MINUTES);
  list.alertedTaskId = null;
  return s;
}

// Fixe le temps RESTANT (en minutes) de la tâche en cours, ou de la prochaine.
// Le temps déjà passé est conservé : seule la durée prévue est recalculée.
export function setRemaining(state, listId, remainingMin, now) {
  const m = toMinutes(remainingMin);
  const l = getList(state, listId);
  if (m === null || !l || !l.tasks.length) return state;
  const s = clone(state);
  const list = getList(s, listId);
  const t = list.active ? list.tasks.find((x) => x.id === list.active.taskId) : list.tasks[0];
  const wasRunning = listRunning(list);
  if (wasRunning) { accumulate(list, now); list.active.startedAtMs = now; }
  t.minutes = clamp(Math.round(((m * 60 + t.spentSec) / 60) * 1e4) / 1e4, MIN_MINUTES, MAX_MINUTES);
  list.alertedTaskId = null;
  return s;
}

export function checkTimeUp(state, now) {
  const fired = [];
  for (const l of state.lists) {
    if (!listRunning(l)) continue;
    const id = l.active.taskId;
    if (l.alertedTaskId !== id && remainingSec(state, id, now) <= 0) fired.push({ listId: l.id, taskId: id });
  }
  if (!fired.length) return { state, fired };
  const s = clone(state);
  for (const f of fired) getList(s, f.listId).alertedTaskId = f.taskId;
  return { state: s, fired };
}

export function completeTask(state, listId, now, taskId) {
  return completeInternal(state, listId, now, taskId, null);
}
// forceStart : null = suivre le réglage autoStartNext ; true = démarrer la suivante.
function completeInternal(state, listId, now, taskId, forceStart) {
  const l = getList(state, listId);
  if (!l) return state;
  const targetId = taskId || (l.active && l.active.taskId);
  const idx = l.tasks.findIndex((t) => t.id === targetId);
  if (idx < 0) return state;
  const s = clone(state);
  const list = getList(s, listId);
  const wasActive = !!(list.active && list.active.taskId === targetId);
  const wasRunning = wasActive && listRunning(list);
  if (wasActive) accumulate(list, now);
  const [t] = list.tasks.splice(idx, 1);
  s.done.unshift({ id: t.id, title: t.title, emoji: t.emoji, minutes: t.minutes, spentSec: t.spentSec, completedAtMs: now, listId: list.id, listName: list.name });
  if (list.alertedTaskId === targetId) list.alertedTaskId = null;
  if (wasActive) {
    const next = list.tasks[0];
    const startNext = wasRunning && (forceStart ?? s.settings.autoStartNext);
    list.active = next ? { taskId: next.id, startedAtMs: startNext ? now : null } : null;
  }
  return s;
}

export function skipTask(state, listId, now) {
  const l = getList(state, listId);
  if (!l || !l.active || l.tasks.length < 2) return state;
  const s = clone(state);
  const list = getList(s, listId);
  const wasRunning = listRunning(list);
  accumulate(list, now);
  const idx = list.tasks.findIndex((t) => t.id === list.active.taskId);
  const [t] = list.tasks.splice(idx, 1);
  list.tasks.push(t);
  list.active = { taskId: list.tasks[0].id, startedAtMs: wasRunning ? now : null };
  return s;
}

export function nextTask(state, listId) {
  const l = getList(state, listId);
  return l && l.active ? l.tasks[1] || null : null;
}

// ---------------------------------------------------------------- récap
const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };

export function totals(state, listId, now) {
  const l = getList(state, listId);
  if (!l) return { count: 0, remainingSec: 0, finishAtMs: null, progress: 0 };
  let remaining = 0, planned = 0, achieved = 0;
  for (const t of l.tasks) {
    const p = totalSec(t);
    remaining += Math.max(0, remainingSec(state, t.id, now));
    planned += p;
    achieved += Math.min(p, elapsedSec(state, t.id, now));
  }
  for (const d of state.done) {
    if (d.listId === listId && sameDay(d.completedAtMs, now)) { planned += d.minutes * 60; achieved += d.minutes * 60; }
  }
  const count = l.tasks.length;
  return { count, remainingSec: remaining, finishAtMs: count ? now + remaining * 1000 : null, progress: planned ? achieved / planned : 0 };
}

// Créneaux estimés de chaque tâche, enchaînées à partir de maintenant.
export function schedule(state, listId, now) {
  const l = getList(state, listId);
  if (!l) return [];
  let cursor = now;
  return l.tasks.map((t) => {
    const start = cursor;
    cursor += Math.max(0, remainingSec(state, t.id, now)) * 1000;
    return { taskId: t.id, startAtMs: start, endAtMs: cursor };
  });
}

// ---------------------------------------------------------------- plus tard
export function moveToLater(state, taskId, now) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { list, idx } = locate(s, taskId);
  if (list.active && list.active.taskId === taskId) { accumulate(list, now); list.active = null; }
  s.later.push(list.tasks.splice(idx, 1)[0]);
  return s;
}
export function reactivateLater(state, id, listId) {
  const idx = state.later.findIndex((t) => t.id === id);
  if (idx < 0 || !getList(state, listId)) return state;
  const s = clone(state);
  getList(s, listId).tasks.push(s.later.splice(idx, 1)[0]);
  return s;
}
export function deleteLater(state, id) {
  if (!state.later.some((t) => t.id === id)) return state;
  const s = clone(state);
  s.later = s.later.filter((t) => t.id !== id);
  return s;
}

// ---------------------------------------------------------------- terminées
export function doneStats(state) {
  return {
    count: state.done.length,
    spentSec: state.done.reduce((a, t) => a + t.spentSec, 0),
    estimatedSec: state.done.reduce((a, t) => a + t.minutes * 60, 0),
  };
}
export function reopenDone(state, id, fallbackListId) {
  const idx = state.done.findIndex((t) => t.id === id);
  if (idx < 0) return state;
  const s = clone(state);
  const [{ completedAtMs, listId, listName, ...t }] = s.done.splice(idx, 1);
  const target = getList(s, listId) || getList(s, fallbackListId) || s.lists[0];
  target.tasks.push(t);
  return s;
}
export function clearDone(state) {
  if (!state.done.length) return state;
  return { ...clone(state), done: [] };
}
export function doneForList(state, listId) {
  return state.done.filter((d) => d.listId === listId);
}
export function isListCleared(state, listId) {
  const l = getList(state, listId);
  return !!l && l.tasks.length === 0 && state.done.some((d) => d.listId === listId);
}

// ---------------------------------------------------------------- routines
function cleanRoutineItems(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== "object") continue;
    const p = parseQuickAdd(it.title);
    if (!p.title) continue;
    const m = toMinutes(it.minutes) ?? p.minutes;
    out.push({
      title: p.title,
      emoji: String(it.emoji ?? "").trim() || suggestEmoji(p.title),
      minutes: m !== null ? clamp(m, MIN_MINUTES, MAX_MINUTES) : DEFAULT_SETTINGS.defaultMinutes,
    });
  }
  return out;
}

export function createRoutine(state, name, items) {
  const n = String(name ?? "").trim();
  const clean = cleanRoutineItems(items);
  if (!n || !clean.length) return state;
  const s = clone(state);
  s.routines.push({ id: uid(), name: n, items: clean });
  return s;
}
export function updateRoutine(state, id, { name, items } = {}) {
  const n = String(name ?? "").trim();
  const clean = cleanRoutineItems(items);
  if (!n || !clean.length || !state.routines.some((r) => r.id === id)) return state;
  const s = clone(state);
  const r = s.routines.find((x) => x.id === id);
  r.name = n;
  r.items = clean;
  return s;
}
export function saveListAsRoutine(state, listId, name) {
  const l = getList(state, listId);
  if (!l || !l.tasks.length) return state;
  return createRoutine(state, name, l.tasks.map(({ title, emoji, minutes }) => ({ title, emoji, minutes })));
}
const freshTasks = (r) => r.items.map((it) => ({ id: uid(), emoji: it.emoji, title: it.title, minutes: it.minutes, spentSec: 0 }));

export function loadRoutine(state, routineId, listId, mode = "replace") {
  const r = state.routines.find((x) => x.id === routineId);
  if (!r || !getList(state, listId)) return state;
  const s = clone(state);
  const list = getList(s, listId);
  if (mode === "append") list.tasks = list.tasks.concat(freshTasks(r));
  else if (mode === "top") list.tasks.splice(list.active ? 1 : 0, 0, ...freshTasks(r));
  else { list.tasks = freshTasks(r); list.active = null; list.alertedTaskId = null; }
  return s;
}
export function launchRoutine(state, routineId, now, { start = true } = {}) {
  const r = state.routines.find((x) => x.id === routineId);
  if (!r) return state;
  const s = clone(state);
  const list = newList(uid(), r.name);
  list.tasks = freshTasks(r);
  if (start && list.tasks.length) list.active = { taskId: list.tasks[0].id, startedAtMs: now };
  s.lists.push(list);
  s.currentListId = list.id;
  return s;
}
export function deleteRoutine(state, id) {
  if (!state.routines.some((r) => r.id === id)) return state;
  const s = clone(state);
  s.routines = s.routines.filter((r) => r.id !== id);
  return s;
}

// ---------------------------------------------------------------- réglages
export function updateSettings(state, patch = {}) {
  const s = clone(state);
  const cur = s.settings;
  if (typeof patch.sound === "boolean") cur.sound = patch.sound;
  if (typeof patch.autoStartNext === "boolean") cur.autoStartNext = patch.autoStartNext;
  if ("defaultMinutes" in patch) { const m = toMinutes(patch.defaultMinutes); if (m !== null) cur.defaultMinutes = m; }
  if (THEMES.includes(patch.theme)) cur.theme = patch.theme;
  if (typeof patch.showDone === "boolean") cur.showDone = patch.showDone;
  if (CLOCK_STYLES.includes(patch.clockStyle)) cur.clockStyle = patch.clockStyle;
  if (ACCENTS.includes(patch.accent)) cur.accent = patch.accent;
  if (typeof patch.autoAdvance === "boolean") cur.autoAdvance = patch.autoAdvance;
  if (ROUTINE_INSERT.includes(patch.routineInsert)) cur.routineInsert = patch.routineInsert;
  if (SOUNDS.includes(patch.soundType)) cur.soundType = patch.soundType;
  return s;
}

// ---------------------------------------------------------------- synchro
export function stamp(state, now, clientId) {
  return { ...state, updatedAtMs: now, writer: clientId ?? null };
}

export function shouldApplyRemote(local, remote, clientId) {
  if (!remote || typeof remote !== "object") return false;
  const r = Number(remote.updatedAtMs) || 0;
  const l = (local && Number(local.updatedAtMs)) || 0;
  if (r > l) return true;
  return false; // même instant (écho de sa propre écriture) ou plus ancien
}

// ---------------------------------------------------------------- formats
export function fmtTimer(totalSec) {
  const neg = totalSec < 0;
  let v = Math.abs(Math.round(totalSec));
  const h = Math.floor(v / 3600); v -= h * 3600;
  const m = Math.floor(v / 60), sec = v % 60;
  const body = h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
  return neg ? "+" + body : body;
}

export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${pad2(r)}` : `${h} h`;
}

export function fmtClock(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}


export function tabTitle(state, now) {
  const running = state.lists.filter(listRunning).map((l) => {
    const t = l.tasks.find((x) => x.id === l.active.taskId);
    return { t, rem: remainingSec(state, t.id, now) };
  }).sort((a, b) => a.rem - b.rem);
  if (!running.length) return activeLists(state).length ? "⏸ Sablier" : "Sablier";
  const [first] = running;
  return `${fmtTimer(first.rem)} · ${first.t.title}${running.length > 1 ? ` (+${running.length - 1})` : ""}`;
}

// Tracé SVG du camembert (part restante `frac` de 0 à 1, depuis midi, sens horaire).
export function piePath(frac, cx, cy, r) {
  const f = clamp(Number(frac) || 0, 0, 1);
  const n = (v) => String(Math.round(v * 100) / 100);
  if (f <= 0) return "";
  if (f >= 1) return `M${n(cx)} ${n(cy - r)} A${n(r)} ${n(r)} 0 1 1 ${n(cx - 0.01)} ${n(cy - r)} Z`;
  const a = f * 2 * Math.PI;
  const x = cx + r * Math.sin(a), y = cy - r * Math.cos(a);
  return `M${n(cx)} ${n(cy)} L${n(cx)} ${n(cy - r)} A${n(r)} ${n(r)} 0 ${f > 0.5 ? 1 : 0} 1 ${n(x)} ${n(y)} Z`;
}

// Cadran minuteur (type Time Timer) : part du cadran de 60 minutes encore à écouler.
export function dialFraction(remainingSec) {
  return clamp((Number(remainingSec) || 0) / 3600, 0, 1);
}

// ---------------------------------------------------------------- alarmes (appli Android)
function hashId(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) || 1; // entier positif sur 31 bits
}
// Alarmes à programmer : fin de la tâche en cours de chaque liste qui tourne,
// et des tâches suivantes quand le passage automatique est activé.
export function upcomingAlarms(state, now) {
  const out = [];
  for (const l of state.lists) {
    if (!listRunning(l)) continue;
    const head = l.tasks.find((x) => x.id === l.active.taskId);
    // fin exacte de la tâche en cours (indépendante de l'instant du calcul)
    let cursor = l.active.startedAtMs + (totalSec(head) - head.spentSec) * 1000;
    const chain = [{ t: head, end: cursor }];
    if (state.settings.autoAdvance) {
      cursor = Math.max(cursor, now);
      for (const t of l.tasks) {
        if (t.id === head.id) continue;
        cursor += Math.max(0, totalSec(t) - t.spentSec) * 1000;
        chain.push({ t, end: cursor });
      }
    }
    for (const { t, end } of chain) {
      if (end <= now) continue;
      out.push({ id: hashId(l.id + "|" + t.id), listId: l.id, listName: l.name, taskId: t.id, title: t.title, emoji: t.emoji, atMs: end });
    }
  }
  return out;
}

// ---------------------------------------------------------------- export / import
export function importData(text) {
  let raw;
  try { raw = JSON.parse(String(text ?? "")); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!Array.isArray(raw.lists) && !Array.isArray(raw.tasks)) return null;
  return normalizeState(raw);
}
