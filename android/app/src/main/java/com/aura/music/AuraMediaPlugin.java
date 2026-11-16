package com.aura.music;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import android.util.Base64;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
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

    @PluginMethod
    public void setPlaybackSpeed(PluginCall call) {
        Double speedValue = call.getDouble("speed", 1.0);
        float speed = speedValue != null ? speedValue.floatValue() : 1.0f;

        AuraMediaService service =
                AuraMediaService.getInstance();

        if (service != null) {
            service.setPlaybackSpeed(speed);
        }

        call.resolve();
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text");
        String title = call.getString("title", "Compartir canción");
        if (text == null || text.isEmpty()) {
            call.reject("Text is required");
            return;
        }
        try {
            Intent sendIntent = new Intent(Intent.ACTION_SEND);
            sendIntent.setType("text/plain");
            sendIntent.putExtra(Intent.EXTRA_TEXT, text);
            if (title != null) {
                sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
            }
            Intent chooser = Intent.createChooser(sendIntent, title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to share text", e);
        }
    }

    @PluginMethod
    public void shareToInstagramDM(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("Text is required");
            return;
        }
        Activity activity = getActivity();
        Context context = getContext();
        Runnable launch = () -> {
            try {
                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType("text/plain");
                sendIntent.putExtra(Intent.EXTRA_TEXT, text);
                sendIntent.setComponent(new ComponentName(
                        "com.instagram.android",
                        "com.instagram.direct.share.handler.DirectShareHandlerActivity"
                ));
                if (activity != null) {
                    activity.startActivity(sendIntent);
                } else {
                    sendIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(sendIntent);
                }
                call.resolve();
            } catch (Exception e) {
                try {
                    Intent fallback = new Intent(Intent.ACTION_SEND);
                    fallback.setType("text/plain");
                    fallback.putExtra(Intent.EXTRA_TEXT, text);
                    fallback.setPackage("com.instagram.android");
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(fallback);
                    call.resolve();
                } catch (Exception ex) {
                    call.reject("Instagram no está instalado o no se pudo abrir Direct Messages", ex);
                }
            }
        };
        if (activity != null) {
            activity.runOnUiThread(launch);
        } else {
            launch.run();
        }
    }

    @PluginMethod
    public void shareToInstagramStory(PluginCall call) {
        String bgImageB64 = call.getString("backgroundImageBase64");
        if (bgImageB64 == null || bgImageB64.isEmpty()) {
            call.reject("No story image provided");
            return;
        }

        new Thread(() -> {
            try {
                Context context = getContext();
                Activity activity = getActivity();
                String authority = context.getPackageName() + ".fileprovider";
                File storyDir = new File(context.getCacheDir(), "aura_stories");
                if (!storyDir.exists()) {
                    storyDir.mkdirs();
                }

                File[] oldFiles = storyDir.listFiles();
                if (oldFiles != null) {
                    for (File f : oldFiles) {
                        if (System.currentTimeMillis() - f.lastModified() > 300_000) {
                            f.delete();
                        }
                    }
                }

                byte[] bgBytes = Base64.decode(bgImageB64, Base64.DEFAULT);
                File bgFile = new File(storyDir, "aura_story_" + System.currentTimeMillis() + ".png");
                try (FileOutputStream fos = new FileOutputStream(bgFile)) {
                    fos.write(bgBytes);
                }

                final Uri mediaUri = FileProvider.getUriForFile(context, authority, bgFile);
                context.grantUriPermission(
                        "com.instagram.android",
                        mediaUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                );

                Runnable launchStory = () -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_SEND);
                        intent.setComponent(new ComponentName(
                                "com.instagram.android",
                                "com.instagram.share.handleractivity.StoryShareHandlerActivity"
                        ));
                        intent.setType("image/png");
                        intent.putExtra(Intent.EXTRA_STREAM, mediaUri);
                        intent.setClipData(ClipData.newRawUri("aura_story", mediaUri));
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                        if (activity != null) {
                            activity.startActivity(intent);
                        } else {
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            context.startActivity(intent);
                        }
                        call.resolve();
                    } catch (Exception err) {
                        Log.e("AuraMedia", "Error abriendo StoryShareHandlerActivity", err);
                        call.reject("No se pudo abrir Instagram Stories", err);
                    }
                };

                if (activity != null) {
                    activity.runOnUiThread(launchStory);
                } else {
                    launchStory.run();
                }
            } catch (Exception e) {
                Log.e("AuraMedia", "Error preparando Instagram Story", e);
                call.reject("No se pudo preparar Instagram Story", e);
            }
        }).start();
    }

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String urlString = call.getString("url");
        if (urlString == null || urlString.isEmpty()) {
            call.reject("URL is required");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(urlString));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open external URL", e);
        }
    }
}
