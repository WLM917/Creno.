#!/usr/bin/env python3
"""
Génère toutes les pages du site Créno à partir des données et des modèles.

Utilisation :
    python3 scripts/build_site.py

Lit :
    site.json                       réglages (adresse du site, département par défaut...)
    data/index.json                 départements (produit par scripts/import_auto_ecoles.py)
    data/departements/<code>.json   auto-écoles de chaque département
    data/loueurs.json               loueurs de voitures à double commande
    templates/*.html                contenu des pages fixes (accueil, candidat libre...)

Écrit (à la racine du dépôt, prêt pour GitHub Pages, Vercel ou Netlify) :
    index.html, auto-ecoles/..., candidat-libre/, examen/, cout-du-permis/, methode/,
    confidentialite/, 404.html, sitemap.xml, robots.txt, data/recherche.json (recherche de ville)

Chaque département et chaque ville (à partir de 2 auto-écoles) a sa propre page,
lisible par Google sans JavaScript. Le JavaScript ajoute ensuite les filtres.
"""
import html
import json
import sys
import re
import shutil
import unicodedata
from datetime import date
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

if sys.version_info < (3, 12):
    sys.exit("Ce script demande Python 3.12 ou plus récent.")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TPL = ROOT / "templates"
CFG = json.loads((ROOT / "site.json").read_text(encoding="utf-8"))

SITE_URL = CFG["adresse_du_site"].rstrip("/")
DEP_DEFAUT = str(CFG.get("departement_par_defaut", "91"))
MIN_DECL = int(CFG.get("min_declarations_prix", 3))
VILLE_MIN = int(CFG.get("pages_ville_min_auto_ecoles", 2))
CONTACT = (CFG.get("email_contact") or "").strip()
GSV = (CFG.get("google_site_verification") or "").strip()
PRIX_PACK = CFG.get("prix_pack", "14,99 €")
PRIX_ALERTES = CFG.get("prix_alertes", "9,99 €")
ESSAI_ALERTES = int(CFG.get("essai_alertes_jours", 15))
ALERTES_PAYANTES = bool(CFG.get("alertes_payantes", False))
ANALYTICS = bool(CFG.get("vercel_analytics", False))
EDITEUR = CFG.get("editeur") or {}
MEDIATEUR = (CFG.get("mediateur_consommation") or "").strip()
TOP_BADGE = 10

IDF = ["75", "77", "78", "91", "92", "93", "94", "95"]
SHRINK_K = 40
SMALL_SAMPLE = 50
W_TAUX, W_COUT = 0.6, 0.4
LABELS = {
    "qualite": "Label qualité",
    "permis1euro": "Permis à 1 € par jour",
    "aac": "Conduite accompagnée",
    "associative": "Associative",
    "enligne": "En ligne",
}
NAV = [
    ("auto-ecoles/", "Auto-écoles", "auto-ecoles"),
    ("candidat-libre/", "Candidat libre", "candidat-libre"),
    ("alertes/", "Alertes places", "alertes"),
    ("pack-candidat-libre/", "Le pack", "pack"),
]
FOOTER = [
    ("auto-ecoles/", "Auto-écoles"), ("candidat-libre/", "Candidat libre"), ("alertes/", "Alertes places"),
    ("pack-candidat-libre/", "Pack candidat libre"), ("moniteurs/", "Moniteurs"), ("cout-du-permis/", "Coût du permis"),
    ("examen/", "Jour de l'examen"), ("pro/", "Espace pros"), ("methode/", "Méthode"),
    ("confidentialite/", "Confidentialité"), ("mentions-legales/", "Mentions légales"), ("cgv/", "Conditions de vente"),
]
GENERATED_DIRS = ["auto-ecoles", "candidat-libre", "examen", "cout-du-permis", "methode", "confidentialite",
                  "alertes", "pack-candidat-libre", "moniteurs", "pro", "mentions-legales", "cgv", "badges", "admin", "rapport"]

# Accents absents du fichier officiel, rétablis pour l'affichage des villes les plus courantes.
ACCENTS = {
    "genevieve": "Geneviève", "evry": "Évry", "etampes": "Étampes", "etang": "Étang", "eglise": "Église",
    "epinay": "Épinay", "elancourt": "Élancourt", "ecouen": "Écouen", "eragny": "Éragny", "ezanville": "Ézanville",
    "velizy": "Vélizy", "sevres": "Sèvres", "creteil": "Créteil", "chatillon": "Châtillon", "chateau": "Château",
    "chatelet": "Châtelet", "chatenay": "Châtenay", "foret": "Forêt", "ile": "Île", "cote": "Côte",
    "orleans": "Orléans", "beziers": "Béziers", "nimes": "Nîmes", "besancon": "Besançon", "epernay": "Épernay",
    "epinal": "Épinal", "evreux": "Évreux", "etienne": "Étienne", "rhone": "Rhône", "sete": "Sète",
    "frejus": "Fréjus", "hyeres": "Hyères", "ales": "Alès", "macon": "Mâcon", "perigueux": "Périgueux",
    "merignac": "Mérignac", "begles": "Bègles", "venissieux": "Vénissieux", "decines": "Décines",
    "bretigny": "Brétigny", "lesigny": "Lésigny", "asnieres": "Asnières", "brevannes": "Brévannes",
    "chennevieres": "Chennevières", "perigny": "Périgny", "senart": "Sénart", "bievres": "Bièvres",
    "verrieres": "Verrières", "egly": "Égly", "etrechy": "Étréchy", "ferte": "Ferté", "leger": "Léger",
    "medard": "Médard", "remy": "Rémy", "andre": "André", "helene": "Hélène", "meru": "Méru", "mery": "Méry",
    "vaureal": "Vauréal", "acheres": "Achères", "vesinet": "Vésinet", "coignieres": "Coignières",
    "mee": "Mée", "pate": "Pâté", "emerainville": "Émerainville", "mezieres": "Mézières", "geneve": "Genève",
    "valerien": "Valérien", "denis": "Denis", "brice": "Brice", "gratien": "Gratien", "chateaudun": "Châteaudun",
    "chateauroux": "Châteauroux", "chateaubriant": "Châteaubriant", "chalons": "Châlons", "chambery": "Chambéry",
    "angouleme": "Angoulême", "beauvais": "Beauvais", "bethune": "Béthune", "valenciennes": "Valenciennes",
    "cretes": "Crêtes", "lucon": "Luçon", "saone": "Saône", "riviere": "Rivière", "eaubonne": "Eaubonne",
}


# ---------------------------------------------------------------- outils
def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def slug(s):
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "ville"


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def ville_affichee(v):
    def fix(m):
        w = m.group(0)
        rep = ACCENTS.get(w.lower())
        if not rep:
            return w
        return rep if w[:1].isupper() else rep.lower()
    return re.sub(r"[A-Za-z]+", fix, v)


def lien_maps(e):
    """Fiche Google Maps de l'auto-école (téléphone, horaires, itinéraire) : la source officielle n'a pas de téléphone."""
    lieu = ", ".join(x for x in (e["nom"], e.get("adresse", ""), f'{e["cp"]} {ville_affichee(e["ville"])}') if x)
    return "https://www.google.com/maps/search/?api=1&query=" + quote(lieu)


def avec_utm(url, campagne="classement"):
    """Ajoute utm_source=creno : l'auto-école voit dans ses statistiques que la visite vient de Créno."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    q = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.lower().startswith("utm_")]
    q += [("utm_source", "creno"), ("utm_medium", "referral"), ("utm_campaign", campagne)]
    return urlunsplit(parts._replace(query=urlencode(q)))


MESSAGE_CONTACT = ("Bonjour, j'ai trouvé votre auto-école sur Créno. Je voudrais connaître le prix de votre forfait "
                   "permis B, le nombre d'heures comprises et le prix d'une heure en plus. Merci !")


def panneau_contact(e, decl_href):
    """Volet « Contacter » d'une auto-école du classement. Chaque clic est compté (table clics)."""
    eid = esc(e["id"])
    nom = esc(e["nom"])
    site = (f'<a class="btn btn-small btn-ghost" href="{esc(avec_utm(e["site"]))}" target="_blank" rel="noopener" '
            f'data-clic="ae-{eid}-site">Son site web<span class="visually-hidden"> ({nom})</span></a>') if e.get("site") else ""
    if e.get("email"):
        mail = ("mailto:" + quote(e["email"], safe="@.") + "?subject=" + quote("Demande d'information (trouvé sur Créno)")
                + "&body=" + quote(MESSAGE_CONTACT))
        site += (f'<a class="btn btn-small btn-ghost" href="{esc(mail)}" data-clic="ae-{eid}-email">'
                 f'Leur écrire<span class="visually-hidden"> ({nom})</span></a>')
    code = ""
    if e.get("code_promo"):
        code = (f'<p class="promo">Code Créno : <strong>{esc(e["code_promo"])}</strong>'
                f'{(" : " + esc(e["reduction"])) if e.get("reduction") else ""}</p>')
    return (
        f'<details class="rank-more" data-pro="ae-{eid}"><summary>Contacter<span class="visually-hidden"> {nom}</span></summary>'
        f'<div class="rank-panel">'
        f'<div class="rank-actions">'
        f'<a class="btn btn-small btn-signal" href="{esc(lien_maps(e))}" target="_blank" rel="noopener" '
        f'data-clic="ae-{eid}-carte">Téléphone et itinéraire<span class="visually-hidden"> ({nom}, sur Google Maps)</span></a>'
        f'{site}'
        f'<button class="btn btn-small btn-ghost" type="button" data-message="ae" data-clic="ae-{eid}-message" hidden>Copier un message tout prêt</button>'
        f'</div>'
        f'{code}'
        f'<p class="rank-tip">Quand tu les appelles ou passes les voir, dis que tu viens de <strong>Créno</strong>.</p>'
        f'<p class="rank-msg" role="status" hidden></p>'
        f'<a class="rank-decl" href="{decl_href}" data-decl="{eid}">J\'y suis inscrit : je déclare ce que j\'ai payé</a>'
        f'</div></details>'
    )


def pct(x):
    return f"{round(x * 100)} %"


def fr_int(n):
    return f"{n:,}".replace(",", " ")


def eur(n):
    return f"{fr_int(int(round(n)))} €"


def plural(n, one, many):
    return f"{fr_int(n)} {one if n <= 1 else many}"


def rang_txt(n):
    return "1re" if n == 1 else f"{n}e"


def date_fr(iso):
    mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
            "septembre", "octobre", "novembre", "décembre"]
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{'1er' if d == 1 else d} {mois[m - 1]} {y}"


def depuis(page_path):
    """Préfixe relatif pour remonter à la racine depuis une page (ex. 'auto-ecoles/essonne-91/')."""
    depth = page_path.count("/")
    return "../" * depth


class Links:
    """Fabrique les liens relatifs. explicit=True ajoute index.html (utile hors serveur web)."""
    def __init__(self, root, explicit=False):
        self.root = root
        self.explicit = explicit

    def __call__(self, path=""):
        if self.explicit and (path == "" or path.endswith("/")):
            return self.root + path + "index.html"
        return self.root + path if (self.root or path) else "./"


# ---------------------------------------------------------------- données
def cout_reel(e):
    if (e.get("declarations") or 0) < MIN_DECL:
        return None
    if e.get("forfait") is None or e.get("heures_incluses") is None or e.get("prix_heure") is None:
        return None
    heures = e.get("heures_moyennes")
    if heures is None:
        heures = e["heures_incluses"]
    en_plus = max(0, heures - e["heures_incluses"])
    return round(e["forfait"] + en_plus * e["prix_heure"] + (e.get("frais_examen") or 0))


def scale(v, lo, hi, invert=False):
    if hi == lo:
        return 50.0
    s = (v - lo) / (hi - lo) * 100
    return 100 - s if invert else s


def classer(dep):
    """Même formule que la page Méthode : indice sur 100, comparé au département."""
    moyenne = dep.get("moyenne") or 0
    rows = []
    for e in dep["ecoles"]:
        if "taux" not in e or not e.get("presentes"):
            continue
        aj = (e["taux"] * e["presentes"] + moyenne * SHRINK_K) / (e["presentes"] + SHRINK_K)
        rows.append({"e": e, "ajuste": aj, "cout": cout_reel(e)})
    if not rows:
        return {"rows": [], "moyenne": moyenne, "avec_prix": False}
    aj = [r["ajuste"] for r in rows]
    couts = [r["cout"] for r in rows if r["cout"] is not None]
    avec_prix = bool(couts)
    for r in rows:
        s_taux = scale(r["ajuste"], min(aj), max(aj))
        if avec_prix:
            s_cout = 50.0 if r["cout"] is None else scale(r["cout"], min(couts), max(couts), invert=True)
            r["indice"] = round(W_TAUX * s_taux + W_COUT * s_cout)
        else:
            r["indice"] = round(s_taux)
    rows.sort(key=lambda r: (-r["indice"], -r["ajuste"], r["e"]["nom"]))
    for i, r in enumerate(rows, 1):
        r["rang"] = i
    return {"rows": rows, "moyenne": moyenne, "avec_prix": avec_prix, "nb_prix": len(couts)}


# ---------------------------------------------------------------- morceaux de page
def chips(e):
    out = "".join(f'<span class="chip">{esc(LABELS[l])}</span>' for l in ("qualite", "permis1euro", "aac", "associative", "enligne") if l in (e.get("labels") or []))
    if e.get("partenaire"):
        out = '<span class="chip chip-flag">Partenaire payant</span>' + out
    return out


def ligne(r, moyenne, mode, nb_dep=None, code=None, avec_prix=True, href=None, decl_href="#declarer"):
    """mode : 'complet' (page département), 'ville' (page ville), 'compact' (accueil).
    avec_prix=False : aucun prix déclaré dans le département, la colonne coût n'est pas affichée.
    href (compact) : lien vers l'auto-école dans le classement du département.
    decl_href : lien vers le formulaire de déclaration de prix."""
    e = r["e"]
    ville = ville_affichee(e["ville"])
    labels = " ".join(e.get("labels") or [])
    q = norm(f'{e["nom"]} {ville} {e["cp"]} {e.get("adresse", "")}')
    attrs = (f' id="ae-{esc(e["id"])}" data-rang="{r["rang"]}" data-indice="{r["indice"]}"'
             f' data-taux="{e["taux"]}" data-cout="{"" if r["cout"] is None else r["cout"]}"'
             f' data-labels="{esc(labels)}" data-q="{esc(q)}"') if mode == "complet" else ""
    place = esc(ville) if mode == "compact" else esc((e.get("adresse") + ", ") if e.get("adresse") else "") + esc(ville)
    contact = "" if mode == "compact" else panneau_contact(e, decl_href)
    extra = ""
    if mode == "ville":
        extra = f'<p class="rank-deprank">{rang_txt(r["rang"])} sur {nb_dep} dans le {esc(code)}</p>'
    chip_html = "" if mode == "compact" else f'<p class="rank-chips">{chips(e)}</p>'
    n = e["presentes"]
    taux_note = (f"Seulement {plural(n, 'élève', 'élèves')}, taux ajusté" if n < SMALL_SAMPLE
                 else f"{plural(n, 'élève', 'élèves')} au 1er passage")
    if not avec_prix:
        cout_cell = ""
    elif r["cout"] is None:
        cout_cell = ('<div class="metric metric-cout"><span class="metric-label">Coût réel</span>'
                     '<span class="metric-value is-missing">Pas encore déclaré</span></div>')
    else:
        cout_cell = (f'<div class="metric metric-cout"><span class="metric-label">Coût réel</span>'
                     f'<span class="metric-value">{eur(r["cout"])}</span>'
                     f'<span class="metric-note">{plural(e["declarations"], "déclaration", "déclarations")}</span></div>')
    t = round(e["taux"] * 100)
    m = round(moyenne * 100)
    nom_html = f'<a class="rank-link" href="{href}">{esc(e["nom"])}</a>' if href else esc(e["nom"])
    return (
        f'<li class="rank-row{" is-first" if r["rang"] == 1 else ""}{"" if avec_prix else " no-cost"}"{attrs}>'
        f'<span class="rank-plate{" is-long" if r["rang"] >= 100 else ""}"><span class="visually-hidden">Rang </span>{r["rang"]}</span>'
        f'<div class="rank-main"><h3 class="rank-name">{nom_html}</h3>'
        f'<p class="rank-place">{place}</p>{extra}{chip_html}</div>'
        f'<div class="metric metric-taux"><span class="metric-label">Réussite</span>'
        f'<span class="metric-value">{pct(e["taux"])}</span>'
        f'<span class="bar" role="img" aria-label="{t} % de réussite, moyenne du département {m} %">'
        f'<span class="bar-fill" style="width:{t}%"></span><span class="bar-avg" style="left:calc({m}% - 1px)"></span></span>'
        f'<span class="metric-note">{taux_note}</span></div>'
        f'{cout_cell}'
        f'<div class="rank-score"><strong>{r["indice"]}</strong><span>sur 100</span></div>'
        f'{contact}'
        f'</li>'
    )


def fil_ariane(L, items, extra_class=""):
    """items : liste de (libellé, chemin ou None pour la page courante)."""
    parts = []
    for label, path in items:
        if path is None:
            parts.append(f'<li><span aria-current="page">{esc(label)}</span></li>')
        else:
            parts.append(f'<li><a href="{L(path)}">{esc(label)}</a></li>')
    cls = f"crumbs {extra_class}".strip()
    return f'<nav class="{cls}" aria-label="Fil d\'Ariane"><ol>{"".join(parts)}</ol></nav>'


def jsonld_ariane(items):
    return {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i, "name": label, "item": f"{SITE_URL}/{path}"}
            for i, (label, path) in enumerate(items, 1)
        ],
    }


def jsonld_liste(rows, nom_liste):
    items = []
    for r in rows[:50]:
        e = r["e"]
        school = {
            "@type": "DrivingSchool", "name": e["nom"],
            "address": {"@type": "PostalAddress", "streetAddress": e.get("adresse", ""),
                        "postalCode": e["cp"], "addressLocality": ville_affichee(e["ville"]), "addressCountry": "FR"},
        }
        if e.get("site"):
            school["url"] = e["site"]
        items.append({"@type": "ListItem", "position": r["rang"], "item": school})
    return {"@context": "https://schema.org", "@type": "ItemList", "name": nom_liste, "itemListElement": items}


def recherche(L, prefill=False):
    return f'''<form class="finder" action="{L("auto-ecoles/")}" method="get" role="search" data-finder>
      <label class="finder-label" for="finder-q">Où passes-tu ton permis ?</label>
      <div class="finder-row">
        <input id="finder-q" name="q" type="search" placeholder="Ville ou code postal" autocomplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="finder-list"{" data-prefill" if prefill else ""}>
        <button class="finder-btn" type="submit">Chercher</button>
      </div>
      <ul class="finder-list" id="finder-list" role="listbox" aria-label="Suggestions" hidden></ul>
      <p class="finder-msg" role="status"></p>
    </form>'''


def formulaire_prix(dep=None, ecoles=None, deps=None):
    """Formulaire de déclaration du prix réel. Sur une page département, la liste des auto-écoles est déjà là."""
    if dep:
        dep_field = f'<input type="hidden" name="departement" value="{esc(dep["code"])}">'
        opts = "".join(
            f'<option value="{esc(e["nom"])}, {esc(ville_affichee(e["ville"]))}" data-id="{esc(e["id"])}"></option>'
            for e in sorted(ecoles, key=lambda e: (e["nom"], e["ville"])))
        intro = f"Dis combien tu as vraiment payé dans ton auto-école en {esc(dep['nom'])}."
    else:
        options = "".join(f'<option value="{esc(d["code"])}">{esc(d["nom"])} ({esc(d["code"])})</option>' for d in deps)
        dep_field = (f'<div class="field field-wide"><label for="decl-dep">Département de ton auto-école</label>'
                     f'<select id="decl-dep" name="departement" required data-load-ecoles><option value="">Choisis</option>{options}</select></div>')
        opts = ""
        intro = "Dis combien tu as vraiment payé."
    return f'''<section class="block" id="declarer" aria-labelledby="contrib-title">
    <h2 id="contrib-title">Tu as passé ton permis récemment ?</h2>
    <p class="lede">{intro} Chaque réponse rend le classement plus juste pour les suivants. Ta réponse est anonyme.</p>
    <form class="form-grid" id="contrib-form" data-form-type="declaration">
      {dep_field}
      <div class="field field-wide"><label for="decl-ecole">Ton auto-école</label>
        <input id="decl-ecole" name="auto_ecole_nom" list="decl-ecoles" required autocomplete="off" maxlength="160" placeholder="Commence à taper son nom">
        <datalist id="decl-ecoles">{opts}</datalist>
        <input type="hidden" name="auto_ecole_id" value="">
      </div>
      <div class="field"><label for="decl-forfait">Prix du forfait (€)</label><input id="decl-forfait" name="forfait" type="number" inputmode="numeric" min="0" max="10000" required></div>
      <div class="field"><label for="decl-incluses">Heures incluses dans le forfait</label><input id="decl-incluses" name="heures_incluses" type="number" inputmode="numeric" min="0" max="200" required></div>
      <div class="field"><label for="decl-prix">Prix d'une heure en plus (€)</label><input id="decl-prix" name="prix_heure" type="number" inputmode="numeric" min="0" max="500" required></div>
      <div class="field"><label for="decl-heures">Heures faites au total</label><input id="decl-heures" name="heures_total" type="number" inputmode="numeric" min="0" max="300" required></div>
      <div class="field"><label for="decl-frais">Frais d'examen payés (€), si tu sais</label><input id="decl-frais" name="frais_examen" type="number" inputmode="numeric" min="0" max="1000"></div>
      <div class="field">
        <label for="decl-resultat">Ton résultat</label>
        <select id="decl-resultat" name="resultat" required>
          <option value="">Choisis une réponse</option>
          <option value="1er">Réussi du premier coup</option>
          <option value="2e">Réussi au deuxième passage</option>
          <option value="3e+">Réussi après trois passages ou plus</option>
          <option value="pas-encore">Pas encore réussi</option>
        </select>
      </div>
      <div class="form-actions field-wide">
        <button class="btn" type="submit">Envoyer ma réponse</button>
        <p class="form-status" role="status"></p>
      </div>
    </form>
  </section>'''


def dep_card(L, d):
    moy = f"{pct(d['moyenne'])} de réussite" if d.get("moyenne") is not None else "Pas de taux publié"
    return (f'<li><a href="{L(d["url"])}"><span class="dep-code">{esc(d["code"])}</span>'
            f'<span class="dep-name">{esc(d["nom"])}</span>'
            f'<span class="dep-meta">{plural(d["nb_taux"], "auto-école classée", "auto-écoles classées")}, {moy}</span></a></li>')


def poteau(L, villes, nom_dep):
    """Panneaux de direction vers les villes les plus fournies du département par défaut."""
    if not villes:
        return ""
    signs = "".join(
        f'<a class="post-sign {"post-right" if i % 2 == 0 else "post-left"}" style="grid-row:{i + 1}" href="{L(v["url"])}">'
        f'<span class="post-city">{esc(v["nom"])}</span>'
        f'<span class="post-count">{plural(len(v["ecoles"]), "auto-école", "auto-écoles")}</span></a>'
        for i, v in enumerate(villes))
    return (f'<nav class="post" aria-label="Villes avec le plus d\'auto-écoles en {esc(nom_dep)}">'
            f'<span class="post-pole" aria-hidden="true"></span>{signs}</nav>')


def loueurs_html(L, loueurs, dep=None):
    """Annuaire des loueurs. Chaque bouton (réserver, téléphone, message) est compté dans la table clics
    (cible loueur-<nom>-<bouton>) : c'est la preuve du nombre de clients envoyés à chaque loueur."""
    items = [l for l in loueurs if dep is None or l.get("dep") == dep]
    if not items:
        return ""
    items.sort(key=lambda l: (not l.get("partenaire"), l.get("dep", ""), l.get("nom", "")))
    out = []
    for l in items:
        cible = f'loueur-{slug(l.get("nom", "loueur"))}'
        nom = esc(l["nom"])
        lien = l.get("lien_reservation") or l.get("site")
        boutons = []
        if lien:
            type_ = "reserver" if l.get("lien_reservation") else "site"
            boutons.append(f'<a class="btn btn-small btn-signal" href="{esc(avec_utm(lien, "loueurs"))}" target="_blank" '
                           f'rel="noopener sponsored" data-clic="{cible}-{type_}">{"Réserver" if l.get("lien_reservation") else "Voir le site"}'
                           f'<span class="visually-hidden"> ({nom})</span></a>')
        lieu = {"nom": l["nom"], "adresse": l.get("adresse", ""), "cp": l.get("cp", ""), "ville": l.get("ville", "")}
        boutons.append(f'<a class="btn btn-small btn-ghost" href="{esc(lien_maps(lieu))}" target="_blank" rel="noopener" '
                       f'data-clic="{cible}-carte">Téléphone et itinéraire<span class="visually-hidden"> ({nom}, sur Google Maps)</span></a>')
        boutons.append(f'<button class="btn btn-small btn-ghost" type="button" data-message="loueur" data-clic="{cible}-message" hidden>'
                       f'Copier un message tout prêt</button>')
        if l.get("code_promo"):
            tip = (f'<p class="promo">Code Créno : <strong>{esc(l["code_promo"])}</strong>'
                   f'{(" : " + esc(l["reduction"])) if l.get("reduction") else ""}. Donne-le en réservant.</p>')
        else:
            tip = '<p class="rank-tip">Quand tu réserves, dis que tu viens de <strong>Créno</strong>.</p>'
        chip = ' <span class="chip chip-flag">Partenaire</span>' if l.get("partenaire") else ""
        prix = f'<span class="renter-price">{esc(l["prix"])}</span>' if l.get("prix") else ""
        out.append(f'<li class="renter"><div class="renter-head"><strong>{nom}</strong>{chip}'
                   f'<span>{esc(l["ville"])} ({esc(l["dep"])})</span>{prix}</div>'
                   f'<div class="rank-actions">{"".join(boutons)}</div>{tip}<p class="rank-msg" role="status" hidden></p></li>')
    return "".join(out)


def pros_html(L, pros):
    """Annuaire des moniteurs et auto-écoles vérifiés (data/pros.json)."""
    items = [p for p in pros if p.get("verifie", True)]
    if not items:
        return ('<p class="empty-state">L\'annuaire démarre : aucun pro vérifié pour l\'instant. '
                'Laisse ta demande ci-dessous, on te met en relation avec un pro de ton département.</p>')
    items.sort(key=lambda p: (p.get("dep", ""), p.get("ville", ""), p.get("nom", "")))
    out = []
    for p in items:
        offres = "".join(f'<span class="chip">{esc(o)}</span>' for o in p.get("offres", []))
        lien = (f'<a href="{esc(p["site"])}" target="_blank" rel="noopener nofollow" data-clic="pro-{esc(slug(p["nom"]))}">Contacter'
                f'<span class="visually-hidden"> {esc(p["nom"])}</span></a>') if p.get("site") else ""
        prix = f'<span>{esc(p["prix"])}</span>' if p.get("prix") else ""
        etab = f'<span>{esc(p["etablissement"])}</span>' if p.get("etablissement") else ""
        out.append(f'<li><strong>{esc(p["nom"])}</strong><span>{esc(p["ville"])} ({esc(p["dep"])})</span>{etab}'
                   f'<p class="rank-chips">{offres}</p>{prix}{lien}</li>')
    return f'<ul class="renters">{"".join(out)}</ul>'


def badge_svg(e, rang, nb, dep_nom, dep_code):
    """Badge à afficher sur le site d'une auto-école du top 10 de son département."""
    ligne1 = f"{rang_txt(rang)} sur {nb} en {dep_nom}"
    nom = e["nom"] if len(e["nom"]) <= 34 else e["nom"][:32] + "…"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="280" height="88" viewBox="0 0 280 88" role="img" aria-label="{esc(nom)} : {esc(ligne1)}, classement Créno">
  <rect x="1" y="1" width="278" height="86" rx="9" fill="#FFFFFF" stroke="#1A1F25" stroke-width="2"/>
  <rect x="226" y="1" width="53" height="86" rx="9" fill="#0A4F8F"/>
  <rect x="226" y="1" width="12" height="86" fill="#0A4F8F"/>
  <text x="252.5" y="52" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#FFFFFF">{esc(dep_code)}</text>
  <text x="16" y="27" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#55606B">{esc(nom)}</text>
  <text x="16" y="52" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" fill="#1A1F25">{esc(ligne1)}</text>
  <text x="16" y="73" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#55606B">Classement Créno, taux de réussite officiels</text>
</svg>
'''


# ---------------------------------------------------------------- gabarit
def page(L, path, kind, title, description, body, jsonld=None, section=None, dep_code=None, absolute_root=None, noindex=False):
    canonical = f"{SITE_URL}/{path}"
    root_attr = absolute_root if absolute_root is not None else L.root
    current = ' aria-current="page"'
    nav = "".join(
        f'<a href="{L(p)}"{current if section == key else ""}>{esc(label)}</a>'
        for p, label, key in NAV)
    ld = ""
    for block in (jsonld or []):
        ld += '<script type="application/ld+json">' + json.dumps(block, ensure_ascii=False).replace("</", "<\\/") + "</script>\n"
    verif = f'<meta name="google-site-verification" content="{esc(GSV)}">\n' if GSV else ""
    if noindex:
        verif += '<meta name="robots" content="noindex">\n'
    stats_js = '<script defer src="/_vercel/insights/script.js"></script>\n' if ANALYTICS and not L.explicit else ""
    footer = "".join(f'<a href="{L(p)}">{esc(label)}</a>' for p, label in FOOTER)
    return f'''<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(canonical)}">
{verif}<meta property="og:type" content="website">
<meta property="og:site_name" content="Créno">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:image" content="{esc(SITE_URL)}/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#2A2F35">
<link rel="icon" href="{root_attr}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Overpass:wght@500;700;800;900&display=swap">
<link rel="stylesheet" href="{root_attr}assets/style.css">
{ld}</head>
<body data-root="{root_attr}" data-page="{kind}"{f' data-dep="{esc(dep_code)}"' if dep_code else ""}{' data-links="explicit"' if L.explicit else ""}>
<a class="skip" href="#main">Aller au contenu</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="{L("")}" aria-label="Créno, accueil">
      <svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="5" fill="var(--signal)"/>
        <rect x="3.5" y="3.5" width="25" height="25" rx="3" fill="none" stroke="var(--signal-ink)" stroke-width="1.6"/>
        <path d="M11 25 L13.5 7 M21 25 L18.5 7" stroke="var(--signal-ink)" stroke-width="2" stroke-linecap="round"/>
        <path d="M16 23.5 V20.5 M16 16.5 V13.5 M16 9.8 V8" stroke="var(--chantier)" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="logo-word">créno</span>
    </a>
    <nav class="site-nav" aria-label="Sections">{nav}</nav>
  </div>
</header>
<main id="main" tabindex="-1">
{body}
</main>
<footer class="site-footer">
  <div class="wrap footer-row">
    <p><strong>Créno, le bon créneau pour ton permis.</strong> Projet indépendant, sans lien avec l'administration ni avec RdvPermis. Taux de réussite : Sécurité routière.</p>
    <nav aria-label="Pied de page">{footer}</nav>
  </div>
</footer>
<script src="{root_attr}assets/config.js"></script>
<script src="{root_attr}assets/app.js"></script>
{stats_js}</body>
</html>
'''


def fill(template, values):
    def rep(m):
        key = m.group(1)
        if key not in values:
            raise KeyError(f"Valeur manquante pour {{{{{key}}}}} dans un modèle")
        return str(values[key])
    return re.sub(r"\{\{(\w+)\}\}", rep, template)


# ---------------------------------------------------------------- construction
def build(out_dir=ROOT, explicit=False, only=None):
    """only : None (tout) ou ensemble de codes département à générer (aperçu)."""
    index = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
    loueurs = json.loads((DATA / "loueurs.json").read_text(encoding="utf-8")).get("loueurs", [])
    meta = index["meta"]
    deps = index["departements"]
    for d in deps:
        d["slug"] = f'{slug(d["nom"])}-{d["code"].lower()}'
        d["url"] = f'auto-ecoles/{d["slug"]}/'
    deps_by_code = {d["code"]: d for d in deps}
    date_import = date_fr(meta["importe_le"])
    common = {
        "nb_classees": fr_int(meta["nb_avec_taux"]),
        "nb_auto_ecoles": fr_int(meta["nb_auto_ecoles"]),
        "moyenne_nationale": pct(meta["moyenne_nationale"]),
        "date_import": date_import,
        "min_declarations": MIN_DECL,
    }

    if out_dir == ROOT:
        for d in GENERATED_DIRS:
            shutil.rmtree(ROOT / d, ignore_errors=True)

    pages = []          # (chemin, priorité)
    search_deps, search_villes = [], []   # index de recherche

    def write(path, content, priority=0.5, sitemap=True):
        target = out_dir / (path + "index.html" if path.endswith("/") or path == "" else path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        if sitemap and (path.endswith("/") or path == ""):
            pages.append((path, priority))

    options_deps = "".join(f'<option value="{esc(d["code"])}">{esc(d["nom"])} ({esc(d["code"])})</option>' for d in deps)
    stats = {"departements": 0, "villes": 0}
    badges = {"deps": {}, "top": {}}
    pros = json.loads((DATA / "pros.json").read_text(encoding="utf-8")).get("pros", []) if (DATA / "pros.json").exists() else []
    top_defaut = ""
    poteau_villes = []

    # --- départements et villes
    for d in deps:
        if only is not None and d["code"] not in only and d["code"] != DEP_DEFAUT:
            continue
        dep = json.loads((DATA / "departements" / f'{d["code"]}.json').read_text(encoding="utf-8"))
        res = classer(dep)
        rows = res["rows"]
        nb = len(rows)
        if not nb:
            continue
        search_deps.append([d["code"], d["nom"], d["url"], nb])
        if d["code"] == DEP_DEFAUT:
            LH = Links(depuis(""), explicit)
            top_defaut = "".join(ligne(r, res["moyenne"], "compact", avec_prix=res["avec_prix"],
                                       href=f'{LH(d["url"])}#ae-{esc(r["e"]["id"])}') for r in rows[:5])
        if only is not None and d["code"] not in only:
            continue
        stats["departements"] += 1
        badges["deps"][d["code"]] = d["url"]
        (out_dir / "badges").mkdir(exist_ok=True)
        for r in rows[:TOP_BADGE]:
            badges["top"][r["e"]["id"]] = [r["rang"], nb]
            (out_dir / "badges" / f'{r["e"]["id"]}.svg').write_text(
                badge_svg(r["e"], r["rang"], nb, d["nom"], d["code"]), encoding="utf-8")
        path = d["url"]
        L = Links(depuis(path), explicit)

        # villes du département
        villes = {}
        for e in dep["ecoles"]:
            villes.setdefault(e["ville"], []).append(e)
        rank_by_id = {r["e"]["id"]: r for r in rows}
        ville_pages = {}
        used = set()
        for v, ecoles in villes.items():
            classees = [rank_by_id[e["id"]] for e in ecoles if e["id"] in rank_by_id]
            cps = sorted({e["cp"] for e in ecoles})
            nom = ville_affichee(v)
            if len(ecoles) >= VILLE_MIN and classees:
                s = slug(nom)
                if s in used:
                    s = f"{s}-{cps[0]}"
                used.add(s)
                ville_pages[v] = {"nom": nom, "slug": s, "url": f'{path}{s}/', "ecoles": ecoles, "classees": classees, "cps": cps}
            # [nom, codes postaux, département, slug de la page ville ("" = pas de page : on filtre la page département), nb]
            search_villes.append([nom, " ".join(cps), d["code"], ville_pages[v]["slug"] if v in ville_pages else "", len(ecoles)])

        if d["code"] == DEP_DEFAUT:
            poteau_villes = sorted(ville_pages.values(), key=lambda x: (-len(x["ecoles"]), x["nom"]))[:4]

        # page département
        sans_taux = [e for e in dep["ecoles"] if "taux" not in e]
        crumbs = [("Accueil", ""), ("Auto-écoles", "auto-ecoles/"), (f'{d["nom"]} ({d["code"]})', None)]
        ville_links = "".join(
            f'<li><a href="{L(vp["url"])}">{esc(vp["nom"])}</a><span>{len(vp["ecoles"])}</span></li>'
            for vp in sorted(ville_pages.values(), key=lambda x: (-len(x["ecoles"]), x["nom"])))
        dep_options = "".join(
            f'<option value="{esc(x["url"])}"{" selected" if x["code"] == d["code"] else ""}>{esc(x["nom"])} ({esc(x["code"])})</option>'
            for x in deps if x["nb_taux"])
        price_note = (f'{plural(res["nb_prix"], "auto-école a", "auto-écoles ont")} des prix déclarés par les élèves dans ce département.'
                      if res["avec_prix"] else
                      "Aucun prix déclaré pour l'instant dans ce département : l'indice se base sur la réussite. Le coût réel apparaîtra avec les déclarations des élèves.")
        unranked = ""
        if sans_taux:
            items = "".join(f'<li data-q="{esc(norm(e["nom"] + " " + ville_affichee(e["ville"]) + " " + e["cp"]))}"><strong>{esc(e["nom"])}</strong><span>{esc(ville_affichee(e["ville"]))}</span></li>'
                            for e in sorted(sans_taux, key=lambda e: (e["ville"], e["nom"])))
            unranked = f'''<details class="disclose unranked" id="unranked">
      <summary>{plural(len(sans_taux), "auto-école", "auto-écoles")} sans taux de réussite publié</summary>
      <p class="small">Elles enseignent le permis B, mais n'ont pas encore de taux publié, souvent parce qu'elles sont récentes ou présentent peu d'élèves. Elles ne sont donc pas classées.</p>
      <ul class="unranked-list">{items}</ul>
    </details>'''
        villes_block = f'''<section class="block" aria-labelledby="villes-title">
    <h2 id="villes-title">Auto-écoles par ville en {esc(d["nom"])}</h2>
    <ul class="city-links">{ville_links}</ul>
  </section>''' if ville_links else ""
        title = f'Auto-écoles {d["nom"]} ({d["code"]}) : classement et taux de réussite | Créno'
        best = rows[0]["e"]
        description = (f'Compare les {nb} auto-écoles du {d["code"]} sur leur taux de réussite officiel au permis B. '
                       f'Réussite moyenne au 1er passage : {pct(res["moyenne"])}. N°1 : {best["nom"]} ({pct(best["taux"])}).')
        body = f'''<div class="wrap stack-lg page-pad">
  {fil_ariane(L, crumbs)}
  <header class="view-head">
    <h1>Auto-écoles en {esc(d["nom"])} ({esc(d["code"])})</h1>
    <p class="lede">Classement des {plural(nb, "auto-école", "auto-écoles")} du département qui ont un taux de réussite officiel au permis B. Réussite moyenne au 1er passage : {pct(res["moyenne"])}, contre {pct(meta["moyenne_nationale"])} en France.</p>
  </header>

  <form class="filters" id="filters" onsubmit="return false" data-js-only hidden>
    <div class="field field-search">
      <label for="f-search">Ville, code postal ou nom</label>
      <input id="f-search" type="search" placeholder="Ex. {esc(ville_affichee(rows[0]["e"]["ville"]))}" autocomplete="off">
    </div>
    <details class="more-filters" open>
      <summary>Plus de filtres</summary>
      <div class="more-grid">
        <div class="field">
          <label for="f-zone">Département</label>
          <select id="f-zone">{dep_options}</select>
        </div>
        <div class="field">
          <label for="f-budget">Budget maximum : <output id="f-budget-out" for="f-budget">pas de limite</output></label>
          <input id="f-budget" type="range" min="800" max="3000" step="50" value="3000">
        </div>
        <div class="field">
          <label for="f-sort">Trier par</label>
          <select id="f-sort">
            <option value="indice">Indice Créno</option>
            <option value="taux">Taux de réussite</option>
            <option value="cout">Coût réel le plus bas</option>
          </select>
        </div>
        <fieldset class="crit">
          <legend>Seulement les auto-écoles qui proposent</legend>
          <label class="check-inline" for="f-1euro"><input id="f-1euro" type="checkbox" data-label="permis1euro"> Le permis à 1 € par jour</label>
          <label class="check-inline" for="f-qualite"><input id="f-qualite" type="checkbox" data-label="qualite"> Le label qualité</label>
          <label class="check-inline" for="f-aac"><input id="f-aac" type="checkbox" data-label="aac"> La conduite accompagnée</label>
        </fieldset>
        <label class="check-inline crit-unknown" for="f-unknown">
          <input id="f-unknown" type="checkbox" checked>
          Garder les auto-écoles dont le prix n'est pas encore déclaré
        </label>
      </div>
    </details>
  </form>

  <div class="summary-block">
    <p class="zone-summary" id="zone-summary" aria-live="polite">{plural(nb, "auto-école classée", "auto-écoles classées")} dans le {esc(d["code"])}.</p>
    <p class="small">{price_note} Données de la Sécurité routière, fichier du {date_import}. <a href="{L("methode/")}">Comment on calcule l'indice</a></p>
    <p class="rank-hint">Touche une auto-école pour la contacter : téléphone, itinéraire ou message tout prêt.</p>
  </div>
  <ol class="ranking" id="ranking" data-dynamic>
    {"".join(ligne(r, res["moyenne"], "complet", avec_prix=res["avec_prix"]) for r in rows)}
  </ol>
  <p class="empty" id="ranking-empty" hidden>Aucune auto-école ne correspond. Retire un filtre ou monte ton budget.</p>
  <button class="btn btn-ghost" type="button" id="ranking-more" hidden>Afficher plus</button>
  {unranked}
  {villes_block}
  {formulaire_prix(d, dep["ecoles"])}
</div>'''
        jsonld = [jsonld_ariane([("Accueil", ""), ("Auto-écoles", "auto-ecoles/"), (f'{d["nom"]} ({d["code"]})', path)]),
                  jsonld_liste(rows, f'Auto-écoles en {d["nom"]} classées par Créno')]
        write(path, page(L, path, "departement", title, description, body, jsonld, "auto-ecoles", d["code"]),
              0.8 if d["code"] in IDF else 0.7)

        # pages ville
        autres = sorted(ville_pages.values(), key=lambda x: (-len(x["ecoles"]), x["nom"]))
        for v, vp in ville_pages.items():
            stats["villes"] += 1
            vpath = vp["url"]
            LV = Links(depuis(vpath), explicit)
            cl = sorted(vp["classees"], key=lambda r: r["rang"])
            n_ok = sum(r["e"]["presentes"] for r in cl)
            moy_v = sum(r["e"]["taux"] * r["e"]["presentes"] for r in cl) / n_ok
            sans = [e for e in vp["ecoles"] if e["id"] not in rank_by_id]
            cps = ", ".join(vp["cps"])
            vcrumbs = [("Accueil", ""), ("Auto-écoles", "auto-ecoles/"), (f'{d["nom"]} ({d["code"]})', path), (vp["nom"], None)]
            comp = "au-dessus de" if moy_v > res["moyenne"] + 0.005 else ("en dessous de" if moy_v < res["moyenne"] - 0.005 else "comme")
            sans_html = ""
            if sans:
                items = "".join(f'<li><strong>{esc(e["nom"])}</strong><span>{esc(e.get("adresse", ""))}</span></li>' for e in sans)
                sans_html = f'''<section class="block" aria-labelledby="sans-title">
    <h2 id="sans-title">Sans taux de réussite publié</h2>
    <p class="small">Ces auto-écoles enseignent le permis B à {esc(vp["nom"])}, mais n'ont pas encore de taux publié. Elles ne sont pas classées.</p>
    <ul class="unranked-list">{items}</ul>
  </section>'''
            others = "".join([f'<li><a href="{LV(o["url"])}">{esc(o["nom"])}</a><span>{len(o["ecoles"])}</span></li>'
                              for o in autres if o["url"] != vpath][:16])
            loc = loueurs_html(LV, loueurs, d["code"])
            loueurs_block = f'<ul class="renters">{loc}</ul>' if loc else ""
            vtitle = f'Auto-écoles à {vp["nom"]} ({vp["cps"][0]}) : taux de réussite et classement | Créno'
            best = cl[0]["e"]
            vdesc = (f'{plural(len(vp["ecoles"]), "auto-école enseigne", "auto-écoles enseignent")} le permis B à {vp["nom"]}. '
                     f'Réussite moyenne au 1er passage : {pct(moy_v)}. Meilleure : {best["nom"]} ({pct(best["taux"])}).')
            vbody = f'''<div class="wrap stack-lg page-pad">
  {fil_ariane(LV, vcrumbs)}
  <header class="view-head">
    <h1>Auto-écoles à {esc(vp["nom"])}</h1>
    <p class="lede">{plural(len(vp["ecoles"]), "auto-école enseigne", "auto-écoles enseignent")} le permis B à {esc(vp["nom"])} ({esc(cps)}). Réussite moyenne au 1er passage : {pct(moy_v)}, {comp} la moyenne du département ({pct(res["moyenne"])}).</p>
  </header>
  <p class="rank-hint">Touche une auto-école pour la contacter : téléphone, itinéraire ou message tout prêt.</p>
  <ol class="ranking ranking-city">
    {"".join(ligne(r, res["moyenne"], "ville", nb, d["code"], res["avec_prix"], decl_href=f'{LV(path)}?ae={esc(r["e"]["id"])}#declarer') for r in cl)}
  </ol>
  <p class="small">Le rang compare chaque auto-école à toutes celles du {esc(d["code"])}. Données de la Sécurité routière, fichier du {date_import}. <a href="{LV("methode/")}">Comment on calcule l'indice</a></p>
  {sans_html}
  <section class="block note-block" aria-labelledby="cl-title">
    <h2 id="cl-title">Passer le permis en candidat libre près de {esc(vp["nom"])}</h2>
    <p>Sans forfait : tu t'entraînes avec un proche, tu réserves toi-même ta date d'examen et tu loues une voiture à double commande pour le jour J.</p>
    {loueurs_block}
    <a class="link-strong" href="{LV("candidat-libre/")}">Comment passer le permis en candidat libre</a>
  </section>
  <section class="block" aria-labelledby="autres-title">
    <h2 id="autres-title">Autres villes en {esc(d["nom"])}</h2>
    <ul class="city-links">{others}</ul>
    <a class="link-strong" href="{LV(path)}">Tout le classement du {esc(d["code"])}</a>
  </section>
  <section class="block" aria-labelledby="decl-cta">
    <h2 id="decl-cta">Tu as passé ton permis à {esc(vp["nom"])} ?</h2>
    <p>Dis combien tu as vraiment payé : ça aide les prochains élèves à choisir.</p>
    <a class="btn" href="{LV(path)}#declarer">Déclarer mon prix</a>
  </section>
</div>'''
            vjsonld = [jsonld_ariane([("Accueil", ""), ("Auto-écoles", "auto-ecoles/"), (f'{d["nom"]} ({d["code"]})', path), (vp["nom"], vpath)]),
                       jsonld_liste(cl, f'Auto-écoles à {vp["nom"]}')]
            write(vpath, page(LV, vpath, "ville", vtitle, vdesc, vbody, vjsonld, "auto-ecoles", d["code"]),
                  0.6 if d["code"] in IDF else 0.5)

    # --- liste des départements
    path = "auto-ecoles/"
    L = Links(depuis(path), explicit)
    shown = [d for d in deps if d["nb_taux"]]
    body = f'''<div class="wrap stack-lg page-pad">
  {fil_ariane(L, [("Accueil", ""), ("Auto-écoles", None)])}
  <header class="view-head">
    <h1>Classement des auto-écoles par département</h1>
    <p class="lede">{common["nb_classees"]} auto-écoles ont un taux de réussite officiel au permis B. Choisis ton département ou cherche ta ville.</p>
  </header>
  <div class="finder-band">{recherche(L, prefill=True)}</div>
  <section class="block" aria-labelledby="idf2-title">
    <h2 id="idf2-title">Île-de-France</h2>
    <ul class="dep-grid">{"".join(dep_card(L, deps_by_code[c]) for c in IDF if c in deps_by_code)}</ul>
  </section>
  <section class="block" aria-labelledby="all-title">
    <h2 id="all-title">Tous les départements</h2>
    <ul class="dep-grid dep-grid-dense">{"".join(dep_card(L, d) for d in shown if d["code"] not in IDF)}</ul>
  </section>
</div>'''
    write(path, page(L, path, "departements", "Classement des auto-écoles par département | Créno",
                     f'Trouve la meilleure auto-école de ton département : {common["nb_classees"]} auto-écoles comparées sur leur taux de réussite officiel au permis B.',
                     body, [jsonld_ariane([("Accueil", ""), ("Auto-écoles", path)])], "auto-ecoles"), 0.9)

    # --- accueil
    L = Links("", explicit)
    dd = deps_by_code[DEP_DEFAUT]
    accueil = fill((TPL / "accueil.html").read_text(encoding="utf-8"), {
        **common, "root": L.root, "recherche": recherche(L), "top_defaut": top_defaut,
        "dep_defaut_nom": dd["nom"], "dep_defaut_url": dd["url"] + ("index.html" if explicit else ""),
        "dep_defaut_nb": fr_int(dd["nb_taux"]), "dep_defaut_moyenne": pct(dd["moyenne"]),
        "deps_idf": "".join(dep_card(L, deps_by_code[c]) for c in IDF if c in deps_by_code),
        "poteau": poteau(L, poteau_villes, dd["nom"]), "prix_pack": esc(PRIX_PACK),
    })
    if explicit:
        accueil = re.sub(r'href="((?:\.\./)*[a-z0-9\-/]*/)"', lambda m: f'href="{m.group(1)}index.html"', accueil)
    write("", page(L, "", "accueil", "Créno : compare les auto-écoles et le vrai prix du permis",
                   f'Taux de réussite officiels de {common["nb_classees"]} auto-écoles, coût réel du permis, conseils pour passer en candidat libre. Gratuit et indépendant.',
                   accueil, [{"@context": "https://schema.org", "@type": "WebSite", "name": "Créno", "url": SITE_URL + "/",
                              "inLanguage": "fr-FR"}]), 1.0)

    # --- pages fixes
    fixes = [
        ("candidat-libre/", "candidat-libre.html", "candidat-libre", "Passer le permis en candidat libre : étapes, voiture, date d'examen | Créno",
         "Comment passer le permis B en candidat libre : NEPH, RdvPermis, accompagnateur, location d'une voiture à double commande, délais d'annulation.",
         "Candidat libre", 0.8),
        ("cout-du-permis/", "cout-du-permis.html", "cout-du-permis", "Prix du permis de conduire : calcule le coût réel de ton devis | Créno",
         "Calcule ce que ton permis va vraiment coûter : forfait, heures en plus, frais d'examen. Compare avec ton budget.",
         "Coût du permis", 0.8),
        ("examen/", "examen.html", "examen", "Jour de l'examen du permis : la checklist du candidat libre | Créno",
         "Ce qu'il faut avoir le jour de l'examen pratique du permis B en candidat libre, quand arrive le résultat, et que faire en cas d'échec.",
         "Jour de l'examen", 0.6),
        ("methode/", "methode.html", None, "Méthode du classement des auto-écoles | Créno",
         "Comment Créno classe les auto-écoles : taux de réussite officiel au 1er passage, coût réel déclaré par les élèves, formule publique.",
         "Méthode", 0.4),
        ("confidentialite/", "confidentialite.html", None, "Confidentialité | Créno",
         "Ce que Créno garde quand tu remplis un formulaire, et pourquoi.", "Confidentialité", 0.2),
        ("alertes/", "alertes.html", "alertes", "Alertes places d'examen du permis, partagées par les candidats | Créno",
         "Sois prévenu par e-mail quand un candidat signale des places d'examen du permis dans ton département. Signale toi aussi les places que tu vois.",
         "Alertes places", 0.8),
        ("pack-candidat-libre/", "pack.html", "pack", "Pack candidat libre : le guide complet pour passer le permis sans auto-école | Créno",
         "Dossier, accompagnateur, voiture double commande, programme en 12 séances, examen blanc sur 31 points, jour J : tout le parcours du candidat libre.",
         "Pack candidat libre", 0.8),
        ("moniteurs/", "moniteurs.html", None, "Moniteur pour examen blanc ou présentation à l'examen du permis | Créno",
         "Faire appel à un moniteur dans les règles : examen blanc, heures à l'unité, présentation à l'examen par une auto-école agréée.",
         "Moniteurs", 0.6),
        ("pro/", "pro.html", None, "Créno pour les auto-écoles, moniteurs et loueurs | Créno",
         "Badge du top 10, demandes d'élèves, référencement des loueurs de voitures à double commande : ce que Créno apporte aux pros.",
         "Espace pros", 0.5),
        ("mentions-legales/", "mentions-legales.html", None, "Mentions légales | Créno",
         "Éditeur, hébergement et sources des données de Créno.", "Mentions légales", 0.1),
        ("cgv/", "cgv.html", None, "Conditions de vente | Créno",
         "Conditions de vente du Pack candidat libre et de l'abonnement aux Alertes.", "Conditions de vente", 0.1),
    ]
    etats = [
        ("alertes/confirmer/", "Confirmation de ton alerte", "confirmer", "Confirmation en cours…", "alertes/", "Revenir aux alertes"),
        ("alertes/merci/", "Merci pour ton paiement", "paiement", "Vérification du paiement…", "alertes/", "Revenir aux alertes"),
        ("alertes/desabonner/", "Arrêter les alertes", "desabonner", "Désabonnement en cours…", "alertes/", "Revenir aux alertes"),
        ("pack-candidat-libre/acces/", "Ton Pack candidat libre", "pack", "Vérification de ton achat…", "candidat-libre/", "Revenir au guide candidat libre"),
    ]
    contact_txt = (f'Écris à <a href="mailto:{esc(CONTACT)}">{esc(CONTACT)}</a>.' if CONTACT
                   else "L'adresse de contact sera indiquée ici dès l'ouverture des formulaires.")
    a_completer = '<span class="todo">à compléter</span>'
    ed = {k: (EDITEUR.get(k) or "").strip() for k in ("nom", "statut", "adresse", "siren", "directeur_publication")}
    editeur_html = (
        f'<p>Nom ou raison sociale : {esc(ed["nom"]) or a_completer}{(", " + esc(ed["statut"])) if ed["statut"] else ""}<br>'
        f'Adresse : {esc(ed["adresse"]) or a_completer}<br>'
        f'SIREN : {esc(ed["siren"]) or a_completer}<br>'
        f'Directeur de la publication : {esc(ed["directeur_publication"] or ed["nom"]) or a_completer}<br>'
        f'Contact : {(f"<a href=\"mailto:{esc(CONTACT)}\">{esc(CONTACT)}</a>") if CONTACT else a_completer}</p>')
    mediateur_html = (f"Médiateur de la consommation : {esc(MEDIATEUR)}." if MEDIATEUR
                      else f"Médiateur de la consommation : {a_completer}.")
    if ALERTES_PAYANTES:
        offre_alertes = (f"<strong>{ESSAI_ALERTES} jours gratuits</strong>, sans carte bancaire. Ensuite, si tu veux continuer : "
                         f"{esc(PRIX_ALERTES)} par mois, sans engagement.")
        bouton_alertes = f"Essayer {ESSAI_ALERTES} jours gratuits"
        faq_prix = (f'<details><summary>Combien ça coûte ?</summary><p>Les {ESSAI_ALERTES} premiers jours sont gratuits et tu ne donnes '
                    f'pas ta carte bancaire. Quelques jours avant la fin de l\'essai, tu reçois un e-mail : si tu veux continuer, '
                    f'tu t\'abonnes pour {esc(PRIX_ALERTES)} par mois sur la page sécurisée de Stripe. Sinon, tu ne fais rien : '
                    f'les alertes s\'arrêtent et rien n\'est prélevé.</p></details>'
                    f'<details><summary>Comment arrêter l\'abonnement ?</summary><p>En un clic, avec le lien « Ne plus recevoir '
                    f'd\'alertes » en bas de chaque e-mail. L\'abonnement s\'arrête tout de suite et tu n\'es plus prélevé. '
                    f'Aucun engagement de durée.</p></details>')
    else:
        offre_alertes = "Gratuit pendant le lancement. Tu confirmes ton e-mail en un clic."
        bouton_alertes = "Recevoir les alertes"
        faq_prix = ('<details><summary>C\'est gratuit ?</summary><p>Oui, pendant le lancement. '
                    f'Plus tard, les alertes coûteront {esc(PRIX_ALERTES)} par mois après {ESSAI_ALERTES} jours d\'essai gratuit, '
                    'sans engagement.</p></details>')
    for path, tpl, section, title, desc, crumb, prio in fixes:
        L = Links(depuis(path), explicit)
        body = fill((TPL / tpl).read_text(encoding="utf-8"), {
            **common, "root": L.root, "fil_ariane": fil_ariane(L, [("Accueil", ""), (crumb, None)]),
            "fil_ariane_clair": fil_ariane(L, [("Accueil", ""), (crumb, None)], "crumbs-dark"),
            "loueurs": loueurs_html(L, loueurs) or '<li><span>Aucun loueur pour l\'instant. Ajoute le premier ci-dessous.</span></li>',
            "options_departements": options_deps, "formulaire_prix": formulaire_prix(deps=deps), "contact": contact_txt,
            "prix_pack": esc(PRIX_PACK), "prix_alertes": esc(PRIX_ALERTES), "essai_alertes": ESSAI_ALERTES,
            "offre_alertes": offre_alertes, "bouton_alertes": bouton_alertes,
            "faq_prix": faq_prix,
            "pros": pros_html(L, pros), "editeur": editeur_html, "mediateur": mediateur_html,
            "nb_pages_villes": fr_int(stats["villes"]), "nb_pages_deps": fr_int(stats["departements"]),
        })
        if explicit:
            body = re.sub(r'href="((?:\.\./)*[a-z0-9\-/]*/)"', lambda m: f'href="{m.group(1)}index.html"', body)
        write(path, page(L, path, section or "autre", title, desc, body,
                         [jsonld_ariane([("Accueil", ""), (crumb, path)])], section), prio)

    # --- pages privées (pas dans Google) : continuer les alertes, tableau de bord, rapport envoyé aux pros
    prives = [
        ("alertes/continuer/", "alertes-continuer.html", "Continuer les alertes", "Continuer à recevoir les alertes places d'examen."),
        ("admin/", "admin.html", "Tableau de bord", "Tableau de bord de Créno."),
        ("rapport/", "rapport.html", "Rapport Créno", "Les élèves envoyés par Créno à votre établissement."),
    ]
    for path, tpl, titre, desc in prives:
        L = Links(depuis(path), explicit)
        body = fill((TPL / tpl).read_text(encoding="utf-8"), {
            **common, "root": L.root, "prix_alertes": esc(PRIX_ALERTES), "essai_alertes": ESSAI_ALERTES,
            "contact": contact_txt})
        write(path, page(L, path, "prive", f"{titre} | Créno", desc, body, noindex=True), sitemap=False)

    # --- pages de confirmation (alertes, accès au pack) : pas dans Google
    for path, titre, etat, attente, retour, retour_txt in etats:
        L = Links(depuis(path), explicit)
        body = fill((TPL / "etat.html").read_text(encoding="utf-8"), {
            "root": L.root, "titre": esc(titre), "etat": etat, "attente": esc(attente),
            "retour_url": retour + ("index.html" if explicit else ""), "retour_txt": esc(retour_txt)})
        write(path, page(L, path, "etat", f"{titre} | Créno", titre, body, noindex=True), sitemap=False)

    (out_dir / "data").mkdir(exist_ok=True)
    (out_dir / "data" / "badges.json").write_text(json.dumps(badges, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # --- page 404 (servie à n'importe quelle profondeur : liens absolus)
    base_path = re.sub(r"^https?://[^/]+", "", SITE_URL) + "/"
    L = Links(base_path, False)
    body404 = f'''<div class="wrap stack-lg page-pad">
  <header class="view-head">
    <h1>Cette page n'existe pas</h1>
    <p class="lede">Le lien est peut-être ancien. Cherche ta ville pour retrouver les auto-écoles près de chez toi.</p>
  </header>
  <div class="finder-band">{recherche(L)}</div>
  <a class="link-strong" href="{L("")}">Revenir à l'accueil</a>
</div>'''
    (out_dir / "404.html").write_text(
        page(L, "404.html", "autre", "Page introuvable | Créno", "Cette page n'existe pas.", body404, noindex=True), encoding="utf-8")

    # --- index de recherche, sitemap, robots
    search_villes.sort(key=lambda x: (-x[4], x[0]))
    (out_dir / "data").mkdir(exist_ok=True)
    (out_dir / "data" / "recherche.json").write_text(
        json.dumps({"d": search_deps, "v": search_villes}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    lastmod = meta["importe_le"]
    urls = "\n".join(
        f"  <url><loc>{html.escape(SITE_URL + '/' + p)}</loc><lastmod>{lastmod}</lastmod><priority>{prio:.1f}</priority></url>"
        for p, prio in sorted(pages, key=lambda x: (-x[1], x[0])))
    (out_dir / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}\n</urlset>\n',
        encoding="utf-8")
    (out_dir / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8")
    return stats, len(pages)


def main():
    stats, n = build()
    print(f"{n} pages générées : {stats['departements']} départements, {stats['villes']} villes, plus les pages fixes.")
    print(f"Adresse du site utilisée pour Google : {SITE_URL} (à changer dans site.json si besoin).")


if __name__ == "__main__":
    main()
