export const instruments = [
  { key: "vocal", label: "보컬" },
  { key: "drums", label: "드럼" },
  { key: "guitar", label: "기타" },
  { key: "bass", label: "베이스" },
  { key: "keys", label: "건반" },
  { key: "other", label: "Other" }
];

export const sampleSongs = [
  {
    id: "stay-with-me",
    title: "자우림 - Stay with me",
    artist: "자우림",
    audioUrl: "https://example.supabase.co/storage/v1/object/public/audio/stay-with-me/full.mp3",
    splitTracks: {
      vocal: "https://example.supabase.co/storage/v1/object/public/audio/stay-with-me/vocal.mp3",
      drums: "https://example.supabase.co/storage/v1/object/public/audio/stay-with-me/drums.mp3",
      guitar: "https://example.supabase.co/storage/v1/object/public/audio/stay-with-me/guitar.mp3",
      bass: "https://example.supabase.co/storage/v1/object/public/audio/stay-with-me/bass.mp3",
      keys: "https://example.supabase.co/storage/v1/object/public/audio/stay-with-me/keys.mp3",
      other: "https://example.supabase.co/storage/v1/object/public/audio/stay-with-me/other.mp3"
    },
    scores: [
      { label: "합주 악보", url: "https://example.supabase.co/storage/v1/object/public/scores/stay-with-me-score.pdf" },
      { label: "기타 악보", url: "https://example.supabase.co/storage/v1/object/public/scores/stay-with-me-guitar.pdf" }
    ],
    album: {
      images: [
        "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1200&q=80"
      ],
      youtubeId: "dQw4w9WgXcQ"
    },
    partsReady: 6
  },
  {
    id: "champagne-supernova",
    title: "Oasis - Champagne Supernova",
    artist: "Oasis",
    audioUrl: "https://example.supabase.co/storage/v1/object/public/audio/champagne-supernova/full.mp3",
    splitTracks: {
      vocal: "https://example.supabase.co/storage/v1/object/public/audio/champagne-supernova/vocal.mp3",
      drums: "https://example.supabase.co/storage/v1/object/public/audio/champagne-supernova/drums.mp3",
      guitar: "https://example.supabase.co/storage/v1/object/public/audio/champagne-supernova/guitar.mp3",
      bass: "https://example.supabase.co/storage/v1/object/public/audio/champagne-supernova/bass.mp3",
      keys: "https://example.supabase.co/storage/v1/object/public/audio/champagne-supernova/keys.mp3",
      other: "https://example.supabase.co/storage/v1/object/public/audio/champagne-supernova/other.mp3"
    },
    scores: [
      { label: "합주 악보", url: "https://example.supabase.co/storage/v1/object/public/scores/champagne-supernova-score.pdf" }
    ],
    album: {
      images: [
        "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=80"
      ],
      youtubeId: "bx1Bh8ZvH84"
    },
    partsReady: 6
  },
  {
    id: "pretender",
    title: "Official Hige Dandism - Pretender",
    artist: "Official Hige Dandism",
    audioUrl: "https://example.supabase.co/storage/v1/object/public/audio/pretender/full.mp3",
    splitTracks: {
      vocal: "https://example.supabase.co/storage/v1/object/public/audio/pretender/vocal.mp3",
      drums: "https://example.supabase.co/storage/v1/object/public/audio/pretender/drums.mp3",
      guitar: "https://example.supabase.co/storage/v1/object/public/audio/pretender/guitar.mp3",
      bass: "https://example.supabase.co/storage/v1/object/public/audio/pretender/bass.mp3",
      keys: "https://example.supabase.co/storage/v1/object/public/audio/pretender/keys.mp3",
      other: "https://example.supabase.co/storage/v1/object/public/audio/pretender/other.mp3"
    },
    scores: [
      { label: "합주 악보", url: "https://example.supabase.co/storage/v1/object/public/scores/pretender-score.pdf" }
    ],
    album: {
      images: [
        "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=1200&q=80"
      ],
      youtubeId: "TQ8WlA2GXbk"
    },
    partsReady: 6
  }
];
