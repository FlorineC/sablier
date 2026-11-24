package fr.sablier.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;

/**
 * Service de premier plan actif tant qu'un minuteur tourne : affiche la tâche en cours et son
 * décompte, et empêche Android de geler l'appli, pour que la synchronisation continue
 * (une tâche terminée ailleurs annule ainsi l'alarme de ce téléphone).
 */
public class TimerService extends Service {
    static final String CHANNEL = "sablier-en-cours";
    static final int NOTIF_ID = 4242;
    static volatile boolean running = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getExtras() == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = build(this, intent.getExtras());
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIF_ID, n);
        }
        running = true;
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Appli balayée des récents : plus de synchro possible, on retire la notification
        // (les alarmes déjà programmées restent).
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Minuteur en cours", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Tâche en cours et temps restant (sans son)");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    static Notification build(Context ctx, Bundle data) {
        ensureChannel(ctx);
        String title = data.getString("title", "Sablier");
        String text = data.getString("text", "");
        String listId = data.getString("listId", "");
        long endAt = data.getLong("endAtMs", System.currentTimeMillis());

        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(ctx, 0, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(ctx, CHANNEL)
            : new Notification.Builder(ctx);
        b.setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setShowWhen(true)
            .setWhen(endAt)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .addAction(action(ctx, TimerActionReceiver.ACTION_PAUSE, listId, android.R.drawable.ic_media_pause, "Pause", 1))
            .addAction(action(ctx, TimerActionReceiver.ACTION_DONE, listId, android.R.drawable.checkbox_on_background, "Terminer", 2));
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private static Notification.Action action(Context ctx, String what, String listId, int icon, String label, int code) {
        Intent i = new Intent(ctx, TimerActionReceiver.class);
        i.setAction(what);
        i.putExtra("listId", listId);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, code, i,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(ctx, icon), label, pi).build();
    }

    /** Met à jour la notification d'un service déjà lancé (sans le redémarrer). */
    static void update(Context ctx, Bundle data) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, build(ctx, data));
    }
}
