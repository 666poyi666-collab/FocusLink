package app.focuslink.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;

/**
 * Debug-only harness: post or cancel a synthetic focus notification so the Xiaomi island payload
 * can be verified from adb without touching the phone UI.
 *
 * <p>Only reachable in debug builds: the receiver is declared in {@code src/debug/AndroidManifest.xml}
 * and the entry guard rejects non-debug packages.
 */
public final class DebugIslandReceiver extends BroadcastReceiver {
    static final String ACTION_POST = "app.focuslink.mobile.DEBUG_ISLAND_POST";
    static final String ACTION_CANCEL = "app.focuslink.mobile.DEBUG_ISLAND_CANCEL";
    private static final String CHANNEL_ID = "focuslink_debug_island";
    private static final int NOTIFICATION_ID = 980_120;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!BuildConfig.DEBUG || intent == null) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (ACTION_CANCEL.equals(intent.getAction())) {
            manager.cancel(NOTIFICATION_ID);
            return;
        }
        if (!ACTION_POST.equals(intent.getAction())) return;

        manager.createNotificationChannel(
            new NotificationChannel(CHANNEL_ID, "调试岛通知", NotificationManager.IMPORTANCE_LOW)
        );
        JSObject payload = new JSObject()
            .put("state", FocusRuntimeContract.STATE_RUNNING)
            .put("sessionId", "debug-island")
            .put("stateRevision", 1)
            .put("title", "调试专注")
            .put("timeLabel", "25:00")
            .put("detail", "岛载荷验证")
            .put("primaryElapsedMs", 0)
            .put("primaryAdvances", false)
            .put("controlsEnabled", true)
            .put("validUntilEpochMs", System.currentTimeMillis() + 10 * 60 * 1000L);
        FocusRuntimeSnapshot snapshot;
        try {
            snapshot = FocusRuntimeSnapshot.fromPlugin(context, payload);
        } catch (RuntimeException error) {
            android.util.Log.e("FocusLinkIsland", "snapshot build failed", error);
            return;
        }

        PendingIntent noop = PendingIntent.getBroadcast(
            context,
            0,
            new Intent(context, DebugIslandReceiver.class).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_focus)
            .setContentTitle("调试专注")
            .setContentText("25:00 · 岛载荷验证")
            .setContentIntent(noop)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setOngoing(true)
            .addAction(R.drawable.ic_stat_focus, "结束", noop);
        SystemFocusSurfaceProvider.configureBuilder(context, builder);
        Notification notification = builder.build();
        Notification projected = SystemFocusSurfaceProvider.apply(
            context,
            notification,
            snapshot,
            "调试专注",
            "25:00 · 岛载荷验证"
        );
        manager.notify(NOTIFICATION_ID, projected);
        android.util.Log.i(
            "FocusLinkIsland",
            "posted island surface=" + SystemFocusSurfaceProvider.selectedSurface(context)
                + " evidence=" + SystemFocusSurfaceProvider.evidenceLevel(context)
        );
    }
}
