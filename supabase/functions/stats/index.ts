// Créno : compteur des contacts envoyés aux auto-écoles et aux loueurs (fonction serveur Supabase, Deno).
//
// Le site appelle cette fonction en POST avec un JSON { action, ... } :
//   clic    { cible, page?, dep? } -> compte un clic sur « Contacter », « Téléphone et itinéraire », « Site web »...
//                                    Une même personne compte une fois par jour et par bouton.
//   total   {}                     -> nombre total de contacts envoyés (affiché sur l'espace pros)
//   rapport { p, k }               -> chiffres d'une auto-école ou d'un loueur. k est une clé secrète propre
//                                    à chaque pro : seul celui qui a le lien du rapport peut le voir.
//   admin   { code }               -> tableau de bord : clics par pro et par bouton (7 jours, 30 jours, depuis le début),
//                                    courbe jour par jour, ventes Stripe, abonnés aux alertes, demandes d'élèves,
//                                    réponses des pros, liens des rapports, formulaires à traiter
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

const PRO = /^(ae-[A-Z0-9_]{6,24}|loueur-[a-z0-9-]{2,60})$/;
const CIBLE = /^(ae-[A-Z0-9_]{6,24}|loueur-[a-z0-9-]{2,60})-(ouvert|carte|site|email|message|reserver)$/;
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

// Ventes lues chez Stripe (pack, Créno Pro). Le compte Stripe sert aussi à d'autres sites :
// on ne garde que les paiements dont la référence commence par pack-, pro-ae- ou pro-loueur-.
// La clé restreinte « Checkout Sessions : lecture » suffit. Les remboursements ne sont pas déduits.
type Vente = { n: number; eur: number };
async function ventesStripe() {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) return { ok: false, raison: "La clé Stripe n'est pas réglée." };
  const maintenant = Date.now() / 1000;
  const vide = () => ({ j7: { n: 0, eur: 0 }, j30: { n: 0, eur: 0 }, tout: { n: 0, eur: 0 } } as Record<string, Vente>);
  const res: Record<string, Record<string, Vente>> = { pack: vide(), pro_ae: vide(), pro_loueur: vide() };
  let apres = "";
  for (let page = 0; page < 10; page++) {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions?limit=100" + (apres ? `&starting_after=${apres}` : ""),
      { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return { ok: false, raison: `Stripe a refusé la lecture (${r.status}).` };
    const j = await r.json();
    const liste = (j.data ?? []) as Record<string, unknown>[];
    for (const x of liste) {
      const ref = String(x.client_reference_id ?? "");
      const type = ref.startsWith("pack-") ? "pack" : ref.startsWith("pro-ae-") ? "pro_ae" : ref.startsWith("pro-loueur-") ? "pro_loueur" : "";
      if (!type || x.status !== "complete" || x.payment_status !== "paid") continue;
      const eur = n(x.amount_total) / 100;
      const age = (maintenant - n(x.created)) / 86400;
      for (const [cle, max] of [["j7", 7], ["j30", 30], ["tout", Infinity]] as [string, number][]) {
        if (age <= max) { res[type][cle].n++; res[type][cle].eur += eur; }
      }
    }
    if (!j.has_more || !liste.length) break;
    apres = String(liste[liste.length - 1].id);
  }
  return { ok: true, ...res };
}

const boutons = (r: Record<string, unknown>) => ({
  p: r.pro, departement: r.departement, ouvert: n(r.ouvert), carte: n(r.carte), site: n(r.site), email: n(r.email),
  message: n(r.message), reserver: n(r.reserver), personnes: n(r.personnes), action: n(r.personnes_action), dernier: r.dernier,
});

async function admin(body: Record<string, unknown>) {
  if (!await codeOk(body)) return reply(403, { erreur: "Code incorrect." });
  const il7 = jourParis(new Date(Date.now() - 6 * 86400000));
  const il30 = jourParis(new Date(Date.now() - 29 * 86400000));
  const [tout, j30, j7, jours] = await Promise.all([
    rpc("stats_boutons", { depuis: "2000-01-01" }), rpc("stats_boutons", { depuis: il30 }),
    rpc("stats_boutons", { depuis: il7 }), rpc("stats_jours", { depuis: il30 }),
  ]);
  const periodes = {
    j7: (j7 ?? []).map(boutons), j30: (j30 ?? []).map(boutons), tout: (tout ?? []).map(boutons),
  };
  const recents = new Map(periodes.j30.map((r: Record<string, unknown>) => [r.p, r]));
  // Un pro = une ligne, avec la clé de son rapport
  const pros = await Promise.all(periodes.tout.map(async (r: Record<string, unknown>) => {
    const r30 = (recents.get(r.p) ?? {}) as Record<string, unknown>;
    return {
      p: r.p, departement: r.departement, k: await cle(String(r.p)),
      total: n(r.personnes), total_action: n(r.action), j30: n(r30.personnes), j30_action: n(r30.action), dernier: r.dernier,
    } as Record<string, unknown>;
  }));
  // Réponses des pros aux demandes d'élèves : ajoutées à chaque pro
  const il30iso = new Date(Date.now() - 30 * 86400000).toISOString();
  const il7iso = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: toutesReponses } = await db(
    "reponses_demandes?select=pro_ref,pro_nom,departement_pro,created_at&order=created_at.desc&limit=10000");
  const parPro = new Map<string, { total: number; j30: number; j7: number; dep: string | null }>();
  for (const r of toutesReponses ?? []) {
    const x = parPro.get(r.pro_ref) ?? { total: 0, j30: 0, j7: 0, dep: r.departement_pro };
    x.total++;
    if (r.created_at >= il30iso) x.j30++;
    if (r.created_at >= il7iso) x.j7++;
    parPro.set(r.pro_ref, x);
  }
  const index = new Map(pros.map((x) => [x.p, x]));
  for (const [ref, x] of parPro) {
    let pro = index.get(ref);
    if (!pro) {
      pro = { p: ref, departement: x.dep, k: await cle(ref), total: 0, total_action: 0, j30: 0, j30_action: 0, dernier: null };
      pros.push(pro);
    }
    pro.demandes = x.total;
    pro.demandes_30j = x.j30;
    pro.demandes_7j = x.j7;
  }
  pros.sort((a, b) => n(b.j30) - n(a.j30) || n(b.total) - n(a.total));

  const [reponses, demandes, tarifs, prosProposes, loueurs, messages, demandesOuvertes, demandes30, demandes7, demandesTout, crenoPro] =
    await Promise.all([
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
      compte(`demandes_pros?email=not.is.null&created_at=gte.${il7iso}&select=id`),
      compte(`demandes_pros?email=not.is.null&select=id`),
      db("creno_pro_demandes?traite=eq.false&select=*&order=created_at.desc&limit=50").then((r) => r.data ?? []),
    ]);
  // Comptes : élèves, pros, et pros qui attendent ta vérification (pour voir leurs chiffres)
  const [comptesEleves, comptesPros, liens] = await Promise.all([
    compte("profils?type=eq.eleve&select=user_id").catch(() => 0),
    compte("profils?type=eq.pro&select=user_id").catch(() => 0),
    db("liens_pros?statut=eq.en_attente&select=id,created_at,user_id,pro_ref,nom,departement&order=created_at&limit=50")
      .then((r) => r.data ?? []).catch(() => []),
  ]);
  // Pour vérifier un pro, il te faut de quoi le joindre : l'e-mail de son compte et son téléphone s'il l'a donné.
  await Promise.all((liens as Record<string, unknown>[]).map(async (l) => {
    const [u, pr] = await Promise.all([
      fetch(`${SUPABASE_URL}/auth/v1/admin/users/${l.user_id}`, { headers: authHeaders() })
        .then((r) => r.ok ? r.json() : null).catch(() => null),
      db(`profils?user_id=eq.${l.user_id}&select=telephone,pro_type`).then((r) => r.data?.[0] ?? null).catch(() => null),
    ]);
    l.email = u?.email ?? null;
    l.telephone = pr?.telephone ?? null;
    l.pro_type = pr?.pro_type ?? null;
    delete l.user_id;
  }));

  const now = new Date().toISOString();
  const [essais, abonnes, enAttente, signalements, signalements7, ventes] = await Promise.all([
    compte(`abonnes_alertes?statut=eq.actif&plan=eq.essai&expire_le=gt.${now}&select=id`),
    compte(`abonnes_alertes?statut=eq.actif&plan=eq.abonne&select=id`),
    compte(`abonnes_alertes?statut=eq.en_attente&select=id`),
    compte(`signalements?created_at=gte.${il30}&select=id`),
    compte(`signalements?created_at=gte.${il7}&select=id`),
    ventesStripe().catch(() => ({ ok: false, raison: "Stripe ne répond pas." })),
  ]);
  const centimes = Number(env("ALERTES_MONTANT_CENTIMES", "999")) || 999;
  return reply(200, {
    ok: true, pros, periodes, jours: (jours ?? []).map((j: Record<string, unknown>) => ({ jour: j.jour, fiches: n(j.fiches), eleves: n(j.eleves) })),
    ventes,
    alertes: {
      payantes: !!env("ALERTES_LIEN_STRIPE"), actifs: essais + abonnes, essais, abonnes, en_attente: enAttente,
      signalements_30j: signalements, signalements_7j: signalements7, revenu_mensuel: abonnes * centimes / 100,
    },
    demandes: { ouvertes: demandesOuvertes, recues_30j: demandes30, recues_7j: demandes7, recues_tout: demandesTout, liste: demandes, reponses },
    comptes: { eleves: comptesEleves, pros: comptesPros },
    a_traiter: { liens, creno_pro: crenoPro, tarifs, pros: prosProposes, loueurs, messages },
  });
}

// Traiter un formulaire depuis le tableau de bord
// valeur : ce qu'on écrit pour « Publier / C'est fait / Valider » (true par défaut).
// refus : ce qu'on écrit pour « Supprimer » au lieu d'effacer la ligne.
const TRAITEMENTS: Record<string, { table: string; champ: string; valeur?: unknown; refus?: unknown }> = {
  liens: { table: "liens_pros", champ: "statut", valeur: "verifie", refus: "refuse" },
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
    if (t.refus !== undefined) await db(`${t.table}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ [t.champ]: t.refus }) });
    else await db(`${t.table}?id=eq.${id}`, { method: "DELETE" });
  } else {
    await db(`${t.table}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ [t.champ]: t.valeur ?? true }) });
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
