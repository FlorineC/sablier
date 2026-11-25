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
  clockStyle: "ring", accent: "green", autoAdvance: false, routineInsert: "bottom", soundType: "chime", warnPercent: 0,
});
export const WARN_PERCENTS = [0, 10, 20, 25, 33, 50];
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
    warnPercent: WARN_PERCENTS.includes(Number(r.warnPercent)) ? Number(r.warnPercent) : DEFAULT_SETTINGS.warnPercent,
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
    if (Number.isFinite(raw.finishByMs)) t.finishByMs = raw.finishByMs;
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
    if (typeof a.startedBy === "string" && a.startedBy) list.active.startedBy = a.startedBy;
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
      if (Number.isFinite(l.finishByMs)) list.finishByMs = l.finishByMs;
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
    .map((r) => {
      const out = { id: typeof r.id === "string" && r.id ? r.id : uid(), name: String(r.name ?? "").trim() || "Routine", items: normalizeItems(r.items) };
      const timing = cleanTiming(r.timing);
      if (timing) out.timing = timing;
      return out;
    })
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
  [["guitare"], "🎸"],
  [["musique", "piano", "instrument", "repetition", "solfege"], "🎹"],
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
const PREFIX_STEMS = new Set(["appel", "admin", "copro", "muscu", "retro", "kine", "visio", "doc", "impot", "debug", "devel"]);
const COMPILED_EMOJI = EMOJI_DICTIONARY.flatMap(([kws, emoji]) =>
  kws.map((kw) => {
    const n = normalizeText(kw);
    // mots courts : mot entier (pluriel admis) — « repas » ne doit pas reconnaître « repasser »
    const tail = n.length >= 6 || PREFIX_STEMS.has(n) ? "" : "(s|x)?($|[^a-z0-9])";
    return { len: n.length, emoji, re: new RegExp("(^|[^a-z0-9])" + escapeRe(n) + tail) };
  })
);

// Base complète d'emojis (noms et mots-clés en français), chargée par l'appli quand elle est disponible.
let EMOJI_INDEX = null;
const STOP_WORDS = new Set("les des une un le la de du et en au aux pour par sur avec dans mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs ce cet cette ces qui que quoi faire fait refaire aller passer prendre mettre voir petit petite grand grande gros bien tout tous toute toutes tache taches chose choses truc trucs the and for with".split(" "));
export function registerEmojiData(data) {
  EMOJI_INDEX = Array.isArray(data) ? data.filter((r) => Array.isArray(r) && r[3] !== 9).map((r) => ({
    emoji: r[0], label: normalizeText(r[1]).replace(/[^a-z0-9' ]+/g, " ").trim(),
    labelWords: normalizeText(r[1]).split(/[^a-z0-9]+/).filter(Boolean),
    tagWords: normalizeText(r[2]).split(/[^a-z0-9]+/).filter(Boolean),
  })) : null;
}
const singular = (w) => (w.length > 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w);
// Cherche dans la base complète : nom exact > mot du nom > mot-clé > début de mot (le mot le plus long gagne à égalité).
function searchIndexFor(norm) {
  if (!EMOJI_INDEX) return null;
  const words = [...new Set(norm.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)))];
  let best = null;
  for (const w0 of words) {
    const forms = [...new Set([w0, singular(w0)])];
    for (const row of EMOJI_INDEX) {
      let sc = 99;
      for (const w of forms) {
        const eq = (x) => x === w || singular(x) === w;
        if (row.label === w) sc = Math.min(sc, 0);
        else if (row.labelWords.some(eq)) sc = Math.min(sc, 1 + row.labelWords.length * 0.01);
        else if (row.tagWords.some(eq)) sc = Math.min(sc, 2);
        else if (w.length >= 5 && row.labelWords.some((x) => x.startsWith(w))) sc = Math.min(sc, 3);
        else if (w.length >= 5 && row.tagWords.some((x) => x.startsWith(w))) sc = Math.min(sc, 4);
      }
      if (sc < 99 && (!best || sc < best.sc || (sc === best.sc && w0.length > best.len))) best = { sc, len: w0.length, emoji: row.emoji };
    }
  }
  return best ? best.emoji : null;
}
export function suggestEmoji(title) {
  const norm = normalizeText(title);
  if (!norm.trim()) return DEFAULT_EMOJI;
  let best = null;
  for (const k of COMPILED_EMOJI) {
    if (k.re.test(norm) && (!best || k.len > best.len)) best = k;
  }
  if (best) return best.emoji;
  return searchIndexFor(norm) || DEFAULT_EMOJI;
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
export function addTask(state, listId, { title, minutes, emoji } = {}, { position = "bottom", afterId = null } = {}) {
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
  const after = afterId ? list.tasks.findIndex((t) => t.id === afterId) : -1;
  if (after >= 0) list.tasks.splice(after + 1, 0, task);
  else if (position === "top") list.tasks.splice(list.active ? 1 : 0, 0, task);
  else list.tasks.push(task);
  return s;
}

export function updateTask(state, taskId, patch = {}) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { task: t } = locate(s, taskId);
  if ("title" in patch) {
    const v = String(patch.title ?? "").trim();
    // l'emoji automatique suit le titre ; un emoji choisi à la main est conservé
    if (v && v !== t.title && !("emoji" in patch) && t.emoji === suggestEmoji(t.title)) t.emoji = suggestEmoji(v);
    if (v) t.title = v;
  }
  if ("minutes" in patch) { const m = toMinutes(patch.minutes); if (m !== null) t.minutes = m; }
  if ("durationSec" in patch) {
    const d = Number(patch.durationSec);
    if (Number.isFinite(d) && d >= 1) t.minutes = clamp(Math.round((d / 60) * 1e4) / 1e4, 1 / 60, MAX_MINUTES);
  }
  if ("emoji" in patch) t.emoji = String(patch.emoji ?? "").trim() || suggestEmoji(t.title);
  return s;
}

// Supprimer la tâche en cours : la suivante prend sa place (elle démarre si le minuteur tournait
// et que l'enchaînement automatique est activé).
export function deleteTask(state, taskId, now = Date.now()) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { list, idx } = locate(s, taskId);
  const wasActive = !!(list.active && list.active.taskId === taskId);
  const wasRunning = wasActive && listRunning(list);
  const by = wasActive ? list.active.startedBy : null;
  handOverGap(list, idx);
  list.tasks.splice(idx, 1);
  if (wasActive) {
    const next = list.tasks[0];
    list.active = next ? { taskId: next.id, startedAtMs: wasRunning && s.settings.autoStartNext ? now : null } : null;
    if (list.active && by) list.active.startedBy = by;
    if (list.alertedTaskId === taskId) list.alertedTaskId = null;
  }
  return s;
}

export function duplicateTask(state, taskId) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { list, idx, task } = locate(s, taskId);
  list.tasks.splice(idx + 1, 0, { ...task, id: uid(), spentSec: 0 });
  return s;
}

// Jalons « Fin voulue » : ils appartiennent à une place dans la file, pas à une tâche.
// Après un réordonnancement, chaque jalon retrouve la même position (mute `list`).
const gapsOf = (tasks) => tasks.map((t) => (Number.isFinite(t.finishByMs) ? t.finishByMs : null));
function restoreGaps(list, gaps) {
  list.tasks.forEach((t) => { delete t.finishByMs; });
  gaps.forEach((ms, i) => { if (ms !== null && list.tasks[i]) list.tasks[i].finishByMs = ms; });
}
// Une tâche quitte la file : son jalon passe à la tâche précédente (mute `list`, avant le retrait).
function handOverGap(list, idx) {
  const t = list.tasks[idx];
  if (!t || !Number.isFinite(t.finishByMs)) return;
  const prev = list.tasks[idx - 1];
  if (prev && !Number.isFinite(prev.finishByMs)) prev.finishByMs = t.finishByMs;
  delete t.finishByMs;
}

export function moveTask(state, taskId, delta) {
  const loc = locate(state, taskId);
  if (!loc) return state;
  const j = loc.idx + delta;
  const minIdx = loc.list.active ? 1 : 0; // la tâche en cours reste en tête
  if (loc.idx < minIdx || j < minIdx || j >= loc.list.tasks.length) return state;
  const s = clone(state);
  const { list } = locate(s, taskId);
  const gaps = gapsOf(list.tasks);
  const [t] = list.tasks.splice(loc.idx, 1);
  list.tasks.splice(j, 0, t);
  restoreGaps(list, gaps);
  return s;
}

export function reorderTasks(state, listId, orderedIds) {
  if (!getList(state, listId)) return state;
  const s = clone(state);
  const list = getList(s, listId);
  const gaps = gapsOf(list.tasks);
  const byId = new Map(list.tasks.map((t) => [t.id, t]));
  const out = [];
  for (const id of orderedIds) {
    const t = byId.get(id);
    if (t) { out.push(t); byId.delete(id); }
  }
  list.tasks = out.concat([...byId.values()]);
  pinActive(list);
  restoreGaps(list, gaps);
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
  const gaps = gapsOf(list.tasks);
  list.tasks.unshift(list.tasks.splice(idx, 1)[0]);
  restoreGaps(list, gaps);
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
  const gaps = gapsOf(list.tasks);
  const [t] = list.tasks.splice(loc.idx, 1);
  list.tasks.splice(target, 0, t);
  restoreGaps(list, gaps);
  return s;
}

export function moveTaskToList(state, taskId, targetListId, now) {
  const loc = locate(state, taskId);
  if (!loc || !getList(state, targetListId) || loc.list.id === targetListId) return state;
  const s = clone(state);
  const { list, idx } = locate(s, taskId);
  if (list.active && list.active.taskId === taskId) { accumulate(list, now); list.active = null; }
  handOverGap(list, idx);
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
  const gaps = gapsOf(list.tasks);
  list.active = { taskId: target, startedAtMs: now };
  pinActive(list);
  restoreGaps(list, gaps);
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
      const rem = effectiveRemainingSec(s, taskId, now);
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
    if (l.alertedTaskId !== id && effectiveRemainingSec(state, id, now) <= 0) fired.push({ listId: l.id, taskId: id });
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
    const by = list.active && list.active.startedBy;
    list.active = next ? { taskId: next.id, startedAtMs: startNext ? now : null } : null;
    if (list.active && by) list.active.startedBy = by;
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
  const gaps = gapsOf(list.tasks);
  const [t] = list.tasks.splice(idx, 1);
  list.tasks.push(t);
  restoreGaps(list, gaps);
  const by = list.active.startedBy;
  list.active = { taskId: list.tasks[0].id, startedAtMs: wasRunning ? now : null };
  if (by) list.active.startedBy = by;
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
  handOverGap(list, idx);
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

export function createRoutine(state, name, items, timing) {
  const n = String(name ?? "").trim();
  const clean = cleanRoutineItems(items);
  if (!n || !clean.length) return state;
  const s = clone(state);
  const r = { id: uid(), name: n, items: clean };
  const t = cleanTiming(timing);
  if (t) r.timing = t;
  s.routines.push(r);
  return s;
}
export function updateRoutine(state, id, { name, items, timing } = {}) {
  const n = String(name ?? "").trim();
  const clean = cleanRoutineItems(items);
  if (!n || !clean.length || !state.routines.some((r) => r.id === id)) return state;
  const s = clone(state);
  const r = s.routines.find((x) => x.id === id);
  r.name = n;
  r.items = clean;
  const t = cleanTiming(timing);
  if (t) r.timing = t; else delete r.timing;
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
// finishByMs : undefined = horaire de la routine ; null = aucune heure limite ; nombre = cette heure.
export function launchRoutine(state, routineId, now, { start = true, finishByMs } = {}) {
  const r = state.routines.find((x) => x.id === routineId);
  if (!r) return state;
  const s = clone(state);
  const list = newList(uid(), r.name);
  list.tasks = freshTasks(r);
  if (start && list.tasks.length) list.active = { taskId: list.tasks[0].id, startedAtMs: now };
  if (finishByMs === undefined && r.timing && r.timing.mode === "end") {
    const end = timeOfDayToMs(now, r.timing.time);
    if (end !== null && end > now) list.finishByMs = end;
  } else if (Number.isFinite(finishByMs) && finishByMs > now) list.finishByMs = finishByMs;
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
  if ("warnPercent" in patch && WARN_PERCENTS.includes(Number(patch.warnPercent))) cur.warnPercent = Number(patch.warnPercent);
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
  const body = h ? `${pad2(h)}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
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
    return { t, rem: effectiveRemainingSec(state, t.id, now) };
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
export function upcomingAlarms(state, now, { deviceId = null, onlyMine = false } = {}) {
  const out = [];
  const pct = state.settings.warnPercent || 0;
  for (const l of state.lists) {
    if (!listRunning(l)) continue;
    if (onlyMine && l.active.startedBy !== deviceId) continue;
    const head = l.tasks.find((x) => x.id === l.active.taskId);
    let chain; // [{ t, end, budget }]
    if (hasDeadlines(l)) {
      const p = plan(state, l.id, now).tasks;
      chain = (state.settings.autoAdvance ? p : p.filter((x) => x.taskId === head.id)).map((x) => ({
        t: l.tasks.find((y) => y.id === x.taskId),
        end: x.taskId === head.id ? Math.round((now + x.adjustedSec * 1000) / 1000) * 1000 : Math.round(x.endAtMs / 1000) * 1000,
        budget: x.budgetSec,
      }));
    } else {
      // fin exacte de la tâche en cours (indépendante de l'instant du calcul)
      let cursor = l.active.startedAtMs + (totalSec(head) - head.spentSec) * 1000;
      chain = [{ t: head, end: cursor, budget: totalSec(head) }];
      if (state.settings.autoAdvance) {
        cursor = Math.max(cursor, now);
        for (const t of l.tasks) {
          if (t.id === head.id) continue;
          cursor += Math.max(0, totalSec(t) - t.spentSec) * 1000;
          chain.push({ t, end: cursor, budget: totalSec(t) });
        }
      }
    }
    for (const { t, end, budget } of chain) {
      const base = { listId: l.id, listName: l.name, taskId: t.id, title: t.title, emoji: t.emoji };
      if (pct > 0) {
        const at = Math.round(end - (budget * pct) / 100 * 1000);
        if (at > now) out.push({ ...base, kind: "warn", id: hashId(l.id + "|" + t.id + "|warn"), atMs: at, leftMin: Math.round((budget * pct) / 100 / 60) });
      }
      if (end > now) out.push({ ...base, kind: "end", id: hashId(l.id + "|" + t.id), atMs: end });
    }
  }
  return out;
}

// Notification permanente de l'appli Android : la liste qui tourne et finit le plus tôt.
export function ongoingInfo(state, now) {
  const items = state.lists.filter(listRunning).map((l) => {
    const t = l.tasks.find((x) => x.id === l.active.taskId);
    let end;
    if (hasDeadlines(l)) {
      const x = plan(state, l.id, now).tasks.find((y) => y.taskId === t.id);
      end = Math.round((now + (x ? x.adjustedSec : 0) * 1000) / 1000) * 1000;
    } else end = l.active.startedAtMs + (totalSec(t) - t.spentSec) * 1000;
    return { l, t, end };
  }).sort((a, b) => a.end - b.end);
  if (!items.length) return null;
  const { l, t, end } = items[0];
  const more = items.length - 1;
  return { listId: l.id, title: `${t.emoji} ${t.title}`, text: l.name + (more ? ` · +${more} autre${more > 1 ? "s" : ""} liste${more > 1 ? "s" : ""}` : ""), endAtMs: end };
}

// Appareil qui a lancé le minuteur d'une liste (pour « alarmes seulement pour mes tâches »).
export function markStartedBy(state, listId, deviceId) {
  const l = getList(state, listId);
  if (!l || !l.active || !deviceId || l.active.startedBy === deviceId) return state;
  const s = clone(state);
  getList(s, listId).active.startedBy = deviceId;
  return s;
}

// Avertissement avant la fin : tâches en cours entrées dans les derniers `warnPercent` % de leur durée.
function warnInfo(state, l, now) {
  const head = l.tasks.find((x) => x.id === l.active.taskId);
  if (!head) return null;
  if (hasDeadlines(l)) {
    const x = plan(state, l.id, now).tasks.find((y) => y.taskId === head.id);
    return x ? { head, rem: x.adjustedSec, budget: x.budgetSec } : null;
  }
  return { head, rem: remainingSec(state, head.id, now), budget: totalSec(head) };
}
export function inWarnZone(state, taskId, now) {
  const pct = state.settings.warnPercent || 0;
  const loc = locate(state, taskId);
  if (!pct || !loc || !loc.list.active || loc.list.active.taskId !== taskId) return false;
  const w = warnInfo(state, loc.list, now);
  return !!w && w.rem > 0 && w.rem <= (w.budget * pct) / 100;
}
export function warnDue(state, now) {
  const out = [];
  if (!(state.settings.warnPercent > 0)) return out;
  for (const l of state.lists) {
    if (!listRunning(l) || !inWarnZone(state, l.active.taskId, now)) continue;
    const w = warnInfo(state, l, now);
    out.push({ listId: l.id, taskId: w.head.id, key: `${l.id}|${w.head.id}|${Math.round(w.budget)}` });
  }
  return out;
}

// Garde, dans un état distant reçu, les signaux de fin déjà donnés sur cet appareil.
export function carryLocalFlags(local, remote) {
  if (!local || !remote) return remote;
  let changed = false;
  const lists = remote.lists.map((rl) => {
    const ll = local.lists.find((x) => x.id === rl.id);
    if (ll && rl.active && ll.alertedTaskId === rl.active.taskId && rl.alertedTaskId !== ll.alertedTaskId) { changed = true; return { ...rl, alertedTaskId: ll.alertedTaskId }; }
    return rl;
  });
  return changed ? { ...remote, lists } : remote;
}

// Saisie d'une durée : « 25 » (min), « 25:00 », « 1:30:00 », « 1h30 », « 15m » → secondes.
export function parseDurationInput(input) {
  const str = String(input ?? "").trim();
  if (!str) return null;
  const c = parseClock(str);
  if (c !== null) return c;
  const m = parseDuration(str);
  return m !== null && m !== undefined ? Math.round(m * 60) : null;
}

// ---------------------------------------------------------------- export / import
export function importData(text) {
  let raw;
  try { raw = JSON.parse(String(text ?? "")); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!Array.isArray(raw.lists) && !Array.isArray(raw.tasks)) return null;
  return normalizeState(raw);
}

// ---------------------------------------------------------------- configuration Firebase collée
const FB_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId", "databaseURL"];
export function parseFirebaseConfig(text) {
  const str = String(text ?? "");
  let cfg = null;
  try {
    const j = JSON.parse(str);
    if (j && typeof j === "object" && !Array.isArray(j)) cfg = Object.fromEntries(FB_KEYS.filter((k) => typeof j[k] === "string").map((k) => [k, j[k]]));
  } catch { /* pas du JSON : extrait depuis le code copié dans la console */ }
  if (!cfg) {
    cfg = {};
    const re = /\b(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId|measurementId|databaseURL)\s*:\s*["'`]([^"'`]+)["'`]/g;
    let m;
    while ((m = re.exec(str))) cfg[m[1]] = m[2];
  }
  return cfg.apiKey && cfg.projectId ? cfg : null;
}

// ---------------------------------------------------------------- recherche d'emoji
// data : [[emoji, libellé, mots-clés, groupe], …]
export function searchEmoji(data, query) {
  const q = normalizeText(query).trim();
  if (!q) return data.slice();
  const scored = [];
  data.forEach((row, i) => {
    const label = normalizeText(row[1]), tags = normalizeText(row[2]);
    const words = label.split(/\s+/), tagWords = tags.split(/\s+/);
    let score = -1;
    if (label === q) score = 0;
    else if (label.startsWith(q)) score = 1;
    else if (words.some((w) => w.startsWith(q))) score = 2;
    else if (tagWords.some((w) => w.startsWith(q))) score = 3;
    else if (label.includes(q) || tags.includes(q)) score = 4;
    if (score >= 0) scored.push([score, i, row]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

// ---------------------------------------------------------------- remise à zéro du temps
// Le temps passé repart de zéro (durée prévue complète) ; une tâche qui tournait continue de tourner.
export function resetTime(state, taskId, now) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { list, task } = locate(s, taskId);
  task.spentSec = 0;
  task.minutes = clamp(Math.round(task.minutes), MIN_MINUTES, MAX_MINUTES);
  if (list.active && list.active.taskId === taskId && listRunning(list)) list.active.startedAtMs = now;
  if (list.alertedTaskId === taskId) list.alertedTaskId = null;
  return s;
}

// ---------------------------------------------------------------- heures limites (fin voulue)
export function timeOfDayToMs(now, hhmm) {
  const m = String(hhmm ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date(now);
  d.setHours(+m[1], +m[2], 0, 0);
  return d.getTime();
}
export const msToTimeOfDay = (ms) => fmtClock(ms);

function cleanTiming(t) {
  if (!t || typeof t !== "object" || !["start", "end"].includes(t.mode)) return null;
  const m = String(t.time ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return { mode: t.mode, time: `${pad2(+m[1])}:${m[2]}` };
}

// Fenêtre horaire d'une routine : l'autre borne est calculée à partir de la durée totale.
export function routineWindow(routine) {
  if (!routine || !routine.timing) return null;
  const totalMin = routine.items.reduce((a, it) => a + Math.round(it.minutes), 0);
  const [h, m] = routine.timing.time.split(":").map(Number);
  const base = h * 60 + m;
  const fmt = (x) => { const v = ((x % 1440) + 1440) % 1440; return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`; };
  return routine.timing.mode === "start"
    ? { start: fmt(base), end: fmt(base + totalMin), totalMin }
    : { start: fmt(base - totalMin), end: fmt(base), totalMin };
}

export function setTaskFinishBy(state, taskId, ms) {
  if (!locate(state, taskId)) return state;
  const s = clone(state);
  const { task } = locate(s, taskId);
  if (Number.isFinite(ms)) task.finishByMs = ms; else delete task.finishByMs;
  return s;
}
export function setListFinishBy(state, listId, ms) {
  if (!getList(state, listId)) return state;
  const s = clone(state);
  const l = getList(s, listId);
  if (Number.isFinite(ms)) l.finishByMs = ms; else delete l.finishByMs;
  return s;
}

// Planning avec heures limites : les durées prévues ne changent pas ; si une limite est plus
// proche que le temps prévu, les tâches depuis la limite précédente (ou maintenant) sont
// raccourcies proportionnellement (jamais allongées).
// Budget d'un tronçon = temps jusqu'à la limite + temps déjà passé sur ses tâches ; chaque tâche
// reçoit (durée prévue × facteur) − temps déjà passé. Le facteur ne bouge pas pendant que la tâche
// en cours tourne : son temps ajusté décompte donc à vitesse normale.
const hasDeadlines = (l) => !!l && (Number.isFinite(l.finishByMs) || l.tasks.some((t) => Number.isFinite(t.finishByMs)));
export function plan(state, listId, now) {
  const l = getList(state, listId);
  if (!l) return { tasks: [], segments: [] };
  const activeId = l.active ? l.active.taskId : null;
  const P = l.tasks.map((t) => totalSec(t));
  const E = l.tasks.map((t) => elapsedSec(state, t.id, now));
  const rem = l.tasks.map((t, i) => (t.id === activeId ? P[i] - E[i] : Math.max(0, P[i] - E[i])));
  const n = l.tasks.length;
  const bounds = []; // [index de fin, échéance]
  l.tasks.forEach((t, i) => {
    let d = Number.isFinite(t.finishByMs) ? t.finishByMs : null;
    if (i === n - 1 && Number.isFinite(l.finishByMs)) d = d === null ? l.finishByMs : Math.min(d, l.finishByMs);
    if (d !== null) bounds.push([i, d]);
  });
  const adjusted = rem.slice();
  const factors = l.tasks.map(() => 1);
  const segments = [];
  let segStartIdx = 0, cursor = now;
  for (const [endIdx, deadline] of bounds) {
    const idx = [];
    for (let i = segStartIdx; i <= endIdx; i++) idx.push(i);
    const planned = idx.reduce((a, i) => a + Math.max(0, rem[i]), 0);
    const avail = (deadline - cursor) / 1000;
    let K = avail + idx.reduce((a, i) => a + E[i], 0);
    let factor = 1;
    if (K > 0 && avail < planned) {
      // répartition au prorata ; une tâche qui a déjà consommé plus que sa part reçoit 0
      let free = idx.slice();
      for (let guard = 0; guard < 100; guard++) {
        const Pf = free.reduce((a, i) => a + P[i], 0);
        factor = Pf > 0 ? Math.min(1, K / Pf) : 1;
        const over = free.filter((i) => l.tasks[i].id !== activeId && P[i] * factor < E[i]);
        if (!over.length) break;
        for (const i of over) { adjusted[i] = 0; factors[i] = factor; K -= E[i]; }
        free = free.filter((i) => !over.includes(i));
      }
      for (const i of free) { adjusted[i] = P[i] * factor - E[i]; factors[i] = factor; }
    }
    segments.push({ endIndex: endIdx, deadlineAtMs: deadline, plannedSec: Math.round(planned), availableSec: Math.max(0, Math.round(avail)), factor, late: !(K > 0) });
    cursor += idx.reduce((a, i) => a + Math.max(0, adjusted[i]), 0) * 1000;
    segStartIdx = endIdx + 1;
  }
  let t0 = now;
  const tasks = l.tasks.map((t, i) => {
    const start = Math.round(t0);
    t0 += Math.max(0, adjusted[i]) * 1000;
    return { taskId: t.id, startAtMs: start, endAtMs: Math.round(t0), plannedSec: rem[i], adjustedSec: adjusted[i], budgetSec: P[i] * factors[i], factor: factors[i] };
  });
  return { tasks, segments };
}

// Secondes affichées d'un temps ajusté (fractionnaire) : arrondi au-dessus, comme un minuteur.
export const shownSec = (x) => Math.ceil(x - 1e-6);
// Temps restant affiché (ajusté par les heures limites, sinon temps restant prévu).
export function effectiveRemainingSec(state, taskId, now) {
  const loc = locate(state, taskId);
  if (!loc) return 0;
  if (!hasDeadlines(loc.list)) return remainingSec(state, taskId, now);
  const x = plan(state, loc.list.id, now).tasks.find((p) => p.taskId === taskId);
  return x ? shownSec(x.adjustedSec) : 0;
}

// Fixe le temps restant AFFICHÉ de la tâche en cours (ou de la prochaine). Sous une heure limite,
// la durée prévue est recalculée pour que le temps ajusté vaille `sec` ; les autres tâches du
// tronçon absorbent la différence. → { state, capped } (capped : limité par l'heure de fin).
export function setShownRemaining(state, listId, sec, now) {
  const l = getList(state, listId);
  const r = Number(sec);
  if (!l || !l.tasks.length || sec === null || !Number.isFinite(r) || r < 1) return { state, capped: false };
  if (!hasDeadlines(l)) return { state: setRemainingSec(state, listId, r, now), capped: false };
  const s = clone(state);
  const list = getList(s, listId);
  const t = list.active ? list.tasks.find((x) => x.id === list.active.taskId) : list.tasks[0];
  if (listRunning(list)) { accumulate(list, now); list.active.startedAtMs = now; }
  list.alertedTaskId = null;
  const shownWith = (m) => { t.minutes = m; return plan(s, listId, now).tasks.find((x) => x.taskId === t.id).adjustedSec; };
  let lo = 1 / 60, hi = MAX_MINUTES;
  const max = shownWith(hi);
  const target = Math.min(r, max) - 0.5; // affiché arrondi au-dessus : vise juste en dessous
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (shownWith(mid) < target) lo = mid; else hi = mid;
  }
  t.minutes = clamp(Math.round(hi * 1e4) / 1e4, 1 / 60, MAX_MINUTES);
  return { state: s, capped: r > max + 1 };
}

// Déplace une heure limite : de la tâche `fromTaskId` (null = fin de liste) vers la tâche `toTaskId`.
export function moveFinishBy(state, listId, fromTaskId, toTaskId) {
  const l = getList(state, listId);
  if (!l) return state;
  const from = fromTaskId ? l.tasks.find((t) => t.id === fromTaskId) : null;
  const ms = from ? from.finishByMs : l.finishByMs;
  const to = l.tasks.find((t) => t.id === toTaskId);
  if (!Number.isFinite(ms) || !to || to === from || Number.isFinite(to.finishByMs)) return state;
  const s = clone(state);
  const list = getList(s, listId);
  if (fromTaskId) delete list.tasks.find((t) => t.id === fromTaskId).finishByMs; else delete list.finishByMs;
  list.tasks.find((t) => t.id === toTaskId).finishByMs = ms;
  return s;
}
