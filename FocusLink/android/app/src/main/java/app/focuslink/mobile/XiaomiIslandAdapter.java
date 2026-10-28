package app.focuslink.mobile;

import android.app.Notification;
import android.content.Context;
import android.graphics.drawable.Icon;
import android.os.Bundle;
import android.provider.Settings;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * HyperOS focus-notification / super-island projection.
 *
 * <p>Payload keys follow the official Xiaomi schema (param_v2 → islandProperty / bigIslandArea /
 * smallIslandArea / baseInfo / ticker / aodTitle). Earlier revisions used a hand-rolled shape
 * ("textInfo", missing business/aodTitle, no miui.focus.pics) which SystemUI accepted but never
 * rendered.
 */
final class XiaomiIslandAdapter {
    static final String EVIDENCE_UNSUPPORTED = "unsupported";
    static final String EVIDENCE_PROTOCOL_SELECTED = "protocol-selected";
    static final String EVIDENCE_SYSTEMUI_ACCEPTED = "systemui-accepted";
    static final String EVIDENCE_VISUALLY_VERIFIED = "visually-verified";

    private static final String PIC_TICKER = "miui.focus.pic_ticker";
    private static final String PIC_AOD = "miui.focus.pic_aod";
    private static final String PIC_IMAGE_TEXT = "miui.focus.pic_imageText";
    private static final String ACTION_KEY = "focuslink_action_0";

    private XiaomiIslandAdapter() {}

    static Notification apply(
        Context context,
        Notification notification,
        FocusRuntimeSnapshot snapshot,
        String displayTitle,
        String displayContent
    ) {
        try {
            boolean paused = FocusRuntimeContract.STATE_PAUSED.equals(snapshot.state);
            String stateLabel = paused ? "暂停" : "专注";
            String timeLabel = snapshot.timeLabel == null ? "" : snapshot.timeLabel;
            String headline = stateLabel + " " + timeLabel;
            String businessId = "focuslink:" + snapshot.sessionId;

            JSONObject textInfo = new JSONObject()
                .put("frontTitle", stateLabel)
                .put("title", timeLabel)
                .put("content", displayTitle == null ? "" : displayTitle)
                .put("useHighLight", false);
            JSONObject picInfo = new JSONObject().put("type", 1).put("pic", PIC_IMAGE_TEXT);

            JSONObject bigIsland = new JSONObject()
                .put(
                    "imageTextInfoLeft",
                    new JSONObject()
                        .put("type", 1)
                        .put("picInfo", picInfo)
                        // 官方 schema 的键名就是 "miui.focus.paramtextInfo"，不是 textInfo。
                        .put("miui.focus.paramtextInfo", textInfo)
                )
                .put("picInfo", picInfo);

            JSONObject island = new JSONObject()
                .put("islandProperty", 1)
                .put("bigIslandArea", bigIsland)
                .put("smallIslandArea", new JSONObject().put("picInfo", picInfo))
                .put("shareData", new JSONObject().put("title", headline));

            JSONObject paramV2 = new JSONObject()
                .put("protocol", focusProtocol(context))
                .put("business", "focus")
                .put("islandFirstFloat", true)
                .put("enableFloat", true)
                .put("updatable", true)
                .put("ticker", headline)
                .put("tickerPic", PIC_TICKER)
                .put("aodTitle", headline)
                .put("aodPic", PIC_AOD)
                .put("param_island", island)
                .put(
                    "baseInfo",
                    new JSONObject()
                        .put("title", headline)
                        .put("content", displayContent == null ? "" : displayContent)
                        .put("colorTitle", "#7C4DFF")
                        .put("type", 2)
                )
                .put(
                    "hintInfo",
                    new JSONObject()
                        .put("type", 1)
                        .put("title", timeLabel)
                        .put("actionInfo", new JSONObject().put("action", ACTION_KEY))
                );

            Bundle actionBundle = new Bundle();
            if (notification.actions != null && notification.actions.length > 0) {
                actionBundle.putParcelable(ACTION_KEY, notification.actions[0]);
                notification.extras.putBundle("miui.focus.actions", actionBundle);
            }

            // 没有 miui.focus.pics 时，picInfo 引用的图不存在，系统会整段丢弃岛数据。
            Bundle pics = new Bundle();
            Icon appIcon = Icon.createWithResource(context, context.getApplicationInfo().icon);
            pics.putParcelable(PIC_TICKER, appIcon);
            pics.putParcelable(PIC_AOD, appIcon);
            pics.putParcelable(PIC_IMAGE_TEXT, appIcon);
            notification.extras.putBundle("miui.focus.pics", pics);

            notification.extras.putString(
                "miui.focus.param",
                new JSONObject().put("param_v2", paramV2).toString()
            );
            notification.extras.putString("focuslink.xiaomi.businessId", businessId);
            notification.extras.putString(
                "focuslink.xiaomi.projectionId",
                UUID.nameUUIDFromBytes(businessId.getBytes()).toString()
            );
            notification.extras.putString("focuslink.systemSurface", "xiaomi-island");
        } catch (JSONException ignored) {
            // The independent standard ongoing notification remains valid.
        }
        return notification;
    }

    /** Official samples use protocol 1; HyperOS 3 exposes its own value, so follow the platform. */
    private static int focusProtocol(Context context) {
        try {
            int protocol = Settings.System.getInt(
                context.getContentResolver(),
                "notification_focus_protocol",
                1
            );
            return protocol > 0 ? protocol : 1;
        } catch (RuntimeException ignored) {
            return 1;
        }
    }
}
