// Créno : accès au Pack candidat libre après paiement (fonction serveur Supabase, Deno).
//
// Le site appelle cette fonction en POST avec { session_id } (fourni par Stripe dans l'adresse de retour).
// La fonction vérifie auprès de Stripe que le paiement est bien fait, puis renvoie un lien
// temporaire (1 heure) vers le PDF rangé dans l'espace de stockage privé « pack ».
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   STRIPE_SECRET_KEY      clé secrète Stripe
//   PACK_MONTANT_CENTIMES  prix minimum attendu en centimes (défaut 1499 = 14,99 €)
//   PACK_FICHIER           nom du PDF dans le stockage « pack » (défaut : pack-candidat-libre.pdf)
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { erreur: "Méthode non autorisée." });
  try {
    const { session_id } = await req.json();
    const id = String(session_id ?? "");
    if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return reply(400, { erreur: "Lien d'accès invalide." });

    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
      headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` },
    });
    if (!res.ok) return reply(404, { erreur: "Paiement introuvable." });
    const s = await res.json();
    const min = Number(env("PACK_MONTANT_CENTIMES", "1499")) || 1499;
    if (s.payment_status !== "paid") return reply(402, { erreur: "Le paiement n'est pas encore confirmé." });
    if (!String(s.client_reference_id ?? "").startsWith("pack-") || (s.amount_total ?? 0) < min) {
      return reply(400, { erreur: "Ce paiement ne correspond pas au pack." });
    }

    const fichier = env("PACK_FICHIER", "pack-candidat-libre.pdf");
    const headers: Record<string, string> = { apikey: SERVICE_KEY, "Content-Type": "application/json" };
    if (!SERVICE_KEY.startsWith("sb_")) headers.Authorization = `Bearer ${SERVICE_KEY}`;
    const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/pack/${encodeURIComponent(fichier)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!sign.ok) {
      console.error("Stockage", sign.status, await sign.text());
      return reply(503, { erreur: "Le pack n'est pas disponible pour le moment. Écris-nous, on te l'envoie." });
    }
    const { signedURL } = await sign.json();
    return reply(200, {
      ok: true,
      url: `${SUPABASE_URL}/storage/v1${signedURL}`,
      email: s.customer_details?.email ?? null,
    });
  } catch (e) {
    console.error(e);
    return reply(500, { erreur: "Une erreur est survenue. Réessaie dans quelques minutes." });
  }
});
