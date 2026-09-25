package com.aura.music;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.core.content.ContextCompat;
import androidx.media3.common.Player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AuraMedia")
public class AuraMediaPlugin extends Plugin {

    private static AuraMediaPlugin instance;

    @Override
    public void load() {
        super.load();

        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }

        super.handleOnDestroy();
    }

    @PluginMethod
    public void start(PluginCall call) {
        Context context = getContext();

        Intent intent = new Intent(
                context,
                AuraMediaService.class
        );

        ContextCompat.startForegroundService(
                context,
                intent
        );

        call.resolve();
    }

    @PluginMethod
    public void setTrack(PluginCall call) {
        String id = call.getString("id");
        String title = call.getString("title");
        String artist = call.getString("artist");
        String album = call.getString("album");
        String artworkUrl = call.getString("artworkUrl");

        Double durationValue = call.getDouble(
                "durationMs",
                0.0
        );

        long durationMs =
                durationValue != null
                        ? Math.round(durationValue)
                        : 0L;

        Log.d(
                "AuraMedia",
                "setTrack duration recibido: "
                        + durationMs
                        + " ms"
        );

        AuraMediaService service =
                AuraMediaService.getInstance();

        if (service == null) {
            call.reject(
                    "AuraMediaService no está iniciado"
            );
            return;
        }

        service.setTrack(
                id,
                title,
                artist,
                album,
                artworkUrl,
                durationMs
        );

        call.resolve();
    }

    @PluginMethod
    public void setPlaying(PluginCall call) {
        boolean playing = Boolean.TRUE.equals(
                call.getBoolean(
                        "playing",
                        false
                )
        );

        AuraMediaService service =
                AuraMediaService.getInstance();

        if (service == null) {
            call.reject(
                    "AuraMediaService no está iniciado"
            );
            return;
        }

        service.setPlaying(playing);

        call.resolve();
    }

    @PluginMethod
    public void setPosition(PluginCall call) {
        Double positionValue = call.getDouble(
                "positionMs",
                0.0
        );

        long positionMs =
                positionValue != null
                        ? Math.round(positionValue)
                        : 0L;

        Log.d(
                "AuraMedia",
                "setPosition recibido: "
                        + positionMs
                        + " ms"
        );

        AuraMediaService service =
                AuraMediaService.getInstance();

        if (service == null) {
            call.reject(
                    "AuraMediaService no está iniciado"
            );
            return;
        }

        service.setPosition(positionMs);

        call.resolve();
    }

    @PluginMethod
    public void setDuration(PluginCall call) {
        Double durationValue = call.getDouble(
                "durationMs",
                0.0
        );

        long durationMs =
                durationValue != null
                        ? Math.round(durationValue)
                        : 0L;

        Log.d(
                "AuraMedia",
                "setDuration recibido: "
                        + durationMs
                        + " ms"
        );

        AuraMediaService service =
                AuraMediaService.getInstance();

        if (service == null) {
            call.reject(
                    "AuraMediaService no está iniciado"
            );
            return;
        }

        service.setDuration(durationMs);

        call.resolve();
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(
                call.getBoolean(
                        "enabled",
                        false
                )
        );

        Log.d(
                "AuraMedia",
                "setShuffle recibido: " + enabled
        );

        AuraMediaService service =
                AuraMediaService.getInstance();

        if (service == null) {
            call.reject(
                    "AuraMediaService no está iniciado"
            );
            return;
        }

        service.setShuffleEnabled(enabled);

        call.resolve();
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(
                call.getBoolean(
                        "enabled",
                        false
                )
        );

        Log.d(
                "AuraMedia",
                "setRepeat recibido: " + enabled
        );

        AuraMediaService service =
                AuraMediaService.getInstance();

        if (service == null) {
            call.reject(
                    "AuraMediaService no está iniciado"
            );
            return;
        }

        int repeatMode =
                enabled
                        ? Player.REPEAT_MODE_ONE
                        : Player.REPEAT_MODE_OFF;

        service.setRepeatMode(repeatMode);

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();

        Intent intent = new Intent(
                context,
                AuraMediaService.class
        );

        context.stopService(intent);

        call.resolve();
    }

    public static void dispatchPlay() {
        if (instance == null) {
            return;
        }

        instance.notifyListeners(
                "play",
                new JSObject()
        );
    }

    public static void dispatchPause() {
        if (instance == null) {
            return;
        }

        instance.notifyListeners(
                "pause",
                new JSObject()
        );
    }

    public static void dispatchNext() {
        if (instance == null) {
            return;
        }

        instance.notifyListeners(
                "next",
                new JSObject()
        );
    }

    public static void dispatchPrevious() {
        if (instance == null) {
            return;
        }

        instance.notifyListeners(
                "previous",
                new JSObject()
        );
    }

    public static void dispatchSeek(long positionMs) {
        if (instance == null) {
            return;
        }

        JSObject data = new JSObject();

        data.put(
                "positionMs",
                positionMs
        );

        instance.notifyListeners(
                "seek",
                data
        );
    }

    public static void dispatchShuffleChanged(
            boolean enabled
    ) {
        if (instance == null) {
            return;
        }

        JSObject data = new JSObject();

        data.put(
                "enabled",
                enabled
        );

        instance.notifyListeners(
                "shuffleChanged",
                data
        );
    }

    public static void dispatchRepeatChanged(
            int repeatMode
    ) {
        if (instance == null) {
            return;
        }

        JSObject data = new JSObject();

        data.put(
                "repeatMode",
                repeatMode
        );

        instance.notifyListeners(
                "repeatChanged",
                data
        );
    }
}
