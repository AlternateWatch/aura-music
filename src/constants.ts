export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  audioUrl: string;
  status: 'pending' | 'approved' | 'rejected';
  uploaderId: string;
  createdAt: string;
  updatedAt: string;
  format: 'mp3' | 'flac';
  tabs_url: string | null;
  track_number: number | null;
  duration?: number;
  genre?: string | null;
  is_liked?: number | boolean;
  animated_cover_path?: string | null;
  animatedCoverUrl?: string | null;
  video_url?: string | null;
}
export interface Playlist {
  id: string | number;
  name: string;
  songIds?: string[];
  color?: string;
  ownerId?: string;
  owner_id?: number | string;
  owner_name?: string;
  createdAt?: string;
  description?: string;
  cover_path?: string;
  is_collaborative?: boolean | number;
  invite_code?: string | null;
  is_owner?: boolean | number;
  is_collaborator?: boolean | number;
  collaborator_count?: number;
}


export const MOCK_SONGS: Song[] = [];
