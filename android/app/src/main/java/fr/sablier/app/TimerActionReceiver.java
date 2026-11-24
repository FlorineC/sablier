package fr.sablier.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Boutons « Pause » et « Terminer » de la notification : transmis à l'appli web. */
public class TimerActionReceiver extends BroadcastReceiver {
    static final String ACTION_PAUSE = "fr.sablier.app.TIMER_PAUSE";
    static final String ACTION_DONE = "fr.sablier.app.TIMER_DONE";

    @Override
    public void onReceive(Context context, Intent intent) {
        String what = ACTION_PAUSE.equals(intent.getAction()) ? "pause" : ACTION_DONE.equals(intent.getAction()) ? "done" : null;
        if (what == null) return;
        String listId = intent.getStringExtra("listId");
        if (!TimerPlugin.emit(what, listId)) {
            // Appli plus chargée : on l'ouvre plutôt que de perdre le geste.
            Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(open);
            }
        }
    }
}
