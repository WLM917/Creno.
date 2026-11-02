// Créno : compteur des contacts envoyés aux auto-écoles et aux loueurs (fonction serveur Supabase, Deno).
//
// Le site appelle cette fonction en POST avec un JSON { action, ... } :
//   clic    { cible, page?, dep? } -> compte un clic sur « Contacter », « Téléphone et itinéraire », « Site web »...
//                                    Une même personne compte une fois par jour et par bouton.
//   total   {}                     -> nombre total de contacts envoyés (affiché sur l'espace pros)
//   rapport { p, k }               -> chiffres d'une auto-école ou d'un loueur. k est une clé secrète propre
//                                    à chaque pro : seul celui qui a le lien du rapport peut le voir.
//   admin   { code }               -> tableau de bord : tous les pros, liens de leurs rapports, abonnés aux alertes,
//                                    réponses des pros aux demandes d'élèves, formulaires à traiter
//   traiter { code, quoi, id, decision } -> publier des tarifs, marquer un pro / un loueur / un message comme traité
//
// Vie privée : on ne garde jamais l'adresse IP. L'empreinte est calculée à partir de l'IP, du navigateur,
// du jour et d'une phrase secrète : elle change chaque jour et ne permet pas de suivre quelqu'un.
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   CRENO_SEL   une phrase secrète au hasard (la même que pour la fonction alertes)
//   ADMIN_CODE  ton code secret pour le tableau de bord
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SEL = env("CRENO_SEL") || env("ALERTES_SEL") || SERVICE_KEY.slice(-16);
const MAX_CLICS_JOUR = 80; // au-delà, c'est un robot ou un abus : on ne compte plus cet appareil ce jour-là

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRO = /^(ae-[A-Z0-9]{6,20}|loueur-[a-z0-9-]{2,60})$/;
const CIBLE = /^(ae-[A-Z0-9]{6,20}|loueur-[a-z0-9-]{2,60})-(ouvert|carte|site|email|message|reserver)$/;
const DEPARTEMENT = /^([0-9]{2,3}|2[AB])$/;
const ROBOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|python|curl|wget/i;

function reply(status: number, body: Record<string, unknown> | null, extra: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body),
    { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });
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

async function rpc(name: string, args: Record<string, unknown>) {
  const { data } = await db(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  return data;
}

async function compte(path: string) {
  const { headers } = await db(path, { headers: { Prefer: "count=exact", Range: "0-0" } });
  return Number((headers.get("content-range") ?? "*/0").split("/")[1]) || 0;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Clé du rapport d'un pro : impossible à deviner sans la phrase secrète.
async function cle(p: string) {
  return (await sha256(`${SEL}|rapport|${p}`)).slice(0, 20);
}

// Date du jour à Paris, au format AAAA-MM-JJ
function jourParis(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

const n = (v: unknown) => Number(v ?? 0) || 0;

// ---------------------------------------------------------------- actions
async function clic(body: Record<string, unknown>, req: Request) {
  const cible = String(body.cible ?? "");
  if (!CIBLE.test(cible)) return reply(400, { erreur: "Cible inconnue." });
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || ROBOT.test(ua)) return reply(204, null);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const jour = jourParis();
  const empreinte = await sha256(`${SEL}|${jour}|${ip}|${ua}`);

  if (await compte(`clics?empreinte=eq.${empreinte}&jour=eq.${jour}&select=id`) >= MAX_CLICS_JOUR) return reply(204, null);

  const dep = String(body.dep ?? "").toUpperCase();
  const page = String(body.page ?? "").slice(0, 200) || null;
  await db("clics?on_conflict=cible,empreinte,jour", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ cible, empreinte, jour, page, departement: DEPARTEMENT.test(dep) ? dep : null }),
  });
  return reply(204, null);
}

async function total() {
  const t = await rpc("stats_total", {});
  return reply(200, { total: n(t) }, { "Cache-Control": "public, max-age=600" });
}

async function rapport(body: Record<string, unknown>) {
  const p = String(body.p ?? "");
  if (!PRO.test(p) || String(body.k ?? "") !== await cle(p)) {
    return reply(403, { erreur: "Ce lien de rapport n'est pas valide. Demandez un nouveau lien à Créno." });
  }
  const lignes = (await rpc("stats_pro", { p })) ?? [];
  const mois = lignes.map((l: Record<string, unknown>) => ({
    mois: l.mois, personnes: n(l.personnes), personnes_action: n(l.personnes_action),
    ouvert: n(l.ouvert), carte: n(l.carte), site: n(l.site), email: n(l.email), message: n(l.message), reserver: n(l.reserver),
  }));
  const somme = (k: string) => mois.reduce((s: number, m: Record<string, number>) => s + m[k], 0);
  const premier = lignes.map((l: Record<string, unknown>) => String(l.premier)).sort()[0] ?? null;
  const dep = lignes.map((l: Record<string, unknown>) => l.departement).find(Boolean) ?? null;
  const debutMois = `${jourParis().slice(0, 7)}-01`;
  const [demandes, demandesMois] = await Promise.all([
    compte(`reponses_demandes?pro_ref=eq.${p}&select=id`),
    compte(`reponses_demandes?pro_ref=eq.${p}&created_at=gte.${debutMois}&select=id`),
  ]);
  return reply(200, {
    ok: true, p, departement: dep, depuis: premier, mois,
    total: { personnes: somme("personnes"), personnes_action: somme("personnes_action") },
    demandes: { total: demandes, ce_mois: demandesMois },
    ce_mois: jourParis().slice(0, 7),
  });
}

async function codeOk(body: Record<string, unknown>) {
  const code = env("ADMIN_CODE");
  if (code && String(body.code ?? "") === code) return true;
  await new Promise((r) => setTimeout(r, 800));
  return false;
}

async function admin(body: Record<string, unknown>) {
  if (!await codeOk(body)) return reply(403, { erreur: "Code incorrect." });
  const il30 = jourParis(new Date(Date.now() - 29 * 86400000));
  const [tout, recent] = await Promise.all([rpc("stats_pros", { depuis: "2000-01-01" }), rpc("stats_pros", { depuis: il30 })]);
  const recents = new Map((recent ?? []).map((r: Record<string, unknown>) => [r.pro, r]));
  const pros = await Promise.all((tout ?? []).map(async (r: Record<string, unknown>) => {
    const r30 = (recents.get(r.pro) ?? {}) as Record<string, unknown>;
    return {
      p: r.pro, departement: r.departement, k: await cle(String(r.pro)),
      total: n(r.personnes), total_action: n(r.personnes_action),
      j30: n(r30.personnes), j30_action: n(r30.personnes_action), dernier: r.dernier,
    };
  }));
  // Réponses des pros aux demandes d'élèves : ajoutées à chaque pro
  const il30iso = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: toutesReponses } = await db(
    "reponses_demandes?select=pro_ref,pro_nom,departement_pro,created_at&order=created_at.desc&limit=10000");
  const parPro = new Map<string, { total: number; j30: number; dep: string | null }>();
  for (const r of toutesReponses ?? []) {
    const x = parPro.get(r.pro_ref) ?? { total: 0, j30: 0, dep: r.departement_pro };
    x.total++;
    if (r.created_at >= il30iso) x.j30++;
    parPro.set(r.pro_ref, x);
  }
  const index = new Map(pros.map((x) => [x.p, x]));
  for (const [ref, x] of parPro) {
    let pro = index.get(ref) as Record<string, unknown> | undefined;
    if (!pro) {
      pro = { p: ref, departement: x.dep, k: await cle(ref), total: 0, total_action: 0, j30: 0, j30_action: 0, dernier: null };
      pros.push(pro as typeof pros[number]);
    }
    pro.demandes = x.total;
    pro.demandes_30j = x.j30;
  }
  pros.sort((a, b) => b.j30 - a.j30 || b.total - a.total);

  const [reponses, demandes, tarifs, prosProposes, loueurs, messages, demandesOuvertes, demandes30, crenoPro] = await Promise.all([
    db("reponses_demandes?select=created_at,pro_type,pro_ref,pro_nom,contact,message,demandes_pros(besoin,departement,ville)" +
      "&order=created_at.desc&limit=50").then((r) => r.data ?? []),
    db("demandes_pros?select=id,created_at,besoin,departement,ville,disponibilites,nb_reponses,statut&email=not.is.null" +
      "&order=created_at.desc&limit=50").then((r) => r.data ?? []),
    db("tarifs_proposes?valide=eq.false&select=*&order=created_at.desc&limit=50").then((r) => r.data ?? []),
    db("pros_proposes?verifie=eq.false&select=*&order=created_at.desc&limit=50").then((r) => r.data ?? []),
    db("loueurs_proposes?verifie=eq.false&select=*&order=created_at.desc&limit=50").then((r) => r.data ?? []),
    db("contacts_pros?traite=eq.false&select=*&order=created_at.desc&limit=50").then((r) => r.data ?? []),
    compte(`demandes_pros?statut=eq.ouverte&email=not.is.null&created_at=gte.${il30iso}&select=id`),
    compte(`demandes_pros?email=not.is.null&created_at=gte.${il30iso}&select=id`),
    db("creno_pro_demandes?traite=eq.false&select=*&order=created_at.desc&limit=50").then((r) => r.data ?? []),
  ]);

  const now = new Date().toISOString();
  const [essais, abonnes, enAttente, signalements] = await Promise.all([
    compte(`abonnes_alertes?statut=eq.actif&plan=eq.essai&expire_le=gt.${now}&select=id`),
    compte(`abonnes_alertes?statut=eq.actif&plan=eq.abonne&select=id`),
    compte(`abonnes_alertes?statut=eq.en_attente&select=id`),
    compte(`signalements?created_at=gte.${il30}&select=id`),
  ]);
  const centimes = Number(env("ALERTES_MONTANT_CENTIMES", "999")) || 999;
  return reply(200, {
    ok: true, pros,
    alertes: { essais, abonnes, en_attente: enAttente, signalements_30j: signalements, revenu_mensuel: abonnes * centimes / 100 },
    demandes: { ouvertes: demandesOuvertes, recues_30j: demandes30, liste: demandes, reponses },
    a_traiter: { creno_pro: crenoPro, tarifs, pros: prosProposes, loueurs, messages },
  });
}

// Traiter un formulaire depuis le tableau de bord
const TRAITEMENTS: Record<string, { table: string; champ: string }> = {
  tarifs: { table: "tarifs_proposes", champ: "valide" },
  pros: { table: "pros_proposes", champ: "verifie" },
  loueurs: { table: "loueurs_proposes", champ: "verifie" },
  messages: { table: "contacts_pros", champ: "traite" },
  creno_pro: { table: "creno_pro_demandes", champ: "traite" },
};

async function traiter(body: Record<string, unknown>) {
  if (!await codeOk(body)) return reply(403, { erreur: "Code incorrect." });
  const t = TRAITEMENTS[String(body.quoi ?? "")];
  const id = Number(body.id);
  if (!t || !Number.isInteger(id) || id <= 0) return reply(400, { erreur: "Demande invalide." });
  if (body.decision === "supprimer") {
    await db(`${t.table}?id=eq.${id}`, { method: "DELETE" });
  } else {
    await db(`${t.table}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ [t.champ]: true }) });
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
      case "clic": return await clic(body, req);
      case "total": return await total();
      case "rapport": return await rapport(body);
      case "admin": return await admin(body);
      case "traiter": return await traiter(body);
      default: return reply(400, { erreur: "Action inconnue." });
    }
  } catch (e) {
    console.error(e);
    return reply(500, { erreur: "Une erreur est survenue. Réessaie dans quelques minutes." });
  }
});
