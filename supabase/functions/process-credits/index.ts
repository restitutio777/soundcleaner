import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Kreditpakete (müssen mit dem Frontend übereinstimmen)
const PACKAGES: Record<string, { credits_seconds: number; amount_cents: number }> = {
  pkg_30: { credits_seconds: 1800, amount_cents: 200 },
  pkg_120: { credits_seconds: 7200, amount_cents: 700 },
  pkg_480: { credits_seconds: 28800, amount_cents: 1900 },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Nutzer über JWT authentifizieren
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Nicht authentifiziert" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // JWT validieren und Nutzer-ID auslesen
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Ungültiges Token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();

    // Route: GET /process-credits/balance – aktuelles Guthaben abfragen
    if (req.method === "GET" && path === "balance") {
      const { data, error } = await supabase
        .from("user_credits")
        .select("credits_seconds, is_pro")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      return new Response(JSON.stringify(data ?? { credits_seconds: 0, is_pro: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Route: POST /process-credits/purchase – Credits kaufen (Stripe-Stub)
    if (req.method === "POST" && path === "purchase") {
      const { package_id } = await req.json();
      const pkg = PACKAGES[package_id];

      if (!pkg) {
        return new Response(JSON.stringify({ error: "Unbekanntes Paket" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // TODO: Stripe-Zahlung hier verarbeiten
      // Für jetzt: Credits direkt gutschreiben (Demo-Modus)
      const { error: insertError } = await supabase
        .from("credit_purchases")
        .insert({
          user_id: user.id,
          stripe_session_id: `demo_${Date.now()}`,
          credits_seconds: pkg.credits_seconds,
          amount_cents: pkg.amount_cents,
        });

      if (insertError) throw insertError;

      // Credits zum bestehenden Guthaben addieren
      const { data: existing } = await supabase
        .from("user_credits")
        .select("credits_seconds")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("user_credits")
          .update({
            credits_seconds: existing.credits_seconds + pkg.credits_seconds,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);
      } else {
        await supabase.from("user_credits").insert({
          user_id: user.id,
          credits_seconds: pkg.credits_seconds,
          is_pro: true,
        });
      }

      return new Response(
        JSON.stringify({ success: true, added_seconds: pkg.credits_seconds }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Route nicht gefunden" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
