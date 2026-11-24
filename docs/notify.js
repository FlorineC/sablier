// Alarmes de l'appli Android (Capacitor) : une notification programmée à la fin de chaque
// tâche en cours, qui sonne même téléphone verrouillé. Sans Capacitor, ce module ne fait rien.
import * as C from "./core.js";

const plugin = () => {
  const cap = window.Capacitor;
  const native = cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
  return (native && cap.Plugins && cap.Plugins.LocalNotifications) || null;
};
let ready = Promise.resolve(), queue = Promise.resolve(), lastKey = null;

export const isNative = () => !!plugin();

export function setupAlarms() {
  const ln = plugin();
  if (!ln) return;
  ready = (async () => {
    try { await ln.requestPermissions(); } catch { /* refusé : l'appli reste utilisable */ }
    try { await ln.createChannel({ id: "sablier", name: "Fin des tâches", importance: 5, visibility: 1, vibration: true }); } catch { /* ancien Android */ }
  })();
}

export function syncAlarms(state, now, opts = {}) {
  const ln = plugin();
  if (!ln) return;
  const alarms = C.upcomingAlarms(state, now, opts);
  const key = JSON.stringify(alarms.map((a) => [a.id, a.atMs, a.title, a.listName, a.kind]));
  if (key === lastKey) return;
  lastKey = key;
  queue = queue.then(async () => {
    await ready;
    try {
      const pending = await ln.getPending();
      if (pending.notifications.length) await ln.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      if (alarms.length) {
        await ln.schedule({
          notifications: alarms.map((a) => ({
            id: a.id,
            title: a.kind === "warn" ? `⏳ ${a.listName}` : `⏰ ${a.listName}`,
            body: a.kind === "warn" ? `${a.emoji} « ${a.title} » : plus que ${a.leftMin} min` : `${a.emoji} « ${a.title} » : temps écoulé`,
            channelId: "sablier",
            schedule: { at: new Date(a.atMs), allowWhileIdle: true },
          })),
        });
      }
    } catch { /* notification indisponible */ }
  });
}

// ---------------------------------------------------------------- notification « minuteur en cours »
// Plugin natif de l'appli Android (service de premier plan) : garde l'appli active et la synchro
// ouverte tant qu'un minuteur tourne.
const timerPlugin = () => {
  if (!plugin()) return null;
  const cap = window.Capacitor;
  return (cap.Plugins && cap.Plugins.SablierTimer) || (typeof cap.registerPlugin === "function" ? cap.registerPlugin("SablierTimer") : null);
};
let ongoingLast = null;
export function setupOngoing(onAction) {
  const tp = timerPlugin();
  if (!tp || typeof tp.addListener !== "function") return;
  try { tp.addListener("action", (d) => onAction(d || {})); } catch { /* indisponible */ }
}
export function syncOngoing(state, now, { enabled = true } = {}) {
  const tp = timerPlugin();
  if (!tp) return;
  const info = enabled ? C.ongoingInfo(state, now) : null;
  if (!info) {
    if (ongoingLast !== "none") { ongoingLast = "none"; Promise.resolve(tp.hide()).catch(() => {}); }
    return;
  }
  const prev = ongoingLast && ongoingLast !== "none" ? ongoingLast : null;
  if (prev && prev.listId === info.listId && prev.title === info.title && prev.text === info.text && Math.abs(prev.endAtMs - info.endAtMs) < 1500) return;
  ongoingLast = info;
  Promise.resolve(tp.show(info)).catch(() => { ongoingLast = null; }); // refusé en arrière-plan : réessayé au prochain rendu
}
export async function batteryStatus() {
  const tp = timerPlugin();
  if (!tp || typeof tp.batteryStatus !== "function") return null;
  try { return await tp.batteryStatus(); } catch { return null; }
}
export function openBatterySettings() {
  const tp = timerPlugin();
  if (tp && typeof tp.openBatterySettings === "function") Promise.resolve(tp.openBatterySettings()).catch(() => {});
}
