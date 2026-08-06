import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfig = {
  buckets: {
    audio: import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || "audio",
    split: import.meta.env.VITE_SUPABASE_SPLIT_BUCKET || "audio",
    score: import.meta.env.VITE_SUPABASE_SCORE_BUCKET || "scores",
    album: import.meta.env.VITE_SUPABASE_ALBUM_BUCKET || "album"
  }
};

export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
