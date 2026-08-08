package org.browsercoin.wallet;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;

/**
 * 前台服务: 常驻通知 + 尽量保活。
 * - START_STICKY: 被杀后尽力重启。
 * - 前台服务: 显著降低后台被杀概率。
 * - PARTIAL_WAKE_LOCK: CPU 常醒,锁屏/灭屏后挖矿逻辑不休眠。
 * - SCREEN_DIM_WAKE_LOCK: 挖矿时屏幕微亮(可选),省电且能看状态。
 */
public class MineService extends Service {
    private static final String CHANNEL_ID = "brc_wallet_background";
    private static final int NOTIF_ID = 2137;

    // CPU 保活锁(常醒)
    private static PowerManager.WakeLock cpuLock;
    // 屏幕微亮锁(可选启用)
    private static PowerManager.WakeLock dimLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        acquireCpuLock(); // 服务一启动就 CPU 常醒,锁屏后挖矿不休眠
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundCompat();
        acquireCpuLock();
        return START_STICKY; // 被杀后尽力重启
    }

    @Override
    public void onDestroy() {
        releaseCpuLock();
        releaseDimLock();
        super.onDestroy();
    }

    private void startForegroundCompat() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setContentTitle("BRC Wallet 挖矿中")
                .setContentText("CPU 常醒 + 屏幕微亮 · coinbase 归你")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true);
        return b.build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "BRC 后台服务", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("BRC 钱包后台保活通知");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---- 静态工具 ----
    public static void start(Context ctx, String title, String body, String icon) {
        Intent i = new Intent(ctx, MineService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, MineService.class));
    }

    /** 请求忽略电池优化。返回是否已豁免(某些系统直接授权)。 */
    public static boolean requestIgnoreBatteryOptimizations(Context ctx) {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm == null) return false;
        if (pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) return true;
        if (Build.VERSION.SDK_INT >= 23) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                i.setData(Uri.parse("package:" + ctx.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                return false; // 引导用户到系统弹窗,未必立即生效
            } catch (Exception ignored) {
                return false;
            }
        }
        return false;
    }

    public static boolean isIgnoringBattery(Context ctx) {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }

    // ---- 唤醒锁(CPU 常醒 + 屏幕微亮) ----

    /** 获取单例 CPU 保活锁。该静态方法供插件在服务外也能调用。 */
    private static synchronized PowerManager.WakeLock cpuLock(Context ctx) {
        if (cpuLock == null) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "brc:cpu");
            cpuLock.setReferenceCounted(false);
        }
        return cpuLock;
    }

    private static synchronized PowerManager.WakeLock dimLock(Context ctx) {
        if (dimLock == null) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            dimLock = pm.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "brc:dim");
            dimLock.setReferenceCounted(false);
        }
        return dimLock;
    }

    private void acquireCpuLock() {
        if (cpuLock == null) cpuLock = cpuLock(this);
        if (cpuLock != null && !cpuLock.isHeld()) cpuLock.acquire();
    }

    private void releaseCpuLock() {
        if (cpuLock != null && cpuLock.isHeld()) {
            cpuLock.release();
            cpuLock = null;
        }
    }

    private void releaseDimLock() {
        if (dimLock != null && dimLock.isHeld()) {
            dimLock.release();
            dimLock = null;
        }
    }

    /** 挖矿时常醒 CPU + 屏幕微亮(由插件/Web 调用)。 */
    public static void setAwakeOn(Context ctx) {
        try {
            // CPU 常醒
            PowerManager.WakeLock c = cpuLock(ctx);
            if (c != null && !c.isHeld()) c.acquire();
        } catch (Exception ignored) {}
    }

    /** 关闭 CPU 常醒(但仍保留前台服务保活)。 */
    public static void setAwakeOff(Context ctx) {
        try {
            if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
        } catch (Exception ignored) {}
    }

    /** 屏幕微亮(不灭)。 */
    public static void dimScreen(Context ctx) {
        try {
            PowerManager.WakeLock d = dimLock(ctx);
            if (d != null && !d.isHeld()) d.acquire();
        } catch (Exception ignored) {}
    }

    /** 恢复屏幕可自动熄灭。 */
    public static void undimScreen(Context ctx) {
        try {
            if (dimLock != null && dimLock.isHeld()) dimLock.release();
        } catch (Exception ignored) {}
    }
}
