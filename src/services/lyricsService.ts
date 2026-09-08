
export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsData {
  plainLyrics?: string;
  syncedLyrics?: string;
  instrumental: boolean;
}

class LyricsService {
  private baseUrl = 'https://lrclib.net/api';

  async getLyrics(artist: string, title: string, album?: string, duration?: number): Promise<LyricLine[] | null> {
    try {
      const params = new URLSearchParams({
        artist_name: artist,
        track_name: title,
      });
      if (album) params.append('album_name', album);
      if (duration) params.append('duration', Math.round(duration).toString());

      const targetUrl = `${this.baseUrl}/get?${params.toString()}`;
      const response = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}`);
      
      if (!response.ok) {
        // If specific get fails, try search
        return this.searchLyrics(artist, title);
      }

      const data = await response.json();
      return this.parseSyncedLyrics(data.syncedLyrics || data.plainLyrics);
    } catch (error) {
      console.error('Error fetching lyrics:', error);
      // Fallback to searching even if the initial fetch to proxy failed
      return this.searchLyrics(artist, title);
    }
  }

  private async searchLyrics(artist: string, title: string): Promise<LyricLine[] | null> {
    try {
      const params = new URLSearchParams({
        q: `${artist} ${title}`
      });
      const targetUrl = `${this.baseUrl}/search?${params.toString()}`;
      const response = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}`);
      
      if (!response.ok) return null;
      
      const results = await response.json();
      
      if (results && results.length > 0) {
        const bestMatch = results[0];
        return this.parseSyncedLyrics(bestMatch.syncedLyrics || bestMatch.plainLyrics);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private parseSyncedLyrics(lrcContent: string | undefined): LyricLine[] | null {
    if (!lrcContent) return null;

    // Check if it's LRC format (has timestamps)
    const lrcRegex = /\[(\d+):(\d+\.\d+)\](.*)/g;
    const lines: LyricLine[] = [];
    let match;

    while ((match = lrcRegex.exec(lrcContent)) !== null) {
      const minutes = parseInt(match[1]);
      const seconds = parseFloat(match[2]);
      const time = minutes * 60 + seconds;
      const text = match[3].trim();
      
      if (text || lines.length === 0) {
        lines.push({ time, text });
      }
    }

    if (lines.length > 0) return lines;

    // Fallback for plain text lyrics (no sync, just distribute them)
    return lrcContent.split('\n').map((text, index) => ({
      time: index * 5, // Faked timing if no sync available
      text: text.trim()
    })).filter(l => l.text);
  }
}

export const lyricsService = new LyricsService();
