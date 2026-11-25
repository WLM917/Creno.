// Créno : espace « Gérer mon compte » des élèves et des pros (fonction serveur Supabase, Deno).
//
// La connexion elle-même (inscription, mot de passe) passe par Supabase Auth, directement depuis le site.
// Cette fonction reçoit le jeton de connexion { jeton } et ne renvoie que ce qui appartient au compte :
//   moi        {}                                -> profil, pack acheté (et sa formule : ddt), alertes, demandes (avec les réponses des pros),
//                                                   établissements reliés (pros) et leurs chiffres une fois vérifiés.
//                                                   Formule Pack + DDT : aussi les démarches des départements (table
//                                                   ddt_demarches), réservées à cette formule.
//   profil     { prenom?, telephone?, departement? } -> met à jour les informations (toutes facultatives)
//   pack       {}                                -> lien de téléchargement du pack (1 heure), si le compte l'a acheté
//   pack_email {}                                -> envoie ce lien par e-mail (valable 7 jours)
//   places     { departement? }                  -> places d'examen signalées ces 30 derniers jours dans le département
//   dossier    { departement, ville?, code_ok, libre_ok, accompagnateur_ok, voiture_ok, appris_proches,
//                autres_departements?, message? } -> formule Pack + DDT : demande que William prépare sa demande de place
//                                                   pour la DDT (envoyée par e-mail). Aucune pièce d'identité demandée.
//   lier       { pro_type, departement, auto_ecole_id? | nom }  -> un pro relie son compte à son auto-école
//                                                   ou à son agence. William vérifie avant que les chiffres s'affichent.
//   supprimer  { confirmation: "SUPPRIMER" }      -> supprime le compte et ses données (demandes, alertes, liens)
//
// Tout est rattaché au compte (user_id), jamais à une simple adresse e-mail : tant que les e-mails ne sont pas
// confirmés à l'inscription, une adresse ne prouve pas qu'on en est le propriétaire.
//
// Secrets utilisés : SITE_URL, RESEND_API_KEY, ALERTES_EXPEDITEUR, ADMIN_EMAIL, STRIPE_SECRET_KEY, PACK_FICHIER.
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SITE_URL = env("SITE_URL", "https://creno-tan.vercel.app").replace(/\/$/, "");
const MAX_LIENS = 5;
// Même phrase secrète que la fonction stats : le compte d'un pro vérifié donne le lien de son rapport complet.
const SEL = env("CRENO_SEL") || env("ALERTES_SEL") || SERVICE_KEY.slice(-16);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DEPARTEMENT = /^([0-9]{2,3}|2[AB])$/;
const AGREMENT = /^[A-Z0-9_]{6,24}$/;
const TELEPHONE = /^[0-9 +().-]{6,20}$/;

class Refus extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

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
  if (res.status === 400 || res.status === 409) {
    console.error("Refus de la base", await res.text());
    throw new Refus("Vérifie tes réponses : une valeur n'est pas acceptée.");
  }
  if (!res.ok) throw new Error(`Base de données : ${res.status} ${await res.text()}`);
  const text = await res.text();
  return { data: text ? JSON.parse(text) : null, headers: res.headers };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data } = await db(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  return data;
}

async function compte(path: string) {
  const { headers } = await db(path, { headers: { Prefer: "count=exact", Range: "0-0" } });
  return Number((headers.get("content-range") ?? "*/0").split("/")[1]) || 0;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function clean(s: unknown, max: number) {
  const v = String(s ?? "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
}
function slug(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function sha256(t: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function lienRapport(p: string, departement: unknown) {
  const k = (await sha256(`${SEL}|rapport|${p}`)).slice(0, 20);
  return `${SITE_URL}/rapport/?p=${encodeURIComponent(p)}` + (departement ? `&d=${encodeURIComponent(String(departement))}` : "") + `&k=${k}`;
}

// ---------------------------------------------------------------- qui est connecté
type Utilisateur = { id: string; email: string; meta: Record<string, unknown>; cree: string };
async function utilisateur(jeton: unknown): Promise<Utilisateur> {
  const t = String(jeton ?? "");
  if (t.length < 20) throw new Refus("Connecte-toi à ton compte.", 401);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Refus("Ta connexion a expiré : reconnecte-toi.", 401);
  const u = await res.json();
  if (!u?.id) throw new Refus("Ta connexion a expiré : reconnecte-toi.", 401);
  return { id: u.id, email: String(u.email ?? "").toLowerCase(), meta: u.user_metadata ?? {}, cree: u.created_at };
}

// Le profil est créé à la première visite, à partir du choix fait à l'inscription (élève ou pro).
async function profil(u: Utilisateur) {
  const { data } = await db(`profils?user_id=eq.${u.id}&select=*`);
  if (data?.[0]) return data[0];
  const type = u.meta.type === "pro" ? "pro" : "eleve";
  const proType = ["auto-ecole", "moniteur", "loueur"].includes(String(u.meta.pro_type)) ? String(u.meta.pro_type) : null;
  const { data: cree } = await db("profils?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: u.id, type, pro_type: type === "pro" ? proType : null }),
  });
  return cree?.[0] ?? { user_id: u.id, type, pro_type: proType };
}

// ---------------------------------------------------------------- pack
// Deux formules, payées avec la même référence « pack-<compte> » : le Pack candidat libre (PACK_MONTANT_CENTIMES,
// 1499 par défaut) et le Pack + DDT (PACK_DDT_MONTANT_CENTIMES, 2499 par défaut : démarches des départements et
// demande de place préparée). La formule dépend du total payé : un passage du Pack au Pack + DDT se fait avec un
// lien Stripe de la différence, toujours avec client_reference_id=pack-<compte>.
// Les achats sont notés dans achats_pack (fonction pack) ; sinon, ou pour un passage à la formule + DDT, on cherche
// dans les derniers paiements Stripe. stripe = false : seulement la table (comptes pros).
const PACK_MIN = () => Number(env("PACK_MONTANT_CENTIMES", "1499")) || 1499;
const PACK_DDT_MIN = () => Number(env("PACK_DDT_MONTANT_CENTIMES", "2499")) || 2499;
type Achat = { session_id: string; created_at: string; total: number; ddt: boolean };

async function packAchete(u: Utilisateur, stripe = true): Promise<Achat | null> {
  const ref = `pack-${u.id}`;
  const { data } = await db(`achats_pack?ref=eq.${ref}&select=session_id,created_at,montant&order=created_at`);
  const lignes = ((data ?? []) as { session_id: string; created_at: string; montant: number }[]).map((l) => ({ ...l }));
  const somme = () => lignes.reduce((t, l) => t + n(l.montant), 0);
  const key = env("STRIPE_SECRET_KEY");
  if (key && stripe && somme() < PACK_DDT_MIN()) {
    const vus = new Set(lignes.map((l) => l.session_id));
    let apres = "";
    for (let page = 0; page < 3; page++) {
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions?limit=100" + (apres ? `&starting_after=${apres}` : ""),
        { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) break;
      const j = await r.json();
      const liste = (j.data ?? []) as Record<string, unknown>[];
      for (const x of liste) {
        if (x.client_reference_id !== ref || x.payment_status !== "paid" || n(x.amount_total) <= 0 || vus.has(String(x.id))) continue;
        const achat = { session_id: String(x.id), ref, montant: n(x.amount_total), created_at: new Date(n(x.created) * 1000).toISOString() };
        await db("achats_pack?on_conflict=session_id", {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(achat),
        });
        lignes.push({ session_id: achat.session_id, created_at: achat.created_at, montant: achat.montant });
        vus.add(achat.session_id);
      }
      if (!j.has_more || !liste.length) break;
      apres = String(liste[liste.length - 1].id);
    }
  }
  const total = somme();
  if (!lignes.length || total < PACK_MIN()) return null;
  lignes.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return { session_id: lignes[0].session_id, created_at: lignes[0].created_at, total, ddt: total >= PACK_DDT_MIN() };
}

async function lienPack(secondes: number) {
  const fichier = env("PACK_FICHIER", "pack-candidat-libre.pdf");
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/pack/${encodeURIComponent(fichier)}`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ expiresIn: secondes }),
  });
  if (!sign.ok) {
    console.error("Stockage", sign.status, await sign.text());
    throw new Refus("Le pack n'est pas disponible pour le moment. Écris-nous, on te l'envoie.", 503);
  }
  const { signedURL } = await sign.json();
  return `${SUPABASE_URL}/storage/v1${signedURL}`;
}

async function sendEmail(message: Record<string, unknown>) {
  const key = env("RESEND_API_KEY");
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("ALERTES_EXPEDITEUR", "Créno <onboarding@resend.dev>"), ...message }),
  });
  if (!res.ok) console.error("Resend", res.status, await res.text());
  return res.ok;
}

// ---------------------------------------------------------------- actions
async function moi(body: Record<string, unknown>) {
  const u = await utilisateur(body.jeton);
  const p = await profil(u);
  const [achat, alertes, demandes, liens, envoyees, dossiers] = await Promise.all([
    packAchete(u, p.type === "eleve"),
    db(`abonnes_alertes?user_id=eq.${u.id}&select=departement,statut,plan,expire_le,created_at&order=created_at.desc`).then((r) => r.data ?? []),
    db(`demandes_pros?user_id=eq.${u.id}&select=id,created_at,besoin,departement,ville,statut,nb_reponses,token&order=created_at.desc&limit=20`)
      .then((r) => r.data ?? []),
    db(`liens_pros?user_id=eq.${u.id}&select=id,created_at,pro_ref,nom,departement,statut&order=created_at`).then((r) => r.data ?? []),
    // Pros : les réponses qu'ils ont envoyées aux demandes d'élèves (l'élève leur répond ensuite par e-mail ou téléphone)
    p.type === "pro"
      ? db(`reponses_demandes?user_id=eq.${u.id}&select=created_at,pro_nom,message,demandes_pros(besoin,ville,departement,statut)` +
        "&order=created_at.desc&limit=30").then((r) => r.data ?? [])
      : Promise.resolve([]),
    p.type === "eleve"
      ? db(`dossiers_ddt?user_id=eq.${u.id}&select=created_at,departement,traite&order=created_at.desc&limit=10`)
        .then((r) => r.data ?? []).catch(() => [])
      : Promise.resolve([]),
  ]);
  // Démarches pour demander une place, département par département : réservées aux acheteurs du pack
  const ddt = achat?.ddt
    ? await db("ddt_demarches?select=departement,fiche,maj_le&order=departement").then((r) => r.data ?? []).catch(() => [])
    : [];
  // Réponses des pros aux demandes de l'élève
  const ids = (demandes as { id: number }[]).map((d) => d.id);
  const reponses = ids.length
    ? (await db(`reponses_demandes?demande_id=in.(${ids.join(",")})&select=demande_id,created_at,pro_type,pro_nom,contact,message&order=created_at`)).data ?? []
    : [];
  for (const d of demandes as Record<string, unknown>[]) {
    d.reponses = (reponses as Record<string, unknown>[]).filter((r) => r.demande_id === d.id);
  }
  // Chiffres de chaque établissement vérifié (les mêmes que dans le rapport envoyé aux pros)
  for (const l of liens as Record<string, unknown>[]) {
    if (l.statut !== "verifie") continue;
    const p2 = String(l.pro_ref);
    const [mois, reponsesPro] = await Promise.all([
      rpc("stats_pro", { p: p2 }).then((r) => r ?? []),
      compte(`reponses_demandes?pro_ref=eq.${p2}&select=id`),
    ]);
    l.mois = (mois as Record<string, unknown>[]).map((m) => ({
      mois: m.mois, personnes_action: n(m.personnes_action), ouvert: n(m.ouvert), carte: n(m.carte), site: n(m.site),
      email: n(m.email), message: n(m.message), reserver: n(m.reserver),
    }));
    l.reponses_demandes = reponsesPro;
    l.rapport = await lienRapport(p2, l.departement);
  }
  return reply(200, {
    ok: true,
    user: { email: u.email, cree: u.cree },
    profil: { type: p.type, pro_type: p.pro_type, prenom: p.prenom ?? null, telephone: p.telephone ?? null, departement: p.departement ?? null },
    pack: achat ? { achete: true, date: achat.created_at, ddt: achat.ddt } : { achete: false },
    alertes, demandes, liens, reponses_envoyees: envoyees, dossiers, ddt,
    emails: !!env("RESEND_API_KEY"),
  });
}

async function majProfil(body: Record<string, unknown>) {
  const u = await utilisateur(body.jeton);
  await profil(u);
  const prenom = clean(body.prenom, 60);
  const telephone = clean(body.telephone, 20);
  const departement = String(body.departement ?? "").toUpperCase() || null;
  if (telephone && !TELEPHONE.test(telephone)) throw new Refus("Ce numéro de téléphone n'est pas valide.");
  if (departement && !DEPARTEMENT.test(departement)) throw new Refus("Choisis un département de la liste.");
  await db(`profils?user_id=eq.${u.id}`, { method: "PATCH", body: JSON.stringify({ prenom, telephone, departement }) });
  return reply(200, { ok: true });
}

async function pack(body: Record<string, unknown>) {
  const u = await utilisateur(body.jeton);
  if (!await packAchete(u)) throw new Refus("Aucun achat du pack sur ce compte. Si tu l'as acheté avec un autre compte, connecte-toi avec celui-là.", 404);
  return reply(200, { ok: true, url: await lienPack(3600) });
}

async function packEmail(body: Record<string, unknown>) {
  const u = await utilisateur(body.jeton);
  if (!await packAchete(u)) throw new Refus("Aucun achat du pack sur ce compte.", 404);
  if (!env("RESEND_API_KEY")) {
    throw new Refus("L'envoi par e-mail n'est pas encore disponible. Télécharge ton pack avec le bouton « Télécharger ».", 503);
  }
  const url = await lienPack(7 * 86400);
  const ok = await sendEmail({
    to: [u.email], subject: "Ton Pack candidat libre",
    html: `<div style="font-family:Arial,sans-serif;color:#1A1F25;max-width:540px;line-height:1.5">
      <p style="font-size:20px;font-weight:bold">Ton Pack candidat libre</p>
      <p>Voici ton lien de téléchargement. Il marche pendant 7 jours. Tu peux en redemander un à tout moment depuis ton compte Créno.</p>
      <p><a href="${esc(url)}" style="display:inline-block;background:#0A4F8F;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Télécharger le pack</a></p>
      <p style="color:#55606B;font-size:13px">Usage personnel : merci de ne pas partager ce lien.</p></div>`,
    text: `Ton Pack candidat libre (lien valable 7 jours) : ${url}`,
  });
  if (!ok) throw new Refus("L'e-mail n'a pas pu partir. Télécharge ton pack avec le bouton « Télécharger ».", 503);
  return reply(200, { ok: true });
}

// ---------------------------------------------------------------- demande de place préparée (pack)
const DELAI_DOSSIER = Number(env("DOSSIER_DELAI_JOURS", "7")) || 7;
const ouiNon = (v: unknown) => v === true || v === "oui" ? true : v === false || v === "non" ? false : null;

async function dossier(body: Record<string, unknown>) {
  const u = await utilisateur(body.jeton);
  const p = await profil(u);
  if (p.type !== "eleve") throw new Refus("Cette demande est réservée aux comptes élèves.");
  const achat = await packAchete(u);
  if (!achat) throw new Refus("La demande de place préparée fait partie de la formule Pack candidat libre + DDT. Prends-la pour l'utiliser.", 402);
  if (!achat.ddt) {
    throw new Refus("La demande de place préparée fait partie de la formule Pack candidat libre + DDT. Écris-nous pour y passer : tu ne paies que la différence.", 402);
  }
  const departement = String(body.departement ?? "").toUpperCase();
  if (!DEPARTEMENT.test(departement)) throw new Refus("Choisis ton département.");
  const depuis = new Date(Date.now() - 86400000).toISOString();
  const { data: recents } = await db(`dossiers_ddt?user_id=eq.${u.id}&created_at=gte.${depuis}&select=id`);
  if ((recents ?? []).length >= 3) throw new Refus("Tu as déjà envoyé plusieurs demandes aujourd'hui. On s'en occupe : réessaie demain si besoin.", 429);
  const row = {
    user_id: u.id, email: u.email, departement, ville: clean(body.ville, 80),
    code_ok: ouiNon(body.code_ok), libre_ok: ouiNon(body.libre_ok), accompagnateur_ok: ouiNon(body.accompagnateur_ok),
    voiture_ok: ouiNon(body.voiture_ok), appris_proches: ouiNon(body.appris_proches),
    autres_departements: clean(body.autres_departements, 200), message: clean(body.message, 1000),
  };
  await db("dossiers_ddt", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
  const admin = env("ADMIN_EMAIL");
  if (admin) {
    const oui = (b: boolean | null) => b === null ? "?" : b ? "oui" : "non";
    await sendEmail({
      to: [admin], reply_to: u.email, subject: `[Créno] Demande de place à préparer : ${departement}`,
      html: `<p>Un acheteur du pack attend sa demande de place préparée (délai annoncé : ${DELAI_DOSSIER} jours).</p>
        <p>Compte : ${esc(u.email)}<br>Département : ${esc(departement)}${row.ville ? `, ${esc(row.ville)}` : ""}<br>
        Code et NEPH : ${oui(row.code_ok)} · Plus en auto-école : ${oui(row.libre_ok)} · Accompagnateur : ${oui(row.accompagnateur_ok)}<br>
        Voiture double commande : ${oui(row.voiture_ok)} · Appris avec des proches : ${oui(row.appris_proches)}<br>
        Autres départements : ${esc(row.autres_departements ?? "aucun")}</p>
        ${row.message ? `<p>« ${esc(row.message)} »</p>` : ""}
        <p>Réponds à cet e-mail pour lui envoyer sa demande, puis clique « Envoyé » dans <a href="${SITE_URL}/admin/">ton tableau de bord</a>.</p>`,
      text: `Demande de place à préparer pour ${u.email} (${departement}). Tableau de bord : ${SITE_URL}/admin/`,
    });
  }
  return reply(200, { ok: true, delai: DELAI_DOSSIER });
}

async function places(body: Record<string, unknown>) {
  const u = await utilisateur(body.jeton);
  const p = await profil(u);
  let dep = String(body.departement ?? "").toUpperCase();
  if (!DEPARTEMENT.test(dep)) {
    const { data } = await db(`abonnes_alertes?user_id=eq.${u.id}&select=departement&order=created_at.desc&limit=1`);
    dep = data?.[0]?.departement ?? p.departement ?? "";
  }
  if (!DEPARTEMENT.test(dep)) return reply(200, { ok: true, departement: null, places: [] });
  const depuis = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await db(`signalements?departement=eq.${dep}&valide=eq.true&created_at=gte.${depuis}` +
    "&select=created_at,centre,creneau,details&order=created_at.desc&limit=100");
  return reply(200, { ok: true, departement: dep, places: data ?? [] });
}

async function lier(body: Record<string, unknown>) {
  const u = await utilisateur(body.jeton);
  const p = await profil(u);
  if (p.type !== "pro") throw new Refus("Seuls les comptes pros peuvent relier un établissement.", 403);
  if (await compte(`liens_pros?user_id=eq.${u.id}&select=id`) >= MAX_LIENS) throw new Refus("Tu as déjà relié 5 établissements. Écris-nous pour en ajouter.");
  const type = String(body.pro_type ?? p.pro_type ?? "");
  const departement = String(body.departement ?? "").toUpperCase();
  if (!DEPARTEMENT.test(departement)) throw new Refus("Choisis ton département.");
  let proRef = "", nom = "";
  if (type === "auto-ecole") {
    const id = String(body.auto_ecole_id ?? "");
    if (!AGREMENT.test(id)) throw new Refus("Choisis ton auto-école dans la liste officielle.");
    const res = await fetch(`${SITE_URL}/data/departements/${departement}.json`);
    const ae = res.ok ? ((await res.json()).ecoles ?? []).find((e: { id: string }) => e.id === id) : null;
    if (!ae) throw new Refus("Cette auto-école n'est pas dans la liste officielle de ce département.");
    proRef = `ae-${ae.id}`;
    nom = `${ae.nom} (${ae.ville})`;
  } else if (type === "loueur" || type === "moniteur") {
    const brut = clean(body.nom, 120);
    if (!brut || brut.length < 2) throw new Refus(type === "loueur" ? "Indique le nom de ton agence." : "Indique ton nom et ton auto-école de rattachement.");
    proRef = `${type}-${slug(brut).slice(0, 60)}`;
    nom = brut;
  } else {
    throw new Refus("Dis-nous si tu es une auto-école, un moniteur ou un loueur.");
  }
  await db("liens_pros?on_conflict=user_id,pro_ref", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: u.id, pro_ref: proRef, nom, departement }),
  });
  const admin = env("ADMIN_EMAIL");
  if (admin) {
    await sendEmail({
      to: [admin], subject: `[Créno] Un pro veut relier son compte : ${nom}`,
      html: `<p><strong>${esc(nom)}</strong> (${esc(type)}, ${esc(departement)})<br>Compte : ${esc(u.email)}</p>
        <p>Vérifie que c'est bien lui (appelle l'établissement), puis valide dans <a href="${SITE_URL}/admin/">ton tableau de bord</a>, rubrique « À traiter ».</p>`,
      text: `${nom} (${type}, ${departement}) veut relier son compte ${u.email}. Valide dans ${SITE_URL}/admin/`,
    });
  }
  return reply(200, { ok: true, pro_ref: proRef, nom });
}

async function supprimer(body: Record<string, unknown>) {
  const u = await utilisateur(body.jeton);
  if (body.confirmation !== "SUPPRIMER") throw new Refus("Écris SUPPRIMER pour confirmer.");
  // Données personnelles rattachées au compte : supprimées. Le reste (profil, liens) part avec le compte.
  await db(`demandes_pros?user_id=eq.${u.id}`, { method: "DELETE" });
  await db(`abonnes_alertes?user_id=eq.${u.id}`, { method: "DELETE" });
  await db(`dossiers_ddt?user_id=eq.${u.id}`, { method: "DELETE" }).catch((e) => console.error("Dossiers", e));
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) {
    console.error("Suppression du compte", res.status, await res.text());
    throw new Error("Suppression impossible");
  }
  return reply(200, { ok: true });
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
      case "moi": return await moi(body);
      case "profil": return await majProfil(body);
      case "pack": return await pack(body);
      case "pack_email": return await packEmail(body);
      case "places": return await places(body);
      case "dossier": return await dossier(body);
      case "lier": return await lier(body);
      case "supprimer": return await supprimer(body);
      default: return reply(400, { erreur: "Action inconnue." });
    }
  } catch (e) {
    if (e instanceof Refus) return reply(e.status, { erreur: e.message });
    console.error(e);
    return reply(500, { erreur: "Une erreur est survenue. Réessaie dans quelques minutes." });
  }
});
