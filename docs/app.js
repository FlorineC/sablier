// Sablier — couche interface. Toute la logique métier est dans core.js (testée).
import * as C from "./core.js";
import { setupAlarms, syncAlarms, isNative } from "./notify.js";

const $ = (id) => document.getElementById(id);
const LS_KEY = "sablier.v2"; // même clé qu'avant : les données locales existantes sont migrées
const VIEWS = ["list", "later", "done", "routines", "routine-edit", "settings", "focus"];
const SECTIONS = { list: "viewList", later: "viewLater", done: "viewDone", routines: "viewRoutines", "routine-edit": "viewRoutineEdit", settings: "viewSettings", focus: "viewFocus" };
const RING = 2 * Math.PI * 98;
const EMOJI_CHOICES = ["🧠", "🎯", "📧", "📝", "💻", "🎨", "📞", "🗓️", "📖", "🎓", "🧾", "📁", "🧹", "🧺", "🍳", "🛒", "🏋️", "🧘", "☕", "🚶", "🎹", "♟️", "💄", "🐾", "📦", "🌱", "😴"];

// ------------------------------------------------------------ icônes vectorielles (suivent la couleur du texte)
const ICONS = {
  play: ["M7 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z", true],
  pause: ["M6.5 4h3.5v16H6.5zM14 4h3.5v16H14z", true],
  check: ["M4.5 12.5l5 5L19.5 7"],
  trash: ["M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"],
  later: ["M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"],
  top: ["M5 4h14M12 20V9M7 13l5-5 5 5"],
  bottom: ["M5 20h14M12 4v11M7 11l5 5 5-5"],
  up: ["M12 19V5M6 11l6-6 6 6"],
  down: ["M12 5v14M6 13l6 6 6-6"],
  more: ["M5 12h.01M12 12h.01M19 12h.01", false, 3.2],
  grip: ["M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01", false, 3.2],
  focus: ["M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"],
  plus: ["M12 5v14M5 12h14"],
  x: ["M6 6l12 12M18 6L6 18"],
  chevL: ["M15 6l-6 6 6 6"],
  chevR: ["M9 6l6 6-6 6"],
  list: ["M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"],
  done: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8 12.5l2.8 2.8L16 9.5"],
  repeat: ["M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"],
  settings: ["M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4"],
  skip: ["M5 5l9 7-9 7zM19 5v14"],
  dup: ["M8 8h11v11H8zM5 16V5h11"],
  sound: ["M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7"],
  edit: ["M4 20h4L19 9l-4-4L4 16z"],
  reset: ["M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4.5H8"],
  flag: ["M5 21V4M5 4h12l-2.5 4L17 12H5"],
};
function icon(name) {
  const [d, fill, sw] = ICONS[name] || ICONS.more;
  return `<svg class="ic${fill ? " fill" : ""}" viewBox="0 0 24 24" aria-hidden="true"${sw ? ` style="stroke-width:${sw}"` : ""}><path d="${d}"/></svg>`;
}
document.querySelectorAll("[data-icon]").forEach((el) => el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon)));

// Couleurs d'accentuation : [clair, clair doux, sombre, sombre doux, teinte]
const ACCENT_COLORS = {
  green: ["#2F6F52", "#DCEAE1", "#6FCB9A", "#1F3A2C", 150],
  blue: ["#2B5FA8", "#DCE6F4", "#82B2F2", "#1D2F4A", 215],
  violet: ["#6B4FB0", "#E7E0F6", "#B7A0F2", "#2E2548", 258],
  pink: ["#B0407A", "#F6DDEA", "#F190C0", "#45223A", 328],
  orange: ["#B4581A", "#F7E3D3", "#F2A262", "#47301C", 28],
  red: ["#B23A3A", "#F6DADA", "#F08A8A", "#472222", 4],
  teal: ["#1E7A7A", "#D6EEEE", "#6CCFCF", "#1A3B3B", 182],
};
const ACCENT_NAMES = { green: "Vert", blue: "Bleu", violet: "Violet", pink: "Rose", orange: "Orange", red: "Rouge", teal: "Sarcelle" };
(() => {
  const css = Object.entries(ACCENT_COLORS).map(([k, [l, ls, d, ds, hue]]) => {
    const light = `--hue:${hue};--accent:${l};--accent-soft:${ls};--accent-ink:#FFFFFF;`;
    const dark = `--hue:${hue};--accent:${d};--accent-soft:${ds};--accent-ink:#101114;`;
    return `:root[data-accent="${k}"]{${light}}:root[data-theme="dark"][data-accent="${k}"]{${dark}}` +
      `@media (prefers-color-scheme: dark){:root:not([data-theme="light"])[data-accent="${k}"]{${dark}}}`;
  }).join("\n");
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
})();

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const now = () => Date.now();
const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
const fmtSpent = (sec) => (sec < 60 ? `${sec} s` : C.fmtDuration(Math.round(sec / 60)));
const setText = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };
const setIcon = (el, name) => { if (el.dataset.ic !== name) { el.dataset.ic = name; el.innerHTML = icon(name); } };
const setButton = (el, name, label) => {
  const key = name + "|" + label;
  if (el.dataset.key !== key) { el.dataset.key = key; el.innerHTML = icon(name) + `<span>${esc(label)}</span>`; el.setAttribute("aria-label", label); }
};

// ------------------------------------------------------------ identité client
const clientId = (() => {
  try {
    let id = sessionStorage.getItem("sablier.client");
    if (!id) { id = C.uid(); sessionStorage.setItem("sablier.client", id); }
    return id;
  } catch { return C.uid(); }
})();

// ------------------------------------------------------------ état
let state = loadLocal();
let view = viewFromHash();
let undoState = null;
let renderPending = false;
let confirmAction = null;
let toastTimer = null;
let sheetTaskId = null, sheetEmoji = "";
let listSheetMode = "create";
let routineMenuId = null;
let draft = null; // routine en cours d'édition
let drag = null;
let dlCarrier; // jalon en cours d'édition : id de la tâche, null = fin de liste, "new" = nouveau
let launchRoutineId = null, launchMode = "now";
window.__sablierChimes = 0;

const cur = () => C.currentList(state);
const listOf = (taskId) => state.lists.find((l) => l.tasks.some((t) => t.id === taskId)) || null;

function loadLocal() {
  try { return C.normalizeState(JSON.parse(localStorage.getItem(LS_KEY))); } catch { return C.createState(); }
}
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ }
}

// Point d'entrée unique de toute modification.
function commit(next, opts = {}) {
  if (!next || next === state) return false;
  if (opts.undoable) undoState = state;
  const before = opts.celebrateList ? C.getList(state, opts.celebrateList) : null;
  state = C.stamp(next, now(), clientId);
  saveLocal();
  scheduleRemote();
  if (opts.toast) showToast(opts.toast, !!opts.undoable);
  if (before && before.tasks.length > 0 && C.isListCleared(state, before.id)) celebrate(before.name);
  render();
  return true;
}

// ------------------------------------------------------------ synchro
// Trois modes : base de l'artifact (dans Claude), Firestore (appli autonome avec compte), local seul.
// Les deux bases exposent le même petit contrat : onSnapshot(next, err) et set(data).
let docRef = null, remoteReady = false, writing = false, writeQueued = false, writeTimer = null, unsubRemote = null;
let fb = null, fbAuth = null, authSkipped = false, fbStatus = "claude", fbUser = null;
const FB_KEY = "sablier.firebaseConfig";

async function initRemote() {
  const cl = window.claude;
  if (cl && typeof cl.use === "function") {
    let db = null;
    try { db = await cl.use("db"); } catch { db = null; }
    if (db) {
      try { connectRemote(db.doc("app/state")); return; } catch { /* repli local */ }
    }
  }
  // Hors de Claude : la section « Compte & synchronisation » est toujours visible.
  $("accountGroup").hidden = false;
  const { cfg, error } = await firebaseConfig();
  if (cfg) { await initFirebase(cfg); return; }
  fbStatus = error ? "invalid" : "none";
  renderAccount(null);
  setSync("local");
}
function connectRemote(ref) {
  disconnectRemote();
  docRef = ref;
  remoteReady = false;
  setSync("connexion…");
  unsubRemote = docRef.onSnapshot(onRemoteSnapshot, () => setSync("hors ligne"));
}
function disconnectRemote() {
  if (typeof unsubRemote === "function") unsubRemote();
  unsubRemote = null; docRef = null; remoteReady = false;
}

// ---------- Firebase (appli autonome)
// Ordre : configuration collée dans l'appli (par appareil), puis fichier firebase-config.js.
async function firebaseConfig() {
  if (window.__SABLIER_FIREBASE_CONFIG) return { cfg: window.__SABLIER_FIREBASE_CONFIG };
  try { const saved = JSON.parse(localStorage.getItem(FB_KEY)); if (saved && saved.apiKey) return { cfg: saved }; } catch { /* rien d'enregistré */ }
  try {
    const m = await import("./firebase-config.js");
    const cfg = m.default || m.firebaseConfig || null;
    if (cfg && !(cfg.apiKey && cfg.projectId)) return { cfg: null, error: true };
    return { cfg };
  } catch { return { cfg: null, error: true }; }
}
async function initFirebase(cfg) {
  try { fb = window.__SABLIER_FIREBASE_MOCK || await import("./vendor/firebase.js"); } catch { setSync("local"); return; }
  let app, db;
  try {
    app = fb.initializeApp(cfg);
    fbAuth = fb.getAuth(app);
    db = fb.getFirestore(app);
  } catch { fbStatus = "invalid"; renderAccount(null); setSync("local"); return; }
  fbStatus = "ready";
  fb.onAuthStateChanged(fbAuth, (user) => {
    fbUser = user;
    renderAccount(user);
    if (user) {
      closeAuth();
      const ref = fb.doc(db, "users", user.uid);
      connectRemote({ onSnapshot: (next, err) => fb.onSnapshot(ref, next, err), set: (data) => fb.setDoc(ref, data) });
    } else {
      disconnectRemote();
      setSync("local");
      if (!authSkipped) openAuth();
    }
  });
}
const AUTH_ERRORS = {
  "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
  "auth/wrong-password": "E-mail ou mot de passe incorrect.",
  "auth/user-not-found": "E-mail ou mot de passe incorrect.",
  "auth/invalid-email": "Adresse e-mail invalide.",
  "auth/email-already-in-use": "Un compte existe déjà avec cet e-mail : connecte-toi.",
  "auth/weak-password": "Mot de passe trop court (6 caractères minimum).",
  "auth/missing-password": "Saisis un mot de passe.",
  "auth/network-request-failed": "Pas de connexion réseau.",
  "auth/too-many-requests": "Trop d'essais : réessaie dans quelques minutes.",
};
function openAuth() { $("authError").hidden = true; $("authSheet").hidden = false; }
function closeAuth() { $("authSheet").hidden = true; }
async function authAction(kind) {
  const email = $("authEmail").value.trim(), pw = $("authPassword").value;
  $("authError").hidden = true;
  try {
    if (kind === "create") await fb.createUserWithEmailAndPassword(fbAuth, email, pw);
    else await fb.signInWithEmailAndPassword(fbAuth, email, pw);
  } catch (e) {
    $("authError").textContent = AUTH_ERRORS[e && e.code] || "Connexion impossible pour le moment.";
    $("authError").hidden = false;
  }
}
function renderAccount(user) {
  const msg = user ? user.email
    : fbStatus === "none" ? "Synchronisation non configurée — tes données restent sur cet appareil."
    : fbStatus === "invalid" ? "Configuration Firebase invalide (firebase-config.js). Colle-la avec « Configurer Firebase »."
    : "Non connectée — données sur cet appareil seulement.";
  $("accountEmail").textContent = msg;
  $("signOut").hidden = !user;
  $("signIn").hidden = !!user || fbStatus !== "ready";
  $("fbSetup").textContent = fbStatus === "ready" ? "Changer la configuration" : "Configurer Firebase";
}
// Coller la configuration Firebase dans l'appli (pas besoin de modifier le code).
$("fbSetup").addEventListener("click", () => {
  closeSheets();
  let saved = null;
  try { saved = localStorage.getItem(FB_KEY); } catch { /* indisponible */ }
  $("fbConfigText").value = "";
  $("fbConfigError").hidden = true;
  $("fbConfigClear").hidden = !saved;
  $("fbConfigSheet").hidden = false;
  $("fbConfigText").focus();
});
$("fbConfigClose").addEventListener("click", () => { $("fbConfigSheet").hidden = true; });
$("fbConfigSave").addEventListener("click", async () => {
  const cfg = C.parseFirebaseConfig($("fbConfigText").value);
  if (!cfg) { $("fbConfigError").hidden = false; return; }
  try { localStorage.setItem(FB_KEY, JSON.stringify(cfg)); } catch { /* indisponible */ }
  $("fbConfigSheet").hidden = true;
  if (fb && fbAuth) { location.reload(); return; } // une autre configuration était active
  authSkipped = false;
  await initFirebase(cfg);
});
$("fbConfigClear").addEventListener("click", () => { try { localStorage.removeItem(FB_KEY); } catch { /* indisponible */ } location.reload(); });
$("syncNote").addEventListener("click", () => {
  if (fbStatus === "ready" && !fbUser) { authSkipped = false; openAuth(); }
  else if (fbStatus !== "claude") go("settings");
});
$("authLogin").addEventListener("click", () => authAction("login"));
$("authCreate").addEventListener("click", () => authAction("create"));
$("authPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); authAction("login"); } });
$("authSkip").addEventListener("click", () => { authSkipped = true; closeAuth(); });
$("signOut").addEventListener("click", () => { authSkipped = true; if (fb && fbAuth) fb.signOut(fbAuth); });
$("signIn").addEventListener("click", () => { authSkipped = false; openAuth(); });

function onRemoteSnapshot(snap) {
  const first = !remoteReady;
  remoteReady = true;
  setSync("synchronisé");
  const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
  if (!exists) { if (state.updatedAtMs > 0) scheduleRemote(0); return; }
  const remote = C.normalizeState(snap.data());
  if (C.shouldApplyRemote(state, remote, clientId)) {
    state = remote;
    saveLocal();
    render();
  } else if (first && state.updatedAtMs > remote.updatedAtMs) {
    scheduleRemote(0);
  }
}
function scheduleRemote(delay = 400) {
  if (!docRef || !remoteReady) return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushRemote, delay);
}
async function flushRemote() {
  if (!docRef) return;
  if (writing) { writeQueued = true; return; }
  writing = true;
  try {
    await docRef.set(JSON.parse(JSON.stringify(state)));
    setSync("synchronisé");
  } catch (e) {
    setSync(e && e.code === "invalid_argument" ? "lecture seule" : "non synchronisé");
  } finally {
    writing = false;
    if (writeQueued) { writeQueued = false; flushRemote(); }
  }
}
function setSync(text) { $("syncNote").textContent = text; }

// ------------------------------------------------------------ navigation
function viewFromHash() {
  const h = location.hash.replace("#", "");
  return VIEWS.includes(h) ? h : "list";
}
function go(v) {
  view = VIEWS.includes(v) ? v : "list";
  if (location.hash.replace("#", "") !== view) {
    try { history.replaceState(null, "", "#" + view); } catch { /* ignore */ }
  }
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae.blur) ae.blur();
  render();
  $("main").scrollTop = 0;
}
window.addEventListener("hashchange", () => { const v = viewFromHash(); if (v !== view) go(v); });

// ------------------------------------------------------------ rendu
function render() {
  if (view === "focus" && !C.activeTask(state, cur().id)) view = "list";
  if (view === "routine-edit" && !draft) view = "routines";
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.accent = state.settings.accent;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", getComputedStyle(document.body).backgroundColor);
  for (const [v, id] of Object.entries(SECTIONS)) $(id).hidden = view !== v;
  $("listBarWrap").hidden = view !== "list";
  $("tabbar").hidden = view === "focus" || view === "routine-edit";
  const tabView = view === "routine-edit" ? "routines" : view;
  document.querySelectorAll("#tabbar button").forEach((b) => { if (b.dataset.tab === tabView) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  renderListBar();
  renderQueue();
  renderListDone();
  renderLater();
  renderDone();
  renderRoutines();
  renderSettings();
  tick(true);
  syncAlarms(state, now());
}

function renderListBar() {
  const id = cur().id;
  $("listBar").innerHTML = state.lists.map((l) =>
    `<button class="list-chip" data-list="${esc(l.id)}" aria-pressed="${l.id === id}"><span class="dot"></span><span class="chip-name">${esc(l.name)}</span><span class="chip-time"></span></button>`
  ).join("");
  const active = $("listBar").querySelector('[aria-pressed="true"]');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  updateArrows();
  updateArrows(); // l'apparition d'une flèche change la largeur disponible
}

function queueCard(t, i, n, minIdx) {
  const idx = i + 1; // position dans la liste (la tête est sur la carte « Maintenant »)
  const act = (action, ic, label, cls = "") => `<button data-action="${action}" class="${cls}" title="${label}">${icon(ic)}<span>${label}</span></button>`;
  return `<li class="task-card" data-id="${esc(t.id)}">
  <span class="task-eta"></span>
  <div class="move-col">
    <button data-action="top" title="Tout en haut" aria-label="Tout en haut"${idx <= minIdx ? " disabled" : ""}>${icon("top")}</button>
    <button data-action="up" title="Monter" aria-label="Monter"${idx <= minIdx ? " disabled" : ""}>${icon("up")}</button>
    <button data-action="down" title="Descendre" aria-label="Descendre"${idx >= n - 1 ? " disabled" : ""}>${icon("down")}</button>
    <button data-action="bottom" title="Tout en bas" aria-label="Tout en bas"${idx >= n - 1 ? " disabled" : ""}>${icon("bottom")}</button>
  </div>
  <div class="task-body">
    <div class="task-row">
      <span class="task-emoji drag-handle" data-action="drag" title="Glisser pour réordonner" aria-label="Position ${i + 2} — glisser pour réordonner">${esc(t.emoji)}</span>
      <div class="task-main">
        <input class="task-title" data-field="title" value="${esc(t.title)}" aria-label="Titre">
        <div class="task-meta">
          <label class="dur"><input class="task-minutes" data-field="minutes" type="number" inputmode="numeric" min="1" max="600" value="${Math.round(t.minutes)}" aria-label="Durée prévue en minutes"><span>min</span></label>
          <span class="task-timer"></span>
          <button class="mini-reset" data-action="reset" title="Remettre le temps à zéro" aria-label="Remettre le temps à zéro" hidden>${icon("reset")}</button>
        </div>
      </div>
      <button class="play-mini" data-action="play" aria-label="Démarrer cette tâche" title="Démarrer">${icon("play")}</button>
    </div>
    <div class="quick-acts">
      ${act("later", "later", "Plus tard")}${act("complete", "check", "Fait", "ok")}${act("delete", "trash", "Suppr.", "danger")}${act("menu", "edit", "Modifier")}
    </div>
  </div>
</li>`;
}

// Jalon « Fin voulue » : placé juste après la tâche qui porte l'heure (ou en fin de liste).
function milestoneItem(l, carrierId, ms) {
  const i = carrierId ? l.tasks.findIndex((t) => t.id === carrierId) : l.tasks.length - 1;
  const hasMs = (j) => j >= 0 && j < l.tasks.length && Number.isFinite(l.tasks[j].finishByMs);
  const upOk = carrierId ? i > 0 && !hasMs(i - 1) : l.tasks.length > 0 && !hasMs(l.tasks.length - 1);
  const downOk = !!carrierId && i < l.tasks.length - 1 && !hasMs(i + 1);
  return `<li class="milestone" data-task="${esc(carrierId || "")}">
  <button type="button" class="ms-main" title="Toucher pour changer l'heure, glisser pour déplacer">
    ${icon("flag")}<span class="ms-time">Fin voulue <b>${C.fmtClock(ms)}</b></span><span class="ms-info"></span>
  </button>
  <span class="ms-move">
    <button type="button" data-ms="up" aria-label="Monter le jalon"${upOk ? "" : " disabled"}>${icon("up")}</button>
    <button type="button" data-ms="down" aria-label="Descendre le jalon"${downOk ? "" : " disabled"}>${icon("down")}</button>
  </span>
</li>`;
}
function renderQueue() {
  const el = $("taskList");
  const ae = document.activeElement;
  if (drag || (ae && ae.tagName === "INPUT" && el.contains(ae))) { renderPending = true; return; }
  renderPending = false;
  const l = cur();
  const tasks = l.tasks;
  const minIdx = l.active ? 1 : 0;
  const parts = [];
  if (tasks[0] && Number.isFinite(tasks[0].finishByMs)) parts.push(milestoneItem(l, tasks[0].id, tasks[0].finishByMs));
  tasks.slice(1).forEach((t, i) => {
    parts.push(queueCard(t, i, tasks.length, minIdx));
    if (Number.isFinite(t.finishByMs)) parts.push(milestoneItem(l, t.id, t.finishByMs));
  });
  if (Number.isFinite(l.finishByMs) && tasks.length) parts.push(milestoneItem(l, null, l.finishByMs));
  el.innerHTML = parts.join("");
  $("queueTitle").hidden = parts.length === 0;
  $("listEmpty").hidden = tasks.length > 0;
  $("addDeadline").hidden = tasks.length === 0;
}

function renderListDone() {
  const items = C.doneForList(state, cur().id);
  const show = state.settings.showDone;
  const tg = $("doneToggle");
  tg.hidden = items.length === 0;
  tg.textContent = `${show ? "▾" : "▸"} Terminées (${items.length})`;
  tg.setAttribute("aria-expanded", String(show));
  $("listDone").innerHTML = show ? items.map((t) => row({
    id: t.id, cls: "list-done-row", emoji: t.emoji, title: t.title,
    sub: `réel ${t.spentSec ? fmtSpent(t.spentSec) : "—"} · estimé ${C.fmtDuration(t.minutes)}`,
    actionsHtml: textBtn("restore", "↺ Remettre"),
  })).join("") : "";
}

function updateArrows() {
  const bar = $("listBar");
  const overflow = bar.scrollWidth > bar.clientWidth + 2;
  $("listPrev").hidden = !overflow || bar.scrollLeft <= 2;
  $("listNext").hidden = !overflow || bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2;
}

function row({ id, cls, emoji, title, sub, actionsHtml }) {
  return `<div class="row ${cls}" data-id="${esc(id)}">
  <div class="row-info"><span class="row-emoji">${esc(emoji)}</span>
    <div class="row-text"><span class="row-title">${esc(title)}</span><span class="row-sub">${esc(sub)}</span></div></div>
  <div class="row-actions">${actionsHtml}</div>
</div>`;
}
const textBtn = (action, label, danger) => `<button class="text-btn${danger ? " danger" : ""}" data-action="${action}">${label}</button>`;

function renderLater() {
  $("laterList").innerHTML = state.later.map((t) => row({
    id: t.id, cls: "later-row", emoji: t.emoji, title: t.title, sub: C.fmtDuration(t.minutes),
    actionsHtml: textBtn("reactivate", "Réactiver") + textBtn("delete-later", "Suppr.", true),
  })).join("");
  $("laterEmpty").hidden = state.later.length > 0;
}

function renderDone() {
  $("doneList").innerHTML = state.done.map((t) => row({
    id: t.id, cls: "done-row", emoji: t.emoji, title: t.title,
    sub: `${t.listName} · réel ${t.spentSec ? fmtSpent(t.spentSec) : "—"} · estimé ${C.fmtDuration(t.minutes)}`,
    actionsHtml: textBtn("reopen", "Rouvrir"),
  })).join("");
  const st = C.doneStats(state);
  $("doneStats").textContent = st.count ? `${plural(st.count, "tâche")} · ${fmtSpent(st.spentSec)} passées (estimé ${C.fmtDuration(Math.round(st.estimatedSec / 60))})` : "";
  $("doneEmpty").hidden = st.count > 0;
  $("clearDone").hidden = st.count === 0;
}

function renderRoutines() {
  $("routineList").innerHTML = state.routines.map((r) => row({
    id: r.id, cls: "routine-row", emoji: "🔁", title: r.name,
    sub: `${plural(r.items.length, "étape")} · ${C.fmtDuration(r.items.reduce((a, it) => a + it.minutes, 0))}${(() => { const w = C.routineWindow(r); return w ? ` · ${w.start} → ${w.end}` : ""; })()}`,
    actionsHtml: `<button class="pill-btn" data-action="launch">▶ Lancer</button>` + textBtn("edit", "Modifier") + `<button class="icon-btn" data-action="more" aria-label="Plus d'actions">${icon("more")}</button>`,
  })).join("");
  $("routineEmpty").hidden = state.routines.length > 0;
}

function renderSettings() {
  const s = state.settings;
  $("setSound").checked = s.sound;
  $("setAuto").checked = s.autoStartNext;
  $("setShowDone").checked = s.showDone;
  $("setAutoAdvance").checked = s.autoAdvance;
  $("setClock").value = s.clockStyle;
  $("setSoundType").value = s.soundType;
  $("setRoutineInsert").value = s.routineInsert;
  $("setAccent").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.accent === s.accent)));
  if (document.activeElement !== $("setDefault")) $("setDefault").value = s.defaultMinutes;
  $("setTheme").value = s.theme;
}

// ------------------------------------------------------------ mise à jour fréquente
function tick(fromRender) {
  const t = now();
  if (!fromRender) {
    const a = C.advanceTimeUp(state, t);
    if (a.completed.length) {
      const find = (id) => state.lists.flatMap((l) => l.tasks).find((x) => x.id === id);
      const msgs = a.completed.map((c) => `✓ « ${(find(c.taskId) || {}).title || ""} » terminée`);
      const cleared = a.completed.map((c) => c.listId).filter((id, i, arr) => arr.indexOf(id) === i)
        .map((id) => C.getList(state, id)).filter((l) => l && C.isListCleared(a.state, l.id));
      commit(a.state);
      cleared.forEach((l) => celebrate(l.name));
      showToast(msgs.join(" · "), false);
      a.completed.forEach(onTimeUp);
      return;
    }
    const r = C.checkTimeUp(state, t);
    if (r.fired.length) {
      const msgs = r.fired.map((f) => {
        const l = C.getList(r.state, f.listId);
        const task = l && l.tasks.find((x) => x.id === f.taskId);
        return `⏰ ${l ? l.name : ""} — « ${task ? task.title : ""} » : temps écoulé`;
      });
      commit(r.state);
      showToast(msgs.join(" · "), false);
      r.fired.forEach(onTimeUp);
      return;
    }
  }
  const list = cur();
  const pl = C.plan(state, list.id, t);
  const slotOf = (id) => pl.tasks.find((x) => x.taskId === id);

  // récapitulatif (temps ajusté par les heures limites)
  const tot = C.totals(state, list.id, t);
  const remAdj = pl.tasks.reduce((a, x) => a + Math.max(0, x.adjustedSec), 0);
  setText($("listRemaining"), C.fmtDuration(Math.round(remAdj / 60)));
  const last = pl.tasks[pl.tasks.length - 1];
  setText($("listFinish"), last ? C.fmtClock(last.endAtMs) : "—:—");
  const lastSeg = pl.segments[pl.segments.length - 1];
  $("listWanted").hidden = !lastSeg;
  if (lastSeg) {
    setText($("listWanted"), `voulue ${C.fmtClock(lastSeg.deadlineAtMs)}`);
    $("listWanted").classList.toggle("late", pl.segments.some((g) => g.late));
  }
  setText($("listCount"), String(tot.count));
  setText($("listCountLbl"), tot.count > 1 ? "tâches" : "tâche");
  $("listProgress").querySelector(".bar").style.width = (tot.progress * 100).toFixed(1) + "%";
  $("listProgress").setAttribute("aria-valuenow", String(Math.round(tot.progress * 100)));

  // carte « Maintenant »
  const head = list.tasks[0];
  $("nowCard").hidden = !head;
  if (head) {
    const isAct = !!(list.active && list.active.taskId === head.id);
    const running = isAct && C.isRunning(state, list.id);
    const slot = slotOf(head.id);
    const rem = slot ? C.shownSec(slot.adjustedSec) : C.remainingSec(state, head.id, t);
    const budget = slot ? slot.budgetSec : head.minutes * 60;
    const el = C.elapsedSec(state, head.id, t);
    const card = $("nowCard");
    card.dataset.taskId = head.id;
    card.classList.toggle("is-running", running);
    card.classList.toggle("is-paused", isAct && !running);
    card.classList.toggle("overtime", isAct && rem < 0);
    setText($("nowLabel"), !isAct ? "Prochaine" : rem <= 0 ? "Temps écoulé" : running ? "En cours" : "En pause");
    setText($("nowEmoji"), head.emoji);
    setText($("nowTitle"), head.title);
    const squeezed = slot && slot.factor < 0.9995;
    setText($("nowPlanned"), squeezed ? `prévu ${C.fmtDuration(head.minutes)} · ajusté ${C.fmtDuration(Math.max(0, Math.round(budget / 60)))}` : `prévu ${C.fmtDuration(head.minutes)}`);
    setText($("nowInfo"), el > 0 ? `${fmtSpent(el)} passées` : "");
    $("nowReset").hidden = el <= 0;
    setText($("nowEta"), slot ? `fin ≈ ${C.fmtClock(slot.endAtMs)}` : "");
    const style = state.settings.clockStyle;
    const mc = $("nowClock");
    $("nowClockBox").className = `clock-box ${style}`;
    mc.setAttribute("class", `clock-svg ${style}`);
    mc.style.display = style === "digital" ? "none" : "";
    $("nowProgress").hidden = style !== "digital";
    if (style === "ring") {
      const frac = rem > 0 && budget > 0 ? Math.min(1, rem / budget) : 0;
      const RC = 2 * Math.PI * 108;
      $("miniRing").style.strokeDasharray = RC.toFixed(2);
      $("miniRing").style.strokeDashoffset = (RC * (1 - frac)).toFixed(2);
    } else if (style === "pie") setDial($("miniPie"), rem);
    const txt = C.fmtTimer(rem);
    setText($("nowTimer"), txt);
    $("nowTimer").setAttribute("aria-label", `Temps restant ${txt} — modifier`);
    $("nowTimer").classList.toggle("long", txt.length > 5);
    $("nowProgress").querySelector(".bar").style.width = (budget > 0 ? Math.min(1, Math.max(0, 1 - rem / budget)) * 100 : 100).toFixed(1) + "%";
    setButton($("nowToggle"), running ? "pause" : "play", running ? "Pause" : isAct ? "Reprendre" : "Démarrer");
  }

  // file « À suivre » : temps restant des tâches entamées, créneau et durée ajustée
  document.querySelectorAll("#taskList .task-card").forEach((li) => {
    const task = list.tasks.find((x) => x.id === li.dataset.id);
    if (!task) return;
    const slot = slotOf(task.id);
    setText(li.querySelector(".task-timer"), task.spentSec > 0 ? C.fmtTimer(slot ? C.shownSec(slot.adjustedSec) : C.remainingSec(state, task.id, t)) : "");
    const rb = li.querySelector(".mini-reset");
    if (rb && rb.hidden !== !(task.spentSec > 0)) rb.hidden = !(task.spentSec > 0);
    setText(li.querySelector(".task-eta"), slot ? `${C.fmtClock(slot.startAtMs)} → ${C.fmtClock(slot.endAtMs)}` : "");
    const squeezed = !!slot && slot.factor < 0.9995;
    li.classList.toggle("compressed", squeezed);
    let adj = li.querySelector(".adj");
    if (squeezed && !adj) {
      adj = document.createElement("span");
      adj.className = "adj";
      li.querySelector(".dur").after(adj);
    } else if (!squeezed && adj) { adj.remove(); adj = null; }
    if (adj) setText(adj, C.fmtDuration(Math.max(0, Math.round(slot.budgetSec / 60))));
  });
  // jalons : prévu, disponible, écart
  document.querySelectorAll("#taskList .milestone").forEach((li) => {
    const carrier = li.dataset.task;
    const endIdx = carrier ? list.tasks.findIndex((x) => x.id === carrier) : list.tasks.length - 1;
    const seg = pl.segments.find((g) => g.endIndex === endIdx);
    if (!seg) return;
    li.classList.toggle("late", seg.late);
    li.classList.toggle("squeezed", seg.factor < 0.9995);
    const info = seg.late ? "heure dépassée"
      : seg.factor < 0.9995 ? `${C.fmtDuration(Math.round(seg.plannedSec / 60))} prévues · ${C.fmtDuration(Math.round(seg.availableSec / 60))} dispo · −${Math.round((1 - seg.factor) * 100)} %`
      : `dans les temps · marge ${C.fmtDuration(Math.max(0, Math.round((seg.availableSec - seg.plannedSec) / 60)))}`;
    setText(li.querySelector(".ms-info"), info);
  });

  // pastilles
  document.querySelectorAll("#listBar .list-chip").forEach((chip) => {
    const l = C.getList(state, chip.dataset.list);
    const a = l && C.activeTask(state, l.id);
    const running = !!a && C.isRunning(state, l.id);
    const rem = a ? C.effectiveRemainingSec(state, a.id, t) : 0;
    chip.classList.toggle("running", running);
    chip.classList.toggle("paused", !!a && !running);
    chip.classList.toggle("overtime", !!a && rem < 0);
    setText(chip.querySelector(".chip-time"), a ? C.fmtTimer(rem) : "");
  });

  if (view === "focus") renderFocus(list, t);
  document.title = C.tabTitle(state, t);
}

function renderFocus(list, t) {
  const act = C.activeTask(state, list.id);
  if (!act) return;
  const running = C.isRunning(state, list.id);
  const slot = C.plan(state, list.id, t).tasks.find((x) => x.taskId === act.id);
  const rem = slot ? C.shownSec(slot.adjustedSec) : C.remainingSec(state, act.id, t);
  const budget = slot ? slot.budgetSec : act.minutes * 60;
  setText($("focusList"), list.name);
  $("focusReset").hidden = C.elapsedSec(state, act.id, t) <= 0;
  setText($("focusEmoji"), act.emoji);
  setText($("focusTitle"), act.title);
  setText($("focusTimer"), C.fmtTimer(rem));
  $("focusTimer").setAttribute("aria-label", `Temps restant ${C.fmtTimer(rem)} — modifier`);
  const frac = rem > 0 && budget > 0 ? Math.min(1, rem / budget) : 0;
  const style = state.settings.clockStyle;
  $("focusClock").className = `ring-wrap ${style}`;
  $("focusPie").toggleAttribute("hidden", style !== "pie");
  $("focusRingSvg").style.display = style === "ring" ? "" : "none";
  if (style === "pie") setDial($("pieWedge"), rem);
  $("focusTimer").classList.toggle("long", C.fmtTimer(rem).length > 5);
  const ring = $("ringProgress");
  ring.style.strokeDasharray = RING.toFixed(2);
  ring.style.strokeDashoffset = (RING * (1 - frac)).toFixed(2);
  $("viewFocus").classList.toggle("overtime", rem < 0);
  setButton($("focusToggle"), running ? "pause" : "play", running ? "Pause" : "Reprendre");
  setText($("focusState"), rem <= 0 ? "Temps écoulé — ajoute du temps ou termine" : running ? "En cours…" : "En pause");
  const nx = C.nextTask(state, list.id);
  setText($("focusNext"), nx ? `Ensuite : ${nx.emoji} ${nx.title}` : "Dernière tâche de la liste");
  $("focusSkip").disabled = list.tasks.length < 2;
}

// ------------------------------------------------------------ son & signaux
let audioCtx = null;
function unlockAudio() {
  if (audioCtx) return;
  try { const A = window.AudioContext || window.webkitAudioContext; if (A) audioCtx = new A(); } catch { audioCtx = null; }
}
// ------------------------------------------------------------ sons
// Synthèse additive (aucun fichier à charger) + légère réverbération.
// Note : { f: fréquence, at: départ (s), dur: durée (s), gain, p: [[rapport, gain relatif, facteur de durée]] }
// Une ou deux notes par son, rien au-dessus de 3 kHz, filtre adoucissant les aigus, signal identique à gauche et à droite.
const BELL = [[0.5, 0.16, 1.2], [1, 1, 1], [1.183, 0.28, 0.7], [1.506, 0.18, 0.6], [2, 0.22, 0.5], [2.514, 0.08, 0.35], [3.011, 0.05, 0.25]];
const SOFT = [[1, 1, 1], [2, 0.2, 0.6], [3, 0.05, 0.35]];
const WOOD = [[1, 1, 1], [3.93, 0.18, 0.2]];
const PLUCK = [[1, 1, 1], [2, 0.35, 0.55], [3, 0.12, 0.35]];
const SOUND_DEFS = {
  chime: { level: 1.35, notes: [{ f: 659, at: 0, dur: 1.8, gain: 0.3, p: SOFT }, { f: 988, at: 0.32, dur: 2.4, gain: 0.3, p: SOFT }] },
  bell: { level: 1, notes: [{ f: 880, at: 0, dur: 3, gain: 0.3, p: BELL }] },
  bowl: { level: 1, notes: [{ f: 523, at: 0, dur: 4, gain: 0.3, attack: 0.05, p: [[1, 1, 1], [1.004, 0.7, 1], [2.71, 0.28, 0.6], [5.15, 0.08, 0.35]] }] },
  marimba: { level: 1, notes: [{ f: 440, at: 0, dur: 1, gain: 0.42, p: WOOD }, { f: 659, at: 0.2, dur: 1.2, gain: 0.42, p: WOOD }] },
  harp: { level: 1, notes: [{ f: 523, at: 0, dur: 1.8, gain: 0.32, p: PLUCK }, { f: 784, at: 0.16, dur: 2.2, gain: 0.32, p: PLUCK }] },
};
function soundLength(type) { return Math.max(...SOUND_DEFS[type].notes.map((n) => n.at + n.dur)); }
function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) mono[i] = rnd() * Math.pow(1 - i / len, 3);
  buf.copyToChannel(mono, 0);
  buf.copyToChannel(mono, 1); // même réverbération des deux côtés : son centré
  return buf;
}
function soundChain(ctx) {
  const input = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver();
  const soften = ctx.createBiquadFilter(), master = ctx.createGain();
  soften.type = "lowpass"; soften.frequency.value = 3200; soften.Q.value = 0.5;
  dry.gain.value = 0.9; wet.gain.value = 0.18; master.gain.value = 0.55;
  conv.normalize = true; conv.buffer = impulse(ctx, 1.4);
  input.connect(soften);
  soften.connect(dry).connect(master);
  soften.connect(conv).connect(wet).connect(master);
  master.connect(ctx.destination);
  return input;
}
function scheduleSound(ctx, dest, type, t0) {
  const def = SOUND_DEFS[type] || SOUND_DEFS.chime;
  const out = ctx.createGain();
  out.gain.value = def.level;
  out.connect(dest);
  for (const n of def.notes) {
    for (const [ratio, g, dk] of n.p) {
      const o = ctx.createOscillator(), env = ctx.createGain();
      const start = t0 + n.at, d = n.dur * dk, atk = n.attack || 0.006;
      o.type = "sine";
      o.frequency.value = n.f * ratio;
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(n.gain * g, start + atk);
      env.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(atk + 0.05, d));
      o.connect(env).connect(out);
      o.start(start);
      o.stop(start + d + 0.1);
    }
  }
}
let liveChain = null;
function playSound(type) {
  window.__sablierLastSound = type;
  if (!audioCtx) return;
  try {
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (!liveChain) liveChain = soundChain(audioCtx);
    scheduleSound(audioCtx, liveChain, type, audioCtx.currentTime + 0.03);
  } catch { /* son indisponible */ }
}
// Outils de vérification (utilisés par les tests).
window.__sablierSoundStats = () => Object.fromEntries(Object.entries(SOUND_DEFS).map(([k, def]) => {
  const counts = {};
  def.notes.forEach((n) => { counts[n.f] = (counts[n.f] || 0) + 1; });
  return [k, {
    minFreq: Math.min(...def.notes.flatMap((n) => n.p.map(([r]) => n.f * r))),
    maxFreq: Math.round(Math.max(...def.notes.flatMap((n) => n.p.map(([r]) => n.f * r)))),
    notes: def.notes.length,
    maxRepeat: Math.max(...Object.values(counts)),
    duration: Math.round(soundLength(k) * 100) / 100,
  }];
}));
async function renderSound(k) {
  const ctx = new OfflineAudioContext(2, Math.ceil(44100 * (soundLength(k) + 1.5)), 44100);
  scheduleSound(ctx, soundChain(ctx), k, 0.01);
  return ctx.startRendering();
}
window.__sablierRenderBalance = async () => {
  const out = {};
  for (const k of Object.keys(SOUND_DEFS)) {
    const buf = await renderSound(k);
    const rms = (ch) => { const d = buf.getChannelData(ch); let a = 0; for (const v of d) a += v * v; return Math.sqrt(a / d.length); };
    out[k] = { left: Math.round(rms(0) * 1e5) / 1e5, right: Math.round(rms(1) * 1e5) / 1e5 };
  }
  return out;
};
window.__sablierRenderPeaks = async () => {
  const out = {};
  for (const k of Object.keys(SOUND_DEFS)) {
    const ctx = new OfflineAudioContext(2, Math.ceil(44100 * (soundLength(k) + 1.7)), 44100);
    scheduleSound(ctx, soundChain(ctx), k, 0.01);
    const buf = await ctx.startRendering();
    let peak = 0;
    for (let ch = 0; ch < 2; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
    out[k] = Math.round(peak * 1000) / 1000;
  }
  return out;
};
function onTimeUp() {
  window.__sablierChimes++;
  if (state.settings.sound) playSound(state.settings.soundType);
  document.body.classList.add("timeup");
  setTimeout(() => document.body.classList.remove("timeup"), 3200);
}
function celebrate(listName) {
  const box = $("celebrate");
  $("celebrateTitle").textContent = "Liste terminée !";
  $("celebrateSub").textContent = listName;
  box.querySelectorAll(".confetti").forEach((c) => c.remove());
  const ac = ACCENT_COLORS[state.settings.accent] || ACCENT_COLORS.green;
  const colors = [ac[0], ac[2], "#D9A752", "#E1897C", "#7AA7E0"];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement("span");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "%";
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = (Math.random() * 0.8).toFixed(2) + "s";
    box.appendChild(c);
  }
  box.hidden = false;
  setTimeout(() => { box.hidden = true; }, 3500);
}

// ------------------------------------------------------------ toast / fenêtres
function showToast(msg, withUndo) {
  $("toastMsg").textContent = msg;
  $("toastUndo").hidden = !withUndo;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; undoState = null; }, withUndo ? 6000 : 5000);
}
const SHEETS = ["taskSheet", "listSheet", "routineMenu", "confirmSheet", "dataSheet", "deadlineSheet", "launchSheet", "shortcutsSheet"];
let sheetReturnFocus = null;
// Fenêtres accessibles : le focus entre dans la fenêtre, y reste (Tab boucle), et revient d'où il venait.
function openSheet(id) {
  const ae = document.activeElement;
  if (!anySheetOpen()) sheetReturnFocus = ae && ae !== document.body ? ae : null;
  $(id).hidden = false;
  const first = $(id).querySelector("input:not([type=hidden]):not([disabled]), textarea, select, button:not([disabled]):not(.icon-btn)") || $(id).querySelector("button");
  if (first && !$(id).contains(document.activeElement)) first.focus({ preventScroll: true });
}
function closeSheets() {
  const wasOpen = anySheetOpen();
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest(".scrim")) ae.blur(); // sinon le champ masqué garde le clavier
  SHEETS.forEach((id) => { $(id).hidden = true; });
  confirmAction = null; sheetTaskId = null; routineMenuId = null; dlCarrier = undefined; launchRoutineId = null;
  if (wasOpen && sheetReturnFocus && document.contains(sheetReturnFocus) && sheetReturnFocus.offsetParent !== null) sheetReturnFocus.focus({ preventScroll: true });
  sheetReturnFocus = null;
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !anySheetOpen()) return;
  const sh = SHEETS.map($).find((x) => !x.hidden);
  const f = [...sh.querySelectorAll("button, input, select, textarea, [tabindex]")].filter((x) => !x.disabled && x.offsetParent !== null && x.tabIndex >= 0);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
});
const anySheetOpen = () => SHEETS.some((id) => !$(id).hidden);
function askConfirm(message, okLabel, action) {
  closeSheets();
  $("confirmMsg").textContent = message;
  $("confirmOk").textContent = okLabel;
  confirmAction = action;
  openSheet("confirmSheet");
  $("confirmOk").focus();
}
document.querySelectorAll(".scrim").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s) closeSheets(); }));
$("confirmOk").addEventListener("click", () => { const a = confirmAction; closeSheets(); if (a) a(); });
$("confirmCancel").addEventListener("click", closeSheets);
$("toastUndo").addEventListener("click", () => {
  if (undoState) { const prev = undoState; undoState = null; commit(prev); }
  $("toast").hidden = true;
});

// ------------------------------------------------------------ actions minuteur
function toggleList(listId) { unlockAudio(); commit(C.toggleTimer(state, listId, now())); }
function completeIn(listId, taskId) {
  const l = C.getList(state, listId);
  const id = taskId || (l && l.active && l.active.taskId);
  const t = l && l.tasks.find((x) => x.id === id);
  if (!t) return;
  commit(C.completeTask(state, listId, now(), t.id), { undoable: true, toast: `« ${t.title} » terminée`, celebrateList: listId });
}

// carte « Maintenant »
$("nowToggle").addEventListener("click", () => toggleList(cur().id));
$("nowDone").addEventListener("click", () => { const h = cur().tasks[0]; if (h) completeIn(cur().id, h.id); });
$("nowFocus").addEventListener("click", () => {
  if (!C.activeTask(state, cur().id)) { unlockAudio(); commit(C.startTask(state, cur().id, null, now())); }
  go("focus");
});
// Sous une heure limite, on règle le temps AFFICHÉ (ajusté) ; les autres tâches du tronçon s'adaptent.
function hasDeadline(l) { return Number.isFinite(l.finishByMs) || l.tasks.some((x) => Number.isFinite(x.finishByMs)); }
function setShown(sec) {
  const l = cur();
  const r = C.setShownRemaining(state, l.id, sec, now());
  commit(r.state);
  if (r.capped) {
    const seg = C.plan(state, l.id, now()).segments[0];
    showToast(`Pas plus avant la fin voulue${seg ? " de " + C.fmtClock(seg.deadlineAtMs) : ""} : les tâches suivantes du tronçon n'ont plus de temps`, false);
  }
}
function adjustShown(deltaMin) {
  const l = cur();
  const head = C.activeTask(state, l.id) || l.tasks[0];
  if (!head) return;
  if (!hasDeadline(l)) { commit(C.adjustTime(state, l.id, deltaMin)); return; }
  setShown(Math.max(60, C.effectiveRemainingSec(state, head.id, now()) + deltaMin * 60));
}
$("nowMinus5").addEventListener("click", () => adjustShown(-5));
$("nowPlus5").addEventListener("click", () => adjustShown(5));
function resetTask(id) {
  if (id) commit(C.resetTime(state, id, now()), { undoable: true, toast: "Temps remis à zéro" });
}
$("nowReset").addEventListener("click", () => { const h = cur().tasks[0]; if (h) resetTask(h.id); });
$("focusReset").addEventListener("click", () => { const a = C.activeTask(state, cur().id); if (a) resetTask(a.id); });
$("nowLater").addEventListener("click", () => { const h = cur().tasks[0]; if (h) sendLater(h.id); });

function sendLater(id) {
  const t = listOf(id) && listOf(id).tasks.find((x) => x.id === id);
  if (t) commit(C.moveToLater(state, id, now()), { undoable: true, toast: `« ${t.title} » → Plus tard` });
}

// Cadran minuteur : 60 graduations, chiffres 0 à 55 dans le sens inverse des aiguilles (comme un Time Timer).
function buildDial(g) {
  const NS = "http://www.w3.org/2000/svg";
  for (let m = 0; m < 60; m++) {
    const a = (m / 60) * 2 * Math.PI, major = m % 5 === 0;
    const r1 = 95, r2 = major ? 83 : 89;
    const l = document.createElementNS(NS, "line");
    l.setAttribute("class", major ? "tick major" : "tick");
    l.setAttribute("x1", (120 - r1 * Math.sin(a)).toFixed(2)); l.setAttribute("y1", (120 - r1 * Math.cos(a)).toFixed(2));
    l.setAttribute("x2", (120 - r2 * Math.sin(a)).toFixed(2)); l.setAttribute("y2", (120 - r2 * Math.cos(a)).toFixed(2));
    g.appendChild(l);
  }
  for (let m = 0; m < 60; m += 5) {
    const a = (m / 60) * 2 * Math.PI;
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", "dial-num");
    t.setAttribute("x", (120 - 106 * Math.sin(a)).toFixed(2)); t.setAttribute("y", (120 - 106 * Math.cos(a)).toFixed(2));
    t.textContent = String(m);
    g.appendChild(t);
  }
}
document.querySelectorAll(".dial-marks").forEach(buildDial);
function setDial(path, remSec) {
  const f = C.dialFraction(remSec);
  path.setAttribute("d", C.piePath(f, 120, 120, 80));
  path.setAttribute("data-frac", String(Math.round(f * 1e4) / 1e4));
}

// Toucher le grand minuteur pour taper le temps restant (carte et focus).
function setupTimerEdit(displayId, wrapId, inputId, areaId) {
  const disp = $(displayId), wrap = $(wrapId), inp = $(inputId);
  let initial = "";
  const open = () => {
    if (!wrap.hidden) return;
    const l = cur();
    const head = C.activeTask(state, l.id) || l.tasks[0];
    if (!head) return;
    initial = C.fmtTimer(Math.max(0, C.effectiveRemainingSec(state, head.id, now())));
    inp.value = initial;
    disp.hidden = true;
    wrap.hidden = false;
    inp.focus();
    inp.select();
  };
  // N'applique que si la valeur a vraiment été modifiée : un toucher involontaire ne change rien.
  const close = (apply) => {
    if (wrap.hidden) return;
    const v = inp.value.trim();
    wrap.hidden = true;
    disp.hidden = false;
    if (!apply || v === initial) return;
    const sec = C.parseClock(v);
    if (sec === null) { showToast("Temps non reconnu — exemples : 20, 19:30", false); return; }
    setShown(sec);
  };
  disp.addEventListener("click", open);
  if (areaId) $(areaId).addEventListener("click", (e) => { if (!e.target.closest(".timer-input-wrap")) open(); });
  disp.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); open(); } });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); close(true); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
  });
  inp.addEventListener("blur", () => close(true));
}
setupTimerEdit("nowTimer", "nowTimerWrap", "nowTimerInput", "nowClock");
setupTimerEdit("focusTimer", "focusTimerWrap", "focusTimerInput", "focusClock");
$("nowMenu").addEventListener("click", () => { const h = cur().tasks[0]; if (h) openTaskSheet(h.id); });

// saisie rapide
function quickAdd(position) {
  const input = $("quickAdd");
  if (commit(C.addTask(state, cur().id, { title: input.value }, { position })) || !input.value.trim()) input.value = "";
  input.focus();
}
$("quickAddForm").addEventListener("submit", (e) => { e.preventDefault(); quickAdd("bottom"); });
$("quickAddTop").addEventListener("click", () => quickAdd("top"));
$("quickAdd").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); quickAdd("top"); } });

// file « À suivre »
$("taskList").addEventListener("click", (e) => {
  const mb = e.target.closest(".milestone button[data-ms]");
  if (mb) {
    const l = cur(), carrier = mb.closest(".milestone").dataset.task || null;
    const i = carrier ? l.tasks.findIndex((x) => x.id === carrier) : l.tasks.length;
    const to = l.tasks[i + (mb.dataset.ms === "up" ? -1 : 1)];
    if (to) commit(C.moveFinishBy(state, l.id, carrier, to.id));
    const again = document.querySelector(`#taskList .milestone[data-task="${to ? to.id : ""}"] [data-ms="${mb.dataset.ms}"]`);
    if (again && !again.disabled) again.focus(); else { const m = document.querySelector("#taskList .milestone .ms-main"); if (m) m.focus(); }
    return;
  }
  const mm = e.target.closest(".ms-main");
  if (mm) { if (e.detail === 0) openDeadline(mm.closest(".milestone").dataset.task || null); return; }
  const b = e.target.closest("button[data-action]");
  if (!b) return;
  const id = b.closest(".task-card").dataset.id;
  if (b.dataset.action === "play") { unlockAudio(); commit(C.startTask(state, cur().id, id, now())); }
  if (b.dataset.action === "menu") openTaskSheet(id);
  if (b.dataset.action === "top") commit(C.moveTaskToEdge(state, id, "top"));
  if (b.dataset.action === "bottom") commit(C.moveTaskToEdge(state, id, "bottom"));
  if (b.dataset.action === "up") commit(C.moveTask(state, id, -1));
  if (b.dataset.action === "reset") resetTask(id);
  if (b.dataset.action === "down") commit(C.moveTask(state, id, 1));
  if (b.dataset.action === "later") sendLater(id);
  if (b.dataset.action === "complete") completeIn(cur().id, id);
  if (b.dataset.action === "delete") {
    const t = cur().tasks.find((x) => x.id === id);
    if (t) commit(C.deleteTask(state, id), { undoable: true, toast: `« ${t.title} » supprimée` });
  }
});
$("taskList").addEventListener("change", (e) => {
  const el = e.target, field = el.dataset.field;
  if (!field) return;
  const id = el.closest(".task-card").dataset.id;
  commit(C.updateTask(state, id, { [field]: el.value }));
  const t = cur().tasks.find((x) => x.id === id);
  const shown = t && (field === "minutes" ? String(Math.round(t.minutes)) : t[field]);
  if (t && shown !== el.value) el.value = shown;
});
$("taskList").addEventListener("keydown", (e) => {
  const f = e.target.dataset.field;
  if (!f) return;
  if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
  if (e.key === "Escape") {
    const t = cur().tasks.find((x) => x.id === e.target.closest(".task-card").dataset.id);
    if (t) e.target.value = f === "minutes" ? Math.round(t.minutes) : t[f];
    e.target.blur();
    e.stopPropagation();
  }
});
$("taskList").addEventListener("focusout", () => { setTimeout(() => { if (renderPending) render(); }, 0); });

// glisser-déposer (souris, tactile, stylet)
$("taskList").addEventListener("pointerdown", (e) => {
  const h = e.target.closest(".drag-handle, .ms-main");
  if (!h) return;
  const li = h.closest(".task-card, .milestone");
  drag = { li, pointerId: e.pointerId, y0: e.clientY, moved: false };
  li.classList.add("dragging");
  try { h.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  e.preventDefault();
});
window.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.moved && Math.abs(e.clientY - drag.y0) < 6) return; // simple toucher, pas encore un glisser
  drag.moved = true;
  // défilement automatique près des bords pendant le glisser
  const mr = $("main").getBoundingClientRect();
  if (e.clientY < mr.top + 56) $("main").scrollTop -= 14;
  else if (e.clientY > mr.bottom - 56) $("main").scrollTop += 14;
  const hero = $("nowCard");
  const hr = hero.getBoundingClientRect();
  drag.promote = !drag.li.classList.contains("milestone") && !hero.hidden && e.clientY <= hr.bottom + 8;
  hero.classList.toggle("drop-target", drag.promote);
  if (drag.promote) return;
  const list = $("taskList");
  for (const sib of [...list.children].filter((x) => x !== drag.li)) {
    const r = sib.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { if (drag.li.nextSibling !== sib) list.insertBefore(drag.li, sib); return; }
  }
  if (list.lastElementChild !== drag.li) list.appendChild(drag.li);
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.pointerId)) return;
  const l = cur();
  const ids = (l.tasks[0] ? [l.tasks[0].id] : []).concat([...$("taskList").querySelectorAll(".task-card")].map((x) => x.dataset.id));
  const { li, promote, moved } = drag;
  li.classList.remove("dragging");
  $("nowCard").classList.remove("drop-target");
  drag = null;
  if (li.classList.contains("milestone")) {
    const from = li.dataset.task || null;
    if (!moved) { openDeadline(from); return; }
    let prev = li.previousElementSibling;
    while (prev && !prev.classList.contains("task-card")) prev = prev.previousElementSibling;
    const to = prev ? prev.dataset.id : l.tasks[0] && l.tasks[0].id;
    if (!to || !commit(C.moveFinishBy(state, l.id, from, to))) render();
    return;
  }
  if (!moved) { openTaskSheet(li.dataset.id, { emoji: true }); return; } // toucher l'emoji = le changer
  const next = promote ? C.promoteTask(state, l.id, li.dataset.id, now()) : C.reorderTasks(state, l.id, ids);
  if (!commit(next)) render();
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

// ------------------------------------------------------------ menu d'une tâche
// Sélecteur d'emoji : ≈ 1 800 emojis (données françaises chargées à la demande), catégories, recherche, récents.
const EMOJI_GROUPS = [[0, "😀", "Smileys"], [1, "🧑", "Personnes"], [3, "🐱", "Animaux et nature"], [4, "🍔", "Nourriture"],
  [5, "✈️", "Voyages et lieux"], [6, "⚽", "Activités"], [7, "💡", "Objets"], [8, "❤️", "Symboles"], [9, "🏁", "Drapeaux"]];
let emojiData = null, emojiLoading = null, emojiGroup = 7;
function loadEmojiData() {
  if (!emojiLoading) emojiLoading = fetch("vendor/emoji-fr.json").then((r) => r.json()).then((d) => (emojiData = d))
    .catch(() => (emojiData = EMOJI_CHOICES.map((e) => [e, "", "", 7])));
  return emojiLoading;
}
function recentEmoji() { try { return JSON.parse(localStorage.getItem("sablier.recentEmoji")) || []; } catch { return []; } }
function pushRecent(e) {
  const r = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 16);
  try { localStorage.setItem("sablier.recentEmoji", JSON.stringify(r)); } catch { /* stockage indisponible */ }
}
const emojiBtn = (e, label) => `<button type="button" class="emoji-opt${e === sheetEmoji ? " sel" : ""}" data-emoji="${esc(e)}" title="${esc(label || "")}" aria-label="${esc(label || e)}">${esc(e)}</button>`;
$("emojiCats").innerHTML = EMOJI_GROUPS.map(([g, e, name]) => `<button type="button" class="emoji-cat" data-group="${g}" role="tab" title="${name}" aria-label="${name}">${e}</button>`).join("");
function renderEmojiGrid() {
  const q = $("emojiSearch").value;
  $("emojiCats").querySelectorAll(".emoji-cat").forEach((b) => b.setAttribute("aria-selected", String(!q.trim() && +b.dataset.group === emojiGroup)));
  if (!emojiData) { $("emojiGrid").innerHTML = `<p class="emoji-empty">Chargement…</p>`; return; }
  const rows = q.trim() ? C.searchEmoji(emojiData, q).slice(0, 240) : emojiData.filter((r) => r[3] === emojiGroup);
  $("emojiGrid").innerHTML = rows.length ? rows.map((r) => emojiBtn(r[0], r[1])).join("") : `<p class="emoji-empty">Aucun emoji pour « ${esc(q)} »</p>`;
  $("emojiGrid").scrollTop = 0;
}
function renderRecent() {
  const r = recentEmoji();
  $("emojiRecentWrap").hidden = r.length === 0;
  $("emojiRecent").innerHTML = r.map((e) => emojiBtn(e)).join("");
}
function setSheetEmoji(e) {
  sheetEmoji = e;
  $("tsEmojiPreview").textContent = e;
  document.querySelectorAll("#taskSheet .emoji-opt").forEach((b) => b.classList.toggle("sel", b.dataset.emoji === e));
}
$("emojiCats").addEventListener("click", (e) => {
  const b = e.target.closest(".emoji-cat"); if (!b) return;
  emojiGroup = +b.dataset.group; $("emojiSearch").value = ""; renderEmojiGrid();
});
$("emojiSearch").addEventListener("input", renderEmojiGrid);
$("emojiSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const first = $("emojiGrid").querySelector(".emoji-opt"); if (first) setSheetEmoji(first.dataset.emoji); } });
for (const id of ["emojiGrid", "emojiRecent"]) {
  $(id).addEventListener("click", (e) => { const b = e.target.closest(".emoji-opt"); if (b) setSheetEmoji(b.dataset.emoji); });
}
function showPicker(show) {
  $("emojiPicker").hidden = !show;
  $("tsEmojiPreview").setAttribute("aria-expanded", String(show));
  if (show) { renderRecent(); renderEmojiGrid(); loadEmojiData().then(() => { if (!$("emojiPicker").hidden) renderEmojiGrid(); }); }
}
$("tsEmojiPreview").addEventListener("click", () => showPicker($("emojiPicker").hidden));
function openTaskSheet(id, { emoji = false } = {}) {
  const l = listOf(id);
  if (!l) return;
  const idx = l.tasks.findIndex((t) => t.id === id);
  const t = l.tasks[idx];
  closeSheets();
  sheetTaskId = id;
  $("tsTitle").value = t.title;
  $("tsMinutes").value = Math.round(t.minutes);
  $("tsFinishBy").value = Number.isFinite(t.finishByMs) ? C.fmtClock(t.finishByMs) : "";
  sheetEmoji = t.emoji;
  $("tsEmojiPreview").textContent = t.emoji;
  $("emojiSearch").value = "";
  const found = emojiData && emojiData.find((r) => r[0] === t.emoji);
  if (found) emojiGroup = found[3];
  loadEmojiData().then(() => { if (sheetTaskId === id) { const f = emojiData.find((r) => r[0] === t.emoji); if (f && !$("emojiSearch").value) emojiGroup = f[3]; if (!$("emojiPicker").hidden) renderEmojiGrid(); } });
  showPicker(emoji);
  const minIdx = l.active ? 1 : 0;
  // Supprimer n'est dans le menu que pour la tâche en tête (les autres ont le bouton sur leur carte).
  $("taskSheet").querySelector('[data-ts="delete"]').hidden = idx !== 0;
  const others = state.lists.filter((x) => x.id !== l.id);
  $("tsMove").hidden = others.length === 0;
  $("tsMove").innerHTML = others.length ? `<span>Déplacer vers</span>` + others.map((x) => `<button data-ts="move" data-list="${esc(x.id)}">${esc(x.name)}</button>`).join("") : "";
  openSheet("taskSheet");
}
$("tsEmojiAuto").addEventListener("click", () => setSheetEmoji(C.suggestEmoji($("tsTitle").value)));
$("nowEmoji").addEventListener("click", () => { const h = cur().tasks[0]; if (h) openTaskSheet(h.id, { emoji: true }); });
$("tsClose").addEventListener("click", closeSheets);
function saveTaskSheet() {
  const id = sheetTaskId;
  if (!id) return;
  const l = listOf(id), t = l && l.tasks.find((x) => x.id === id);
  const patch = { title: $("tsTitle").value, emoji: sheetEmoji };
  if (t && sheetEmoji !== t.emoji) pushRecent(sheetEmoji);
  if (!t || String(Math.round(t.minutes)) !== $("tsMinutes").value) patch.minutes = $("tsMinutes").value;
  const fb = $("tsFinishBy").value;
  const had = t && Number.isFinite(t.finishByMs) ? C.fmtClock(t.finishByMs) : "";
  closeSheets();
  let next = C.updateTask(state, id, patch);
  if (t && fb !== had) next = C.setTaskFinishBy(next, id, fb ? toDeadlineMs(fb) : null);
  commit(next);
}
$("tsSave").addEventListener("click", saveTaskSheet);
$("tsFinishClear").addEventListener("click", () => { $("tsFinishBy").value = ""; $("tsFinishBy").focus(); });
$("tsFinishBy").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveTaskSheet(); } });
[$("tsTitle"), $("tsMinutes")].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveTaskSheet(); } }));
$("taskSheet").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ts]");
  if (!b || !sheetTaskId) return;
  const id = sheetTaskId, l = listOf(id), t = l && l.tasks.find((x) => x.id === id);
  if (!t) return;
  closeSheets();
  switch (b.dataset.ts) {
    case "dup": commit(C.duplicateTask(state, id)); break;
    case "delete": commit(C.deleteTask(state, id), { undoable: true, toast: `« ${t.title} » supprimée` }); break;
    case "move": {
      const target = C.getList(state, b.dataset.list);
      commit(C.moveTaskToList(state, id, b.dataset.list, now()), { undoable: true, toast: `« ${t.title} » → ${target ? target.name : ""}` });
      break;
    }
  }
});

// ------------------------------------------------------------ listes
function scrollChips(dir) {
  const bar = $("listBar");
  bar.scrollBy({ left: dir * Math.max(120, bar.clientWidth * 0.8), behavior: "auto" });
  updateArrows();
}
$("listPrev").addEventListener("click", () => scrollChips(-1));
$("listNext").addEventListener("click", () => scrollChips(1));
$("listBar").addEventListener("scroll", updateArrows, { passive: true });
if (window.ResizeObserver) new ResizeObserver(updateArrows).observe($("listBar"));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateArrows);
window.addEventListener("resize", updateArrows);
$("doneToggle").addEventListener("click", () => commit(C.updateSettings(state, { showDone: !state.settings.showDone })));
$("listDone").addEventListener("click", (e) => {
  const b = e.target.closest('button[data-action="restore"]'); if (!b) return;
  commit(C.reopenDone(state, b.closest(".row").dataset.id, cur().id), { toast: "Tâche remise dans la liste" });
});
$("setAccent").innerHTML = Object.entries(ACCENT_COLORS).map(([k, c]) => `<button type="button" data-accent="${k}" style="background:${c[0]}" title="${ACCENT_NAMES[k]}" aria-label="${ACCENT_NAMES[k]}" aria-pressed="false"></button>`).join("");
$("setAccent").addEventListener("click", (e) => { const b = e.target.closest("[data-accent]"); if (b) commit(C.updateSettings(state, { accent: b.dataset.accent })); });
$("setAutoAdvance").addEventListener("change", (e) => commit(C.updateSettings(state, { autoAdvance: e.target.checked })));
$("setClock").addEventListener("change", (e) => commit(C.updateSettings(state, { clockStyle: e.target.value })));
$("setRoutineInsert").addEventListener("change", (e) => commit(C.updateSettings(state, { routineInsert: e.target.value })));
$("setShowDone").addEventListener("change", (e) => commit(C.updateSettings(state, { showDone: e.target.checked })));
$("listBar").addEventListener("click", (e) => {
  const c = e.target.closest(".list-chip");
  if (c) commit(C.setCurrentList(state, c.dataset.list));
});
$("addList").addEventListener("click", () => {
  closeSheets();
  listSheetMode = "create";
  $("listSheetTitle").textContent = "Nouvelle liste";
  $("listName").value = "";
  $("listSave").textContent = "Créer la liste";
  $("listExtra").hidden = true;
  openSheet("listSheet");
  $("listName").focus();
});
$("listMenu").addEventListener("click", () => {
  closeSheets();
  const l = cur();
  listSheetMode = "edit";
  $("listSheetTitle").textContent = `Liste « ${l.name} »`;
  $("listName").value = l.name;
  $("listSave").textContent = "Renommer";
  $("listExtra").hidden = false;
  $("listDelete").disabled = state.lists.length < 2;
  $("listToRoutine").disabled = l.tasks.length === 0;
  openSheet("listSheet");
});
function saveListSheet() {
  const name = $("listName").value;
  const mode = listSheetMode, id = cur().id;
  closeSheets();
  if (mode === "create") commit(C.createList(state, name));
  else commit(C.renameList(state, id, name));
  if (view !== "list") go("list");
}
$("listSave").addEventListener("click", saveListSheet);
$("listName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveListSheet(); } });
$("listClose").addEventListener("click", closeSheets);
$("listDelete").addEventListener("click", () => {
  const l = cur();
  askConfirm(`Supprimer la liste « ${l.name} »${l.tasks.length ? ` et ses ${plural(l.tasks.length, "tâche")}` : ""} ?`, "Supprimer",
    () => commit(C.deleteList(state, l.id), { undoable: true, toast: `Liste « ${l.name} » supprimée` }));
});
$("listToRoutine").addEventListener("click", () => {
  const l = cur();
  closeSheets();
  commit(C.saveListAsRoutine(state, l.id, l.name), { toast: `Routine « ${l.name} » enregistrée` });
});

// ------------------------------------------------------------ plus tard / terminées
$("laterList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-action]"); if (!b) return;
  const id = b.closest(".row").dataset.id;
  if (b.dataset.action === "reactivate") commit(C.reactivateLater(state, id, cur().id), { toast: `Remise dans « ${cur().name} »` });
  if (b.dataset.action === "delete-later") commit(C.deleteLater(state, id), { undoable: true, toast: "Tâche supprimée" });
});
$("doneList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-action]"); if (!b) return;
  if (b.dataset.action === "reopen") commit(C.reopenDone(state, b.closest(".row").dataset.id, cur().id), { toast: "Tâche remise dans sa liste" });
});
$("clearDone").addEventListener("click", () => askConfirm("Vider l'historique des tâches terminées ?", "Vider", () => commit(C.clearDone(state), { undoable: true, toast: "Historique vidé" })));

// ------------------------------------------------------------ routines
$("routineList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-action]"); if (!b) return;
  const r = state.routines.find((x) => x.id === b.closest(".row").dataset.id); if (!r) return;
  if (b.dataset.action === "launch") { unlockAudio(); openLaunch(r); }
  if (b.dataset.action === "edit") openEditor(r);
  if (b.dataset.action === "more") {
    closeSheets();
    routineMenuId = r.id;
    $("routineMenuTitle").textContent = r.name;
    $("routineMenu").querySelector('[data-rm="append"]').textContent = state.settings.routineInsert === "top" ? `➕ Ajouter en haut de « ${cur().name} »` : `➕ Ajouter en bas de « ${cur().name} »`;
    $("routineMenu").querySelector('[data-rm="replace"]').textContent = `↺ Remplacer le contenu de « ${cur().name} »`;
    openSheet("routineMenu");
  }
});
$("rmClose").addEventListener("click", closeSheets);
$("routineMenu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  const r = state.routines.find((x) => x.id === routineMenuId); if (!r) return;
  const l = cur();
  closeSheets();
  const load = (mode) => { commit(C.loadRoutine(state, r.id, l.id, mode), { undoable: true, toast: `Routine « ${r.name} » chargée dans « ${l.name} »` }); go("list"); };
  switch (b.dataset.rm) {
    case "append": load(state.settings.routineInsert === "top" ? "top" : "append"); break;
    case "replace":
      if (l.tasks.length) askConfirm(`Remplacer les ${plural(l.tasks.length, "tâche")} de « ${l.name} » par la routine « ${r.name} » ?`, "Remplacer", () => load("replace"));
      else load("replace");
      break;
    case "edit": openEditor(r); break;
    case "delete": askConfirm(`Supprimer la routine « ${r.name} » ?`, "Supprimer", () => commit(C.deleteRoutine(state, r.id), { undoable: true, toast: "Routine supprimée" })); break;
  }
});
$("newRoutineBtn").addEventListener("click", () => openEditor(null));

// éditeur
function openEditor(r) {
  draft = r ? { id: r.id, name: r.name, items: r.items.map((it) => ({ ...it })), timing: r.timing ? { ...r.timing } : null } : { id: null, name: "", items: [], timing: null };
  $("reHeading").textContent = r ? "Modifier la routine" : "Nouvelle routine";
  $("reName").value = draft.name;
  $("reAdd").value = "";
  $("reError").hidden = true;
  $("reTime").value = draft.timing ? draft.timing.time : "";
  renderEditorItems();
  go("routine-edit");
  if (!r) $("reName").focus();
}
function editorTotal() {
  const mins = draft.items.reduce((a, it) => a + (parseInt(it.minutes, 10) || 0), 0);
  $("reTotal").textContent = `${plural(draft.items.length, "étape")} · ${C.fmtDuration(mins)}`;
  renderTiming();
}
function renderTiming() {
  const mode = draft.timing ? draft.timing.mode : ($("reTimeWrap").hidden ? "none" : draft.pendingMode || "none");
  document.querySelectorAll("[data-timing]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.timing === mode)));
  $("reTimeWrap").hidden = mode === "none";
  $("reTimeLbl").textContent = mode === "start" ? "Commencer à" : "Finir à";
  const w = draft.timing ? C.routineWindow({ items: draft.items.map((it) => ({ minutes: parseInt(it.minutes, 10) || 0 })), timing: draft.timing }) : null;
  $("reWindow").textContent = !w ? "" : draft.timing.mode === "start" ? `→ fin estimée à ${w.end}` : `→ à commencer au plus tard à ${w.start}`;
}
function updateDraftTiming() {
  const mode = draft.pendingMode;
  const v = $("reTime").value;
  draft.timing = mode && mode !== "none" && /^\d{1,2}:\d{2}$/.test(v) ? { mode, time: v } : null;
  renderTiming();
}
document.querySelectorAll("[data-timing]").forEach((b) => b.addEventListener("click", () => {
  draft.pendingMode = b.dataset.timing;
  if (b.dataset.timing === "none") { draft.timing = null; $("reTimeWrap").hidden = true; }
  else $("reTimeWrap").hidden = false;
  updateDraftTiming();
  if (b.dataset.timing !== "none") $("reTime").focus();
}));
$("reTime").addEventListener("input", updateDraftTiming);
function renderEditorItems() {
  const n = draft.items.length;
  $("reItems").innerHTML = draft.items.map((it, i) => `<li class="re-item" data-i="${i}">
  <span class="re-num">${i + 1}</span>
  <input class="re-emoji" data-f="emoji" value="${esc(it.emoji)}" maxlength="12" aria-label="Emoji">
  <input class="re-title" data-f="title" value="${esc(it.title)}" aria-label="Titre de l'étape">
  <label class="min-chip"><input class="re-min" data-f="minutes" type="number" inputmode="numeric" min="1" max="600" value="${esc(it.minutes)}" aria-label="Durée"><span>min</span></label>
  <span class="re-tools">
    <button class="icon-btn" data-action="up" aria-label="Monter"${i === 0 ? " disabled" : ""}>${icon("up")}</button>
    <button class="icon-btn" data-action="down" aria-label="Descendre"${i === n - 1 ? " disabled" : ""}>${icon("down")}</button>
    <button class="icon-btn" data-action="remove" aria-label="Retirer">${icon("x")}</button>
  </span>
</li>`).join("");
  editorTotal();
}
$("reItems").addEventListener("input", (e) => {
  const li = e.target.closest(".re-item"), f = e.target.dataset.f;
  if (!li || !f) return;
  draft.items[+li.dataset.i][f] = e.target.value;
  editorTotal();
});
$("reItems").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-action]"); if (!b) return;
  const i = +b.closest(".re-item").dataset.i, items = draft.items;
  if (b.dataset.action === "remove") items.splice(i, 1);
  if (b.dataset.action === "up" && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
  if (b.dataset.action === "down" && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
  renderEditorItems();
});
$("reName").addEventListener("input", (e) => { draft.name = e.target.value; });
$("reAddForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const p = C.parseQuickAdd($("reAdd").value);
  if (p.title) {
    draft.items.push({ title: p.title, emoji: C.suggestEmoji(p.title), minutes: p.minutes ?? state.settings.defaultMinutes });
    renderEditorItems();
    $("reError").hidden = true;
  }
  $("reAdd").value = "";
  $("reAdd").focus();
});
$("reSave").addEventListener("click", () => {
  draft.name = $("reName").value;
  const next = draft.id ? C.updateRoutine(state, draft.id, { name: draft.name, items: draft.items, timing: draft.timing }) : C.createRoutine(state, draft.name, draft.items, draft.timing);
  if (next === state) {
    $("reError").textContent = !draft.name.trim() ? "Donne un nom à la routine." : "Ajoute au moins une étape.";
    $("reError").hidden = false;
    return;
  }
  const name = draft.name.trim();
  draft = null;
  commit(next, { toast: `Routine « ${name} » enregistrée` });
  go("routines");
});
$("reCancel").addEventListener("click", () => { draft = null; go("routines"); });

// ------------------------------------------------------------ focus
$("focusBack").addEventListener("click", () => go("list"));
$("focusToggle").addEventListener("click", () => toggleList(cur().id));
$("focusDone").addEventListener("click", () => completeIn(cur().id));
$("focusSkip").addEventListener("click", () => commit(C.skipTask(state, cur().id, now())));
$("focusPlus1").addEventListener("click", () => adjustShown(1));
$("focusPlus5").addEventListener("click", () => adjustShown(5));
$("focusMinus5").addEventListener("click", () => adjustShown(-5));
$("celebrate").addEventListener("click", () => { $("celebrate").hidden = true; });

// ------------------------------------------------------------ onglets & réglages
$("tabbar").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) go(b.dataset.tab); });
$("setSound").addEventListener("change", (e) => commit(C.updateSettings(state, { sound: e.target.checked })));
$("setAuto").addEventListener("change", (e) => commit(C.updateSettings(state, { autoStartNext: e.target.checked })));
$("setDefault").addEventListener("change", (e) => { if (!commit(C.updateSettings(state, { defaultMinutes: e.target.value }))) e.target.value = state.settings.defaultMinutes; });
$("setTheme").addEventListener("change", (e) => commit(C.updateSettings(state, { theme: e.target.value })));
$("testSound").addEventListener("click", () => { unlockAudio(); playSound(state.settings.soundType); });
$("setSoundType").addEventListener("change", (e) => { unlockAudio(); commit(C.updateSettings(state, { soundType: e.target.value })); playSound(state.settings.soundType); });

// ------------------------------------------------------------ clavier
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (anySheetOpen()) { closeSheets(); return; }
    if (!$("celebrate").hidden) { $("celebrate").hidden = true; return; }
    if (view === "focus") go("list");
    return;
  }
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || anySheetOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (view === "routine-edit") return;
  const l = cur(), head = C.activeTask(state, l.id) || l.tasks[0];
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.key === "?") { e.preventDefault(); openShortcuts(); }
  else if (k === "n") { e.preventDefault(); if (view !== "list") go("list"); $("quickAdd").focus(); }
  else if (e.key === " ") { if (e.target.closest && e.target.closest("button")) return; e.preventDefault(); toggleList(l.id); }
  else if (k === "t") { if (head) completeIn(l.id, head.id); }
  else if (k === "s") commit(C.skipTask(state, l.id, now()));
  else if (k === "l") { if (head) sendLater(head.id); }
  else if (k === "e") { if (head) openTaskSheet(head.id); }
  else if (e.key === "+" || e.key === "=") adjustShown(5);
  else if (e.key === "-" || e.key === "−") adjustShown(-5);
  else if (k === "h") { if (view !== "list") go("list"); openDeadline("new"); }
  else if (k === "f") {
    if (view === "focus") go("list");
    else if (head) { if (!C.activeTask(state, l.id)) { unlockAudio(); commit(C.startTask(state, l.id, null, now())); } go("focus"); }
  }
  else if (/^[1-5]$/.test(e.key)) go(["list", "later", "done", "routines", "settings"][+e.key - 1]);
  else if (e.key === "[" || e.key === "]") {
    const i = state.lists.findIndex((l) => l.id === cur().id);
    const j = Math.max(0, Math.min(state.lists.length - 1, i + (e.key === "]" ? 1 : -1)));
    commit(C.setCurrentList(state, state.lists[j].id));
  }
});


// ------------------------------------------------------------ heures de fin voulues (jalons)
// Heure du jour → horodatage ; une heure déjà passée aujourd'hui vise demain.
function toDeadlineMs(hhmm) {
  const t = now();
  let ms = C.timeOfDayToMs(t, hhmm);
  if (ms === null) return null;
  if (ms <= t) ms += 24 * 3600 * 1000;
  return ms;
}
const roundUp5 = (ms) => { const step = 5 * 60 * 1000; return Math.ceil(ms / step) * step; };
function openDeadline(carrier) {
  const l = cur();
  if (!l.tasks.length) return;
  closeSheets();
  let ms;
  if (carrier === "new") {
    const lastT = l.tasks[l.tasks.length - 1];
    if (Number.isFinite(lastT.finishByMs)) carrier = lastT.id;
  }
  if (carrier === "new") {
    const p = C.plan(state, l.id, now());
    ms = roundUp5(p.tasks[p.tasks.length - 1].endAtMs);
  } else {
    const t = carrier ? l.tasks.find((x) => x.id === carrier) : null;
    ms = carrier ? t && t.finishByMs : l.finishByMs;
    if (!Number.isFinite(ms)) return;
  }
  dlCarrier = carrier;
  const after = carrier && carrier !== "new" ? l.tasks.find((x) => x.id === carrier) : l.tasks[l.tasks.length - 1];
  $("dlNote").textContent = `Les tâches jusqu'à « ${after.title} » sont raccourcies au prorata si le temps prévu dépasse cette heure. Les durées prévues ne changent pas.`;
  $("dlTime").value = C.fmtClock(ms);
  $("dlRemove").hidden = carrier === "new";
  openSheet("deadlineSheet");
  $("dlTime").focus();
  previewDeadline();
}
function deadlineDraft() {
  const l = cur();
  const ms = toDeadlineMs($("dlTime").value);
  if (ms === null) return null;
  const carrier = dlCarrier === "new" ? l.tasks[l.tasks.length - 1].id : dlCarrier;
  return carrier ? C.setTaskFinishBy(state, carrier, ms) : C.setListFinishBy(state, l.id, ms);
}
function previewDeadline() {
  const d = deadlineDraft();
  if (!d) { $("dlPreview").textContent = "Heure non valide"; return; }
  const l = cur();
  const carrier = dlCarrier === "new" ? l.tasks[l.tasks.length - 1].id : dlCarrier;
  const endIdx = carrier ? l.tasks.findIndex((x) => x.id === carrier) : l.tasks.length - 1;
  const seg = C.plan(d, l.id, now()).segments.find((g) => g.endIndex === endIdx);
  $("dlPreview").classList.toggle("warn", !!seg && seg.factor < 0.9995);
  $("dlPreview").textContent = !seg ? "" : seg.factor < 0.9995
    ? `${C.fmtDuration(Math.round(seg.plannedSec / 60))} prévues pour ${C.fmtDuration(Math.round(seg.availableSec / 60))} → tâches raccourcies de ${Math.round((1 - seg.factor) * 100)} %`
    : `Dans les temps · marge ${C.fmtDuration(Math.max(0, Math.round((seg.availableSec - seg.plannedSec) / 60)))}`;
}
$("dlTime").addEventListener("input", previewDeadline);
$("dlTime").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("dlSave").click(); } });
$("dlSave").addEventListener("click", () => {
  const d = deadlineDraft();
  if (!d) { $("dlPreview").textContent = "Heure non valide"; return; }
  closeSheets();
  commit(d);
});
$("dlRemove").addEventListener("click", () => {
  const l = cur(), c = dlCarrier;
  closeSheets();
  commit(c ? C.setTaskFinishBy(state, c, null) : C.setListFinishBy(state, l.id, null), { undoable: true, toast: "Heure de fin voulue retirée" });
});
$("dlClose").addEventListener("click", closeSheets);
$("addDeadline").addEventListener("click", () => openDeadline("new"));

// ------------------------------------------------------------ vue maximisée : glisser vers la gauche = terminer
(() => {
  const el = $("focusCard");
  let sw = null;
  const reset = () => { el.style.transform = ""; el.style.opacity = ""; el.classList.remove("swiping"); el.style.setProperty("--reveal", "0"); };
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || e.target.closest(".timer-input-wrap")) return;
    sw = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, active: false };
  });
  el.addEventListener("pointermove", (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
    if (!sw.active) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      sw.active = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      el.classList.add("swiping");
    }
    sw.dx = Math.min(0, dx);
    const w = el.getBoundingClientRect().width || 300;
    el.style.transform = `translateX(${sw.dx}px) rotate(${(sw.dx / w) * 6}deg)`;
    el.style.setProperty("--reveal", String(Math.min(1, -sw.dx / (w * 0.35))));
  });
  const end = (e) => {
    if (!sw || (e && e.pointerId !== sw.id)) return;
    const { dx, active } = sw;
    sw = null;
    if (!active) return;
    // le clic qui suit un glisser ne doit pas ouvrir la saisie du temps
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 60);
    const w = el.getBoundingClientRect().width || 300;
    if (dx < -Math.max(90, w * 0.3)) {
      el.classList.add("leaving");
      el.style.transform = `translateX(${-w * 1.3}px) rotate(-8deg)`;
      el.style.opacity = "0";
      setTimeout(() => { el.classList.remove("leaving"); reset(); completeIn(cur().id); }, 220);
    } else {
      el.classList.add("back");
      reset();
      setTimeout(() => el.classList.remove("back"), 220);
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
})();


// ------------------------------------------------------------ lancer une routine (maintenant / finir à / commencer à)
function openLaunch(r) {
  closeSheets();
  launchRoutineId = r.id;
  const total = r.items.reduce((a, it) => a + Math.round(it.minutes), 0);
  $("launchTitle").textContent = `Lancer « ${r.name} » (${C.fmtDuration(total)})`;
  launchMode = r.timing ? r.timing.mode : "now";
  $("launchTime").value = r.timing ? r.timing.time : C.fmtClock(roundUp5(now() + total * 60000));
  renderLaunch();
  openSheet("launchSheet");
}
function launchPlan() {
  const r = state.routines.find((x) => x.id === launchRoutineId);
  if (!r) return null;
  const t = now(), total = r.items.reduce((a, it) => a + Math.round(it.minutes), 0) * 60;
  const at = C.timeOfDayToMs(t, $("launchTime").value);
  return { r, t, total, at };
}
function renderLaunch() {
  document.querySelectorAll("[data-launch]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.launch === launchMode)));
  $("launchTimeWrap").hidden = launchMode === "now";
  $("launchTimeLbl").textContent = launchMode === "start" ? "Commencer à" : "Finir à";
  const lp = launchPlan();
  if (!lp) return;
  const { t, total, at } = lp;
  let msg = "", ok = true, warn = false;
  if (launchMode === "now") msg = `Démarre maintenant · fin estimée ≈ ${C.fmtClock(t + total * 1000)}`;
  else if (at === null) { msg = "Choisis une heure"; ok = false; }
  else if (launchMode === "end") {
    if (at <= t) { msg = "Cette heure est déjà passée"; ok = false; }
    else {
      const avail = Math.round((at - t) / 1000);
      if (avail >= total) msg = `Démarre maintenant · dans les temps, marge ${C.fmtDuration(Math.round((avail - total) / 60))}`;
      else { warn = true; msg = `${C.fmtDuration(Math.round(total / 60))} prévues pour ${C.fmtDuration(Math.round(avail / 60))} → tâches raccourcies de ${Math.round((1 - avail / total) * 100)} %`; }
    }
  } else msg = at <= t ? `Démarre maintenant · fin estimée ≈ ${C.fmtClock(t + total * 1000)}` : `Liste créée en pause, à lancer à ${C.fmtClock(at)} · fin estimée ${C.fmtClock(at + total * 1000)}`;
  $("launchInfo").textContent = msg;
  $("launchInfo").classList.toggle("warn", warn);
  $("launchGo").disabled = !ok;
}
document.querySelectorAll("[data-launch]").forEach((b) => b.addEventListener("click", () => { launchMode = b.dataset.launch; renderLaunch(); if (launchMode !== "now") $("launchTime").focus(); }));
$("launchTime").addEventListener("input", renderLaunch);
$("launchClose").addEventListener("click", closeSheets);
$("launchGo").addEventListener("click", () => {
  const lp = launchPlan();
  if (!lp) return;
  const { r, t, at } = lp;
  const opts = launchMode === "now" ? { start: true, finishByMs: null }
    : launchMode === "end" ? { start: true, finishByMs: at }
    : { start: at === null || at <= t, finishByMs: null };
  closeSheets();
  commit(C.launchRoutine(state, r.id, t, opts), { toast: `Routine « ${r.name} » lancée` });
  go("list");
});

// ------------------------------------------------------------ raccourcis et gestes
const SHORTCUTS = [
  ["Clavier", [
    ["N", "Nouvelle tâche (champ d'ajout)"], ["Entrée", "Ajouter la tâche en bas de la liste"], ["Maj+Entrée", "Ajouter la tâche en haut de la liste"],
    ["Espace", "Démarrer / mettre en pause"], ["T", "Terminer la tâche en cours"], ["S", "Passer (envoyer en fin de liste)"],
    ["L", "Mettre la tâche en cours « Plus tard »"], ["E", "Modifier la tâche en cours"], ["+ / −", "Ajouter / retirer 5 minutes"],
    ["H", "Heure de fin voulue"], ["F", "Vue maximisée"], ["[ / ]", "Liste précédente / suivante"],
    ["1 à 5", "Onglets : Liste, Plus tard, Terminées, Routines, Réglages"], ["?", "Cette page"], ["Échap", "Fermer une fenêtre, quitter la vue maximisée, annuler une saisie"],
  ]],
  ["Gestes", [
    ["Toucher l'horloge", "Taper le temps restant (25, 19:30, 1:02:03)"], ["Toucher l'emoji", "Choisir un autre emoji"],
    ["Glisser l'emoji", "Réordonner ; le déposer sur la carte « Maintenant » en fait la tâche en cours"],
    ["Glisser un jalon « Fin voulue »", "Le placer entre deux tâches ; le toucher pour changer l'heure"],
    ["Vue maximisée : glisser vers la gauche", "Terminer la tâche (Annuler dans le bandeau)"],
  ]],
];
$("shortcutsBody").innerHTML = SHORTCUTS.map(([g, rows]) => `<h4>${g}</h4><dl>${rows.map(([k, d]) => `<div><dt>${k.split(" / ").map((x) => g === "Clavier" ? `<kbd>${esc(x)}</kbd>` : esc(x)).join(" / ")}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl>`).join("");
function openShortcuts() { closeSheets(); openSheet("shortcutsSheet"); $("scClose").focus(); }
$("openShortcuts").addEventListener("click", openShortcuts);
$("scClose").addEventListener("click", closeSheets);

// ------------------------------------------------------------ sauvegarde (exporter / importer)
function openData(mode) {
  closeSheets();
  const exp = mode === "export";
  $("dataTitle").textContent = exp ? "Exporter mes données" : "Importer des données";
  $("dataHelp").textContent = exp
    ? "Copie ce texte et colle-le dans « Importer » de l'autre version de Sablier."
    : "Colle ici le texte copié depuis « Exporter ». Il remplacera toutes les données de cet appareil.";
  $("dataText").value = exp ? JSON.stringify(state, null, 1) : "";
  $("dataText").readOnly = exp;
  $("dataCopy").hidden = !exp;
  $("dataApply").hidden = exp;
  $("dataError").hidden = true;
  openSheet("dataSheet");
  if (!exp) $("dataText").focus();
}
$("exportData").addEventListener("click", () => openData("export"));
$("importData").addEventListener("click", () => openData("import"));
$("dataClose").addEventListener("click", closeSheets);
$("dataCopy").addEventListener("click", async () => {
  const ta = $("dataText");
  try { await navigator.clipboard.writeText(ta.value); showToast("Données copiées", false); }
  catch { ta.focus(); ta.select(); showToast("Sélectionné : copie-le avec Ctrl+C / Copier", false); }
});
$("dataApply").addEventListener("click", () => {
  const next = C.importData($("dataText").value);
  if (!next) { $("dataError").hidden = false; return; }
  const n = next.lists.reduce((a, l) => a + l.tasks.length, 0);
  askConfirm(`Remplacer toutes les données par la sauvegarde (${plural(next.lists.length, "liste")}, ${plural(n, "tâche")}) ?`, "Importer",
    () => { commit(next, { undoable: true, toast: "Données importées" }); go("list"); });
});

// ------------------------------------------------------------ démarrage
render();
$("app").dataset.ready = "1";
setInterval(() => tick(false), 250);
document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(false); });
initRemote();
setupAlarms();
syncAlarms(state, now());
setTimeout(loadEmojiData, 1500);
// Appli installable (hors de Claude et hors appli Android) : service worker pour le hors-ligne.
if ("serviceWorker" in navigator && !window.claude && !isNative() && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
