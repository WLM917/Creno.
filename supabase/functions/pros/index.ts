// Créno : demandes d'élèves et formulaires des pros (fonction serveur Supabase, Deno).
//
// Le site appelle cette fonction en POST avec un JSON { action, ... } :
//   demande    { besoin, departement, ville?, disponibilites?, email, telephone?, partage_tel?, consentement }
//              -> un élève publie sa demande. Elle apparaît chez les pros SANS son nom ni son contact.
//   liste      { departement? }  -> demandes ouvertes, sans aucun contact (page « Demandes d'élèves » des pros)
//   repondre   { demande, pro_type, departement_pro, auto_ecole_id? | loueur?, nom?, contact, message?, engagement }
//              -> un pro répond : son message part à l'élève par e-mail, et tu es prévenu.
//   fermer     { t }              -> l'élève ferme sa demande (lien dans ses e-mails)
//   formulaire { type: pro | contact_pro | tarifs | loueur, ... } -> enregistre le formulaire et te prévient par e-mail
//
// Qui peut répondre : une auto-école de la liste officielle (ou un de ses moniteurs), ou un loueur référencé
// sur Créno. 3 réponses au plus par demande, une seule par pro. Une demande reste ouverte 30 jours.
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   SITE_URL            https://creno-tan.vercel.app (la fonction y lit la liste officielle des auto-écoles)
//   RESEND_API_KEY      clé Resend (envoi des e-mails)
//   ALERTES_EXPEDITEUR  expéditeur des e-mails, ex. "Créno <bonjour@creno.fr>"
//   ADMIN_EMAIL         ton e-mail : tu reçois chaque demande, chaque réponse de pro et chaque formulaire
//   CRENO_SEL           la même phrase secrète que pour les autres fonctions
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SITE_URL = env("SITE_URL", "https://creno-tan.vercel.app").replace(/\/$/, "");
const SEL = env("CRENO_SEL") || env("ALERTES_SEL") || SERVICE_KEY.slice(-16);
const BLEU = "#0A4F8F";
const MAX_REPONSES = 3;
const JOURS_OUVERTE = 30;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEPARTEMENT = /^([0-9]{2,3}|2[AB])$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGREMENT = /^[A-Z0-9]{6,20}$/;
const BESOINS: Record<string, string> = {
  "examen-blanc": "une évaluation ou un examen blanc",
  "presentation-examen": "être présenté à l'examen par une auto-école",
  "heures": "des heures de conduite avec un moniteur",
  "location-voiture": "louer une voiture à double commande",
};
// Limites anti-abus : [nombre maximum, fenêtre en minutes]
const LIMITES: Record<string, [number, number]> = {
  demande: [3, 60], repondre: [30, 1440], formulaire: [6, 60],
};

function reply(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { apikey: SERVICE_KEY, "Content-Type": "application/json" };
  if (!SERVICE_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SERVICE_KEY}`;
  return h;
}

class Refus extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers as Record<string, string> ?? {}) },
  });
  if (res.status === 400 || res.status === 409) {
    console.error("Refus de la base", await res.text());
    throw new Refus("Vérifie tes réponses : une valeur n'est pas acceptée.");
  }
  if (!res.ok) throw new Error(`Base de données : ${res.status} ${await res.text()}`);
  const text = await res.text();
  return { data: text ? JSON.parse(text) : null, headers: res.headers };
}

async function compte(path: string) {
  const { headers } = await db(path, { headers: { Prefer: "count=exact", Range: "0-0" } });
  return Number((headers.get("content-range") ?? "*/0").split("/")[1]) || 0;
}

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function clean(s: unknown, max: number) {
  const v = String(s ?? "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
}

function cleanText(s: unknown, max: number) {
  const v = String(s ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return v ? v.slice(0, max) : null;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function slug(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function jourParis(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

async function empreinte(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return await sha256(`${SEL}|${jourParis()}|${ip}|${req.headers.get("user-agent") ?? ""}`);
}

// Refuse si l'appareil a déjà trop agi récemment, sinon note l'action.
async function limiter(emp: string, action: string) {
  const [max, minutes] = LIMITES[action];
  const depuis = new Date(Date.now() - minutes * 60000).toISOString();
  if (await compte(`limites?empreinte=eq.${emp}&action=eq.${action}&created_at=gte.${depuis}&select=id`) >= max) {
    throw new Refus("Tu as déjà envoyé plusieurs formulaires. Réessaie un peu plus tard.", 429);
  }
  await db("limites", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ empreinte: emp, action }) });
}

// ---------------------------------------------------------------- e-mails
const expediteur = () => env("ALERTES_EXPEDITEUR", "Créno <onboarding@resend.dev>");

async function sendEmail(message: Record<string, unknown>) {
  const key = env("RESEND_API_KEY");
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: expediteur(), ...message }),
  });
  if (!res.ok) console.error("Resend", res.status, await res.text());
  return res.ok;
}

function bouton(href: string, texte: string) {
  return `<p><a href="${href}" style="display:inline-block;background:${BLEU};color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${esc(texte)}</a></p>`;
}

function layout(title: string, body: string) {
  return `<div style="font-family:Arial,sans-serif;color:#1A1F25;max-width:540px;line-height:1.5">
    <p style="font-size:20px;font-weight:bold;margin:0 0 12px">${esc(title)}</p>${body}
    <p style="color:#55606B;font-size:13px">Créno, le bon créneau pour ton permis.</p></div>`;
}

// Te prévient (ADMIN_EMAIL) : une ligne par information.
async function prevenirAdmin(sujet: string, lignes: Array<[string, unknown]>) {
  const to = env("ADMIN_EMAIL");
  if (!to) return;
  const rows = lignes.filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<tr><td style="color:#55606B;padding:4px 12px 4px 0;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("");
  await sendEmail({
    to: [to], subject: `[Créno] ${sujet}`,
    html: layout(sujet, `<table style="border-collapse:collapse;font-size:14px">${rows}</table>
      <p><a href="${SITE_URL}/admin/">Ouvrir le tableau de bord</a></p>`),
    text: `${sujet}\n` + lignes.map(([k, v]) => `${k} : ${v ?? ""}`).join("\n"),
  });
}

// ---------------------------------------------------------------- vérification des pros
async function autoEcoleOfficielle(dep: string, id: string) {
  if (!DEPARTEMENT.test(dep) || !AGREMENT.test(id)) return null;
  const res = await fetch(`${SITE_URL}/data/departements/${dep}.json`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data.ecoles ?? []).find((e: { id: string }) => e.id === id) ?? null;
}

async function loueurReference(nomSlug: string) {
  const res = await fetch(`${SITE_URL}/data/loueurs.json`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data.loueurs ?? []).find((l: { nom: string }) => slug(l.nom) === nomSlug) ?? null;
}

// ---------------------------------------------------------------- actions
async function demande(body: Record<string, unknown>, req: Request) {
  const besoin = String(body.besoin ?? "");
  const departement = String(body.departement ?? "").toUpperCase();
  const email = String(body.email ?? "").trim().toLowerCase();
  const telephone = clean(body.telephone, 30);
  if (!BESOINS[besoin]) return reply(400, { erreur: "Choisis ce dont tu as besoin." });
  if (!DEPARTEMENT.test(departement)) return reply(400, { erreur: "Choisis un département." });
  if (!EMAIL.test(email) || email.length > 200) return reply(400, { erreur: "Cette adresse e-mail n'est pas valide." });
  if (body.consentement !== true) return reply(400, { erreur: "Coche la case pour accepter que les pros voient ta demande." });
  await limiter(await empreinte(req), "demande");

  const row = {
    besoin, departement, email, contact: email, telephone, partage_tel: body.partage_tel === true && !!telephone,
    ville: clean(body.ville, 80), disponibilites: clean(body.disponibilites, 300), consentement: true,
  };
  const { data } = await db("demandes_pros", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  const d = data[0];
  const fermer = `${SITE_URL}/pro/demandes/fermer/?t=${d.token}`;
  await sendEmail({
    to: [email], subject: "Ta demande est en ligne sur Créno",
    html: layout("Ta demande est en ligne", `<p>Tu cherches ${esc(BESOINS[besoin])} dans le ${esc(departement)}${row.ville ? ` (${esc(row.ville)})` : ""}.</p>
      <p>Les auto-écoles, moniteurs et loueurs vérifiés de Créno voient ta demande, <strong>sans ton nom ni ton e-mail</strong>. Quand l'un d'eux te répond, tu reçois son message ici, avec son contact. Tu choisis ensuite qui tu rappelles. Au plus ${MAX_REPONSES} réponses.</p>
      <p style="color:#55606B;font-size:13px">Tu as trouvé ? <a href="${fermer}">Fermer ma demande</a>. Sinon, elle se ferme toute seule dans ${JOURS_OUVERTE} jours.</p>`),
    text: `Ta demande est en ligne sur Créno. Les pros te répondront par e-mail. Fermer ta demande : ${fermer}`,
  });
  await prevenirAdmin("Nouvelle demande d'élève", [
    ["Besoin", BESOINS[besoin]], ["Département", departement], ["Ville", row.ville], ["Disponibilités", row.disponibilites],
  ]);
  return reply(200, { ok: true });
}

async function liste(body: Record<string, unknown>) {
  const dep = String(body.departement ?? "").toUpperCase();
  const depuis = new Date(Date.now() - JOURS_OUVERTE * 86400000).toISOString();
  const filtreDep = DEPARTEMENT.test(dep) ? `&departement=eq.${dep}` : "";
  const { data } = await db(`demandes_pros?statut=eq.ouverte&consentement=eq.true&nb_reponses=lt.${MAX_REPONSES}` +
    `&email=not.is.null&created_at=gte.${depuis}${filtreDep}&select=id,created_at,besoin,departement,ville,disponibilites,nb_reponses` +
    `&order=created_at.desc&limit=200`);
  return reply(200, { demandes: data ?? [], max: MAX_REPONSES }, { "Cache-Control": "public, max-age=60" });
}

async function repondre(body: Record<string, unknown>, req: Request) {
  const id = Number(body.demande);
  const type = String(body.pro_type ?? "");
  const contact = clean(body.contact, 200);
  const message = cleanText(body.message, 600);
  if (!Number.isInteger(id) || id <= 0) return reply(400, { erreur: "Demande introuvable." });
  if (!["auto-ecole", "moniteur", "loueur"].includes(type)) return reply(400, { erreur: "Dis-nous qui tu es." });
  if (!contact || contact.length < 4) return reply(400, { erreur: "Indique ton e-mail ou ton téléphone : c'est ce que l'élève recevra." });
  if (body.engagement !== true) return reply(400, { erreur: "Coche la case d'engagement pour répondre." });

  // Qui répond : vérifié dans la liste officielle ou dans les loueurs référencés
  let proRef = "", proNom = "", depPro: string | null = null;
  if (type === "loueur") {
    const l = await loueurReference(slug(String(body.loueur ?? "")));
    if (!l) return reply(403, { erreur: "Seules les agences référencées sur Créno peuvent répondre. Inscris ton agence depuis l'espace pros." });
    proRef = `loueur-${slug(l.nom)}`;
    proNom = `${l.nom} (${l.ville})`;
    depPro = l.dep ?? null;
  } else {
    depPro = String(body.departement_pro ?? "").toUpperCase();
    const ae = await autoEcoleOfficielle(depPro, String(body.auto_ecole_id ?? ""));
    if (!ae) return reply(403, { erreur: "Choisis ton auto-école dans la liste officielle (département, puis nom)." });
    proRef = `ae-${ae.id}`;
    if (type === "moniteur") {
      const nom = clean(body.nom, 80);
      if (!nom || nom.length < 2) return reply(400, { erreur: "Indique ton nom de moniteur." });
      proNom = `${nom}, moniteur à ${ae.nom} (${ae.ville})`;
    } else {
      proNom = `${ae.nom} (${ae.ville})`;
    }
  }

  const { data: ds } = await db(`demandes_pros?id=eq.${id}&select=id,created_at,besoin,departement,ville,email,telephone,partage_tel,statut,nb_reponses,token`);
  const d = ds?.[0];
  const depuis = Date.now() - JOURS_OUVERTE * 86400000;
  if (!d || !d.email || d.statut !== "ouverte" || new Date(d.created_at).getTime() < depuis) {
    return reply(409, { erreur: "Cette demande est fermée : l'élève a peut-être déjà trouvé." });
  }
  if (d.nb_reponses >= MAX_REPONSES) return reply(409, { erreur: "Cette demande a déjà reçu assez de réponses." });
  if (await compte(`reponses_demandes?demande_id=eq.${id}&pro_ref=eq.${proRef}&select=id`) > 0) {
    return reply(409, { erreur: "Tu as déjà répondu à cette demande." });
  }
  const emp = await empreinte(req);
  await limiter(emp, "repondre");

  const fermer = `${SITE_URL}/pro/demandes/fermer/?t=${d.token}`;
  const quoi = type === "loueur" ? "Un loueur de voitures à double commande" : type === "moniteur" ? "Un moniteur" : "Une auto-école";
  const envoye = await sendEmail({
    to: [d.email],
    reply_to: EMAIL.test(contact) ? contact : undefined,
    subject: `${quoi} te répond sur Créno`,
    html: layout(`${quoi} te répond`, `<p>Pour ta demande (${esc(BESOINS[d.besoin] ?? d.besoin)}, ${esc(d.departement)}${d.ville ? `, ${esc(d.ville)}` : ""}) :</p>
      <p style="font-size:17px"><strong>${esc(proNom)}</strong></p>
      ${message ? `<p style="white-space:pre-line;border-left:4px solid ${BLEU};padding-left:12px">${esc(message)}</p>` : ""}
      <p><strong>Pour lui répondre :</strong> ${esc(contact)}</p>
      <p style="color:#55606B;font-size:13px">Tu n'es pas obligé de donner suite. Créno vérifie que les auto-écoles sont dans la liste officielle et que les loueurs sont référencés, mais ne garantit ni leurs prix ni leurs disponibilités. Dis-leur que tu viens de Créno !</p>
      <p style="color:#55606B;font-size:13px">Tu as trouvé ? <a href="${fermer}">Fermer ma demande</a> : tu ne recevras plus de réponses.</p>`),
    text: `${quoi} te répond sur Créno : ${proNom}. ${message ?? ""} Pour lui répondre : ${contact}. Fermer ta demande : ${fermer}`,
  });
  if (!envoye) return reply(503, { erreur: "Le message n'a pas pu partir. Réessaie dans quelques minutes." });

  await db("reponses_demandes", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ demande_id: id, pro_type: type, pro_ref: proRef, pro_nom: proNom, departement_pro: depPro, contact, message, empreinte: emp }),
  });
  await db(`demandes_pros?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ nb_reponses: d.nb_reponses + 1 }) });
  await prevenirAdmin(`${proNom} a répondu à un élève`, [
    ["Pro", proNom], ["Type", type], ["Contact du pro", contact], ["Demande", `${BESOINS[d.besoin] ?? d.besoin}, ${d.departement}${d.ville ? `, ${d.ville}` : ""}`],
    ["Réponses reçues", `${d.nb_reponses + 1} sur ${MAX_REPONSES}`], ["Message", message],
  ]);
  return reply(200, { ok: true, telephone: d.partage_tel ? d.telephone : null });
}

async function fermer(body: Record<string, unknown>) {
  const t = String(body.t ?? "");
  if (!UUID.test(t)) return reply(400, { erreur: "Lien invalide." });
  await db(`demandes_pros?token=eq.${t}`, { method: "PATCH", body: JSON.stringify({ statut: "fermee" }) });
  return reply(200, { ok: true });
}

// Formulaires des pros : champs acceptés pour chaque table
const FORMULAIRES: Record<string, { table: string; champs: string[]; titre: string }> = {
  pro: { table: "pros_proposes", titre: "Un pro propose ses services",
    champs: ["type", "nom", "etablissement", "numero_agrement", "ville", "departement", "offres", "prix", "contact"] },
  contact_pro: { table: "contacts_pros", titre: "Nouveau message (page Nous contacter)",
    champs: ["type", "nom", "ville", "contact", "message", "auto_ecole_id"] },
  tarifs: { table: "tarifs_proposes", titre: "Une auto-école envoie ses tarifs",
    champs: ["auto_ecole_id", "auto_ecole_nom", "departement", "forfait", "heures_forfait", "prix_heure", "frais_examen",
      "accelere", "accelere_details", "lien", "contact"] },
  loueur: { table: "loueurs_proposes", titre: "Un loueur veut s'inscrire",
    champs: ["nom", "ville", "departement", "adresse", "site", "contact", "email", "prix_heure", "boite", "formule"] },
};

async function formulaire(body: Record<string, unknown>, req: Request) {
  const f = FORMULAIRES[String(body.type_formulaire ?? "")];
  if (!f) return reply(400, { erreur: "Formulaire inconnu." });
  await limiter(await empreinte(req), "formulaire");
  const row: Record<string, unknown> = {};
  for (const c of f.champs) {
    const v = body[c];
    if (v === undefined || v === null || v === "") continue;
    row[c] = typeof v === "string" ? v.trim().slice(0, 1000) : v;
  }
  const { data } = await db(f.table, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  await prevenirAdmin(f.titre, Object.entries(row));
  return reply(200, { ok: true, id: data?.[0]?.id ?? null });
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
      case "demande": return await demande(body, req);
      case "liste": return await liste(body);
      case "repondre": return await repondre(body, req);
      case "fermer": return await fermer(body);
      case "formulaire": return await formulaire(body, req);
      default: return reply(400, { erreur: "Action inconnue." });
    }
  } catch (e) {
    if (e instanceof Refus) return reply(e.status, { erreur: e.message });
    console.error(e);
    return reply(500, { erreur: "Une erreur est survenue. Réessaie dans quelques minutes." });
  }
});
