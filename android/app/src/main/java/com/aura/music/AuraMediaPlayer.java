package com.aura.music;

import android.net.Uri;
import android.os.Looper;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;
import androidx.media3.common.util.UnstableApi;

import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.Collections;

@OptIn(markerClass = UnstableApi.class)
public class AuraMediaPlayer extends SimpleBasePlayer {

    public interface Callback {
        void onPlay();

        void onPause();

        void onNext();

        void onPrevious();

        void onSeek(long positionMs);

        void onShuffleChanged(boolean enabled);

        void onRepeatChanged(int repeatMode);
    }

    private final Callback callback;

    private MediaItem currentMediaItem;
    private MediaMetadata currentMetadata;

    private boolean playing = false;

    private long currentPositionMs = 0;

    private long durationMs = 0;

    private boolean shuffleEnabled = false;

    private int repeatMode = Player.REPEAT_MODE_OFF;

    public AuraMediaPlayer(
            Looper looper,
            Callback callback
    ) {
        super(looper);

        this.callback = callback;
    }

    public void setMedia(
            String id,
            String title,
            String artist,
            String album,
            String artworkUrl,
            long durationMs
    ) {
        MediaMetadata.Builder metadataBuilder =
                new MediaMetadata.Builder();

        if (title != null && !title.isEmpty()) {
            metadataBuilder.setTitle(title);
            metadataBuilder.setDisplayTitle(title);
        }

        if (artist != null && !artist.isEmpty()) {
            String artistText = artist;

            if (album != null && !album.isEmpty()) {
                artistText =
                        artist
                                + "   -   "
                                + album;
            }

            metadataBuilder.setArtist(artistText);
        }

        if (artworkUrl != null && !artworkUrl.isEmpty()) {
            metadataBuilder.setArtworkUri(
                    Uri.parse(artworkUrl)
            );
        }

        currentMetadata =
                metadataBuilder.build();

        currentMediaItem =
                new MediaItem.Builder()
                        .setMediaId(
                                id != null
                                        ? id
                                        : "aura-track"
                        )
                        .setMediaMetadata(
                                currentMetadata
                        )
                        .build();

        this.durationMs =
                Math.max(
                        0,
                        durationMs
                );

        this.currentPositionMs = 0;

        invalidateState();
    }

    public void setPlaying(
            boolean playing
    ) {
        this.playing = playing;

        invalidateState();
    }

    public void setPosition(long positionMs) {
        android.util.Log.d(
                "AuraMedia",
                "PLAYER setPosition ENTRADA: " + positionMs
        );

        if (durationMs > 0) {
            currentPositionMs = Math.max(
                    0,
                    Math.min(positionMs, durationMs)
            );
        } else {
            currentPositionMs = Math.max(
                    0,
                    positionMs
            );
        }

        android.util.Log.d(
                "AuraMedia",
                "PLAYER currentPositionMs DESPUES: "
                        + currentPositionMs
                        + " / durationMs: "
                        + durationMs
        );

        invalidateState();
    }

    public void setDuration(
            long durationMs
    ) {
        this.durationMs =
                Math.max(
                        0,
                        durationMs
                );

        if (this.durationMs > 0) {

            currentPositionMs =
                    Math.min(
                            currentPositionMs,
                            this.durationMs
                    );
        }

        invalidateState();
    }

    public boolean isPlayingNow() {
        return playing;
    }

    public long getPositionMs() {
        return currentPositionMs;
    }

    public long getDurationMs() {
        return durationMs;
    }

    public boolean isShuffleEnabled() {
        return shuffleEnabled;
    }

    public void setShuffleEnabledFromApp(boolean enabled) {
        shuffleEnabled = enabled;

        invalidateState();
    }

    public void setRepeatModeFromApp(int mode) {
        repeatMode = mode;

        invalidateState();
    }

    /*
     * NO se llama getRepeatMode().
     *
     * SimpleBasePlayer ya tiene getRepeatMode() como final.
     */
    public int getCurrentRepeatMode() {
        return repeatMode;
    }

    @Override
    protected State getState() {

        Commands commands =
                new Commands.Builder()

                        .add(
                                Player.COMMAND_PLAY_PAUSE
                        )

                        .add(
                                Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM
                        )

                        .add(
                                Player.COMMAND_SEEK_TO_NEXT
                        )

                        .add(
                                Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM
                        )

                        .add(
                                Player.COMMAND_SEEK_TO_PREVIOUS
                        )

                        .add(
                                Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM
                        )

                        .add(
                                Player.COMMAND_SEEK_FORWARD
                        )

                        .add(
                                Player.COMMAND_SEEK_BACK
                        )

                        .add(
                                Player.COMMAND_SET_SHUFFLE_MODE
                        )

                        .add(
                                Player.COMMAND_SET_REPEAT_MODE
                        )

                        .add(
                                Player.COMMAND_GET_CURRENT_MEDIA_ITEM
                        )

                        .add(
                                Player.COMMAND_GET_METADATA
                        )

                        .build();

        State.Builder builder =
                new State.Builder()

                        .setAvailableCommands(
                                commands
                        )

                        .setPlayWhenReady(
                                playing,
                                Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST
                        )

                        .setPlaybackState(
                                currentMediaItem != null
                                        ? Player.STATE_READY
                                        : Player.STATE_IDLE
                        )

                        .setCurrentMediaItemIndex(
                                currentMediaItem != null
                                        ? 0
                                        : C.INDEX_UNSET
                        )

                        .setContentPositionMs(
                                currentPositionMs
                        )

                        .setShuffleModeEnabled(
                                shuffleEnabled
                        )

                        .setRepeatMode(
                                repeatMode
                        );

        if (currentMediaItem != null) {

            MediaItemData mediaItemData =
                    new MediaItemData.Builder(
                            currentMediaItem
                    )
                            .setMediaMetadata(
                                    currentMetadata
                            )
                            .setDurationUs(
                                    durationMs > 0
                                            ? durationMs * 1000L
                                            : C.TIME_UNSET
                            )
                            .build();

            builder.setPlaylist(
                    Collections.singletonList(
                            mediaItemData
                    )
            );
        }

        return builder.build();
    }

    @Override
    protected ListenableFuture<?> handleSetPlayWhenReady(
            boolean playWhenReady
    ) {
        playing = playWhenReady;

        if (callback != null) {

            if (playWhenReady) {
                callback.onPlay();
            } else {
                callback.onPause();
            }
        }

        invalidateState();

        return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleSeek(
            int mediaItemIndex,
            long positionMs,
            int seekCommand
    ) {

        if (seekCommand == Player.COMMAND_SEEK_TO_NEXT
                || seekCommand == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM) {

            if (callback != null) {
                callback.onNext();
            }

            return Futures.immediateVoidFuture();
        }

        if (seekCommand == Player.COMMAND_SEEK_TO_PREVIOUS
                || seekCommand == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {

            if (callback != null) {
                callback.onPrevious();
            }

            return Futures.immediateVoidFuture();
        }

        if (seekCommand == Player.COMMAND_SEEK_FORWARD) {

            long newPosition =
                    currentPositionMs + 10_000L;

            if (durationMs > 0) {
                newPosition =
                        Math.min(
                                newPosition,
                                durationMs
                        );
            }

            currentPositionMs =
                    Math.max(
                            0,
                            newPosition
                    );

            if (callback != null) {
                callback.onSeek(
                        currentPositionMs
                );
            }

            invalidateState();

            return Futures.immediateVoidFuture();
        }

        if (seekCommand == Player.COMMAND_SEEK_BACK) {

            long newPosition =
                    currentPositionMs - 10_000L;

            currentPositionMs =
                    Math.max(
                            0,
                            newPosition
                    );

            if (callback != null) {
                callback.onSeek(
                        currentPositionMs
                );
            }

            invalidateState();

            return Futures.immediateVoidFuture();
        }

        if (mediaItemIndex != 0) {
            return Futures.immediateVoidFuture();
        }

        if (durationMs > 0) {

            currentPositionMs =
                    Math.max(
                            0,
                            Math.min(
                                    positionMs,
                                    durationMs
                            )
                    );

        } else {

            currentPositionMs =
                    Math.max(
                            0,
                            positionMs
                    );
        }

        if (callback != null) {
            callback.onSeek(
                    currentPositionMs
            );
        }

        invalidateState();

        return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleSetShuffleModeEnabled(
            boolean enabled
    ) {
        shuffleEnabled = enabled;

        if (callback != null) {
            callback.onShuffleChanged(
                    enabled
            );
        }

        invalidateState();

        return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleSetRepeatMode(
            int mode
    ) {
        repeatMode = mode;

        if (callback != null) {
            callback.onRepeatChanged(
                    mode
            );
        }

        invalidateState();

        return Futures.immediateVoidFuture();
    }
}