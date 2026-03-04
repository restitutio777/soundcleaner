import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserCredits = {
  id: string;
  user_id: string;
  credits_seconds: number;
  is_pro: boolean;
  created_at: string;
  updated_at: string;
};

export type ProcessingJob = {
  id: string;
  user_id: string | null;
  filename: string;
  duration_seconds: number;
  preset: string;
  status: string;
  created_at: string;
};

export type CreditPurchase = {
  id: string;
  user_id: string;
  stripe_session_id: string;
  credits_seconds: number;
  amount_cents: number;
  created_at: string;
};

export const CREDIT_PACKAGES = [
  { id: "pkg_30", label: "30 Minuten", credits_seconds: 1800, amount_cents: 200, display: "2€" },
  { id: "pkg_120", label: "2 Stunden", credits_seconds: 7200, amount_cents: 700, display: "7€" },
  { id: "pkg_480", label: "8 Stunden", credits_seconds: 28800, amount_cents: 1900, display: "19€" },
] as const;

export const FREE_CREDITS_SECONDS = 600;
export const FREE_MAX_DURATION_SECONDS = 180;
export const PRO_MAX_DURATION_SECONDS = 3600;
