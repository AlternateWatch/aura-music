package com.aura.music;

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
        try {
            Context context = getContext();
            Intent sendIntent = new Intent(Intent.ACTION_SEND);
            sendIntent.setType("text/plain");
            sendIntent.putExtra(Intent.EXTRA_TEXT, text);
            sendIntent.setPackage("com.instagram.android");
            sendIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(sendIntent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Instagram no está instalado o no se pudo abrir Direct Messages", e);
        }
    }

    @PluginMethod
    public void shareToInstagramStory(PluginCall call) {
        String bgImageB64 = call.getString("backgroundImageBase64");
        String stickerB64 = call.getString("stickerBase64");
        String bgVideoUrl = call.getString("backgroundVideoUrl");
        String topColor = call.getString("topColor", "#18181b");
        String bottomColor = call.getString("bottomColor", "#09090b");
        String contentUrl = call.getString("contentUrl", "https://aura.basildo.me");

        new Thread(() -> {
            try {
                Context context = getContext();
                String authority = context.getPackageName() + ".fileprovider";
                File storyDir = new File(context.getCacheDir(), "aura_stories");
                if (!storyDir.exists()) {
                    storyDir.mkdirs();
                }

                File videoFile = null;
                if (bgVideoUrl != null && !bgVideoUrl.trim().isEmpty()) {
                    try {
                        File candidateVideo = new File(storyDir, "story_bg_" + System.currentTimeMillis() + ".mp4");
                        URL url = new URL(bgVideoUrl.trim());
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setConnectTimeout(8000);
                        conn.setReadTimeout(12000);
                        conn.setInstanceFollowRedirects(true);
                        if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                            try (InputStream in = conn.getInputStream();
                                 FileOutputStream fos = new FileOutputStream(candidateVideo)) {
                                byte[] buf = new byte[16384];
                                int read;
                                while ((read = in.read(buf)) != -1) {
                                    fos.write(buf, 0, read);
                                }
                            }
                            if (candidateVideo.exists() && candidateVideo.length() > 1024) {
                                videoFile = candidateVideo;
                            }
                        }
                    } catch (Exception videoErr) {
                        Log.w("AuraMedia", "Fallback a Story estática, no se pudo descargar vídeo de portada: " + videoErr.getMessage());
                    }
                }

                Intent intent = new Intent("com.instagram.share.ADD_TO_STORY");
                intent.setPackage("com.instagram.android");
                intent.putExtra("source_application", context.getPackageName());
                intent.putExtra("top_background_color", topColor);
                intent.putExtra("bottom_background_color", bottomColor);
                if (contentUrl != null) {
                    intent.putExtra("content_url", contentUrl);
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                if (videoFile != null && stickerB64 != null && !stickerB64.isEmpty()) {
                    byte[] stickerBytes = Base64.decode(stickerB64, Base64.DEFAULT);
                    File stickerFile = new File(storyDir, "story_sticker_" + System.currentTimeMillis() + ".png");
                    try (FileOutputStream fos = new FileOutputStream(stickerFile)) {
                        fos.write(stickerBytes);
                    }

                    Uri videoUri = FileProvider.getUriForFile(context, authority, videoFile);
                    Uri stickerUri = FileProvider.getUriForFile(context, authority, stickerFile);

                    intent.setDataAndType(videoUri, "video/mp4");
                    intent.putExtra("interactive_asset_uri", stickerUri);

                    context.grantUriPermission("com.instagram.android", videoUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    context.grantUriPermission("com.instagram.android", stickerUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else if (bgImageB64 != null && !bgImageB64.isEmpty()) {
                    byte[] bgBytes = Base64.decode(bgImageB64, Base64.DEFAULT);
                    File bgFile = new File(storyDir, "story_full_" + System.currentTimeMillis() + ".png");
                    try (FileOutputStream fos = new FileOutputStream(bgFile)) {
                        fos.write(bgBytes);
                    }

                    Uri bgUri = FileProvider.getUriForFile(context, authority, bgFile);
                    intent.setDataAndType(bgUri, "image/png");
                    context.grantUriPermission("com.instagram.android", bgUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else {
                    call.reject("No story assets provided");
                    return;
                }

                context.startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                Log.e("AuraMedia", "Error compartiendo en Instagram Story", e);
                call.reject("No se pudo abrir Instagram Stories", e);
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
