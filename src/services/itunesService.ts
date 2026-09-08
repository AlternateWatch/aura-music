export interface iTunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  artworkUrl100: string;
  previewUrl: string;
  trackTimeMillis: number;
}

export const itunesService = {
  async searchTracks(query: string): Promise<iTunesTrack[]> {
    try {
      const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=15`);
      if (!response.ok) throw new Error('iTunes API error');
      const data = await response.json();
      return data.results;
    } catch (error) {
      console.error('Error fetching from iTunes:', error);
      return [];
    }
  },

  async getTrendingTracks(): Promise<iTunesTrack[]> {
    try {
      // Using a predefined search term to simulate trending/popular
      const response = await fetch(`https://itunes.apple.com/search?term=pop&media=music&entity=song&limit=25`);
      if (!response.ok) throw new Error('iTunes API error');
      const data = await response.json();
      return data.results;
    } catch (error) {
      console.error('Error fetching trending from iTunes:', error);
      return [];
    }
  }
};
