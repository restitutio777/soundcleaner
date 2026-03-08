/*
  # Purchase Interest Tracking + Jobs Counter

  1. New Tables
    - `purchase_interest`
      - `id` (uuid, primary key)
      - `user_id` (uuid, nullable - references auth.users)
      - `package_id` (text) - which credit package the user wanted to buy
      - `created_at` (timestamptz)

  2. New Functions
    - `get_total_jobs_count()` - Returns the total number of processing jobs (for public counter)

  3. Security
    - RLS enabled on `purchase_interest`
    - Authenticated users can insert their own interest records
    - No public SELECT access (admin-only via dashboard)

  4. Notes
    - This table captures real purchase intent before Stripe is live
    - The jobs counter function uses SECURITY DEFINER so it can count all rows
*/

CREATE TABLE IF NOT EXISTS purchase_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  package_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchase_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can log purchase interest"
  ON purchase_interest FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_purchase_interest_user_id ON purchase_interest(user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_interest_created_at ON purchase_interest(created_at);

CREATE OR REPLACE FUNCTION get_total_jobs_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(count(*)::integer, 0) FROM processing_jobs;
$$;
