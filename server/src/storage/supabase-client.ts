import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../config/env.js";

let supabaseInstance: SupabaseClient | null = null;
let supabaseChecked = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseChecked) {
    return supabaseInstance;
  }

  const url = ENV.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = ENV.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (url && key) {
    try {
      supabaseInstance = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      console.log(`[Supabase] Client initialized for endpoint: ${url}`);
    } catch (err) {
      console.warn("[Supabase] Failed to initialize client, using local JSON repository fallback:", err);
      supabaseInstance = null;
    }
  }

  supabaseChecked = true;
  return supabaseInstance;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseClient() !== null;
}
