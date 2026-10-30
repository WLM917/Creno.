// Créno : alertes partagées entre candidats (fonction serveur Supabase, Deno).
//
// Formule : un essai gratuit sans carte bancaire (15 jours par défaut), puis, si la personne veut
// continuer, un abonnement mensuel Stripe (9,99 € par mois), sans engagement.
// Quelques jours avant la fin de l'essai, un e-mail automatique lui propose de continuer.
//
// Le site appelle cette fonction en POST avec un JSON { action, ... } :
//   abonner    { email, departement }  -> essai : envoie un e-mail de confirmation.
//                                        Essai déjà utilisé avec cet e-mail : renvoie { continuer } (page d'abonnement).
//   confirmer  { t }                   -> active l'essai après le clic dans l'e-mail
//   continuer  { t }                   -> renvoie le lien de paiement Stripe de cet abonné
//   paiement   { session_id }          -> vérifie l'abonnement Stripe et active les alertes
//   desabonner { t }                   -> arrête les alertes et résilie l'abonnement Stripe (plus aucun prélèvement)
//   signaler   { departement, centre, creneau?, details? } -> enregistre un signalement et prévient les abonnés
//   quotidien  { code }                -> tâche lancée chaque jour (Supabase Cron) : rappels de fin d'essai,
//                                        fin des essais, renouvellement des abonnements
//
// Aucun robot, aucune connexion à RdvPermis : les alertes viennent uniquement des candidats.
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   SITE_URL                 https://creno-tan.vercel.app
//   RESEND_API_KEY           clé Resend (envoi des e-mails)
//   ALERTES_EXPEDITEUR       ex. "Créno <alertes@creno.fr>" (domaine vérifié dans Resend)
//   ALERTES_LIEN_STRIPE      lien de paiement Stripe de l'abonnement mensuel.
//                            Vide = lancement gratuit : les essais se prolongent tout seuls.
//   ALERTES_MONTANT_CENTIMES prix minimum attendu en centimes (défaut 999 = 9,99 €)
//   ALERTES_ESSAI_JOURS      durée de l'essai gratuit (défaut 15)
//   STRIPE_SECRET_KEY        clé secrète Stripe (vérification des paiements, résiliation)
//   CRENO_SEL                une phrase secrète au hasard (anonymise les appareils)
//   ADMIN_CODE               ton code secret : protège la tâche quotidienne et le tableau de bord
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SITE_URL = env("SITE_URL", "https://creno-tan.vercel.app").replace(/\/$/, "");
const ESSAI_JOURS = Number(env("ALERTES_ESSAI_JOURS", "15")) || 15;
const PASS_JOURS = Number(env("ALERTES_DUREE_JOURS", "30")) || 30; // ancien pass à paiement unique
const RAPPEL_JOURS = 3; // le rappel part 3 jours avant la fin de l'essai
const SEL = env("CRENO_SEL") || env("ALERTES_SEL") || SERVICE_KEY.slice(-16);
const MAX_SIGNALEMENTS_HEURE = 3;
const PAUSE_MINUTES = 10; // un même abonné reçoit au plus une alerte toutes les 10 minutes
const BLEU = "#0A4F8F";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEPARTEMENT = /^([0-9]{2,3}|2[AB])$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Abonne = {
  id: number; email: string; token: string; departement: string; statut: string; plan: string;
  expire_le: string | null; stripe_session: string | null; stripe_abonnement: string | null;
};

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

async function patch(filter: string, values: Record<string, unknown>) {
  await db(`abonnes_alertes?${filter}`, { method: "PATCH", body: JSON.stringify(values) });
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

function dateFr(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
}

function emailBase(email: string) {
  const [local, domaine] = email.split("@");
  return `${local.split("+")[0]}@${domaine}`;
}

const lienPaye = () => env("ALERTES_LIEN_STRIPE");
const prixTxt = () => {
  const c = Number(env("ALERTES_MONTANT_CENTIMES", "999")) || 999;
  return `${(c / 100).toFixed(2).replace(".", ",")} €`;
};
const continuerUrl = (t: string) => `${SITE_URL}/alertes/continuer/?t=${t}`;
const desaboUrl = (t: string) => `${SITE_URL}/alertes/desabonner/?t=${t}`;

function lienPaiement(token: string, email: string) {
  const lien = lienPaye();
  if (!lien) return null;
  const url = new URL(lien);
  url.searchParams.set("client_reference_id", `alerte-${token}`);
  url.searchParams.set("prefilled_email", email);
  return url.toString();
}

// ---------------------------------------------------------------- e-mails
// Renvoie, pour chaque message, s'il est bien parti.
async function sendEmails(messages: Array<Record<string, unknown>>) {
  const key = env("RESEND_API_KEY");
  const ok = messages.map(() => false);
  if (!key || !messages.length) return ok;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (res.ok) batch.forEach((_, j) => (ok[i + j] = true));
    else console.error("Resend", res.status, await res.text());
  }
  return ok;
}

const expediteur = () => env("ALERTES_EXPEDITEUR", "Créno <onboarding@resend.dev>");

function bouton(href: string, texte: string) {
  return `<p><a href="${href}" style="display:inline-block;background:${BLEU};color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${esc(texte)}</a></p>`;
}

function emailLayout(title: string, bodyHtml: string, desabo?: string) {
  const foot = desabo
    ? `<p style="color:#55606B;font-size:13px">Tu reçois cet e-mail parce que tu suis ce département sur Créno.
       <a href="${desabo}">Ne plus recevoir d'alertes</a> (ça arrête aussi l'abonnement, s'il y en a un).</p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;color:#1A1F25;max-width:520px;line-height:1.5">
    <p style="font-size:20px;font-weight:bold;margin:0 0 12px">${esc(title)}</p>${bodyHtml}${foot}
    <p style="color:#55606B;font-size:13px">Créno, le bon créneau pour ton permis. Service indépendant, sans lien avec RdvPermis.</p></div>`;
}

// ---------------------------------------------------------------- Stripe
async function stripe(path: string, method = "GET") {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY manquant");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error("Stripe", path, res.status, await res.text());
    return null;
  }
  return await res.json();
}

// Fin de la période payée. Selon la version de l'API Stripe, elle est sur l'abonnement ou sur sa ligne.
function finPeriode(sub: Record<string, any>) {
  const s = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return s ? new Date(Number(s) * 1000) : addDays(new Date(), 31);
}

const ABONNEMENT_OK = new Set(["active", "trialing", "past_due"]);

// ---------------------------------------------------------------- actions
async function abonne(token: string): Promise<Abonne | null> {
  const { data } = await db(`abonnes_alertes?token=eq.${token}&select=id,email,token,departement,statut,plan,expire_le,stripe_session,stripe_abonnement`);
  return data?.[0] ?? null;
}

async function abonner(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const departement = String(body.departement ?? "").toUpperCase();
  if (!EMAIL.test(email) || email.length > 200) return reply(400, { erreur: "Cette adresse e-mail n'est pas valide." });
  if (!DEPARTEMENT.test(departement)) return reply(400, { erreur: "Choisis un département." });

  const base = emailBase(email);
  const { data: lignes } = await db(
    `abonnes_alertes?email_base=eq.${encodeURIComponent(base)}&select=id,token,departement,statut,plan,expire_le&order=created_at.desc`);
  const rows = (lignes ?? []) as Abonne[];
  const now = new Date();
  const memeDep = rows.filter((r) => r.departement === departement);
  const enCours = memeDep.find((r) => r.statut === "actif" && r.expire_le && new Date(r.expire_le) > now);
  if (enCours) {
    return reply(200, { deja: true, departement, plan: enCours.plan, expire_txt: dateFr(enCours.expire_le) });
  }

  // Un seul essai gratuit par personne : ensuite, on l'envoie vers l'abonnement.
  const essaiUtilise = rows.some((r) => r.statut !== "en_attente");
  if (essaiUtilise && lienPaye()) {
    let token = memeDep[0]?.token;
    if (!token) {
      const { data } = await db("abonnes_alertes", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ email, email_base: base, departement }),
      });
      token = data[0].token;
    }
    return reply(200, { essai_utilise: true, continuer: continuerUrl(token!) });
  }

  let token = memeDep.find((r) => r.statut === "en_attente")?.token;
  if (!token) {
    const { data } = await db("abonnes_alertes", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ email, email_base: base, departement }),
    });
    token = data[0].token as string;
  }

  const confirmUrl = `${SITE_URL}/alertes/confirmer/?t=${token}`;
  const offre = lienPaye()
    ? `<p>Clique sur le bouton pour activer ton <strong>essai gratuit de ${ESSAI_JOURS} jours</strong>. Pas de carte bancaire : à la fin de l'essai, tu choisis si tu veux continuer.</p>`
    : `<p>Clique sur le bouton pour activer tes alertes. Elles sont gratuites pendant le lancement.</p>`;
  const [sent] = await sendEmails([{
    from: expediteur(),
    to: [email],
    subject: "Confirme tes alertes Créno",
    html: emailLayout("Confirme tes alertes", `<p>Tu as demandé à être prévenu quand des candidats signalent des places d'examen dans le ${esc(departement)}.</p>
      ${offre}${bouton(confirmUrl, "Activer mes alertes")}
      <p style="color:#55606B;font-size:13px">Si ce n'est pas toi, ignore cet e-mail : rien ne sera activé.</p>`),
    text: `Active tes alertes Créno pour le ${departement} : ${confirmUrl}`,
  }]);
  if (!sent) return reply(503, { erreur: "L'e-mail de confirmation n'a pas pu partir. Réessaie dans quelques minutes." });
  return reply(200, { confirmation: true, essai_jours: ESSAI_JOURS, payant: !!lienPaye() });
}

async function confirmer(body: Record<string, unknown>) {
  const t = String(body.t ?? "");
  if (!UUID.test(t)) return reply(400, { erreur: "Lien de confirmation invalide." });
  const row = await abonne(t);
  if (!row) return reply(404, { erreur: "Alerte introuvable. Inscris-toi à nouveau sur la page Alertes." });
  if (row.statut === "actif") {
    return reply(200, { ok: true, departement: row.departement, plan: row.plan, expire_txt: dateFr(row.expire_le) });
  }
  if (row.statut !== "en_attente") {
    return reply(200, { continuer: continuerUrl(t), departement: row.departement });
  }
  const expire = addDays(new Date(), ESSAI_JOURS).toISOString();
  await patch(`id=eq.${row.id}`, { statut: "actif", plan: "essai", expire_le: expire });
  return reply(200, { ok: true, departement: row.departement, plan: "essai", payant: !!lienPaye(), expire_txt: dateFr(expire) });
}

async function continuer(body: Record<string, unknown>) {
  const t = String(body.t ?? "");
  if (!UUID.test(t)) return reply(400, { erreur: "Lien invalide." });
  const row = await abonne(t);
  if (!row) return reply(404, { erreur: "Alerte introuvable. Inscris-toi à nouveau sur la page Alertes." });
  if (row.plan === "abonne" && row.statut === "actif") {
    return reply(200, { deja: true, departement: row.departement, expire_txt: dateFr(row.expire_le) });
  }
  const paiement = lienPaiement(row.token, row.email);
  if (!paiement) return reply(200, { gratuit: true, departement: row.departement });
  return reply(200, { departement: row.departement, prix: prixTxt(), paiement });
}

async function paiement(body: Record<string, unknown>) {
  const id = String(body.session_id ?? "");
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return reply(400, { erreur: "Lien de paiement invalide." });
  const s = await stripe(`checkout/sessions/${id}`);
  if (!s || !(s.status === "complete" || s.payment_status === "paid")) return reply(402, { erreur: "Le paiement n'est pas confirmé." });
  const ref = String(s.client_reference_id ?? "");
  const min = Number(env("ALERTES_MONTANT_CENTIMES", "999")) || 999;
  if (!ref.startsWith("alerte-") || (s.amount_total ?? 0) < min) return reply(400, { erreur: "Ce paiement ne correspond pas aux alertes." });
  const token = ref.slice("alerte-".length);
  if (!UUID.test(token)) return reply(400, { erreur: "Référence de paiement invalide." });
  const row = await abonne(token);
  if (!row) return reply(404, { erreur: "Alerte introuvable. Écris-nous avec ton reçu Stripe." });
  if (row.stripe_session === id) {
    return reply(200, { ok: true, departement: row.departement, plan: row.plan, expire_txt: dateFr(row.expire_le) });
  }

  const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
  let values: Record<string, unknown>;
  if (subId) {
    const sub = await stripe(`subscriptions/${subId}`);
    const fin = sub ? finPeriode(sub) : addDays(new Date(), 31);
    values = { statut: "actif", plan: "abonne", stripe_abonnement: subId, expire_le: addDays(fin, 1).toISOString() };
  } else {
    // Paiement unique (ancien pass) : on ajoute la durée du pass.
    const now = new Date();
    const depart = row.expire_le && new Date(row.expire_le) > now ? new Date(row.expire_le) : now;
    values = { statut: "actif", plan: "pass", expire_le: addDays(depart, PASS_JOURS).toISOString() };
  }
  await patch(`id=eq.${row.id}`, { ...values, stripe_session: id, rappel_envoye: null, fin_envoyee: null });
  return reply(200, { ok: true, departement: row.departement, plan: values.plan, expire_txt: dateFr(values.expire_le as string) });
}

async function desabonner(body: Record<string, unknown>) {
  const t = String(body.t ?? "");
  if (!UUID.test(t)) return reply(400, { erreur: "Lien invalide." });
  const row = await abonne(t);
  if (!row) return reply(200, { ok: true });
  await patch(`id=eq.${row.id}`, { statut: "desabonne" });
  let resilie = false;
  const avaitAbonnement = !!row.stripe_abonnement && row.plan === "abonne";
  if (avaitAbonnement) {
    const r = await stripe(`subscriptions/${row.stripe_abonnement}`, "DELETE");
    resilie = !!r;
  }
  return reply(200, { ok: true, abonnement: avaitAbonnement, resilie });
}

async function signaler(body: Record<string, unknown>, req: Request) {
  const departement = String(body.departement ?? "").toUpperCase();
  const centre = clean(body.centre, 120);
  const creneau = clean(body.creneau, 120);
  const details = clean(body.details, 300);
  if (!DEPARTEMENT.test(departement)) return reply(400, { erreur: "Choisis un département." });
  if (!centre || centre.length < 2) return reply(400, { erreur: "Indique le centre d'examen." });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const empreinte = await sha256(`${SEL}|${ip}|${req.headers.get("user-agent") ?? ""}`);
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
    const desabo = desaboUrl(a.token);
    return {
      from: expediteur(),
      to: [a.email],
      subject: sujet,
      headers: { "List-Unsubscribe": `<${desabo}>` },
      html: emailLayout("Un candidat vient de voir des places", `
        <p><strong>Centre :</strong> ${esc(centre)} (${esc(departement)})</p>
        ${creneau ? `<p><strong>Créneau vu :</strong> ${esc(creneau)}</p>` : ""}
        ${details ? `<p><strong>Précision :</strong> ${esc(details)}</p>` : ""}
        ${bouton(rdv, "Vérifier sur RdvPermis")}
        <p style="color:#55606B;font-size:13px">Ce signalement vient d'un autre candidat, à ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}. La place a peut-être déjà été prise.</p>`, desabo),
      text: `${sujet}${creneau ? ` - créneau vu : ${creneau}` : ""}. Vérifie sur RdvPermis : ${rdv}. Ne plus recevoir d'alertes : ${desabo}`,
    };
  });

  const ok = await sendEmails(messages);
  const ids = cibles.filter((_: unknown, i: number) => ok[i]).map((a: { id: number }) => a.id);
  if (ids.length) {
    await patch(`id=in.(${ids.join(",")})`, { dernier_envoi: now.toISOString() });
    await db(`signalements?id=eq.${sig[0].id}`, { method: "PATCH", body: JSON.stringify({ nb_prevenus: ids.length }) });
  }
  return reply(200, { ok: true, prevenus: ids.length });
}

// ---------------------------------------------------------------- tâche quotidienne
function emailContinuer(a: Abonne, fini: boolean) {
  const url = continuerUrl(a.token);
  const date = dateFr(a.expire_le);
  const prix = prixTxt();
  const titre = fini ? "Ton essai des alertes est terminé" : `Ton essai se termine le ${date}`;
  const intro = fini
    ? `<p>Ton essai gratuit des alertes du ${esc(a.departement)} est terminé : tu ne reçois plus les places signalées par les candidats.</p>`
    : `<p>Ton essai gratuit des alertes du ${esc(a.departement)} se termine le <strong>${esc(date)}</strong>.</p>`;
  return {
    from: expediteur(),
    to: [a.email],
    subject: fini ? "Tes alertes Créno sont en pause" : "Ton essai des alertes Créno se termine bientôt",
    headers: { "List-Unsubscribe": `<${desaboUrl(a.token)}>` },
    html: emailLayout(titre, `${intro}
      <p>Pour continuer à être prévenu dès qu'une place se libère, c'est <strong>${esc(prix)} par mois</strong>, sans engagement. Tu arrêtes quand tu veux, en un clic, depuis n'importe quel e-mail d'alerte.</p>
      ${bouton(url, `Continuer pour ${prix} par mois`)}
      <p style="color:#55606B;font-size:13px">${fini ? "Si tu as déjà ta date d'examen, bravo : tu n'as rien à faire." : `Si tu ne veux pas continuer, ne fais rien : les alertes s'arrêteront le ${esc(date)}, sans aucun prélèvement.`}</p>`,
      desaboUrl(a.token)),
    text: `${titre}. Continuer pour ${prix} par mois, sans engagement : ${url}`,
  };
}

async function quotidien(body: Record<string, unknown>) {
  const code = env("ADMIN_CODE");
  if (!code || String(body.code ?? "") !== code) {
    await new Promise((r) => setTimeout(r, 800));
    return reply(403, { erreur: "Code incorrect." });
  }
  const now = new Date();
  const champs = "select=id,email,token,departement,statut,plan,expire_le,stripe_session,stripe_abonnement";
  const bilan = { rappels: 0, essais_finis: 0, essais_prolonges: 0, renouveles: 0, arretes: 0 };

  if (lienPaye()) {
    // 1. Rappel quelques jours avant la fin de l'essai
    const { data: bientot } = await db(`abonnes_alertes?statut=eq.actif&plan=eq.essai&rappel_envoye=is.null` +
      `&expire_le=gt.${now.toISOString()}&expire_le=lte.${addDays(now, RAPPEL_JOURS).toISOString()}&${champs}`);
    const rows1 = (bientot ?? []) as Abonne[];
    const ok1 = await sendEmails(rows1.map((a) => emailContinuer(a, false)));
    const ids1 = rows1.filter((_, i) => ok1[i]).map((a) => a.id);
    if (ids1.length) await patch(`id=in.(${ids1.join(",")})`, { rappel_envoye: now.toISOString() });
    bilan.rappels = ids1.length;

    // 2. Essais terminés : les alertes s'arrêtent, on propose de continuer
    const { data: finis } = await db(`abonnes_alertes?statut=eq.actif&plan=eq.essai&expire_le=lte.${now.toISOString()}&${champs}`);
    const rows2 = (finis ?? []) as Abonne[];
    if (rows2.length) {
      await patch(`id=in.(${rows2.map((a) => a.id).join(",")})`, { statut: "expire" });
      const ok2 = await sendEmails(rows2.map((a) => emailContinuer(a, true)));
      const ids2 = rows2.filter((_, i) => ok2[i]).map((a) => a.id);
      if (ids2.length) await patch(`id=in.(${ids2.join(",")})`, { fin_envoyee: now.toISOString() });
    }
    bilan.essais_finis = rows2.length;
  } else {
    // Lancement gratuit : les essais se prolongent tout seuls
    const { data: prolonges } = await db(
      `abonnes_alertes?statut=eq.actif&plan=eq.essai&expire_le=lte.${addDays(now, 1).toISOString()}&select=id`);
    const ids = (prolonges ?? []).map((a: { id: number }) => a.id);
    if (ids.length) await patch(`id=in.(${ids.join(",")})`, { expire_le: addDays(now, ESSAI_JOURS).toISOString() });
    bilan.essais_prolonges = ids.length;
  }

  // 3. Abonnements : on vérifie chez Stripe que le mois suivant est payé
  const { data: abos } = await db(
    `abonnes_alertes?statut=eq.actif&plan=eq.abonne&expire_le=lte.${addDays(now, 1).toISOString()}&${champs}`);
  for (const a of (abos ?? []) as Abonne[]) {
    const sub = a.stripe_abonnement ? await stripe(`subscriptions/${a.stripe_abonnement}`) : null;
    if (sub && ABONNEMENT_OK.has(sub.status)) {
      const fin = addDays(finPeriode(sub), 1);
      if (!a.expire_le || fin > new Date(a.expire_le)) {
        await patch(`id=eq.${a.id}`, { expire_le: fin.toISOString() });
        bilan.renouveles++;
      }
    } else if (sub || !a.stripe_abonnement) {
      await patch(`id=eq.${a.id}`, { statut: "expire" });
      bilan.arretes++;
    }
  }

  // 4. Anciens pass à paiement unique arrivés à échéance
  await patch(`statut=eq.actif&plan=eq.pass&expire_le=lte.${now.toISOString()}`, { statut: "expire" });

  return reply(200, { ok: true, ...bilan });
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
      case "continuer": return await continuer(body);
      case "paiement": return await paiement(body);
      case "desabonner": return await desabonner(body);
      case "signaler": return await signaler(body, req);
      case "quotidien": return await quotidien(body);
      default: return reply(400, { erreur: "Action inconnue." });
    }
  } catch (e) {
    console.error(e);
    return reply(500, { erreur: "Une erreur est survenue. Réessaie dans quelques minutes." });
  }
});
