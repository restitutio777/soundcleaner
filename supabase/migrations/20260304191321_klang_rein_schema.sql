/*
  # KlangRein – Datenbankschema

  ## Beschreibung
  Dieses Schema legt die Datenstruktur für das KlangRein Audio-Verarbeitungssystem an.

  ## Neue Tabellen

  ### 1. `user_credits`
  Speichert das Guthaben jedes Nutzers.
  - `id` – Primärschlüssel
  - `user_id` – Verknüpfung mit auth.users
  - `credits_seconds` – verbleibendes Guthaben in Sekunden
  - `is_pro` – ob der Nutzer ein Pro-Konto hat
  - `created_at`, `updated_at` – Zeitstempel

  ### 2. `processing_jobs`
  Protokolliert alle Verarbeitungsjobs (für Statistik, Debugging, Credit-Abzug).
  - `id` – Primärschlüssel
  - `user_id` – Verknüpfung mit auth.users (null = anonymer Free-Nutzer, beschränkt per IP-Logik)
  - `filename` – Name der Audiodatei
  - `duration_seconds` – Länge der Audiodatei
  - `preset` – gewähltes Preset (basic, kursaufnahme, webinar, podcast)
  - `status` – Status des Jobs
  - `created_at` – Zeitstempel

  ### 3. `credit_purchases`
  Protokolliert alle Credit-Käufe über Stripe.
  - `id` – Primärschlüssel
  - `user_id` – Käufer
  - `stripe_session_id` – Stripe Checkout Session ID
  - `credits_seconds` – gekaufte Sekunden
  - `amount_cents` – bezahlter Betrag in Cent
  - `created_at` – Zeitstempel

  ## Sicherheit
  - RLS auf allen Tabellen aktiviert
  - Nutzer sehen und verändern nur ihre eigenen Daten
*/

-- Tabelle: Nutzerguthaben
CREATE TABLE IF NOT EXISTS user_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_seconds integer NOT NULL DEFAULT 600, -- 10 Minuten Startguthaben für Free-Nutzer
  is_pro boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Nutzer kann eigenes Guthaben lesen"
  ON user_credits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Nutzer kann eigenes Guthaben anlegen"
  ON user_credits FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Nutzer kann eigenes Guthaben aktualisieren"
  ON user_credits FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Tabelle: Verarbeitungsjobs
CREATE TABLE IF NOT EXISTS processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL DEFAULT 0,
  preset text NOT NULL DEFAULT 'basic',
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Nutzer kann eigene Jobs lesen"
  ON processing_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Nutzer kann Jobs anlegen"
  ON processing_jobs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Tabelle: Credit-Käufe
CREATE TABLE IF NOT EXISTS credit_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL DEFAULT '',
  credits_seconds integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Nutzer kann eigene Käufe lesen"
  ON credit_purchases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Nutzer kann Käufe anlegen"
  ON credit_purchases FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Index für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user_id ON credit_purchases(user_id);

-- Funktion: Guthaben automatisch abziehen nach Verarbeitung
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id uuid, p_seconds integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current integer;
BEGIN
  SELECT credits_seconds INTO v_current
  FROM user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RETURN -1; -- Kein Eintrag gefunden
  END IF;

  IF v_current < p_seconds THEN
    RETURN -2; -- Nicht genug Guthaben
  END IF;

  UPDATE user_credits
  SET credits_seconds = credits_seconds - p_seconds,
      updated_at = now()
  WHERE user_id = p_user_id;

  RETURN v_current - p_seconds;
END;
$$;
