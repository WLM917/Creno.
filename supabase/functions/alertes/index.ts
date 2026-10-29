// Créno : alertes partagées entre candidats (fonction serveur Supabase, Deno).
//
// Le site appelle cette fonction en POST avec un JSON { action, ... } :
//   abonner    { email, departement }   -> crée l'abonnement. Payant : renvoie le lien Stripe.
//                                          Gratuit (pas de lien Stripe configuré) : envoie un e-mail de confirmation.
//   confirmer  { t }                    -> active un abonnement gratuit après clic dans l'e-mail
//   paiement   { session_id }           -> vérifie le paiement Stripe et active l'abonnement
//   desabonner { t }                    -> arrête les alertes
//   signaler   { departement, centre, creneau?, details? } -> enregistre un signalement et prévient les abonnés
//
// Aucun robot, aucune connexion à RdvPermis : les alertes viennent uniquement des candidats.
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   SITE_URL                 https://creno-tan.vercel.app
//   RESEND_API_KEY           clé Resend (envoi des e-mails)
//   ALERTES_EXPEDITEUR       ex. "Créno <alertes@creno.fr>" (domaine vérifié dans Resend)
//   ALERTES_LIEN_STRIPE      lien de paiement Stripe du pass alertes (vide = alertes gratuites)
//   ALERTES_MONTANT_CENTIMES prix minimum attendu en centimes (défaut 299 = 2,99 €)
//   ALERTES_DUREE_JOURS      durée du pass, 30 par défaut
//   STRIPE_SECRET_KEY        clé secrète Stripe (vérification des paiements)
//   ALERTES_SEL              une phrase secrète au hasard (anonymise les appareils)
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SITE_URL = env("SITE_URL", "https://creno-tan.vercel.app").replace(/\/$/, "");
const DUREE_JOURS = Number(env("ALERTES_DUREE_JOURS", "30")) || 30;
const MAX_SIGNALEMENTS_HEURE = 3;
const PAUSE_MINUTES = 10; // un même abonné reçoit au plus une alerte toutes les 10 minutes

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEPARTEMENT = /^([0-9]{2,3}|2[AB])$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { apikey: SERVICE_KEY, "Content-Type": "application/json" };
  if (!SERVICE_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SERVICE_KEY}`;
  return h;
}

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) throw new Error(`Base de données : ${res.status} ${await res.text()}`);
  const text = await res.text();
  return { data: text ? JSON.parse(text) : null, headers: res.headers };
}

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function clean(s: unknown, max: number) {
  const v = String(s ?? "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 86400000);
}

function dateFr(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
}

async function sendEmails(messages: Array<Record<string, unknown>>) {
  const key = env("RESEND_API_KEY");
  if (!key || !messages.length) return 0;
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (res.ok) sent += batch.length;
    else console.error("Resend", res.status, await res.text());
  }
  return sent;
}

function emailLayout(title: string, bodyHtml: string, desabo?: string) {
  const foot = desabo
    ? `<p style="color:#55606B;font-size:13px">Tu reçois cet e-mail parce que tu suis ce département sur Créno.
       <a href="${desabo}">Ne plus recevoir d'alertes</a></p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;color:#1A1F25;max-width:520px;line-height:1.5">
    <p style="font-size:20px;font-weight:bold;margin:0 0 12px">${esc(title)}</p>${bodyHtml}${foot}
    <p style="color:#55606B;font-size:13px">Créno, le bon créneau pour ton permis. Service indépendant, sans lien avec RdvPermis.</p></div>`;
}

async function stripeSession(id: string) {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY manquant");
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return null;
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  return await res.json();
}

// ---------------------------------------------------------------- actions
async function abonner(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const departement = String(body.departement ?? "").toUpperCase();
  if (!EMAIL.test(email) || email.length > 200) return reply(400, { erreur: "Cette adresse e-mail n'est pas valide." });
  if (!DEPARTEMENT.test(departement)) return reply(400, { erreur: "Choisis un département." });

  const { data } = await db("abonnes_alertes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ email, departement }),
  });
  const token = data[0].token as string;
  const lien = env("ALERTES_LIEN_STRIPE");

  if (lien) {
    const url = new URL(lien);
    url.searchParams.set("client_reference_id", `alerte-${token}`);
    url.searchParams.set("prefilled_email", email);
    return reply(200, { paiement: url.toString() });
  }

  const confirmUrl = `${SITE_URL}/alertes/confirmer/?t=${token}`;
  const sent = await sendEmails([{
    from: env("ALERTES_EXPEDITEUR", "Créno <onboarding@resend.dev>"),
    to: [email],
    subject: "Confirme ton alerte Créno",
    html: emailLayout("Confirme ton alerte", `<p>Tu as demandé à être prévenu quand des candidats signalent des places d'examen dans le ${esc(departement)}.</p>
      <p><a href="${confirmUrl}" style="display:inline-block;background:#0A4F8F;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Confirmer mon alerte</a></p>
      <p style="color:#55606B;font-size:13px">Si ce n'est pas toi, ignore cet e-mail.</p>`),
    text: `Confirme ton alerte Créno pour le ${departement} : ${confirmUrl}`,
  }]);
  if (!sent) return reply(503, { erreur: "L'e-mail de confirmation n'a pas pu partir. Réessaie dans quelques minutes." });
  return reply(200, { confirmation: true });
}

async function activer(token: string, sessionId: string | null) {
  const { data } = await db(`abonnes_alertes?token=eq.${token}&select=id,departement,statut,expire_le,stripe_session`);
  const row = data?.[0];
  if (!row) return reply(404, { erreur: "Abonnement introuvable." });
  if (sessionId && row.stripe_session === sessionId) {
    return reply(200, { ok: true, departement: row.departement, expire_le: row.expire_le, expire_txt: dateFr(row.expire_le) });
  }
  if (!sessionId && row.statut === "actif") {
    return reply(200, { ok: true, departement: row.departement, expire_le: row.expire_le, expire_txt: dateFr(row.expire_le) });
  }
  const now = new Date();
  const base = row.expire_le && new Date(row.expire_le) > now ? new Date(row.expire_le) : now;
  const expire = addDays(base, DUREE_JOURS).toISOString();
  await db(`abonnes_alertes?id=eq.${row.id}`, {
    method: "PATCH",
    body: JSON.stringify({ statut: "actif", expire_le: expire, ...(sessionId ? { stripe_session: sessionId } : {}) }),
  });
  return reply(200, { ok: true, departement: row.departement, expire_le: expire, expire_txt: dateFr(expire) });
}

async function confirmer(body: Record<string, unknown>) {
  const t = String(body.t ?? "");
  if (!UUID.test(t)) return reply(400, { erreur: "Lien de confirmation invalide." });
  if (env("ALERTES_LIEN_STRIPE")) return reply(400, { erreur: "Les alertes sont payantes : passe par la page Alertes." });
  return await activer(t, null);
}

async function paiement(body: Record<string, unknown>) {
  const id = String(body.session_id ?? "");
  const s = await stripeSession(id);
  if (!s || s.payment_status !== "paid") return reply(402, { erreur: "Le paiement n'est pas confirmé." });
  const ref = String(s.client_reference_id ?? "");
  const min = Number(env("ALERTES_MONTANT_CENTIMES", "299")) || 299;
  if (!ref.startsWith("alerte-") || (s.amount_total ?? 0) < min) return reply(400, { erreur: "Ce paiement ne correspond pas au pass alertes." });
  const token = ref.slice("alerte-".length);
  if (!UUID.test(token)) return reply(400, { erreur: "Référence de paiement invalide." });
  return await activer(token, id);
}

async function desabonner(body: Record<string, unknown>) {
  const t = String(body.t ?? "");
  if (!UUID.test(t)) return reply(400, { erreur: "Lien invalide." });
  await db(`abonnes_alertes?token=eq.${t}`, { method: "PATCH", body: JSON.stringify({ statut: "desabonne" }) });
  return reply(200, { ok: true });
}

async function signaler(body: Record<string, unknown>, req: Request) {
  const departement = String(body.departement ?? "").toUpperCase();
  const centre = clean(body.centre, 120);
  const creneau = clean(body.creneau, 120);
  const details = clean(body.details, 300);
  if (!DEPARTEMENT.test(departement)) return reply(400, { erreur: "Choisis un département." });
  if (!centre || centre.length < 2) return reply(400, { erreur: "Indique le centre d'examen." });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const empreinte = await sha256(`${env("ALERTES_SEL", SERVICE_KEY.slice(-16))}|${ip}|${req.headers.get("user-agent") ?? ""}`);
  const uneHeure = new Date(Date.now() - 3600000).toISOString();
  const { headers } = await db(`signalements?empreinte=eq.${empreinte}&created_at=gte.${uneHeure}&select=id`, {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  const count = Number((headers.get("content-range") ?? "*/0").split("/")[1]) || 0;
  if (count >= MAX_SIGNALEMENTS_HEURE) {
    return reply(429, { erreur: "Tu as déjà fait plusieurs signalements cette heure-ci. Merci, réessaie un peu plus tard." });
  }

  const { data: sig } = await db("signalements", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ departement, centre, creneau, details, empreinte }),
  });

  const now = new Date();
  const { data: abonnes } = await db(
    `abonnes_alertes?departement=eq.${departement}&statut=eq.actif&expire_le=gt.${now.toISOString()}&select=id,email,token,dernier_envoi`);
  const pause = now.getTime() - PAUSE_MINUTES * 60000;
  const vus = new Set<string>();
  const cibles = (abonnes ?? []).filter((a: { email: string; dernier_envoi: string | null }) => {
    if (vus.has(a.email)) return false;
    vus.add(a.email);
    return !a.dernier_envoi || new Date(a.dernier_envoi).getTime() < pause;
  });

  const rdv = "https://candidat.permisdeconduire.gouv.fr";
  const sujet = `Places signalées : ${centre} (${departement})`;
  const messages = cibles.map((a: { email: string; token: string }) => {
    const desabo = `${SITE_URL}/alertes/desabonner/?t=${a.token}`;
    return {
      from: env("ALERTES_EXPEDITEUR", "Créno <onboarding@resend.dev>"),
      to: [a.email],
      subject: sujet,
      headers: { "List-Unsubscribe": `<${desabo}>` },
      html: emailLayout("Un candidat vient de voir des places", `
        <p><strong>Centre :</strong> ${esc(centre)} (${esc(departement)})</p>
        ${creneau ? `<p><strong>Créneau vu :</strong> ${esc(creneau)}</p>` : ""}
        ${details ? `<p><strong>Précision :</strong> ${esc(details)}</p>` : ""}
        <p><a href="${rdv}" style="display:inline-block;background:#0A4F8F;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Vérifier sur RdvPermis</a></p>
        <p style="color:#55606B;font-size:13px">Ce signalement vient d'un autre candidat, à ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}. La place a peut-être déjà été prise.</p>`, desabo),
      text: `${sujet}${creneau ? ` - créneau vu : ${creneau}` : ""}. Vérifie sur RdvPermis : ${rdv}. Ne plus recevoir d'alertes : ${desabo}`,
    };
  });

  const sent = await sendEmails(messages);
  if (sent) {
    const ids = cibles.slice(0, sent).map((a: { id: number }) => a.id).join(",");
    await db(`abonnes_alertes?id=in.(${ids})`, { method: "PATCH", body: JSON.stringify({ dernier_envoi: now.toISOString() }) });
    await db(`signalements?id=eq.${sig[0].id}`, { method: "PATCH", body: JSON.stringify({ nb_prevenus: sent }) });
  }
  return reply(200, { ok: true, prevenus: sent });
}

// ---------------------------------------------------------------- point d'entrée
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { erreur: "Méthode non autorisée." });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { erreur: "Requête invalide." });
  }
  try {
    switch (body.action) {
      case "abonner": return await abonner(body);
      case "confirmer": return await confirmer(body);
      case "paiement": return await paiement(body);
      case "desabonner": return await desabonner(body);
      case "signaler": return await signaler(body, req);
      default: return reply(400, { erreur: "Action inconnue." });
    }
  } catch (e) {
    console.error(e);
    return reply(500, { erreur: "Une erreur est survenue. Réessaie dans quelques minutes." });
  }
});
