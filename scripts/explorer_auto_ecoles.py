#!/usr/bin/env python3
"""Explore les sites des auto-écoles de toute la France (lancé par GitHub Actions, pas par le site).

Deux étapes :

1. sites : trouve le site web de chaque auto-école.
   - colonne « site » du fichier officiel (déjà dans data/departements/) ;
   - sinon OpenStreetMap (objets amenity=driving_school avec un site web), relié à l'auto-école officielle
     seulement si le nom ET le lieu concordent (même code postal, même ville ou commune la plus proche).
   Résultat : data/sites_auto_ecoles.json (agrément -> site). Données © contributeurs OpenStreetMap, licence ODbL.

2. explorer : lit poliment chaque site (robots.txt respecté, 6 pages au plus, pages « tarifs / formations »
   en priorité) et cherche :
   - la passerelle boîte auto -> boîte manuelle (7 h) ;
   - une formation accélérée (stage intensif de conduite, pas un simple stage de code) ;
   - des extraits de texte avec des prix (forfait, heure de conduite...), À VÉRIFIER : jamais publiés tels quels.
   Résultat : data/explorations.json.

Le site (build_site.py) affiche ensuite le lien du site, et les étiquettes passerelle / formation accélérée
avec « relevé automatique » et le lien de la page où l'info a été vue. Les prix restent à vérifier (règle 3).

Seulement la bibliothèque standard de Python (3.12+). Usage :
    python3 scripts/explorer_auto_ecoles.py            # les deux étapes
    python3 scripts/explorer_auto_ecoles.py sites      # seulement les sites
    python3 scripts/explorer_auto_ecoles.py explorer   # seulement l'exploration
Variable MINUTES_MAX (défaut 150) : durée maximale de l'exploration ; le reste sera fait au prochain passage.
"""
from __future__ import annotations

import concurrent.futures as cf
import gzip
import html
import json
import math
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import urllib.robotparser
import zlib
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITES = DATA / "sites_auto_ecoles.json"
EXPLO = DATA / "explorations.json"
REGLES = 3  # à augmenter quand on change la détection : tout est relu au passage suivant
UA = "CrenoBot/1.0 (+https://www.xn--crnopermis-c7a.fr/methode/ ; classement des auto-ecoles)"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
COMMUNES = "https://geo.api.gouv.fr/communes?fields=nom,codesPostaux,centre,codeDepartement&format=json&geometry=centre"
# Réseaux sociaux, annuaires et cartes : ce ne sont pas les sites des auto-écoles.
# « nom. » : n'importe quelle terminaison (facebook.com, facebook.fr...) ; sinon le domaine exact et ses sous-domaines.
DOMAINES_EXCLUS = ("facebook.", "fb.com", "fb.me", "instagram.", "tiktok.", "twitter.", "x.com", "linkedin.",
                   "youtube.", "youtu.be", "pagesjaunes.", "vroomvroom.", "mappy.", "yelp.", "google.", "goo.gl",
                   "linktr.ee", "waze.", "tripadvisor.", "118000.", "118712.", "cylex.", "cylex-locale.",
                   "societe.com", "pappers.", "justacote.", "hoodspot.", "lepetitpermis.")


def domaine_exclu(host: str) -> bool:
    for d in DOMAINES_EXCLUS:
        if d.endswith("."):
            if re.search(r"(^|\.)" + re.escape(d), host):
                return True
        elif host == d or host.endswith("." + d):
            return True
    return "annuaire" in host
MOTS_VIDES = {"auto", "autos", "moto", "motos", "ecole", "ecoles", "autoecole", "de", "la", "le", "les", "du", "des",
              "l", "d", "et", "sarl", "sas", "eurl", "sasu", "en", "a", "au", "aux", "driving", "school",
              "the", "e"}


# ---------------------------------------------------------------- outils texte
def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = re.sub(r"\bst\b", "saint", s)
    s = re.sub(r"\bste\b", "sainte", s)
    return s


def mots(nom: str | None) -> set[str]:
    return {m for m in norm(nom).split() if m not in MOTS_VIDES and (len(m) > 1 or m.isdigit())}


def ressemblance(a: str | None, b: str | None) -> float:
    ma, mb = mots(a), mots(b)
    if not ma or not mb:
        return 0.0
    jac = len(ma & mb) / len(ma | mb)
    seq = SequenceMatcher(None, " ".join(sorted(ma)), " ".join(sorted(mb))).ratio()
    return max(jac, seq * 0.9)


def site_propre(url: str | None) -> str:
    """Première adresse d'un champ OSM, avec https:// ; vide si c'est un réseau social ou un annuaire."""
    url = (url or "").strip().split(";")[0].split(" ")[0].strip()
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url.lstrip("/")
    try:
        p = urllib.parse.urlsplit(url)
    except ValueError:
        return ""
    host = (p.hostname or "").lower()
    if not host or "." not in host or domaine_exclu(host):
        return ""
    return urllib.parse.urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path or "/", p.query, ""))


ABREV_RUE = {"av": "avenue", "ave": "avenue", "bd": "boulevard", "bld": "boulevard", "boul": "boulevard", "r": "rue",
             "pl": "place", "rte": "route", "che": "chemin", "chem": "chemin", "all": "allee", "imp": "impasse",
             "fbg": "faubourg", "sq": "square", "crs": "cours", "qu": "quai", "res": "residence", "cc": "centre commercial",
             "gal": "general", "gen": "general", "mal": "marechal", "pdt": "president", "pres": "president"}
MOTS_RUE_VIDES = {"de", "du", "des", "la", "le", "les", "l", "d", "et", "a", "au", "aux"}


def rue_norm(rue: str | None) -> str:
    mots_ = [ABREV_RUE.get(m, m) for m in norm(rue).split()]
    return " ".join(m for m in mots_ if m not in MOTS_RUE_VIDES)


def adresse_cle(adresse: str | None) -> tuple[str, str]:
    """« 135 Avenue de la République » -> ("135", "avenue republique") ; numéro vide s'il n'y en a pas."""
    a = norm(adresse)
    m = re.match(r"^(\d+)\s*(?:bis|ter|quater|[a-dt])?\b\s*(.*)$", a)
    if not m:
        return "", rue_norm(a)
    reste = re.sub(r"^\d+\s*(?:bis|ter)?\s*", "", m.group(2))  # « 84-86 rue … » -> « rue … »
    return m.group(1), rue_norm(reste)


def memes_rues(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b or (len(a) > 8 and a in b) or (len(b) > 8 and b in a):
        return True
    return SequenceMatcher(None, a, b).ratio() >= 0.88


def distance_km(a, b) -> float:
    (la1, lo1), (la2, lo2) = a, b
    x = math.radians(lo2 - lo1) * math.cos(math.radians((la1 + la2) / 2))
    y = math.radians(la2 - la1)
    return 6371 * math.hypot(x, y)


# ---------------------------------------------------------------- réseau
def lire(url: str, timeout: int = 20, maxi: int = 1_500_000, data: bytes | None = None) -> tuple[str, str]:
    """Télécharge une page : (adresse finale, texte). Lève une exception en cas d'erreur."""
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
        "Accept-Language": "fr-FR,fr;q=0.9", "Accept-Encoding": "gzip, deflate"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        brut = r.read(maxi)
        enc = (r.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip":
            brut = gzip.decompress(brut)
        elif enc == "deflate":
            brut = zlib.decompress(brut)
        ctype = r.headers.get("Content-Type") or ""
        jeu = r.headers.get_content_charset()
        if not jeu:
            m = re.search(rb'charset=["\']?([A-Za-z0-9_-]+)', brut[:3000])
            jeu = m.group(1).decode() if m else "utf-8"
        try:
            texte = brut.decode(jeu, errors="replace")
        except LookupError:
            texte = brut.decode("utf-8", errors="replace")
        if ctype and not any(t in ctype for t in ("html", "json", "text")):
            raise ValueError(f"pas une page web ({ctype})")
        return r.geturl(), texte


# ---------------------------------------------------------------- étape 1 : sites
def charger_officiel() -> dict[str, dict]:
    ecoles = {}
    for f in sorted((DATA / "departements").glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for e in d.get("ecoles") or []:
            e["dep"] = d["code"]
            ecoles[e["id"]] = e
    return ecoles


def requete_osm() -> list[dict]:
    q = ('[out:json][timeout:300];area["ISO3166-1"="FR"][admin_level=2]->.fr;'
         '(nwr["amenity"="driving_school"](area.fr););out center tags;')
    for essai in range(3):
        for url in OVERPASS:
            try:
                _, texte = lire(url, timeout=360, maxi=200_000_000, data=urllib.parse.urlencode({"data": q}).encode())
                return json.loads(texte).get("elements") or []
            except Exception as err:  # serveur occupé : on essaie le suivant, puis on attend un peu
                print(f"OpenStreetMap ({url}, essai {essai + 1}) : {err}", file=sys.stderr)
        time.sleep(60)
    raise RuntimeError("OpenStreetMap ne répond pas")


def charger_communes() -> list[dict]:
    _, texte = lire(COMMUNES, timeout=120, maxi=100_000_000)
    out = []
    for c in json.loads(texte):
        centre = (c.get("centre") or {}).get("coordinates")
        if centre:
            out.append({"nom": norm(c["nom"]), "cps": c.get("codesPostaux") or [], "dep": c.get("codeDepartement"),
                        "pos": (centre[1], centre[0])})
    return out


class Grille:
    """Communes rangées par cases de 0,1° pour trouver vite les plus proches d'un point."""
    def __init__(self, communes):
        self.cases: dict[tuple[int, int], list[dict]] = {}
        for c in communes:
            self.cases.setdefault(self.case(c["pos"]), []).append(c)

    @staticmethod
    def case(pos):
        return int(math.floor(pos[0] * 10)), int(math.floor(pos[1] * 10))

    def proches(self, pos, n=4):
        ci, cj = self.case(pos)
        cand = [c for di in (-1, 0, 1) for dj in (-1, 0, 1) for c in self.cases.get((ci + di, cj + dj), [])]
        return sorted(cand, key=lambda c: distance_km(pos, c["pos"]))[:n]


def etape_sites() -> dict:
    try:
        return chercher_sites()
    except Exception as err:
        # OpenStreetMap en panne : on garde les sites du passage précédent et on continue l'exploration.
        if SITES.exists():
            print(f"::warning::Sites non mis à jour ({err}) : on garde ceux du passage précédent.")
            return json.loads(SITES.read_text(encoding="utf-8"))
        raise SystemExit(f"OpenStreetMap ne répond pas ({err}) : réessaie plus tard (Run workflow).")


def chercher_sites() -> dict:
    officiel = charger_officiel()
    par_cp: dict[str, list[str]] = {}
    par_ville: dict[str, list[str]] = {}
    for eid, e in officiel.items():
        par_cp.setdefault(e.get("cp") or "", []).append(eid)
        par_ville.setdefault(norm(e.get("ville")), []).append(eid)

    elements = requete_osm()
    grille = Grille(charger_communes())
    print(f"OpenStreetMap : {len(elements)} auto-écoles, dont "
          f"{sum(1 for x in elements if (x.get('tags') or {}).get('website') or (x.get('tags') or {}).get('contact:website'))} avec un site.")

    meilleurs: dict[str, tuple[float, str, str]] = {}
    compte_domaines: dict[str, int] = {}
    for el in elements:
        t = el.get("tags") or {}
        st = site_propre(t.get("website") or t.get("contact:website") or t.get("url"))
        if st:
            d = (urllib.parse.urlsplit(st).hostname or "").removeprefix("www.")
            compte_domaines[d] = compte_domaines.get(d, 0) + 1
    for el in elements:
        t = el.get("tags") or {}
        site = site_propre(t.get("website") or t.get("contact:website") or t.get("url"))
        nom = t.get("name") or t.get("brand") or ""
        if not site or not nom:
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        cands: set[str] = set(par_cp.get(t.get("addr:postcode") or "", []))
        cands |= set(par_ville.get(norm(t.get("addr:city")), []))
        if lat is not None and lon is not None:
            for c in grille.proches((lat, lon)):
                cands |= set(par_ville.get(c["nom"], []))
                for cp in c["cps"]:
                    cands |= set(par_cp.get(cp, []))
        rue = norm(t.get("addr:street"))
        num_osm = (re.match(r"\d+", (t.get("addr:housenumber") or "").strip()) or [""])[0]
        rue_osm = rue_norm(t.get("addr:street"))
        notes = []
        meme_adresse = []
        for eid in cands:
            e = officiel[eid]
            s = ressemblance(nom, e["nom"])
            if rue and len(rue) > 5 and rue in norm(e.get("adresse")):
                s += 0.2  # même rue : forte présomption
            notes.append((s, eid))
            num_e, rue_e = adresse_cle(e.get("adresse"))
            if num_osm and num_e == num_osm and memes_rues(rue_osm, rue_e):
                meme_adresse.append((s, eid))
        if not notes:
            continue
        notes.sort(reverse=True)
        best, eid = notes[0]
        second = notes[1][0] if len(notes) > 1 else 0.0
        # Seuils stricts : mieux vaut pas de lien qu'un lien vers la mauvaise auto-école.
        if best >= 0.75 and best - second >= 0.15:
            if eid not in meilleurs or best > meilleurs[eid][0]:
                meilleurs[eid] = (round(best, 2), site, nom)
            continue
        # Même numéro et même rue qu'UNE seule auto-école officielle : c'est elle, même si le nom diffère
        # (enseigne commerciale ≠ nom officiel). Plusieurs à la même adresse : il faut aussi que le nom concorde.
        # Les domaines de réseaux (Stych, ECF…) sont écartés ici : un point de rendez-vous n'est pas l'agence.
        domaine_osm = (urllib.parse.urlsplit(site).hostname or "").removeprefix("www.")
        if meme_adresse and compte_domaines.get(domaine_osm, 0) < 3:
            meme_adresse.sort(reverse=True)
            b_s, b_eid = meme_adresse[0]
            s2 = meme_adresse[1][0] if len(meme_adresse) > 1 else -1.0
            if len(meme_adresse) == 1 or (b_s >= 0.5 and b_s - s2 >= 0.15):
                note = round(max(0.7, b_s), 2)
                if b_eid not in meilleurs or note > meilleurs[b_eid][0]:
                    meilleurs[b_eid] = (note, site, nom)

    ecoles = {}
    for eid, e in officiel.items():
        if e.get("site"):
            ecoles[eid] = {"site": e["site"], "source": "officiel"}
        elif eid in meilleurs:
            note, site, nom = meilleurs[eid]
            ecoles[eid] = {"site": site, "source": "osm", "nom_osm": nom, "note": note}
    sortie = {
        "meta": {
            "description": "Site web de chaque auto-école, par numéro d'agrément. Source : colonne site du fichier "
                           "officiel de la Sécurité routière, sinon OpenStreetMap (nom et lieu concordants). "
                           "Généré par scripts/explorer_auto_ecoles.py, ne pas modifier à la main : pour corriger "
                           "un site, mets-le dans data/tarifs.json (champ site), il passe en priorité.",
            "licence": "Sites issus d'OpenStreetMap : © contributeurs OpenStreetMap, licence ODbL (openstreetmap.org/copyright).",
            "mis_a_jour": date.today().isoformat(),
            "nb_officiel": sum(1 for v in ecoles.values() if v["source"] == "officiel"),
            "nb_osm": sum(1 for v in ecoles.values() if v["source"] == "osm"),
        },
        "ecoles": dict(sorted(ecoles.items())),
    }
    SITES.write_text(json.dumps(sortie, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Sites : {sortie['meta']['nb_officiel']} du fichier officiel + {sortie['meta']['nb_osm']} d'OpenStreetMap.")
    return sortie


# ---------------------------------------------------------------- étape 2 : explorer
class Lecteur(HTMLParser):
    """Texte visible et liens d'une page."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.morceaux: list[str] = []
        self.liens: list[tuple[str, str]] = []
        self._cache = 0
        self._lien: str | None = None
        self._texte_lien: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg", "template"):
            self._cache += 1
        elif tag == "a":
            self._lien = dict(attrs).get("href")
            self._texte_lien = []
        if tag in ("p", "div", "li", "br", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "section", "article"):
            self.morceaux.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg", "template") and self._cache:
            self._cache -= 1
        elif tag == "a" and self._lien is not None:
            self.liens.append((self._lien, " ".join(self._texte_lien)))
            self._lien = None

    def handle_data(self, data):
        if self._cache:
            return
        self.morceaux.append(data)
        if self._lien is not None:
            self._texte_lien.append(data)

    def texte(self) -> str:
        t = html.unescape("".join(self.morceaux))
        t = re.sub(r"[ \t\r\f\v  ]+", " ", t)
        return re.sub(r"\n\s*\n+", "\n", t).strip()


RE_PAGE_UTILE = re.compile(r"tarif|prix|forfait|formule|formation|passerelle|accel|intensif|b78|bea|boite|automatique|permis-b|permis_b|offre", re.I)
RE_PASSERELLE = re.compile(
    r"passerelle.{0,80}?(boite auto|boite automatique|\bbea\b|\bbva\b|\bb ?78\b|automatique)"
    r"|(boite auto(matique)?|\bbea\b|\bbva\b|\bb ?78\b).{0,40}?\b(vers|a)\b\s+(la\s+|une\s+)?boite (manuelle|mecanique)")
RE_ACCELERE = re.compile(
    r"\b(formations?|stages?|permis(\s+(b|auto|voiture))?|formules?|forfaits?|conduite|cursus|apprentissage)\s+(en\s+)?"
    r"(accelere|acceleree|acceleres|accelerees|intensif|intensive|intensifs|intensives)\b"
    r"|\b(accelere|acceleree|intensif|intensive)s?\s+(du\s+|de\s+)?(permis|conduite)\b")
RE_PRIX = re.compile(r"\d\s*(€|euros?\b|eur\b|e ttc\b)|€\s*\d")
RE_PRIX_CONTEXTE = re.compile(r"forfait|20 ?h\b|20 heures|13 ?h\b|13 heures|heure de conduite|heures de conduite|lecon|evaluation|code|accompagnement|examen|aac|supervisee|passerelle")


def extrait(texte: str, debut: int, fin: int, marge: int = 70) -> str:
    a, b = max(0, debut - marge), min(len(texte), fin + marge)
    return re.sub(r"\s+", " ", texte[a:b]).strip()


def chercher(texte_page: str) -> dict:
    """Passerelle, formation accélérée et extraits de prix dans le texte d'une page."""
    t = norm_garde_lignes(texte_page)
    out: dict = {}
    for m in RE_PASSERELLE.finditer(t):
        ex = extrait(t, m.start(), m.end())
        if re.search(r"\ba2\b|\bmoto|\bscooter|125", ex):
            continue  # passerelle moto A2 -> A : ce n'est pas celle-là
        out["passerelle"] = ex
        break
    for m in RE_ACCELERE.finditer(t):
        autour = t[max(0, m.start() - 20): m.end() + 25]
        large = t[max(0, m.start() - 70): m.end() + 55]
        if re.search(r"\bpas de (formation|stage)|\bne propos", autour):
            continue  # « pas de formation accélérée »
        if re.search(r"trustindex|publie sur google|avis google|je recommande", large):
            continue  # avis d'un élève (widget Google) : pas une offre de l'auto-école
        if re.match(r"\s*certaines (auto-?)?ecoles", t[m.end(): m.end() + 30]):
            continue  # article de blog sur les permis accélérés en général
        if re.match(r"accel|intensi", m.group(0)):
            # « code accéléré » suivi du menu « permis … » : c'est le code, pas la conduite.
            if re.search(r"\bcode\b", t[max(0, m.start() - 15): m.start()]):
                continue
            if re.match(r"\s*(am|a|a1|a2|moto|bsr|bateau|cotier)\b", t[m.end(): m.end() + 8]):
                continue  # « accéléré permis AM / moto » : pas le permis B
        # « permis / conduite accéléré(e) » : c'est bien la conduite. « Formation / stage accéléré » près du mot
        # code (ou cours en salle) : c'est le code, pas une formation accélérée de conduite.
        if not re.search(r"permis|conduite", m.group(0)) and re.search(r"\bcode\b|en salle|theorique|\betg\b", large):
            continue
        out["accelere"] = extrait(t, m.start(), m.end())
        break
    prix = []
    lignes = [l.strip() for l in t.split("\n") if l.strip()]
    for i, ligne in enumerate(lignes):
        if len(prix) >= 12:
            break
        if not RE_PRIX.search(ligne):
            continue
        # Le nom de la formule est souvent sur la ligne d'avant (titre puis prix dans deux blocs).
        avec_titre = ligne if RE_PRIX_CONTEXTE.search(ligne) or i == 0 else lignes[i - 1][-120:] + " : " + ligne
        if RE_PRIX_CONTEXTE.search(avec_titre) and avec_titre[:220] not in prix:
            prix.append(avec_titre[:220])
    if prix:
        out["prix"] = prix
    return out


def norm_garde_lignes(s: str) -> str:
    """Comme norm(), mais garde les retours à la ligne et les symboles € pour les extraits."""
    s = "".join(c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c)).lower()
    s = s.replace("→", " vers ").replace("->", " vers ").replace("’", "'")
    s = re.sub(r"[^a-z0-9€\n,.:/'()+%-]+", " ", s)
    return re.sub(r" +", " ", s)


_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_robots_lock = threading.Lock()


def autorise(url: str) -> bool:
    p = urllib.parse.urlsplit(url)
    base = f"{p.scheme}://{p.netloc}"
    with _robots_lock:
        rp = _robots.get(base, False)
    if rp is False:
        rp = urllib.robotparser.RobotFileParser()
        try:
            _, texte = lire(base + "/robots.txt", timeout=10, maxi=300_000)
            rp.parse(texte.splitlines())
        except Exception:
            rp = None  # pas de robots.txt lisible : tout est permis
        with _robots_lock:
            _robots[base] = rp
    return rp is None or rp.can_fetch(UA, url)


def explorer_une(eid: str, site: str, reseau: bool = False) -> dict:
    """reseau=True : site partagé par plusieurs auto-écoles (ECF, Codes Rousseau, Stych...). Le texte des pages
    (menus nationaux) ne compte pas : seulement les liens vers les formations de CETTE agence."""
    res: dict = {"site": site, "date": date.today().isoformat(), "pages": [], "regles": REGLES}
    prefixe = urllib.parse.urlsplit(site).path.rstrip("/")
    if reseau and not prefixe:
        res["reseau"] = True  # page commune à tout le réseau : rien de propre à cette agence
        return res
    try:
        if not autorise(site):
            res["erreur"] = "robots.txt refuse la lecture"
            return res
        adresse, page = lire(site)
    except Exception as err:
        res["erreur"] = str(err)[:160]
        return res
    hote = urllib.parse.urlsplit(adresse).netloc.lower().removeprefix("www.")
    a_lire = [(adresse, page)]
    lecteur = Lecteur()
    try:
        lecteur.feed(page)
    except Exception:
        pass
    vus = {adresse.rstrip("/")}
    suivants = []
    for href, txt in lecteur.liens:
        if not href or href.startswith(("mailto:", "tel:", "#", "javascript:")):
            continue
        url = urllib.parse.urljoin(adresse, href).split("#")[0]
        if urllib.parse.urlsplit(url).netloc.lower().removeprefix("www.") != hote:
            continue
        if url.rstrip("/") in vus or re.search(r"\.(pdf|jpe?g|png|gif|webp|zip|docx?)$", url, re.I):
            continue
        if reseau:
            chemin = urllib.parse.urlsplit(url).path
            if not chemin.startswith(prefixe + "/"):
                continue  # page d'une autre agence ou du réseau
            for cle, motif in (("passerelle", r"passerelle"), ("accelere", r"accel|intensif")):
                if re.search(motif, chemin, re.I) and cle not in res:
                    res[cle] = {"extrait": f"formation « {norm(txt) or chemin} » sur la page de l'agence", "page": url}
        if RE_PAGE_UTILE.search(url) or RE_PAGE_UTILE.search(norm(txt)):
            score = 2 if re.search(r"tarif|prix|forfait", url + " " + norm(txt), re.I) else 1
            suivants.append((score, url))
            vus.add(url.rstrip("/"))
    for _, url in sorted(suivants, key=lambda x: -x[0])[:5]:
        time.sleep(0.6)  # poli avec les petits serveurs
        try:
            if autorise(url):
                a_lire.append(lire(url))
        except Exception:
            continue
    for url, contenu in a_lire:
        lec = Lecteur()
        try:
            lec.feed(contenu)
        except Exception:
            continue
        trouve = chercher(lec.texte())
        res["pages"].append(url)
        if reseau:
            trouve.pop("passerelle", None)
            trouve.pop("accelere", None)
        for cle in ("passerelle", "accelere"):
            if cle in trouve and cle not in res:
                res[cle] = {"extrait": trouve[cle], "page": url}
        if trouve.get("prix"):
            res.setdefault("prix", []).extend({"extrait": x, "page": url} for x in trouve["prix"])
    if res.get("prix"):
        res["prix"] = res["prix"][:20]
    return res


def etape_explorer(minutes_max: float) -> dict:
    sites = (json.loads(SITES.read_text(encoding="utf-8")).get("ecoles") or {}) if SITES.exists() else {}
    tarifs = (json.loads((DATA / "tarifs.json").read_text(encoding="utf-8")).get("ecoles") or {})
    for eid, t in tarifs.items():  # un site corrigé à la main passe en priorité
        if t.get("site"):
            sites[eid] = {"site": t["site"], "source": "tarifs"}
    ancien = (json.loads(EXPLO.read_text(encoding="utf-8")).get("ecoles") or {}) if EXPLO.exists() else {}
    # D'abord les auto-écoles jamais lues, puis les plus anciennes ; un site qui a changé est relu.
    ordre = sorted(sites, key=lambda k: ((ancien.get(k) or {}).get("site") == sites[k]["site"]
                                         and (ancien.get(k) or {}).get("regles") == REGLES,
                                         (ancien.get(k) or {}).get("date", "")))
    # Un même domaine pour au moins 3 auto-écoles = site de réseau (menus communs) : voir explorer_une.
    par_domaine: dict[str, int] = {}
    for v in sites.values():
        d = (urllib.parse.urlsplit(v["site"]).hostname or "").removeprefix("www.")
        par_domaine[d] = par_domaine.get(d, 0) + 1
    def est_reseau(url):
        return par_domaine.get((urllib.parse.urlsplit(url).hostname or "").removeprefix("www."), 0) >= 3
    fin = time.monotonic() + minutes_max * 60
    resultats = {k: v for k, v in ancien.items()
                 if k in sites and v.get("site") == sites[k]["site"] and v.get("regles") == REGLES}
    faits = 0
    with cf.ThreadPoolExecutor(max_workers=16) as pool:
        en_cours = {}
        it = iter(ordre)
        def lancer():
            for eid in it:
                if time.monotonic() > fin:
                    return
                en_cours[pool.submit(explorer_une, eid, sites[eid]["site"], est_reseau(sites[eid]["site"]))] = eid
                return
        for _ in range(32):
            lancer()
        while en_cours:
            termine, _ = cf.wait(list(en_cours), return_when=cf.FIRST_COMPLETED)
            for fut in termine:
                eid = en_cours.pop(fut)
                try:
                    resultats[eid] = fut.result()
                except Exception as err:
                    resultats[eid] = {"site": sites[eid]["site"], "date": date.today().isoformat(), "erreur": str(err)[:160]}
                faits += 1
                if faits % 200 == 0:
                    print(f"{faits} sites lus…", flush=True)
                lancer()
    sortie = {
        "meta": {
            "description": "Ce que le robot a vu sur le site de chaque auto-école (scripts/explorer_auto_ecoles.py). "
                           "passerelle et accelere sont affichés avec « relevé automatique » et le lien de la page ; "
                           "les extraits de prix sont À VÉRIFIER, jamais affichés tels quels.",
            "mis_a_jour": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "lus_ce_passage": faits,
            "nb_sites": len(sites),
            "nb_lus": sum(1 for v in resultats.values() if not v.get("erreur")),
            "nb_passerelle": sum(1 for v in resultats.values() if v.get("passerelle")),
            "nb_accelere": sum(1 for v in resultats.values() if v.get("accelere")),
            "nb_avec_prix": sum(1 for v in resultats.values() if v.get("prix")),
        },
        "ecoles": dict(sorted(resultats.items())),
    }
    EXPLO.write_text(json.dumps(sortie, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return sortie


def resume(sites: dict | None, explo: dict | None):
    """Résumé lisible sur la page Summary de GitHub Actions."""
    lignes = ["### Robot des auto-écoles"]
    if sites:
        m = sites["meta"]
        lignes.append(f"- Sites trouvés : **{m['nb_officiel'] + m['nb_osm']}** "
                      f"({m['nb_officiel']} du fichier officiel, {m['nb_osm']} d'OpenStreetMap)")
    if explo:
        m = explo["meta"]
        lignes += [f"- Sites lus ce passage : {m['lus_ce_passage']} (lisibles en tout : {m['nb_lus']} sur {m['nb_sites']})",
                   f"- Passerelle boîte auto → manuelle : **{m['nb_passerelle']}**",
                   f"- Formation accélérée : **{m['nb_accelere']}**",
                   f"- Auto-écoles avec des prix à vérifier : **{m['nb_avec_prix']}**"]
    texte = "\n".join(lignes) + "\n"
    print(texte)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(texte)


def main():
    etape = sys.argv[1] if len(sys.argv) > 1 else "tout"
    sites = explo = None
    if etape in ("tout", "sites"):
        sites = etape_sites()
    if etape in ("tout", "explorer"):
        explo = etape_explorer(float(os.environ.get("MINUTES_MAX", "150")))
    resume(sites, explo)


if __name__ == "__main__":
    main()
