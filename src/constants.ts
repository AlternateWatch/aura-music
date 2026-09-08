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
}
export interface Playlist {
  id: string;
  name: string;
  songIds: string[];
  color: string;
  ownerId: string;
  createdAt: string;
}


export const MOCK_SONGS: Song[] = [];
