package fr.sablier.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Pont JS ↔ Android pour la notification « minuteur en cours » et la batterie. */
@CapacitorPlugin(name = "SablierTimer")
public class TimerPlugin extends Plugin {
    private static TimerPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static boolean emit(String action, String listId) {
        TimerPlugin p = instance;
        if (p == null || p.getBridge() == null) return false;
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("listId", listId == null ? "" : listId);
        p.notifyListeners("action", data, true);
        return true;
    }

    @PluginMethod
    public void show(PluginCall call) {
        Context ctx = getContext();
        Bundle data = new Bundle();
        data.putString("title", call.getString("title", "Sablier"));
        data.putString("text", call.getString("text", ""));
        data.putString("listId", call.getString("listId", ""));
        Double end = call.getDouble("endAtMs");
        data.putLong("endAtMs", end == null ? System.currentTimeMillis() : end.longValue());
        try {
            if (TimerService.running) {
                TimerService.update(ctx, data);
            } else {
                Intent i = new Intent(ctx, TimerService.class);
                i.putExtras(data);
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
                else ctx.startService(i);
            }
            call.resolve();
        } catch (Exception e) {
            // Android 12+ refuse de lancer un service de premier plan depuis l'arrière-plan :
            // ce sera fait au prochain retour sur l'appli.
            call.reject("Notification indisponible pour le moment", e);
        }
    }

    @PluginMethod
    public void hide(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TimerService.class));
        call.resolve();
    }

    @PluginMethod
    public void batteryStatus(PluginCall call) {
        JSObject r = new JSObject();
        boolean unrestricted = true;
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            unrestricted = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        r.put("unrestricted", unrestricted);
        call.resolve(r);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        }
        call.resolve();
    }
}
