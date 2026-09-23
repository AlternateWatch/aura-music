import { registerPlugin } from '@capacitor/core';

export interface AuraMediaPlugin {
  start(): Promise<void>;

  stop(): Promise<void>;

  setTrack(options: {
    id: string;
    title: string;
    artist?: string;
    album?: string;
    artworkUrl?: string;
    durationMs: number;
  }): Promise<void>;

  setPlaying(options: {
    playing: boolean;
  }): Promise<void>;

  setShuffle(options: {
    enabled: boolean;
  }): Promise<void>;

  setRepeat(options: {
    enabled: boolean;
  }): Promise<void>;

  setPosition(options: {
    positionMs: number;
  }): Promise<void>;

  setDuration(options: {
    durationMs: number;
  }): Promise<void>;

  addListener(
    eventName: 'play' | 'pause' | 'next' | 'previous' | 'shuffleChanged' | 'repeatChanged' | 'seek',
    listenerFunc: (data: any) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

const AuraMedia =
  registerPlugin<AuraMediaPlugin>('AuraMedia');

export default AuraMedia;