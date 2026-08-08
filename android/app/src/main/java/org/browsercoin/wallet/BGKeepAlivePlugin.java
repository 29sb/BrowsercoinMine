package org.browsercoin.wallet;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * BRC 后台保活桥接插件。
 * - 启动/停止前台服务(常驻通知,降低被杀概率)
 * - 请求忽略电池优化(白名单)
 */
@CapacitorPlugin(name = "BGKeepAlive")
public class BGKeepAlivePlugin extends Plugin {

    @PluginMethod
    public void startWarmup(PluginCall call) {
        String title = call.getString("title", "BRC Wallet");
        String body = call.getString("body", "后台服务运行中…");
        String icon = call.getString("icon", "ic_notification");
        MineService.start(getContext(), title, body, icon);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void stopWarmup(PluginCall call) {
        MineService.stop(getContext());
        call.resolve(new JSObject().put("ok", true));
    }

    /** 请求忽略电池优化(Android 白名单)。返回是否已获得豁免。 */
    @PluginMethod
    public void requestIgnoreBattery(PluginCall call) {
        boolean granted = MineService.requestIgnoreBatteryOptimizations(
                getActivity() != null ? getActivity() : getContext());
        call.resolve(new JSObject().put("granted", granted));
    }

    @PluginMethod
    public void isIgnoringBattery(PluginCall call) {
        boolean ignoring = MineService.isIgnoringBattery(getContext());
        call.resolve(new JSObject().put("ignoring", ignoring));
    }

    /** 挖矿时 CPU 常醒(锁屏后挖矿不休眠)。 */
    @PluginMethod
    public void setCpuAwake(PluginCall call) {
        Boolean on = call.getBoolean("on", true);
        if (on == null || on) MineService.setAwakeOn(getContext());
        else MineService.setAwakeOff(getContext());
        call.resolve(new JSObject().put("ok", true));
    }

    /** 屏幕微亮(不灭),可选。 */
    @PluginMethod
    public void setScreenDim(PluginCall call) {
        Boolean on = call.getBoolean("on", true);
        if (on == null || on) MineService.dimScreen(getContext());
        else MineService.undimScreen(getContext());
        call.resolve(new JSObject().put("ok", true));
    }
}
