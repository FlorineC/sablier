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

export function syncAlarms(state, now) {
  const ln = plugin();
  if (!ln) return;
  const alarms = C.upcomingAlarms(state, now);
  const key = JSON.stringify(alarms.map((a) => [a.id, a.atMs, a.title, a.listName]));
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
            title: `⏰ ${a.listName}`,
            body: `${a.emoji} « ${a.title} » : temps écoulé`,
            channelId: "sablier",
            schedule: { at: new Date(a.atMs), allowWhileIdle: true },
          })),
        });
      }
    } catch { /* notification indisponible */ }
  });
}
