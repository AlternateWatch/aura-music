package com.aura.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.core.app.NotificationCompat;

import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.MediaStyleNotificationHelper;

import com.google.common.collect.ImmutableList;

@OptIn(markerClass = UnstableApi.class)
public class AuraMediaService extends MediaSessionService {

    private static final String CHANNEL_ID =
            "aura_music_playback";

    private static final int NOTIFICATION_ID =
            1001;

    private static AuraMediaService instance;

    private AuraMediaPlayer player;

    private MediaSession mediaSession;

    private final Handler mainHandler =
            new Handler(Looper.getMainLooper());

    private long lastNotificationUpdateMs = 0;

    private static final long NOTIFICATION_UPDATE_INTERVAL_MS =
            1000L;

    @Override
    public void onCreate() {
        super.onCreate();

        instance = this;

        createNotificationChannel();

        player =
                new AuraMediaPlayer(
                        getMainLooper(),
                        new AuraMediaPlayer.Callback() {

                            @Override
                            public void onPlay() {
                                AuraMediaPlugin.dispatchPlay();

                                updateNotificationImmediately();
                            }

                            @Override
                            public void onPause() {
                                AuraMediaPlugin.dispatchPause();

                                updateNotificationImmediately();
                            }

                            @Override
                            public void onNext() {
                                AuraMediaPlugin.dispatchNext();
                            }

                            @Override
                            public void onPrevious() {
                                AuraMediaPlugin.dispatchPrevious();
                            }

                            @Override
                            public void onSeek(
                                    long positionMs
                            ) {
                                AuraMediaPlugin.dispatchSeek(
                                        positionMs
                                );

                                updateNotificationImmediately();
                            }

                            @Override
                            public void onShuffleChanged(
                                    boolean enabled
                            ) {
                                AuraMediaPlugin.dispatchShuffleChanged(
                                        enabled
                                );

                                updateMediaButtonPreferences();
                            }

                            @Override
                            public void onRepeatChanged(
                                    int repeatMode
                            ) {
                                AuraMediaPlugin.dispatchRepeatChanged(
                                        repeatMode
                                );

                                updateMediaButtonPreferences();
                            }
                        }
                );

        mediaSession =
                new MediaSession.Builder(
                        this,
                        player
                )
                        .setMediaButtonPreferences(
                                buildMediaButtonPreferences()
                        )
                        .build();

        /*
         * El servicio entra en foreground inmediatamente.
         */
        startForeground(
                NOTIFICATION_ID,
                buildNotification()
        );
    }

    public static AuraMediaService getInstance() {
        return instance;
    }

    private ImmutableList<CommandButton>
    buildMediaButtonPreferences() {

        /*
         * SHUFFLE
         *
         * Cambiamos también el icono según el estado.
         */
        int shuffleIcon =
                player != null
                        && player.isShuffleEnabled()
                        ? CommandButton.ICON_SHUFFLE_ON
                        : CommandButton.ICON_SHUFFLE_OFF;

        Log.d(
                "AuraMedia",
                "Icono shuffle seleccionado: "
                        + shuffleIcon
        );

        CommandButton shuffleButton =
                new CommandButton.Builder(
                        shuffleIcon
                )
                        .setDisplayName(
                                "Aleatorio"
                        )
                        .setPlayerCommand(
                                Player.COMMAND_SET_SHUFFLE_MODE
                        )
                        .build();

        /*
         * REPEAT
         *
         * OFF -> ONE -> ALL -> OFF
         */
        int currentRepeatMode =
                player != null
                        ? player.getCurrentRepeatMode()
                        : Player.REPEAT_MODE_OFF;

        int nextRepeatMode;

        int repeatIcon;

        if (currentRepeatMode ==
                Player.REPEAT_MODE_OFF) {

            nextRepeatMode =
                    Player.REPEAT_MODE_ONE;

            repeatIcon =
                    CommandButton.ICON_REPEAT_OFF;

        } else if (currentRepeatMode ==
                Player.REPEAT_MODE_ONE) {

            nextRepeatMode =
                    Player.REPEAT_MODE_ALL;

            repeatIcon =
                    CommandButton.ICON_REPEAT_ONE;

        } else {

            nextRepeatMode =
                    Player.REPEAT_MODE_OFF;

            repeatIcon =
                    CommandButton.ICON_REPEAT_ALL;
        }

        Log.d(
                "AuraMedia",
                "Icono repeat seleccionado: "
                        + repeatIcon
        );

        CommandButton repeatButton =
                new CommandButton.Builder(
                        repeatIcon
                )
                        .setDisplayName(
                                "Repetir"
                        )
                        .setPlayerCommand(
                                Player.COMMAND_SET_REPEAT_MODE,
                                nextRepeatMode
                        )
                        .build();

        return ImmutableList.of(
                shuffleButton,
                repeatButton
        );
    }

    private void updateMediaButtonPreferences() {

        if (mediaSession == null) {
            return;
        }

        ImmutableList<CommandButton> buttons =
                buildMediaButtonPreferences();

        mediaSession.setMediaButtonPreferences(buttons);

        Log.d(
                "AuraMedia",
                "Preferencias aplicadas: "
                        + buttons.size()
                        + " botones"
        );

        updateNotificationImmediately();
    }

    private void createNotificationChannel() {

        if (Build.VERSION.SDK_INT <
                Build.VERSION_CODES.O) {

            return;
        }

        NotificationManager notificationManager =
                (NotificationManager)
                        getSystemService(
                                Context.NOTIFICATION_SERVICE
                        );

        if (notificationManager == null) {
            return;
        }

        NotificationChannel channel =
                new NotificationChannel(
                        CHANNEL_ID,
                        "Aura Music",
                        NotificationManager.IMPORTANCE_LOW
                );

        channel.setDescription(
                "Controles de reproducción de Aura Music"
        );

        channel.setSound(
                null,
                null
        );

        notificationManager.createNotificationChannel(
                channel
        );
    }

    private Notification buildNotification() {

        String title =
                "Aura Music";

        String artist =
                "";

        String album =
                "";

        long positionMs =
                0L;

        long durationMs =
                0L;

        if (player != null) {

            positionMs =
                    player.getPositionMs();

            durationMs =
                    player.getDurationMs();

            if (player.getCurrentMediaItem() != null) {

                if (player
                        .getCurrentMediaItem()
                        .mediaMetadata
                        .title != null) {

                    title =
                            player
                                    .getCurrentMediaItem()
                                    .mediaMetadata
                                    .title
                                    .toString();
                }

                if (player
                        .getCurrentMediaItem()
                        .mediaMetadata
                        .artist != null) {

                    artist =
                            player
                                    .getCurrentMediaItem()
                                    .mediaMetadata
                                    .artist
                                    .toString();
                }

                if (player
                        .getCurrentMediaItem()
                        .mediaMetadata
                        .albumTitle != null) {

                    album =
                            player
                                    .getCurrentMediaItem()
                                    .mediaMetadata
                                    .albumTitle
                                    .toString();
                }
            }
        }

        String subtitle;

        if (!artist.isEmpty()
                && !album.isEmpty()) {

            subtitle =
                    artist
                            + " • "
                            + album;

        } else if (!artist.isEmpty()) {

            subtitle =
                    artist;

        } else {

            subtitle =
                    album;
        }

        NotificationCompat.Builder builder =
                new NotificationCompat.Builder(
                        this,
                        CHANNEL_ID
                );

        builder
                .setSmallIcon(
                        android.R.drawable.ic_media_play
                )
                .setContentTitle(
                        title
                )
                .setContentText(
                        subtitle
                )
                .setCategory(
                        NotificationCompat.CATEGORY_TRANSPORT
                )
                .setVisibility(
                        NotificationCompat.VISIBILITY_PUBLIC
                )
                .setOngoing(
                        true
                )
                .setOnlyAlertOnce(
                        true
                )
                .setPriority(
                        NotificationCompat.PRIORITY_LOW
                )
                .setStyle(
                        new MediaStyleNotificationHelper.MediaStyle(
                                mediaSession
                        )
                );

        /*
         * Barra de progreso de la notificación.
         *
         * Solo se actualiza una vez por segundo, para no
         * generar trabajo innecesario.
         */
        if (durationMs > 0) {

            int progressMax =
                    (int) Math.min(
                            durationMs,
                            Integer.MAX_VALUE
                    );

            int progress =
                    (int) Math.max(
                            0,
                            Math.min(
                                    positionMs,
                                    durationMs
                            )
                    );

            builder.setProgress(
                    progressMax,
                    progress,
                    false
            );
        }

        if (Build.VERSION.SDK_INT >=
                Build.VERSION_CODES.S) {

            builder.setForegroundServiceBehavior(
                    NotificationCompat
                            .FOREGROUND_SERVICE_IMMEDIATE
            );
        }

        return builder.build();
    }

    private void updateNotification() {

        long now =
                SystemClock
                        .elapsedRealtime();

        if (now -
                lastNotificationUpdateMs
                < NOTIFICATION_UPDATE_INTERVAL_MS) {

            return;
        }

        lastNotificationUpdateMs =
                now;

        NotificationManager notificationManager =
                (NotificationManager)
                        getSystemService(
                                Context.NOTIFICATION_SERVICE
                        );

        if (notificationManager == null) {
            return;
        }

        notificationManager.notify(
                NOTIFICATION_ID,
                buildNotification()
        );
    }

    private void updateNotificationImmediately() {

        lastNotificationUpdateMs = 0;

        updateNotification();
    }

    public void setShuffleEnabled(boolean enabled) {
        mainHandler.post(() -> {
            if (player == null) {
                return;
            }

            player.setShuffleEnabledFromApp(enabled);

            updateMediaButtonPreferences();
            updateNotificationImmediately();
        });
    }

    public void setRepeatMode(int repeatMode) {
        mainHandler.post(() -> {
            if (player == null) {
                return;
            }

            player.setRepeatModeFromApp(repeatMode);

            updateMediaButtonPreferences();
            updateNotificationImmediately();
        });
    }

    public void setTrack(
            String id,
            String title,
            String artist,
            String album,
            String artworkUrl,
            long durationMs
    ) {
        mainHandler.post(() -> {

            if (player == null) {
                return;
            }

            player.setMedia(
                    id,
                    title,
                    artist,
                    album,
                    artworkUrl,
                    durationMs
            );

            updateMediaButtonPreferences();

            updateNotificationImmediately();
        });
    }

    public void setPlaying(
            boolean playing
    ) {
        mainHandler.post(() -> {

            if (player == null) {
                return;
            }

            player.setPlaying(
                    playing
            );

            updateNotificationImmediately();
        });
    }

    public void setPosition(
            long positionMs
    ) {
        mainHandler.post(() -> {

            if (player == null) {
                return;
            }

            player.setPosition(
                    positionMs
            );

            /*
             * Como máximo una actualización por segundo.
             */
            updateNotification();
        });
    }

    public void setDuration(
            long durationMs
    ) {
        mainHandler.post(() -> {

            if (player == null) {
                return;
            }

            player.setDuration(
                    durationMs
            );
        });
    }

    @Nullable
    @Override
    public MediaSession onGetSession(
            MediaSession.ControllerInfo controllerInfo
    ) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(
            @Nullable Intent rootIntent
    ) {
        if (player != null
                && player.isPlayingNow()) {

            return;
        }

        stopSelf();
    }

    @Override
    public void onDestroy() {

        instance = null;

        mainHandler.removeCallbacksAndMessages(
                null
        );

        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }

        if (player != null) {
            player.release();
            player = null;
        }

        super.onDestroy();
    }
}