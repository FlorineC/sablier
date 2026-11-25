import { spec, expect } from "../testkit.js";
import * as C from "../core.js";

const T0 = Date.UTC(2026, 10, 17, 8, 0, 0);
const sec = (s) => s * 1000;
const min = (m) => m * 60000;

const L = (s) => s.currentListId;
const list = (s, id) => s.lists.find((l) => l.id === (id ?? s.currentListId));
const tasks = (s, id) => list(s, id).tasks;
const titles = (arr) => arr.map((t) => t.title);
const tid = (s, i, id) => tasks(s, id)[i].id;

function withTasks(...defs) {
  let s = C.createState();
  for (const d of defs) s = C.addTask(s, L(s), typeof d === "string" ? { title: d } : d);
  return s;
}
function twoLists() {
  let s = withTasks({ title: "A", minutes: 10 }, { title: "B", minutes: 10 });
  const l1 = L(s);
  s = C.createList(s, "Cuisine");
  const l2 = L(s);
  s = C.addTask(s, l2, { title: "Cuire", minutes: 5 });
  return { s, l1, l2 };
}

// ================================================================ L — listes
spec("L1", "état neuf : une liste « Ma liste » courante", () => {
  const s = C.createState();
  expect(s.lists).toHaveLength(1);
  expect(s.lists[0].name).toBe("Ma liste");
  expect(s.currentListId).toBe(s.lists[0].id);
});
spec("L1", "créer une liste l'ajoute et l'ouvre ; nom par défaut numéroté", () => {
  let s = C.createList(C.createState(), "  Boulot ");
  expect(s.lists.map((l) => l.name)).toEqual(["Ma liste", "Boulot"]);
  expect(L(s)).toBe(s.lists[1].id);
  s = C.createList(s, "");
  expect(s.lists[2].name).toBe("Liste 3");
});
spec("L1", "renommer (nom vide refusé)", () => {
  let s = C.createState();
  s = C.renameList(s, L(s), "Perso");
  expect(list(s).name).toBe("Perso");
  expect(C.renameList(s, L(s), "  ")).toBe(s);
});
spec("L1", "supprimer une liste ; jamais la dernière ; la courante passe à une voisine", () => {
  let { s, l1, l2 } = twoLists();
  expect(L(s)).toBe(l2);
  s = C.deleteList(s, l2);
  expect(s.lists.map((l) => l.id)).toEqual([l1]);
  expect(L(s)).toBe(l1);
  expect(C.deleteList(s, l1)).toBe(s);
});
spec("L2", "setCurrentList change la liste ouverte (id inconnu ignoré)", () => {
  let { s, l1 } = twoLists();
  s = C.setCurrentList(s, l1);
  expect(L(s)).toBe(l1);
  expect(C.setCurrentList(s, "nope")).toBe(s);
});
spec("L3", "deux listes tournent en même temps, indépendamment", () => {
  let { s, l1, l2 } = twoLists();
  s = C.startTask(s, l1, null, T0);
  s = C.startTask(s, l2, null, T0 + min(1));
  expect(C.isRunning(s, l1)).toBe(true);
  expect(C.isRunning(s, l2)).toBe(true);
  expect(C.remainingSec(s, tid(s, 0, l1), T0 + min(3))).toBe(7 * 60);
  expect(C.remainingSec(s, tid(s, 0, l2), T0 + min(3))).toBe(3 * 60);
  s = C.pauseTask(s, l1, T0 + min(3));
  expect(C.isRunning(s, l1)).toBe(false);
  expect(C.isRunning(s, l2)).toBe(true);
});
spec("L4", "activeLists renvoie les listes ayant une tâche en cours (même en pause)", () => {
  let { s, l1, l2 } = twoLists();
  expect(C.activeLists(s)).toEqual([]);
  s = C.startTask(s, l2, null, T0);
  s = C.startTask(s, l1, null, T0);
  s = C.pauseTask(s, l1, T0 + 5);
  expect(C.activeLists(s).map((l) => l.id)).toEqual([l1, l2]);
});
spec("L5", "déplacer une tâche vers une autre liste (pause + temps conservé)", () => {
  let { s, l1, l2 } = twoLists();
  const a = tid(s, 0, l1);
  s = C.startTask(s, l1, a, T0);
  s = C.moveTaskToList(s, a, l2, T0 + sec(30));
  expect(titles(tasks(s, l1))).toEqual(["B"]);
  expect(titles(tasks(s, l2))).toEqual(["Cuire", "A"]);
  expect(tasks(s, l2)[1].spentSec).toBe(30);
  expect(list(s, l1).active).toBeNull();
  expect(C.moveTaskToList(s, tid(s, 0, l2), l2, T0)).toBe(s);
});

// ================================================================ A — tâches
spec("A1", "ajoute en fin de liste, ids uniques, refuse un titre blanc", () => {
  let s = withTasks("Un", "Deux");
  expect(titles(tasks(s))).toEqual(["Un", "Deux"]);
  expect(tid(s, 0)).not.toBe(tid(s, 1));
  expect(C.addTask(s, L(s), { title: "   " })).toBe(s);
});
spec("A1", "n'ajoute que dans la liste visée ; immutabilité", () => {
  const { s, l1, l2 } = twoLists();
  const s2 = C.addTask(s, l1, { title: "X" });
  expect(titles(tasks(s2, l1))).toEqual(["A", "B", "X"]);
  expect(titles(tasks(s2, l2))).toEqual(["Cuire"]);
  expect(titles(tasks(s, l1))).toEqual(["A", "B"]);
  expect(C.addTask(s, "nope", { title: "X" })).toBe(s);
});
spec("A2", "parseDuration reconnaît les formats usuels", () => {
  expect(C.parseDuration("15")).toBe(15);
  expect(C.parseDuration("15m")).toBe(15);
  expect(C.parseDuration("15 min")).toBe(15);
  expect(C.parseDuration("1h")).toBe(60);
  expect(C.parseDuration("1h30")).toBe(90);
  expect(C.parseDuration("1h 30m")).toBe(90);
  expect(C.parseDuration("1,5h")).toBe(90);
  expect(C.parseDuration("90'")).toBe(90);
  expect(C.parseDuration("abc")).toBeNull();
});
spec("A2", "parseQuickAdd extrait la durée finale", () => {
  expect(C.parseQuickAdd("Emails 15m")).toEqual({ title: "Emails", minutes: 15 });
  expect(C.parseQuickAdd("Rapport 1h 30m")).toEqual({ title: "Rapport", minutes: 90 });
  expect(C.parseQuickAdd("Lire 3 articles")).toEqual({ title: "Lire 3 articles", minutes: null });
  expect(C.parseQuickAdd("2026")).toEqual({ title: "2026", minutes: null });
});
spec("A2", "durée de saisie, sinon durée par défaut ; explicite prioritaire", () => {
  let s = C.addTask(C.createState(), "main", { title: "Emails 15m" });
  s = C.updateSettings(s, { defaultMinutes: 40 });
  s = C.addTask(s, "main", { title: "Autre" });
  s = C.addTask(s, "main", { title: "X", minutes: 10 });
  expect(tasks(s).map((t) => [t.title, t.minutes])).toEqual([["Emails", 15], ["Autre", 40], ["X", 10]]);
});
spec("A3", "durée bornée entre 1 et 600", () => {
  let s = withTasks({ title: "A", minutes: 0 }, { title: "B", minutes: 9999 }, { title: "C", minutes: "abc" });
  expect(tasks(s).map((t) => t.minutes)).toEqual([1, 600, 25]);
});
spec("A4", "suggestion d'emoji", () => {
  expect(C.suggestEmoji("Répondre aux emails")).toBe("📧");
  expect(C.suggestEmoji("Appeler le médecin")).toBe("🩺");
  expect(C.suggestEmoji("Faire les courses")).toBe("🛒");
  expect(C.suggestEmoji("Faire le suivi")).toBe("🧠");
  expect(C.suggestEmoji("Revue UI")).toBe("🎨");
  expect(C.suggestEmoji("Séance de piano")).toBe("🎹");
});
spec("A5", "updateTask par id de tâche, quelle que soit la liste", () => {
  let { s, l2 } = twoLists();
  s = C.updateTask(s, tid(s, 0, l2), { title: " Mijoter ", minutes: "12", emoji: "🍲" });
  expect(tasks(s, l2)[0]).toEqual({ ...tasks(s, l2)[0], title: "Mijoter", minutes: 12, emoji: "🍲" });
  s = C.updateTask(s, tid(s, 0, l2), { title: "", minutes: "x", emoji: " " });
  expect(tasks(s, l2)[0].title).toBe("Mijoter");
  expect(tasks(s, l2)[0].minutes).toBe(12);
  expect(tasks(s, l2)[0].emoji).toBe("🧠");
});
spec("A6", "moveTask et reorderTasks sans perte", () => {
  let s = withTasks("A", "B", "C");
  s = C.moveTask(s, tid(s, 2), -1);
  expect(titles(tasks(s))).toEqual(["A", "C", "B"]);
  s = C.moveTask(s, tid(s, 0), -1);
  expect(titles(tasks(s))).toEqual(["A", "C", "B"]);
  const [a, c, b] = tasks(s).map((t) => t.id);
  s = C.reorderTasks(s, L(s), [b, "inconnu", a]);
  expect(titles(tasks(s))).toEqual(["B", "A", "C"]);
  expect(tasks(s).map((t) => t.id)).toEqual([b, a, c]);
});
spec("A6", "la tâche en cours reste épinglée en tête", () => {
  let s = withTasks("A", "B", "C");
  s = C.startTask(s, L(s), null, T0);
  const [a, b, c] = tasks(s).map((t) => t.id);
  expect(C.moveTask(s, b, -1)).toBe(s);
  s = C.reorderTasks(s, L(s), [c, b, a]);
  expect(titles(tasks(s))).toEqual(["A", "C", "B"]);
});
spec("A7", "dupliquer sous l'original, temps remis à zéro", () => {
  let s = withTasks("A", "B");
  s = C.startTask(s, L(s), null, T0);
  s = C.pauseTask(s, L(s), T0 + sec(90));
  s = C.duplicateTask(s, tid(s, 0));
  expect(titles(tasks(s))).toEqual(["A", "A", "B"]);
  expect(tasks(s).map((t) => t.spentSec)).toEqual([90, 0, 0]);
});
spec("A8", "supprimer une tâche de la file ne touche pas au minuteur", () => {
  let s = withTasks("A", "B", "C");
  s = C.startTask(s, L(s), null, T0);
  s = C.deleteTask(s, tid(s, 1), T0 + sec(5));
  expect(titles(tasks(s))).toEqual(["A", "C"]);
  expect(list(s).active).toEqual({ taskId: tid(s, 0), startedAtMs: T0 });
});

// ================================================================ U / B — récap
spec("B1", "totaux par liste : nombre et restant (passé déduit, jamais négatif)", () => {
  let { s, l1, l2 } = twoLists();
  expect(C.totals(s, l1, T0).count).toBe(2);
  expect(C.totals(s, l1, T0).remainingSec).toBe(1200);
  expect(C.totals(s, l2, T0).remainingSec).toBe(300);
  s = C.startTask(s, l1, null, T0);
  expect(C.totals(s, l1, T0 + min(4)).remainingSec).toBe(16 * 60);
  expect(C.totals(s, l1, T0 + min(30)).remainingSec).toBe(10 * 60);
});
spec("B2", "heure de fin, format 24 h, null si vide", () => {
  let s = withTasks({ title: "A", minutes: 90 });
  const d = new Date(2026, 10, 17, 22, 45).getTime();
  expect(C.fmtClock(C.totals(s, L(s), d).finishAtMs)).toBe("00:15");
  expect(C.totals(C.createState(), "main", T0).finishAtMs).toBeNull();
});
spec("U3", "progression = temps passé / temps prévu (terminées de la liste incluses)", () => {
  let s = withTasks({ title: "A", minutes: 10 }, { title: "B", minutes: 10 });
  expect(C.totals(s, L(s), T0).progress).toBe(0);
  s = C.startTask(s, L(s), null, T0);
  expect(C.totals(s, L(s), T0 + min(5)).progress).toBe(0.25);
  s = C.completeTask(s, L(s), T0 + min(10));
  expect(C.totals(s, L(s), T0 + min(10)).progress).toBe(0.5);
  // un dépassement ne fait pas dépasser 100 %
  expect(C.totals(s, L(s), T0 + min(60)).progress).toBe(1);
});

// ================================================================ C — minuteur
spec("C1", "démarrer une tâche la place en tête et la lance", () => {
  let s = withTasks("A", "B", "C");
  const c = tid(s, 2);
  s = C.startTask(s, L(s), c, T0);
  expect(titles(tasks(s))).toEqual(["C", "A", "B"]);
  expect(list(s).active).toEqual({ taskId: c, startedAtMs: T0 });
});
spec("C1", "sans id : reprend la tâche en cours, sinon la première ; liste vide : rien", () => {
  let s = withTasks("A", "B");
  s = C.startTask(s, L(s), null, T0);
  expect(list(s).active.taskId).toBe(tid(s, 0));
  s = C.pauseTask(s, L(s), T0 + 5);
  s = C.startTask(s, L(s), null, T0 + 10);
  expect(C.isRunning(s, L(s))).toBe(true);
  const e = C.createState();
  expect(C.startTask(e, L(e), null, T0)).toBe(e);
});
spec("C1", "changer de tâche dans une liste conserve le temps de la précédente", () => {
  let s = withTasks("A", "B");
  const [a, b] = tasks(s).map((t) => t.id);
  s = C.startTask(s, L(s), a, T0);
  s = C.startTask(s, L(s), b, T0 + sec(70));
  expect(titles(tasks(s))).toEqual(["B", "A"]);
  expect(tasks(s)[1].spentSec).toBe(70);
  expect(list(s).active).toEqual({ taskId: b, startedAtMs: T0 + sec(70) });
});
spec("C2", "temps par horodatage ; pause ; reprise ; survit à JSON", () => {
  let s = withTasks({ title: "A", minutes: 10 });
  const id = tid(s, 0);
  s = C.startTask(s, L(s), id, T0);
  expect(C.remainingSec(s, id, T0 + sec(61))).toBe(539);
  s = C.pauseTask(s, L(s), T0 + sec(61));
  expect(C.remainingSec(s, id, T0 + min(60))).toBe(539);
  s = C.toggleTimer(s, L(s), T0 + min(60));
  const re = C.normalizeState(JSON.parse(JSON.stringify(s)));
  expect(C.remainingSec(re, id, T0 + min(60) + sec(9))).toBe(530);
});
spec("C3", "ajuster le temps, minimum 1 min ; sans tâche en cours : la prochaine", () => {
  let s = withTasks({ title: "A", minutes: 10 });
  expect(tasks(C.adjustTime(s, L(s), 5))[0].minutes).toBe(15);
  expect(C.adjustTime(C.createState(), "main", 5).lists[0].tasks).toHaveLength(0);
  s = C.startTask(s, L(s), null, T0);
  s = C.adjustTime(s, L(s), 5);
  expect(tasks(s)[0].minutes).toBe(15);
  for (let i = 0; i < 4; i++) s = C.adjustTime(s, L(s), -5);
  expect(tasks(s)[0].minutes).toBe(1);
});
spec("C4", "signal unique par tâche, dépassement, réarmement, rien en pause", () => {
  let s = withTasks({ title: "A", minutes: 1 });
  s = C.startTask(s, L(s), null, T0);
  let r = C.checkTimeUp(s, T0 + sec(59));
  expect(r.fired).toEqual([]);
  r = C.checkTimeUp(r.state, T0 + sec(60));
  expect(r.fired).toEqual([{ listId: L(s), taskId: tid(s, 0) }]);
  r = C.checkTimeUp(r.state, T0 + sec(75));
  expect(r.fired).toEqual([]);
  expect(C.remainingSec(r.state, tid(s, 0), T0 + sec(75))).toBe(-15);
  s = C.adjustTime(r.state, L(s), 1);
  expect(C.checkTimeUp(s, T0 + sec(100)).fired).toEqual([]);
  expect(C.checkTimeUp(s, T0 + sec(121)).fired).toHaveLength(1);
  s = C.pauseTask(s, L(s), T0 + sec(100));
  expect(C.checkTimeUp(s, T0 + min(10)).fired).toEqual([]);
});
spec("C4", "signaux de plusieurs listes dans le même passage", () => {
  let { s, l1, l2 } = twoLists();
  s = C.startTask(s, l1, null, T0);
  s = C.startTask(s, l2, null, T0 + min(5));
  const r = C.checkTimeUp(s, T0 + min(10));
  expect(r.fired.map((f) => f.listId)).toEqual([l1, l2]);
});
spec("C5", "terminer : archive (avec liste d'origine) et enchaîne", () => {
  let s = withTasks({ title: "A", minutes: 10 }, "B", "C");
  const [a, b] = tasks(s).map((t) => t.id);
  s = C.startTask(s, L(s), a, T0);
  s = C.completeTask(s, L(s), T0 + min(12));
  expect(titles(tasks(s))).toEqual(["B", "C"]);
  expect(s.done[0]).toEqual({ id: a, title: "A", emoji: s.done[0].emoji, minutes: 10, spentSec: 720, completedAtMs: T0 + min(12), listId: L(s), listName: "Ma liste" });
  expect(list(s).active).toEqual({ taskId: b, startedAtMs: T0 + min(12) });
});
spec("C5", "sans enchaînement ou si en pause : la suivante attend", () => {
  let s = C.updateSettings(withTasks("A", "B"), { autoStartNext: false });
  s = C.startTask(s, L(s), null, T0);
  s = C.completeTask(s, L(s), T0 + 5);
  expect(list(s).active).toEqual({ taskId: tid(s, 0), startedAtMs: null });
  let p = withTasks("A", "B");
  p = C.startTask(p, L(p), null, T0);
  p = C.pauseTask(p, L(p), T0 + 5);
  p = C.completeTask(p, L(p), T0 + 10);
  expect(list(p).active.startedAtMs).toBeNull();
});
spec("C5", "terminer la seule tâche vide l'actif ; terminer une autre par id n'y touche pas", () => {
  let s = withTasks("A");
  s = C.startTask(s, L(s), null, T0);
  s = C.completeTask(s, L(s), T0 + 5);
  expect(list(s).active).toBeNull();
  let t = withTasks("A", "B");
  t = C.startTask(t, L(t), null, T0);
  t = C.completeTask(t, L(t), T0 + 5, tid(t, 1));
  expect(titles(tasks(t))).toEqual(["A"]);
  expect(list(t).active.startedAtMs).toBe(T0);
});
spec("C5", "terminer dans une liste n'affecte pas l'autre", () => {
  let { s, l1, l2 } = twoLists();
  s = C.startTask(s, l1, null, T0);
  s = C.startTask(s, l2, null, T0);
  s = C.completeTask(s, l2, T0 + min(1));
  expect(list(s, l2).active).toBeNull();
  expect(list(s, l1).active.startedAtMs).toBe(T0);
});
spec("C6", "passer : en fin de liste, la suivante prend la tête", () => {
  let s = withTasks("A", "B", "C");
  s = C.startTask(s, L(s), null, T0);
  const b = tid(s, 1);
  s = C.skipTask(s, L(s), T0 + sec(30));
  expect(titles(tasks(s))).toEqual(["B", "C", "A"]);
  expect(tasks(s)[2].spentSec).toBe(30);
  expect(list(s).active).toEqual({ taskId: b, startedAtMs: T0 + sec(30) });
  const one = C.startTask(withTasks("A"), "main", null, T0);
  expect(C.skipTask(one, "main", T0 + 5)).toBe(one);
});
spec("C7", "nextTask = la tâche après celle en cours", () => {
  let s = withTasks("A", "B");
  expect(C.nextTask(s, L(s))).toBeNull();
  s = C.startTask(s, L(s), tid(s, 1), T0);
  expect(C.nextTask(s, L(s)).title).toBe("A");
});
spec("C8", "titre d'onglet : le minuteur le plus proche de zéro, +N", () => {
  let { s, l1, l2 } = twoLists();
  expect(C.tabTitle(s, T0)).toBe("Sablier");
  s = C.startTask(s, l1, null, T0);
  expect(C.tabTitle(s, T0 + sec(30))).toBe("09:30 · A");
  s = C.startTask(s, l2, null, T0);
  expect(C.tabTitle(s, T0 + sec(30))).toBe("04:30 · Cuire (+1)");
  s = C.pauseTask(s, l2, T0 + sec(30));
  s = C.pauseTask(s, l1, T0 + sec(30));
  expect(C.tabTitle(s, T0 + sec(30))).toBe("⏸ Sablier");
});
spec("C9", "formats", () => {
  expect(C.fmtTimer(0)).toBe("00:00");
  expect(C.fmtTimer(65)).toBe("01:05");
  expect(C.fmtTimer(3725)).toBe("01:02:05");
  expect(C.fmtTimer(3600)).toBe("01:00:00");
  expect(C.fmtTimer(3599)).toBe("59:59");
  expect(C.fmtTimer(-75)).toBe("+01:15");
  expect(C.fmtDuration(25)).toBe("25 min");
  expect(C.fmtDuration(60)).toBe("1 h");
  expect(C.fmtDuration(65)).toBe("1 h 05");
});

// ================================================================ D / E
spec("D1", "déprioriser : vers Plus tard, minuteur coupé", () => {
  let s = withTasks("A", "B");
  s = C.startTask(s, L(s), null, T0);
  s = C.moveToLater(s, tid(s, 0), T0 + sec(40));
  expect(titles(tasks(s))).toEqual(["B"]);
  expect(s.later[0].spentSec).toBe(40);
  expect(list(s).active).toBeNull();
});
spec("D2", "réactiver dans la liste visée, supprimer", () => {
  let { s, l1, l2 } = twoLists();
  s = C.moveToLater(s, tid(s, 0, l1), T0);
  s = C.reactivateLater(s, s.later[0].id, l2);
  expect(titles(tasks(s, l2))).toEqual(["Cuire", "A"]);
  s = C.moveToLater(s, tid(s, 0, l1), T0);
  s = C.deleteLater(s, s.later[0].id);
  expect(s.later).toHaveLength(0);
});
spec("E1", "historique : récent en haut, stats", () => {
  let s = withTasks("A", "B");
  s = C.startTask(s, L(s), null, T0);
  s = C.completeTask(s, L(s), T0 + sec(60));
  s = C.completeTask(s, L(s), T0 + sec(90));
  expect(titles(s.done)).toEqual(["B", "A"]);
  expect(C.doneStats(s)).toEqual({ count: 2, spentSec: 90, estimatedSec: 3000 });
});
spec("E2", "rouvrir dans la liste d'origine, ou la liste de repli si supprimée ; vider", () => {
  let { s, l1, l2 } = twoLists();
  s = C.completeTask(s, l2, T0, tid(s, 0, l2));
  s = C.completeTask(s, l1, T0, tid(s, 0, l1));
  s = C.reopenDone(s, s.done[1].id, l1);
  expect(titles(tasks(s, l2))).toEqual(["Cuire"]);
  expect(tasks(s, l2)[0].completedAtMs).toBe(undefined);
  s = C.completeTask(s, l2, T0, tid(s, 0, l2));
  s = C.deleteList(s, l2);
  s = C.reopenDone(s, s.done[0].id, l1);
  expect(titles(tasks(s, l1))).toEqual(["B", "Cuire"]);
  s = C.clearDone(s);
  expect(s.done).toHaveLength(0);
});
spec("E3", "isListCleared : liste vidée par complétion", () => {
  let { s, l2 } = twoLists();
  expect(C.isListCleared(s, l2)).toBe(false);
  s = C.completeTask(s, l2, T0, tid(s, 0, l2));
  expect(C.isListCleared(s, l2)).toBe(true);
  expect(C.isListCleared(C.createState(), "main")).toBe(false);
});

// ================================================================ F — routines
spec("F1", "créer une routine de zéro : étapes validées, emojis auto", () => {
  let s = C.createRoutine(C.createState(), " Matin ", [
    { title: "Café", minutes: 10 },
    { title: "Emails 20m" },
    { title: "  " },
    { title: "Bloc", minutes: 9999, emoji: "🎯" },
  ]);
  expect(s.routines).toHaveLength(1);
  expect(s.routines[0].name).toBe("Matin");
  expect(s.routines[0].items).toEqual([
    { title: "Café", emoji: "☕", minutes: 10 },
    { title: "Emails", emoji: "📧", minutes: 20 },
    { title: "Bloc", emoji: "🎯", minutes: 600 },
  ]);
});
spec("F1", "refuse sans nom ou sans étape valide", () => {
  const s = C.createState();
  expect(C.createRoutine(s, "", [{ title: "A" }])).toBe(s);
  expect(C.createRoutine(s, "R", [{ title: " " }])).toBe(s);
  expect(C.createRoutine(s, "R", [])).toBe(s);
});
spec("F2", "modifier une routine (nom, étapes) ; refus si invalide", () => {
  let s = C.createRoutine(C.createState(), "R", [{ title: "A" }, { title: "B" }]);
  const id = s.routines[0].id;
  s = C.updateRoutine(s, id, { name: "R2", items: [{ title: "B", minutes: 5 }, { title: "A", minutes: 7 }] });
  expect(s.routines[0].name).toBe("R2");
  expect(titles(s.routines[0].items)).toEqual(["B", "A"]);
  expect(s.routines[0].id).toBe(id);
  expect(C.updateRoutine(s, id, { name: "R3", items: [] })).toBe(s);
  expect(C.updateRoutine(s, "nope", { name: "X", items: [{ title: "A" }] })).toBe(s);
});
spec("F3", "lancer : nouvelle liste nommée comme la routine, ouverte, première étape démarrée", () => {
  let s = withTasks("Existant");
  s = C.startTask(s, L(s), null, T0);
  s = C.createRoutine(s, "Cuisine", [{ title: "Éplucher", minutes: 5 }, { title: "Cuire", minutes: 20 }]);
  const first = L(s);
  s = C.launchRoutine(s, s.routines[0].id, T0 + min(1));
  expect(s.lists).toHaveLength(2);
  expect(list(s).name).toBe("Cuisine");
  expect(titles(tasks(s))).toEqual(["Éplucher", "Cuire"]);
  expect(list(s).active).toEqual({ taskId: tid(s, 0), startedAtMs: T0 + min(1) });
  expect(C.isRunning(s, first)).toBe(true);
});
spec("F3", "lancer sans démarrer ; routine inconnue : inchangé", () => {
  let s = C.createRoutine(C.createState(), "R", [{ title: "A" }]);
  const t = C.launchRoutine(s, s.routines[0].id, T0, { start: false });
  expect(list(t).active).toBeNull();
  expect(C.launchRoutine(s, "nope", T0)).toBe(s);
});
spec("F4", "charger dans une liste : ajouter à la suite ou remplacer", () => {
  let s = withTasks("A");
  s = C.createRoutine(s, "R", [{ title: "X" }, { title: "Y" }]);
  const r = s.routines[0].id;
  s = C.loadRoutine(s, r, L(s), "append");
  expect(titles(tasks(s))).toEqual(["A", "X", "Y"]);
  s = C.startTask(s, L(s), null, T0);
  s = C.loadRoutine(s, r, L(s), "replace");
  expect(titles(tasks(s))).toEqual(["X", "Y"]);
  expect(list(s).active).toBeNull();
  expect(new Set(tasks(s).map((t) => t.id)).size).toBe(2);
});
spec("F5", "enregistrer une liste comme routine", () => {
  let s = withTasks({ title: "A", minutes: 5, emoji: "☕" }, "B");
  s = C.saveListAsRoutine(s, L(s), "Matin");
  expect(s.routines[0].items).toEqual([{ title: "A", emoji: "☕", minutes: 5 }, { title: "B", emoji: "🧠", minutes: 25 }]);
  const e = C.createState();
  expect(C.saveListAsRoutine(e, L(e), "X")).toBe(e);
});
spec("F6", "supprimer une routine", () => {
  let s = C.createRoutine(C.createState(), "R", [{ title: "A" }]);
  s = C.deleteRoutine(s, s.routines[0].id);
  expect(s.routines).toHaveLength(0);
});

// ================================================================ G — persistance
spec("G2", "un état neuf a updatedAtMs = 0", () => {
  expect(C.createState().updatedAtMs).toBe(0);
});
spec("G3", "conflits : plus récent appliqué, plus ancien et écho ignorés", () => {
  const local = C.stamp(withTasks("A"), 1000, "moi");
  expect(C.shouldApplyRemote(local, C.stamp(withTasks("B"), 2000, "x"), "moi")).toBe(true);
  expect(C.shouldApplyRemote(local, C.stamp(withTasks("C"), 500, "x"), "moi")).toBe(false);
  expect(C.shouldApplyRemote(local, JSON.parse(JSON.stringify(local)), "moi")).toBe(false);
  expect(C.shouldApplyRemote(C.createState(), C.stamp(withTasks("A"), 5, "x"), "moi")).toBe(true);
  expect(C.shouldApplyRemote(local, null, "moi")).toBe(false);
});
spec("G4", "migre la v2 (liste unique) vers « Ma liste »", () => {
  const v2 = {
    version: 2,
    tasks: [{ id: "t1", emoji: "📝", title: "Point", minutes: 20, spentSec: 30 }, { id: "t2", title: "Autre", minutes: 5 }],
    active: { taskId: "t2", startedAtMs: 1000 },
    later: [{ id: "n1", title: "Plus tard", minutes: 5 }],
    done: [{ id: "d1", title: "Fait", minutes: 5, spentSec: 60, completedAtMs: 9 }],
    routines: [{ id: "r1", name: "Matin", items: [{ title: "Café", emoji: "☕", minutes: 10 }] }],
    settings: { sound: false },
    updatedAtMs: 42,
  };
  const s = C.normalizeState(v2);
  expect(s.version).toBe(3);
  expect(s.lists).toHaveLength(1);
  expect(s.lists[0].name).toBe("Ma liste");
  expect(titles(s.lists[0].tasks)).toEqual(["Autre", "Point"]); // tâche en cours épinglée en tête
  expect(s.lists[0].active).toEqual({ taskId: "t2", startedAtMs: 1000 });
  expect(s.lists[0].tasks[1].spentSec).toBe(30);
  expect(titles(s.later)).toEqual(["Plus tard"]);
  expect(s.done[0].listName).toBe("Ma liste");
  expect(s.routines[0].items).toEqual([{ title: "Café", emoji: "☕", minutes: 10 }]);
  expect(s.settings.sound).toBe(false);
  expect(s.updatedAtMs).toBe(42);
});
spec("G4", "migre la v1 (focus, notNow, presets)", () => {
  const s = C.normalizeState({
    focus: null, notNow: [{ id: "n1", emoji: "📦", title: "Plus tard", minutes: 5 }],
    presets: [{ id: "p1", name: "Matin", items: [{ emoji: "☕", title: "Café", minutes: 10 }] }],
    tasks: [{ id: "t1", emoji: "📝", title: "Point", minutes: 20 }], updatedAtMs: 7,
  });
  expect(s.lists[0].tasks).toEqual([{ id: "t1", emoji: "📝", title: "Point", minutes: 20, spentSec: 0 }]);
  expect(titles(s.later)).toEqual(["Plus tard"]);
  expect(s.routines[0].name).toBe("Matin");
  expect(s.settings).toEqual(C.DEFAULT_SETTINGS);
});
spec("G4", "nettoie les données invalides (ids dupliqués entre listes, liste courante inconnue)", () => {
  const s = C.normalizeState({
    version: 3,
    lists: [
      { id: "a", name: "", tasks: [null, { title: "" }, { id: "x", title: "Ok", minutes: -3 }], active: { taskId: "zz", startedAtMs: 5 } },
      { id: "a", name: "Doublon", tasks: [{ id: "x", title: "Même id" }] },
    ],
    currentListId: "inconnue",
    settings: { sound: "oui", defaultMinutes: 9999, theme: "fluo" },
  });
  expect(s.lists).toHaveLength(2);
  expect(s.lists[0].name).toBe("Liste 1");
  expect(s.lists[0].id).not.toBe(s.lists[1].id);
  expect(s.lists[0].tasks[0].minutes).toBe(1);
  expect(s.lists[0].tasks[0].id).not.toBe(s.lists[1].tasks[0].id);
  expect(s.lists[0].active).toBeNull();
  expect(s.currentListId).toBe(s.lists[0].id);
  expect(s.settings).toEqual({ ...C.DEFAULT_SETTINGS, defaultMinutes: 600 });
});
spec("G4", "normalizeState(null) / lists vide donnent un état neuf", () => {
  expect(C.normalizeState(null)).toEqual(C.createState());
  expect(C.normalizeState({ version: 3, lists: [] }).lists).toHaveLength(1);
});

// ================================================================ H
spec("H1", "updateSettings valide chaque réglage", () => {
  let s = C.updateSettings(C.createState(), { sound: false, autoStartNext: false, defaultMinutes: "45", theme: "dark", showDone: true });
  expect(s.settings).toEqual({ ...C.DEFAULT_SETTINGS, sound: false, autoStartNext: false, defaultMinutes: 45, theme: "dark", showDone: true });
  s = C.updateSettings(s, { theme: "fluo", defaultMinutes: "x" });
  expect(s.settings.theme).toBe("dark");
  expect(s.settings.defaultMinutes).toBe(45);
});

// ================================================================ v4
spec("A10", "promouvoir sans tâche en cours : passe en tête (« Prochaine »)", () => {
  let s = withTasks("A", "B", "C");
  s = C.promoteTask(s, L(s), tid(s, 2), T0);
  expect(titles(tasks(s))).toEqual(["C", "A", "B"]);
  expect(list(s).active).toBeNull();
  expect(C.promoteTask(s, L(s), tid(s, 0), T0)).toBe(s);
  expect(C.promoteTask(s, L(s), "nope", T0)).toBe(s);
});
spec("A10", "promouvoir quand la liste tourne : la tâche démarre, l'ancienne garde son temps", () => {
  let s = withTasks("A", "B", "C");
  s = C.startTask(s, L(s), null, T0);
  const c = tid(s, 2);
  s = C.promoteTask(s, L(s), c, T0 + sec(40));
  expect(titles(tasks(s))).toEqual(["C", "A", "B"]);
  expect(list(s).active).toEqual({ taskId: c, startedAtMs: T0 + sec(40) });
  expect(tasks(s)[1].spentSec).toBe(40);
});
spec("A10", "promouvoir quand la liste est en pause : la tâche devient courante, en pause", () => {
  let s = withTasks("A", "B");
  s = C.startTask(s, L(s), null, T0);
  s = C.pauseTask(s, L(s), T0 + sec(20));
  const b = tid(s, 1);
  s = C.promoteTask(s, L(s), b, T0 + sec(60));
  expect(titles(tasks(s))).toEqual(["B", "A"]);
  expect(list(s).active).toEqual({ taskId: b, startedAtMs: null });
  expect(tasks(s)[1].spentSec).toBe(20);
});
spec("A11", "tout en haut / tout en bas (sans tâche en cours)", () => {
  let s = withTasks("A", "B", "C", "D");
  s = C.moveTaskToEdge(s, tid(s, 2), "top");
  expect(titles(tasks(s))).toEqual(["C", "A", "B", "D"]);
  s = C.moveTaskToEdge(s, tid(s, 0), "bottom");
  expect(titles(tasks(s))).toEqual(["A", "B", "D", "C"]);
  expect(C.moveTaskToEdge(s, tid(s, 3), "bottom")).toBe(s);
  expect(C.moveTaskToEdge(s, tid(s, 0), "top")).toBe(s);
});
spec("A11", "tout en haut s'arrête juste après la tâche en cours, qui ne bouge pas", () => {
  let s = withTasks("A", "B", "C", "D");
  s = C.startTask(s, L(s), null, T0);
  s = C.moveTaskToEdge(s, tid(s, 3), "top");
  expect(titles(tasks(s))).toEqual(["A", "D", "B", "C"]);
  expect(C.moveTaskToEdge(s, tid(s, 0), "bottom")).toBe(s);
  expect(C.moveTaskToEdge(s, tid(s, 1), "top")).toBe(s);
});
spec("U4", "créneaux estimés : enchaînés depuis maintenant, temps passé déduit", () => {
  let s = withTasks({ title: "A", minutes: 10 }, { title: "B", minutes: 30 }, { title: "C", minutes: 5 });
  s = C.startTask(s, L(s), null, T0);
  const sch = C.schedule(s, L(s), T0 + min(4));
  expect(sch.map((x) => x.taskId)).toEqual(tasks(s).map((t) => t.id));
  expect(sch.map((x) => [(x.startAtMs - T0) / 60000, (x.endAtMs - T0) / 60000])).toEqual([[4, 10], [10, 40], [40, 45]]);
});
spec("U4", "une tâche en dépassement ne décale pas les suivantes vers le passé", () => {
  let s = withTasks({ title: "A", minutes: 1 }, { title: "B", minutes: 5 });
  s = C.startTask(s, L(s), null, T0);
  const sch = C.schedule(s, L(s), T0 + min(3));
  expect(sch.map((x) => [(x.startAtMs - T0) / 60000, (x.endAtMs - T0) / 60000])).toEqual([[3, 3], [3, 8]]);
  expect(C.schedule(s, "nope", T0)).toEqual([]);
});
spec("E4", "terminées d'une liste, les plus récentes d'abord", () => {
  let { s, l1, l2 } = twoLists();
  s = C.completeTask(s, l1, T0, tid(s, 0, l1));
  s = C.completeTask(s, l2, T0 + 1, tid(s, 0, l2));
  s = C.completeTask(s, l1, T0 + 2, tid(s, 0, l1));
  expect(titles(C.doneForList(s, l1))).toEqual(["B", "A"]);
  expect(titles(C.doneForList(s, l2))).toEqual(["Cuire"]);
});
spec("E4", "réglage showDone : faux par défaut, mémorisé", () => {
  expect(C.createState().settings.showDone).toBe(false);
  const s = C.updateSettings(C.createState(), { showDone: true });
  expect(C.normalizeState(JSON.parse(JSON.stringify(s))).settings.showDone).toBe(true);
});

// ================================================================ v5
spec("C3", "taper le temps restant : tâche pas encore lancée", () => {
  let s = withTasks({ title: "A", minutes: 20 }, "B");
  s = C.setRemaining(s, L(s), 35, T0);
  expect(C.remainingSec(s, tid(s, 0), T0)).toBe(35 * 60);
  expect(tasks(s)[0].minutes).toBe(35);
});
spec("C3", "taper le temps restant en cours de route : repart exactement, temps passé conservé", () => {
  let s = withTasks({ title: "A", minutes: 20 });
  s = C.startTask(s, L(s), null, T0);
  s = C.setRemaining(s, L(s), 10, T0 + sec(90));
  expect(C.remainingSec(s, tid(s, 0), T0 + sec(90))).toBe(600);
  expect(C.isRunning(s, L(s))).toBe(true);
  expect(C.remainingSec(s, tid(s, 0), T0 + sec(150))).toBe(540);
  expect(C.elapsedSec(s, tid(s, 0), T0 + sec(150))).toBe(150);
  // survit à un rechargement (durée non entière conservée)
  const re = C.normalizeState(JSON.parse(JSON.stringify(s)));
  expect(C.remainingSec(re, tid(s, 0), T0 + sec(150))).toBe(540);
});
spec("C3", "taper le temps restant : minimum 1 min, signal réarmé, valeur invalide ignorée", () => {
  let s = withTasks({ title: "A", minutes: 1 });
  s = C.startTask(s, L(s), null, T0);
  s = C.checkTimeUp(s, T0 + sec(70)).state;
  s = C.setRemaining(s, L(s), 0, T0 + sec(70));
  expect(C.remainingSec(s, tid(s, 0), T0 + sec(70))).toBe(60);
  expect(C.checkTimeUp(s, T0 + sec(131)).fired).toHaveLength(1);
  expect(C.setRemaining(s, L(s), "abc", T0)).toBe(s);
  expect(C.setRemaining(C.createState(), "main", 5, T0).lists[0].tasks).toHaveLength(0);
});
spec("A12", "ajouter en haut : prochaine si rien ne tourne, sinon juste après la tâche en cours", () => {
  let s = withTasks("A", "B");
  s = C.addTask(s, L(s), { title: "Urgent" }, { position: "top" });
  expect(titles(tasks(s))).toEqual(["Urgent", "A", "B"]);
  s = C.startTask(s, L(s), null, T0);
  s = C.addTask(s, L(s), { title: "Encore plus urgent 5m" }, { position: "top" });
  expect(titles(tasks(s))).toEqual(["Urgent", "Encore plus urgent", "A", "B"]);
  expect(tasks(s)[1].minutes).toBe(5);
  expect(list(s).active.taskId).toBe(tid(s, 0));
});

// ================================================================ v6
spec("H1", "nouveaux réglages : valeurs par défaut et validation", () => {
  const d = C.createState().settings;
  expect([d.clockStyle, d.accent, d.autoAdvance, d.routineInsert]).toEqual(["ring", "green", false, "bottom"]);
  let s = C.updateSettings(C.createState(), { clockStyle: "pie", accent: "violet", autoAdvance: true, routineInsert: "top" });
  expect([s.settings.clockStyle, s.settings.accent, s.settings.autoAdvance, s.settings.routineInsert]).toEqual(["pie", "violet", true, "top"]);
  s = C.updateSettings(s, { clockStyle: "sablier", accent: "fluo", autoAdvance: "oui", routineInsert: "milieu" });
  expect([s.settings.clockStyle, s.settings.accent, s.settings.autoAdvance, s.settings.routineInsert]).toEqual(["pie", "violet", true, "top"]);
  const re = C.normalizeState({ settings: { clockStyle: "digital", accent: "nope" } }).settings;
  expect([re.clockStyle, re.accent]).toEqual(["digital", "green"]);
});
spec("H2", "liste des couleurs d'accentuation", () => {
  expect(C.ACCENTS).toEqual(["green", "blue", "violet", "pink", "orange", "red", "teal"]);
  expect(C.CLOCK_STYLES).toEqual(["ring", "pie", "digital"]);
});
spec("C11", "passage automatique : terminée à l'instant exact, la suivante démarre à ce moment", () => {
  let s = C.updateSettings(withTasks({ title: "A", minutes: 1 }, { title: "B", minutes: 5 }), { autoAdvance: true });
  s = C.startTask(s, L(s), null, T0);
  const r = C.advanceTimeUp(s, T0 + sec(70));
  expect(r.completed).toEqual([{ listId: L(s), taskId: tid(s, 0) }]);
  expect(r.state.done[0].spentSec).toBe(60);
  expect(r.state.done[0].completedAtMs).toBe(T0 + sec(60));
  expect(list(r.state).active).toEqual({ taskId: tid(r.state, 0), startedAtMs: T0 + sec(60) });
  expect(C.remainingSec(r.state, tid(r.state, 0), T0 + sec(70))).toBe(290);
});
spec("C11", "passage automatique en chaîne après une longue veille", () => {
  let s = C.updateSettings(withTasks({ title: "A", minutes: 1 }, { title: "B", minutes: 1 }, { title: "C", minutes: 5 }), { autoAdvance: true });
  s = C.startTask(s, L(s), null, T0);
  const r = C.advanceTimeUp(s, T0 + sec(150));
  expect(titles(r.state.done)).toEqual(["B", "A"]);
  expect(list(r.state).active.startedAtMs).toBe(T0 + sec(120));
  expect(titles(tasks(r.state))).toEqual(["C"]);
});
spec("C11", "désactivé, en pause ou temps restant : rien ne change ; dernière tâche : liste vidée", () => {
  let s = withTasks({ title: "A", minutes: 1 });
  s = C.startTask(s, L(s), null, T0);
  expect(C.advanceTimeUp(s, T0 + min(5)).state).toBe(s);
  s = C.updateSettings(s, { autoAdvance: true });
  expect(C.advanceTimeUp(s, T0 + sec(30)).state).toBe(s);
  const paused = C.pauseTask(s, L(s), T0 + sec(30));
  expect(C.advanceTimeUp(paused, T0 + min(5)).state).toBe(paused);
  const r = C.advanceTimeUp(s, T0 + min(5));
  expect(tasks(r.state)).toHaveLength(0);
  expect(list(r.state).active).toBeNull();
});
spec("F4", "charger une routine en haut : après la tâche en cours, sinon en tête", () => {
  let s = withTasks("A", "B");
  s = C.createRoutine(s, "R", [{ title: "X" }, { title: "Y" }]);
  const r = s.routines[0].id;
  let t = C.loadRoutine(s, r, L(s), "top");
  expect(titles(tasks(t))).toEqual(["X", "Y", "A", "B"]);
  s = C.startTask(s, L(s), null, T0);
  t = C.loadRoutine(s, r, L(s), "top");
  expect(titles(tasks(t))).toEqual(["A", "X", "Y", "B"]);
  expect(list(t).active.taskId).toBe(tid(t, 0));
});
spec("C10", "géométrie du camembert : part restante depuis midi, sens horaire", () => {
  expect(C.piePath(0, 50, 50, 40)).toBe("");
  expect(C.piePath(1, 50, 50, 40)).toBe("M50 10 A40 40 0 1 1 49.99 10 Z");
  expect(C.piePath(0.25, 50, 50, 40)).toBe("M50 50 L50 10 A40 40 0 0 1 90 50 Z");
  expect(C.piePath(0.75, 50, 50, 40)).toBe("M50 50 L50 10 A40 40 0 1 1 10 50 Z");
});

// ================================================================ v7
spec("H3", "choix du son : défaut carillon, valeurs validées", () => {
  expect(C.SOUNDS).toEqual(["chime", "bell", "bowl", "marimba", "harp"]);
  expect(C.createState().settings.soundType).toBe("chime");
  let s = C.updateSettings(C.createState(), { soundType: "bowl" });
  expect(s.settings.soundType).toBe("bowl");
  s = C.updateSettings(s, { soundType: "klaxon" });
  expect(s.settings.soundType).toBe("bowl");
  expect(C.normalizeState({ settings: { soundType: "klaxon" } }).settings.soundType).toBe("chime");
});

// ================================================================ v8
spec("H3", "anciens sons convertis : gong → bol chantant, bip → harpe", () => {
  expect(C.normalizeState({ settings: { soundType: "gong" } }).settings.soundType).toBe("bowl");
  expect(C.normalizeState({ settings: { soundType: "beep" } }).settings.soundType).toBe("harp");
});
spec("C10", "cadran minuteur : part = minutes restantes sur 60, bornée", () => {
  expect(C.dialFraction(15 * 60)).toBe(0.25);
  expect(C.dialFraction(90 * 60)).toBe(1);
  expect(C.dialFraction(0)).toBe(0);
  expect(C.dialFraction(-30)).toBe(0);
});

// ================================================================ v9
spec("C3", "parseClock : minutes seules ou minutes:secondes", () => {
  expect(C.parseClock("19:42")).toBe(1182);
  expect(C.parseClock("19")).toBe(1140);
  expect(C.parseClock("19.42")).toBe(1182);
  expect(C.parseClock("19,42")).toBe(1182);
  expect(C.parseClock(" 19 42 ")).toBe(1182);
  expect(C.parseClock("1:02:03")).toBe(3723);
  expect(C.parseClock("0:45")).toBe(45);
  expect(C.parseClock("19:75")).toBeNull();
  expect(C.parseClock("abc")).toBeNull();
  expect(C.parseClock("")).toBeNull();
  expect(C.parseClock("0")).toBeNull();
});
spec("C3", "fixer le temps restant à la seconde près, temps passé conservé", () => {
  let s = withTasks({ title: "A", minutes: 20 });
  s = C.startTask(s, L(s), null, T0);
  s = C.setRemainingSec(s, L(s), 1182, T0 + sec(18));
  expect(C.remainingSec(s, tid(s, 0), T0 + sec(18))).toBe(1182);
  expect(C.elapsedSec(s, tid(s, 0), T0 + sec(18))).toBe(18);
  s = C.setRemainingSec(s, L(s), 30, T0 + sec(18));
  expect(C.remainingSec(s, tid(s, 0), T0 + sec(18))).toBe(30);
  const re = C.normalizeState(JSON.parse(JSON.stringify(s)));
  expect(C.remainingSec(re, tid(s, 0), T0 + sec(28))).toBe(20);
  expect(C.setRemainingSec(s, L(s), 0, T0)).toBe(s);
  expect(C.setRemainingSec(s, L(s), null, T0)).toBe(s);
});

// ================================================================ v10
spec("N1", "alarmes : fin de la tâche en cours de chaque liste qui tourne", () => {
  let { s, l1, l2 } = twoLists();
  expect(C.upcomingAlarms(s, T0)).toEqual([]);
  s = C.startTask(s, l1, null, T0);
  s = C.startTask(s, l2, null, T0 + min(1));
  const al = C.upcomingAlarms(s, T0 + min(2));
  expect(al.map((a) => [a.listName, a.title, (a.atMs - T0) / 60000])).toEqual([["Ma liste", "A", 10], ["Cuisine", "Cuire", 6]]);
  expect(al[0].id).toBe(C.upcomingAlarms(s, T0 + min(3))[0].id); // identifiant stable
  expect(Number.isInteger(al[0].id) && al[0].id > 0).toBe(true);
});
spec("N1", "alarmes : rien pour une liste en pause ou une tâche déjà dépassée", () => {
  let s = withTasks({ title: "A", minutes: 1 }, "B");
  s = C.startTask(s, L(s), null, T0);
  expect(C.upcomingAlarms(s, T0 + min(2))).toEqual([]);
  s = C.pauseTask(s, L(s), T0 + sec(10));
  expect(C.upcomingAlarms(s, T0 + sec(20))).toEqual([]);
});
spec("N1", "alarmes : avec le passage automatique, une alarme par tâche à venir", () => {
  let s = C.updateSettings(withTasks({ title: "A", minutes: 10 }, { title: "B", minutes: 5 }, { title: "C", minutes: 5 }), { autoAdvance: true });
  s = C.startTask(s, L(s), null, T0);
  const al = C.upcomingAlarms(s, T0 + min(4));
  expect(al.map((a) => [a.title, (a.atMs - T0) / 60000])).toEqual([["A", 10], ["B", 15], ["C", 20]]);
  expect(new Set(al.map((a) => a.id)).size).toBe(3);
});
spec("G5", "import : texte valide → état normalisé ; texte invalide → null", () => {
  const s = withTasks("A");
  const back = C.importData(JSON.stringify(s));
  expect(titles(back.lists[0].tasks)).toEqual(["A"]);
  expect(C.importData("pas du json")).toBeNull();
  expect(C.importData("[1,2]")).toBeNull();
  expect(C.importData("{}")).toBeNull();
});

// ================================================================ v11
spec("S1", "configuration Firebase collée depuis la console", () => {
  const snippet = `// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
const firebaseConfig = {
  apiKey: "AIzaSyB-test_123",
  authDomain: "mon-sablier.firebaseapp.com",
  projectId: "mon-sablier",
  storageBucket: "mon-sablier.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
const app = initializeApp(firebaseConfig);`;
  expect(C.parseFirebaseConfig(snippet)).toEqual({
    apiKey: "AIzaSyB-test_123", authDomain: "mon-sablier.firebaseapp.com", projectId: "mon-sablier",
    storageBucket: "mon-sablier.firebasestorage.app", messagingSenderId: "1234567890", appId: "1:1234567890:web:abcdef",
  });
  expect(C.parseFirebaseConfig('{"apiKey":"k","projectId":"p","appId":"a"}')).toEqual({ apiKey: "k", projectId: "p", appId: "a" });
  expect(C.parseFirebaseConfig("apiKey: 'k', projectId: 'p'")).toEqual({ apiKey: "k", projectId: "p" });
  expect(C.parseFirebaseConfig("bonjour")).toBeNull();
  expect(C.parseFirebaseConfig('{ apiKey: "k" }')).toBeNull(); // projectId manquant
});
spec("A5", "recherche d'emoji : mots français, sans accents, libellés et mots-clés", () => {
  const data = [["☕", "boisson chaude", "boisson café caféine matin thé", 4], ["🎯", "dans le mille", "cible fléchettes jeu", 6], ["🐈", "chat", "animal chat", 3]];
  expect(C.searchEmoji(data, "cafe").map((x) => x[0])).toEqual(["☕"]);
  expect(C.searchEmoji(data, "CIBLE").map((x) => x[0])).toEqual(["🎯"]);
  expect(C.searchEmoji(data, "cha").map((x) => x[0])).toEqual(["🐈", "☕"]); // libellé exact/début d'abord
  expect(C.searchEmoji(data, "").length).toBe(3);
});

// ================================================================ v13
spec("C12", "remettre le temps à zéro : tâche en cours qui tourne", () => {
  let s = withTasks({ title: "A", minutes: 20 }, "B");
  s = C.startTask(s, L(s), null, T0);
  s = C.checkTimeUp(s, T0 + min(25)).state;
  s = C.resetTime(s, tid(s, 0), T0 + min(25));
  expect(C.remainingSec(s, tid(s, 0), T0 + min(25))).toBe(1200);
  expect(C.isRunning(s, L(s))).toBe(true);
  expect(C.remainingSec(s, tid(s, 0), T0 + min(26))).toBe(1140);
  expect(C.checkTimeUp(s, T0 + min(46)).fired).toHaveLength(1); // signal réarmé
});
spec("C12", "remettre à zéro : en pause, durée non entière arrondie, tâche de la file", () => {
  let s = withTasks({ title: "A", minutes: 20 }, { title: "B", minutes: 10 });
  s = C.startTask(s, L(s), null, T0);
  s = C.setRemainingSec(s, L(s), 1182, T0 + sec(18)); // durée devient fractionnaire
  s = C.pauseTask(s, L(s), T0 + min(2));
  s = C.resetTime(s, tid(s, 0), T0 + min(3));
  expect(C.isRunning(s, L(s))).toBe(false);
  expect(tasks(s)[0].minutes).toBe(20);
  expect(C.remainingSec(s, tid(s, 0), T0 + min(9))).toBe(1200);
  s = C.startTask(s, L(s), tid(s, 1), T0 + min(10));
  s = C.resetTime(s, tid(s, 1), T0 + min(12)); // B tourne
  s = C.resetTime(s, tid(s, 1), T0 + min(12));
  const a = tasks(s).find((t) => t.title === "A");
  expect(a.spentSec).toBe(0);
  expect(C.resetTime(s, "nope", T0)).toBe(s);
});

// ================================================================ v14 — heures limites
const at = (h, m) => new Date(2026, 10, 19, h, m, 0).getTime();
const NOW = at(14, 0);
const mins = (p) => p.tasks.map((x) => Math.round(x.adjustedSec / 60));
spec("T1", "sans heure limite : temps ajusté = temps prévu", () => {
  const s = withTasks({ title: "A", minutes: 30 }, { title: "B", minutes: 30 });
  const p = C.plan(s, L(s), NOW);
  expect(mins(p)).toEqual([30, 30]);
  expect(p.tasks.map((x) => C.fmtClock(x.endAtMs))).toEqual(["14:30", "15:00"]);
  expect(p.segments).toEqual([]);
});
spec("T1", "heure de fin de liste plus courte : raccourci proportionnel", () => {
  let s = withTasks({ title: "A", minutes: 30 }, { title: "B", minutes: 60 });
  s = C.setListFinishBy(s, L(s), at(15, 0));
  const p = C.plan(s, L(s), NOW);
  expect(mins(p)).toEqual([20, 40]);
  expect(p.tasks.map((x) => Math.round(x.plannedSec / 60))).toEqual([30, 60]);
  expect(C.fmtClock(p.tasks[1].endAtMs)).toBe("15:00");
  expect(p.segments[0]).toEqual({ endIndex: 1, deadlineAtMs: at(15, 0), plannedSec: 5400, availableSec: 3600, factor: 2 / 3, late: false });
  expect(tasks(s)[0].minutes).toBe(30); // les durées prévues ne changent pas
});
spec("T1", "jamais allongé ; retirer l'heure remet comme avant ; heure dépassée", () => {
  let s = withTasks({ title: "A", minutes: 30 });
  s = C.setListFinishBy(s, L(s), at(18, 0));
  expect(mins(C.plan(s, L(s), NOW))).toEqual([30]);
  expect(C.plan(s, L(s), NOW).segments[0].factor).toBe(1);
  s = C.setListFinishBy(s, L(s), null);
  expect(list(s).finishByMs).toBe(undefined);
  s = C.setListFinishBy(s, L(s), at(13, 0));
  const p = C.plan(s, L(s), NOW);
  expect(mins(p)).toEqual([30]); // heure dépassée : on garde le prévu, signalé en retard
  expect(p.segments[0].late).toBe(true);
});
spec("T2", "limite au milieu de la liste : seules les tâches jusqu'à elle sont raccourcies", () => {
  let s = withTasks({ title: "A", minutes: 60 }, { title: "B", minutes: 60 }, { title: "C", minutes: 30 }, { title: "D", minutes: 30 });
  s = C.setTaskFinishBy(s, tid(s, 1), at(15, 0)); // A+B (2 h) doivent tenir en 1 h
  const p = C.plan(s, L(s), NOW);
  expect(mins(p)).toEqual([30, 30, 30, 30]);
  expect(p.tasks.map((x) => C.fmtClock(x.endAtMs))).toEqual(["14:30", "15:00", "15:30", "16:00"]);
  s = C.setListFinishBy(s, L(s), at(15, 30)); // C+D (1 h) doivent tenir en 30 min après 15:00
  expect(mins(C.plan(s, L(s), NOW))).toEqual([30, 30, 15, 15]);
  expect(C.plan(s, L(s), NOW).segments.map((g) => g.endIndex)).toEqual([1, 3]);
  s = C.setTaskFinishBy(s, tid(s, 1), null);
  expect(tasks(s)[1].finishByMs).toBe(undefined);
});
spec("T2", "tâche en cours : seul le temps restant compte ; la limite suit la tâche quand on réordonne", () => {
  let s = withTasks({ title: "A", minutes: 40 }, { title: "B", minutes: 20 });
  s = C.startTask(s, L(s), null, NOW);
  s = C.setTaskFinishBy(s, tid(s, 1), at(14, 50));
  const p = C.plan(s, L(s), NOW + min(10)); // budget 40 dispo + 10 passées = 50 min pour 60 prévues
  expect(mins(p)).toEqual([23, 17]);
  expect(Math.round(p.tasks[0].budgetSec / 60)).toBe(33);
  s = C.moveTaskToEdge(s, tid(s, 1), "top");
  expect(tasks(s)[1].finishByMs).toBe(at(14, 50));
  const re = C.normalizeState(JSON.parse(JSON.stringify(s)));
  expect(tasks(re)[1].finishByMs).toBe(at(14, 50));
});
spec("T1", "heure du jour → horodatage", () => {
  expect(C.timeOfDayToMs(NOW, "15:30")).toBe(at(15, 30));
  expect(C.timeOfDayToMs(NOW, "7:05")).toBe(at(7, 5));
  expect(C.timeOfDayToMs(NOW, "25:00")).toBeNull();
  expect(C.timeOfDayToMs(NOW, "")).toBeNull();
  expect(C.msToTimeOfDay(at(9, 5))).toBe("09:05");
});
spec("F7", "horaire de routine : début → fin estimée, fin → début au plus tard", () => {
  let s = C.createRoutine(C.createState(), "Matin", [{ title: "A", minutes: 45 }, { title: "B", minutes: 30 }], { mode: "start", time: "7:00" });
  expect(s.routines[0].timing).toEqual({ mode: "start", time: "07:00" });
  expect(C.routineWindow(s.routines[0])).toEqual({ start: "07:00", end: "08:15", totalMin: 75 });
  s = C.updateRoutine(s, s.routines[0].id, { name: "Matin", items: s.routines[0].items, timing: { mode: "end", time: "09:00" } });
  expect(C.routineWindow(s.routines[0])).toEqual({ start: "07:45", end: "09:00", totalMin: 75 });
  s = C.updateRoutine(s, s.routines[0].id, { name: "Matin", items: s.routines[0].items, timing: { mode: "end", time: "0:30" } });
  expect(C.routineWindow(s.routines[0]).start).toBe("23:15");
  s = C.updateRoutine(s, s.routines[0].id, { name: "Matin", items: s.routines[0].items, timing: null });
  expect(s.routines[0].timing).toBe(undefined);
  expect(C.routineWindow(s.routines[0])).toBeNull();
});
spec("F7", "lancer une routine « finir à » pose l'heure de fin voulue sur la liste", () => {
  let s = C.createRoutine(C.createState(), "R", [{ title: "A", minutes: 60 }], { mode: "end", time: "14:45" });
  s = C.launchRoutine(s, s.routines[0].id, NOW, { start: false });
  expect(list(s).finishByMs).toBe(at(14, 45));
  expect(mins(C.plan(s, L(s), NOW))).toEqual([45]);
  let t = C.createRoutine(C.createState(), "R", [{ title: "A" }], { mode: "end", time: "13:00" }); // déjà passée
  t = C.launchRoutine(t, t.routines[0].id, NOW, { start: false });
  expect(list(t).finishByMs).toBe(undefined);
});

// ================================================================ v14 — les autres tâches s'adaptent
spec("T4", "le minuteur ajusté décompte à vitesse normale et sonne à la fin ajustée", () => {
  let s = withTasks({ title: "A", minutes: 30 }, { title: "B", minutes: 30 });
  s = C.setTaskFinishBy(s, tid(s, 1), at(14, 40)); // 60 min prévues pour 40 dispo → A 20, B 20
  s = C.startTask(s, L(s), null, NOW);
  expect(C.effectiveRemainingSec(s, tid(s, 0), NOW)).toBe(1200);
  expect(C.effectiveRemainingSec(s, tid(s, 0), NOW + min(5))).toBe(900);
  expect(C.remainingSec(s, tid(s, 0), NOW + min(5))).toBe(1500); // le prévu ne change pas
  expect(C.checkTimeUp(s, NOW + min(19)).fired).toEqual([]);
  expect(C.checkTimeUp(s, NOW + min(20)).fired.length).toBe(1);
  const al = C.upcomingAlarms(s, NOW + sec(30));
  expect(al.map((a) => C.fmtClock(a.atMs))).toEqual(["14:20"]);
  expect(C.tabTitle(s, NOW + min(5))).toBe("15:00 · A");
  // passage automatique : A se termine à 14:20, B a ses 20 min jusqu'à 14:40
  s = C.updateSettings(s, { autoAdvance: true });
  expect(C.upcomingAlarms(s, NOW).map((a) => C.fmtClock(a.atMs))).toEqual(["14:20", "14:40"]);
  const r = C.advanceTimeUp(s, NOW + min(21));
  expect(r.completed.length).toBe(1);
  expect(C.effectiveRemainingSec(r.state, tid(r.state, 0), NOW + min(21))).toBe(1140);
});
spec("T4", "changer la durée prévue d'une tâche du tronçon redistribue le temps", () => {
  let s = withTasks({ title: "A", minutes: 30 }, { title: "B", minutes: 30 }, { title: "C", minutes: 20 });
  s = C.setTaskFinishBy(s, tid(s, 1), at(14, 40));
  expect(mins(C.plan(s, L(s), NOW))).toEqual([20, 20, 20]);
  s = C.updateTask(s, tid(s, 0), { minutes: 50 }); // 80 prévues pour 40 → ×0,5
  expect(mins(C.plan(s, L(s), NOW))).toEqual([25, 15, 20]);
  expect(C.fmtClock(C.plan(s, L(s), NOW).tasks[1].endAtMs)).toBe("14:40");
});
spec("T4", "régler le temps affiché de la tâche en cours : les autres absorbent", () => {
  let s = withTasks({ title: "A", minutes: 30 }, { title: "B", minutes: 30 }, { title: "C", minutes: 20 });
  s = C.setTaskFinishBy(s, tid(s, 1), at(14, 40));
  s = C.startTask(s, L(s), null, NOW);
  const r = C.setShownRemaining(s, L(s), 30 * 60, NOW + min(5)); // A affichait 15:00, on veut 30:00
  expect(r.capped).toBe(false);
  const p = C.plan(r.state, L(r.state), NOW + min(5));
  expect(C.shownSec(p.tasks[0].adjustedSec)).toBe(1800);
  expect(Math.round(p.tasks[1].adjustedSec / 60)).toBe(5); // 35 min dispo − 30
  expect(C.fmtClock(p.tasks[1].endAtMs)).toBe("14:40");
  expect(C.isRunning(r.state, L(r.state))).toBe(true);
  expect(C.effectiveRemainingSec(r.state, tid(r.state, 0), NOW + min(6))).toBe(1740);
  // +5 min de plus que le temps dispo : limité
  const c = C.setShownRemaining(s, L(s), 60 * 60, NOW + min(5));
  expect(c.capped).toBe(true);
  expect(C.effectiveRemainingSec(c.state, tid(c.state, 0), NOW + min(5)) <= 35 * 60).toBe(true);
  // sans heure limite : identique à setRemainingSec
  const plain = withTasks({ title: "A", minutes: 30 });
  expect(tasks(C.setShownRemaining(plain, L(plain), 600, NOW).state)[0].minutes).toBe(10);
});
spec("T4", "heure dépassée : plus de raccourci (durées prévues), signalée en retard", () => {
  let s = withTasks({ title: "A", minutes: 30 }, { title: "B", minutes: 30 });
  s = C.setTaskFinishBy(s, tid(s, 1), at(13, 0));
  const p = C.plan(s, L(s), NOW);
  expect(mins(p)).toEqual([30, 30]);
  expect(p.segments[0].late).toBe(true);
});
spec("T3", "déplacer un jalon d'une tâche à une autre (ou depuis la fin de liste)", () => {
  let s = withTasks({ title: "A", minutes: 30 }, { title: "B", minutes: 30 }, { title: "C", minutes: 30 });
  s = C.setTaskFinishBy(s, tid(s, 2), at(15, 0));
  s = C.moveFinishBy(s, L(s), tid(s, 2), tid(s, 0));
  expect(tasks(s).map((t) => t.finishByMs ?? null)).toEqual([at(15, 0), null, null]);
  s = C.setListFinishBy(s, L(s), at(16, 0));
  s = C.moveFinishBy(s, L(s), null, tid(s, 1));
  expect(list(s).finishByMs).toBe(undefined);
  expect(tasks(s)[1].finishByMs).toBe(at(16, 0));
  expect(C.moveFinishBy(s, L(s), tid(s, 1), tid(s, 0))).toBe(s); // déjà un jalon : refusé
});
spec("F7", "au lancement : choisir une autre heure de fin, ou aucune", () => {
  let s = C.createRoutine(C.createState(), "R", [{ title: "A", minutes: 60 }], { mode: "end", time: "14:45" });
  const a = C.launchRoutine(s, s.routines[0].id, NOW, { finishByMs: at(14, 30) });
  expect(list(a).finishByMs).toBe(at(14, 30));
  const b = C.launchRoutine(s, s.routines[0].id, NOW, { finishByMs: null });
  expect(list(b).finishByMs).toBe(undefined);
  const c = C.launchRoutine(s, s.routines[0].id, NOW, { start: false, finishByMs: null });
  expect(list(c).active).toBe(null);
});

// ================================================================ v15 — emoji automatique
spec("A4", "mots entiers pour les mots-clés courts ; guitare → 🎸", () => {
  expect(C.suggestEmoji("Repas du soir")).toBe("🍳");
  expect(C.suggestEmoji("Repasser les chemises")).not.toBe("🍳");
  expect(C.suggestEmoji("Guitare")).toBe("🎸");
  expect(C.suggestEmoji("Appeler maman")).toBe("☎️");
});
spec("A4", "base complète : noms et mots-clés français", async () => {
  const fs = await import("node:fs").catch(() => null);
  const data = fs ? JSON.parse(fs.readFileSync(new URL("../vendor/emoji-fr.json", import.meta.url), "utf8"))
    : await (await fetch("vendor/emoji-fr.json")).json();
  C.registerEmojiData(data);
  try {
    expect(C.suggestEmoji("Girafe")).toBe("🦒");
    expect(C.suggestEmoji("Repasser les chemises")).toBe("👔");
    expect(C.suggestEmoji("Brosser les dents")).toBe("🦷");
    expect(C.suggestEmoji("Tondre xyzzy")).toBe("🧠");
  } finally { C.registerEmojiData(null); }
});
spec("A4", "renommer : l'emoji automatique suit, un emoji choisi reste", () => {
  let s = withTasks({ title: "Emails" });
  expect(tasks(s)[0].emoji).toBe("📧");
  s = C.updateTask(s, tid(s, 0), { title: "Courses" });
  expect(tasks(s)[0].emoji).toBe("🛒");
  s = C.updateTask(s, tid(s, 0), { emoji: "🦄" });
  s = C.updateTask(s, tid(s, 0), { title: "Emails" });
  expect(tasks(s)[0].emoji).toBe("🦄");
});

// ================================================================ v16
spec("A3", "durée prévue au format minuteur : saisie et lecture", () => {
  expect(C.parseDurationInput("25")).toBe(1500);
  expect(C.parseDurationInput("25:00")).toBe(1500);
  expect(C.parseDurationInput("1:30:00")).toBe(5400);
  expect(C.parseDurationInput("01:30:00")).toBe(5400);
  expect(C.parseDurationInput("90")).toBe(5400);
  expect(C.parseDurationInput("1h30")).toBe(5400);
  expect(C.parseDurationInput("19:42")).toBe(1182);
  expect(C.parseDurationInput("abc")).toBe(null);
  expect(C.parseDurationInput("")).toBe(null);
  let s = withTasks({ title: "A", minutes: 10 });
  s = C.updateTask(s, tid(s, 0), { durationSec: 5400 });
  expect(tasks(s)[0].minutes).toBe(90);
  s = C.updateTask(s, tid(s, 0), { durationSec: 1182 });
  expect(C.remainingSec(s, tid(s, 0), T0)).toBe(1182);
  expect(C.updateTask(s, tid(s, 0), { durationSec: 0 })).toEqual(s);
  s = C.updateTask(s, tid(s, 0), { durationSec: 999999 });
  expect(tasks(s)[0].minutes).toBe(600);
});
spec("A13", "insérer une tâche après une autre", () => {
  let s = withTasks("A", "B", "C");
  s = C.addTask(s, L(s), { title: "X" }, { afterId: tid(s, 0) });
  expect(tasks(s).map((t) => t.title)).toEqual(["A", "X", "B", "C"]);
  s = C.addTask(s, L(s), { title: "Y" }, { afterId: tid(s, 3) });
  expect(tasks(s).map((t) => t.title)).toEqual(["A", "X", "B", "C", "Y"]);
  s = C.addTask(s, L(s), { title: "Z" }, { afterId: "inconnu" });
  expect(tasks(s).map((t) => t.title).at(-1)).toBe("Z");
});
spec("C13", "avertissement avant la fin : zone, une fois par durée, réglage", () => {
  let s = withTasks({ title: "A", minutes: 10 }, { title: "B", minutes: 10 });
  expect(s.settings.warnPercent).toBe(0);
  expect(C.updateSettings(s, { warnPercent: 37 }).settings.warnPercent).toBe(0);
  s = C.updateSettings(s, { warnPercent: 20 });
  s = C.startTask(s, L(s), null, T0);
  expect(C.warnDue(s, T0 + min(7))).toEqual([]);
  const due = C.warnDue(s, T0 + min(8));
  expect(due.map((d) => d.taskId)).toEqual([tid(s, 0)]);
  expect(C.inWarnZone(s, tid(s, 0), T0 + min(8) + sec(1))).toBe(true);
  expect(C.inWarnZone(s, tid(s, 0), T0 + min(5))).toBe(false);
  expect(C.warnDue(s, T0 + min(11))).toEqual([]); // dépassé : c'est le signal de fin qui prend le relais
  const s2 = C.adjustTime(s, L(s), 5);
  expect(C.warnDue(s2, T0 + min(8))).toEqual([]);
  expect(C.warnDue(s2, T0 + min(12)).map((d) => d.key) [0] !== due[0].key).toBe(true); // nouvelle durée : nouvel avertissement
  const al = C.upcomingAlarms(s, T0 + min(1));
  expect(al.map((a) => [a.kind, (a.atMs - T0) / 60000])).toEqual([["warn", 8], ["end", 10]]);
  expect(al[0].id !== al[1].id).toBe(true);
});
spec("N2", "alarmes seulement pour les tâches démarrées sur cet appareil", () => {
  let { s, l1, l2 } = twoLists();
  s = C.startTask(s, l1, null, T0);
  s = C.startTask(s, l2, null, T0);
  s = C.markStartedBy(s, l1, "tel");
  s = C.markStartedBy(s, l2, "pc");
  expect(C.upcomingAlarms(s, T0, { deviceId: "tel", onlyMine: true }).map((a) => a.listName)).toEqual(["Ma liste"]);
  expect(C.upcomingAlarms(s, T0).length).toBe(2);
  // l'enchaînement automatique garde l'appareil qui a démarré
  s = C.completeTask(s, l1, T0 + min(1));
  expect(C.getList(s, l1).active.startedBy).toBe("tel");
  const re = C.normalizeState(JSON.parse(JSON.stringify(s)));
  expect(C.getList(re, l1).active.startedBy).toBe("tel");
});
spec("G3", "l'état distant reçu garde les signaux déjà donnés sur cet appareil", () => {
  let s = withTasks({ title: "A", minutes: 1 }, "B");
  s = C.startTask(s, L(s), null, T0);
  const fired = C.checkTimeUp(s, T0 + min(2)).state;
  const remote = C.stamp(C.renameList(s, L(s), "Renommée"), T0 + min(3), "pc");
  const merged = C.carryLocalFlags(fired, remote);
  expect(C.checkTimeUp(merged, T0 + min(3)).fired).toEqual([]);
  expect(list(merged).name).toBe("Renommée");
  expect(merged.updatedAtMs).toBe(remote.updatedAtMs);
});

// ================================================================ v17
spec("N3", "notification « minuteur en cours » : tâche qui finit le plus tôt, fin exacte", () => {
  let { s, l1, l2 } = twoLists();
  expect(C.ongoingInfo(s, T0)).toBe(null);
  s = C.startTask(s, l1, null, T0);
  s = C.startTask(s, l2, null, T0 + min(1));
  const o = C.ongoingInfo(s, T0 + min(2));
  expect(o.listId).toBe(l2);
  expect(o.title.endsWith("Cuire")).toBe(true);
  expect(o.text).toBe("Cuisine · +1 autre liste");
  expect(o.endAtMs).toBe(T0 + min(6));
  expect(C.ongoingInfo(s, T0 + min(3)).endAtMs).toBe(o.endAtMs); // stable dans le temps
  s = C.pauseTask(s, l2, T0 + min(3));
  expect(C.ongoingInfo(s, T0 + min(3)).listId).toBe(l1);
  expect(C.ongoingInfo(s, T0 + min(3)).text).toBe("Ma liste");
  s = C.pauseTask(s, l1, T0 + min(3));
  expect(C.ongoingInfo(s, T0 + min(3))).toBe(null);
});

// ================================================================ v18 — jalons à leur place, suppression de la tâche en cours
spec("T3", "un jalon reste à sa place quand on réordonne", () => {
  const titles = (s) => tasks(s).map((t) => t.title + (Number.isFinite(t.finishByMs) ? "|" : ""));
  let s = withTasks("H", "A", "B", "C");
  s = C.setTaskFinishBy(s, tid(s, 2), NOW); // H A B | C
  expect(titles(s)).toEqual(["H", "A", "B|", "C"]);
  s = C.moveTask(s, tid(s, 1), 1); // A descend sous B : le jalon reste sous la 3e tâche
  expect(titles(s)).toEqual(["H", "B", "A|", "C"]);
  s = C.moveTaskToEdge(s, tid(s, 3), "top");
  expect(titles(s)).toEqual(["C", "H", "B|", "A"]);
  s = C.reorderTasks(s, L(s), [tid(s, 3), tid(s, 0), tid(s, 1), tid(s, 2)]);
  expect(titles(s)).toEqual(["A", "C", "H|", "B"]);
  s = C.startTask(s, L(s), tid(s, 3), T0); // ▶ sur B : B en tête
  expect(titles(s)).toEqual(["B", "A", "C|", "H"]);
  s = C.skipTask(s, L(s), T0 + sec(5));
  expect(titles(s)).toEqual(["A", "C", "H|", "B"]);
});
spec("T3", "supprimer ou mettre de côté la tâche du jalon : il passe à la précédente", () => {
  const titles = (s) => tasks(s).map((t) => t.title + (Number.isFinite(t.finishByMs) ? "|" : ""));
  let s = withTasks("A", "B", "C");
  s = C.setTaskFinishBy(s, tid(s, 1), NOW);
  expect(titles(C.deleteTask(s, tid(s, 1)))).toEqual(["A|", "C"]);
  expect(titles(C.moveToLater(s, tid(s, 1), T0))).toEqual(["A|", "C"]);
  s = C.setTaskFinishBy(C.setTaskFinishBy(s, tid(s, 1), null), tid(s, 0), NOW);
  expect(titles(C.deleteTask(s, tid(s, 0)))).toEqual(["B", "C"]);
});
spec("A8", "supprimer la tâche en cours : la suivante prend sa place", () => {
  let s = withTasks({ title: "A", minutes: 10 }, { title: "B", minutes: 10 }, "C");
  s = C.startTask(s, L(s), null, T0);
  let d = C.deleteTask(s, tid(s, 0), T0 + min(1));
  expect(tasks(d).map((t) => t.title)).toEqual(["B", "C"]);
  expect(list(d).active.taskId).toBe(tid(d, 0));
  expect(C.isRunning(d, L(d))).toBe(true); // enchaînement automatique activé par défaut
  d = C.deleteTask(C.updateSettings(s, { autoStartNext: false }), tid(s, 0), T0 + min(1));
  expect(C.isRunning(d, L(d))).toBe(false);
  expect(list(d).active.taskId).toBe(tid(d, 0));
  const p = C.pauseTask(s, L(s), T0 + sec(30));
  const e = C.deleteTask(p, tid(p, 0), T0 + min(1));
  expect(list(e).active.taskId).toBe(tid(e, 0));
  expect(C.isRunning(e, L(e))).toBe(false);
  const one = C.startTask(withTasks("Seule"), "main", null, T0);
  expect(list(C.deleteTask(one, tid(one, 0), T0)).active).toBe(null);
});
