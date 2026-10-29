#!/usr/bin/env python3
"""
Importe le fichier officiel des auto-écoles (carte de la Sécurité routière) dans data/.

Source : https://autoecoles.securite-routiere.gouv.fr/ (liste téléchargeable en CSV,
aussi référencée sur data.gouv.fr). La carte est mise à jour chaque trimestre :
relancer l'import à chaque nouvelle version du fichier.

Utilisation :
    python3 scripts/import_auto_ecoles.py chemin/vers/auto-ecoles.csv

Produit :
    data/index.json                 liste des départements, moyennes, date d'import
    data/departements/<code>.json   auto-écoles du département (permis B uniquement)

Les prix déclarés par les élèves se trouvent dans data/prix.json (clé : numéro d'agrément
de l'auto-école, colonne raf_numero). Ils sont fusionnés à chaque import, donc rien n'est perdu.
"""
import csv
import io
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DEP_DIR = DATA / "departements"
PRIX = DATA / "prix.json"

REQUIRED = [
    "raf_numero", "aue_raisonsociale", "aue_adresse", "aue_codepostal", "aue_commune", "dpt_id",
    "aue_siteinternet", "aue_permis1euro_flag", "aue_labelqualite_flag", "aue_ecoleasso_flag",
    "aue_aac_flag", "aue_cs_flag", "aue_enligne_flag", "B_flag", "B_nombre_1pra", "B_taux_1pra",
]
OPTIONAL = ["B_taux_xpra", "optionnel_nombre_examen_total_tout_passage_BC"]
LABELS = {
    "aue_labelqualite_flag": "qualite",
    "aue_permis1euro_flag": "permis1euro",
    "aue_ecoleasso_flag": "associative",
    "aue_enligne_flag": "enligne",
    "aue_aac_flag": "aac",
    "aue_cs_flag": "cs",
}
PRICE_FIELDS = ["forfait", "heures_incluses", "prix_heure", "heures_moyennes", "frais_examen", "declarations"]

DEPARTEMENTS = {
    "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube",
    "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
    "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud",
    "2B": "Haute-Corse", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne",
    "25": "Doubs", "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère",
    "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault",
    "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
    "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique",
    "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère", "49": "Maine-et-Loire",
    "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
    "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
    "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
    "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
    "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
    "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse",
    "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne",
    "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis",
    "94": "Val-de-Marne", "95": "Val-d'Oise", "971": "Guadeloupe", "972": "Martinique", "973": "Guyane",
    "974": "La Réunion", "975": "Saint-Pierre-et-Miquelon", "976": "Mayotte", "977": "Saint-Barthélemy",
    "978": "Saint-Martin", "98": "Monaco",
}

# ---------- Mise en forme des textes de la source (souvent en majuscules, sans accents) ----------
SMALL = {"de", "du", "des", "la", "le", "les", "et", "en", "sur", "sous", "au", "aux", "a", "l", "d",
         "the", "to", "of", "and", "by"}
SHORT_WORDS = {"bel", "top", "art", "cap", "pro", "new", "one", "duo", "mon", "ton", "sud", "est", "val",
               "mer", "lac", "pas", "vie", "roi", "bon", "oui", "car", "feu", "go", "age", "axe", "cle",
               "eco", "neo", "max", "rue", "av", "bd", "ave", "all", "st", "ste", "pl", "rte", "che",
               "imp", "res", "bat", "lot", "my", "way", "fun", "zen", "sun", "far", "big", "fly", "run",
               "ma", "ta", "sa", "nos", "vos", "ici", "tou", "bis", "ter", "rd", "cd"}
ACCENTS = {"ecole": "école", "ecoles": "écoles", "academie": "académie", "securite": "sécurité",
           "reussite": "réussite", "education": "éducation", "eleve": "élève", "eleves": "élèves",
           "liberte": "liberté", "generale": "générale", "general": "général", "privee": "privée",
           "prefecture": "préfecture", "republique": "république"}
TOKEN = re.compile(r"([\s\-'’./()&,+]+)")


def nice_text(value):
    """Met en forme un nom ou une adresse écrits tout en majuscules. Garde le texte tel quel s'il a déjà des minuscules."""
    s = re.sub(r"\s+", " ", str(value or "")).strip()
    if not s or any(c.islower() for c in s):
        return s
    out, first = [], True
    for tok in TOKEN.split(s):
        if not tok or TOKEN.fullmatch(tok):
            out.append(tok)
            continue
        low = tok.lower()
        if any(c.isdigit() for c in tok):
            word = tok
        elif not first and low in SMALL:
            word = low
        elif len(tok) <= 3 and tok.isalpha() and low not in SHORT_WORDS and low not in SMALL:
            word = tok  # sigle : ABS, AEC, ECF...
        else:
            low = ACCENTS.get(low, low)
            word = low[:1].upper() + low[1:]
        out.append(word)
        first = False
    return "".join(out)


def nice_city(value, cp):
    s = re.sub(r"\s+", " ", str(value or "")).strip()
    up = s.upper()
    # Arrondissements de Paris, Lyon et Marseille, d'après le code postal
    for ville, prefixes in (("Paris", ("750", "751")), ("Lyon", ("690",)), ("Marseille", ("130",))):
        if up.startswith(ville.upper()) and cp[:3] in prefixes:
            n = int(cp[-2:])
            if 1 <= n <= 20:
                return f"{ville} {n}{'er' if n == 1 else 'e'}"
    if any(c.islower() for c in s):
        return s
    parts = re.split(r"([ \-'])", s.lower())
    out = []
    for i, w in enumerate(parts):
        if w in (" ", "-", "'") or not w:
            out.append(w)
        elif i > 0 and w in SMALL:
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return "".join(out)


# ---------- Lecture des valeurs ----------
def num(v):
    s = str(v or "").strip().replace(",", ".")
    if not s or s.upper() == "NC":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def flag(v):
    return str(v or "").strip().upper() == "TRUE"


def dep_code(v):
    d = str(v or "").strip().upper()
    if d in ("02A", "2A", "20A"):
        return "2A"
    if d in ("02B", "2B", "20B"):
        return "2B"
    if d.isdigit() and len(d) == 1:
        return d.zfill(2)
    return d


def clean_site(v):
    s = str(v or "").strip()
    if not s or " " in s:
        return None
    if not re.match(r"^https?://", s, re.I):
        s = "https://" + s
    return s if re.match(r"^https?://[^/\s]+\.[a-z]{2,}", s, re.I) else None


def dep_sort_key(code):
    if code == "2A":
        return (20, 0)
    if code == "2B":
        return (20, 1)
    return (int(code), 0) if code.isdigit() else (999, 0)


def read_csv(path):
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    delim = ";" if text[:2000].count(";") >= text[:2000].count(",") else ","
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delim)
    return reader.fieldnames or [], list(reader)


def main():
    if len(sys.argv) != 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0 if len(sys.argv) == 2 else 1)

    headers, rows = read_csv(sys.argv[1])
    missing = [c for c in REQUIRED if c not in headers]
    if missing:
        sys.exit("Ce fichier n'a pas le format attendu (fichier officiel des auto-écoles).\n"
                 f"Colonnes manquantes : {', '.join(missing)}")

    prix = {}
    if PRIX.exists():
        prix = (json.loads(PRIX.read_text(encoding="utf-8")) or {}).get("ecoles", {})

    par_dep = {}
    nb_b = 0
    for r in rows:
        if not flag(r["B_flag"]):
            continue
        nb_b += 1
        dep = dep_code(r["dpt_id"])
        cp = re.sub(r"\D", "", r["aue_codepostal"] or "").zfill(5)
        taux = num(r["B_taux_1pra"])
        n = num(r["B_nombre_1pra"])
        e = {
            "id": r["raf_numero"].strip(),
            "nom": nice_text(r["aue_raisonsociale"]),
            "adresse": nice_text(r["aue_adresse"]),
            "cp": cp,
            "ville": nice_city(r["aue_commune"], cp),
        }
        site = clean_site(r["aue_siteinternet"])
        if site:
            e["site"] = site
        if taux is not None and n:
            e["taux"] = round(taux, 4)
            e["presentes"] = int(n)
        tous = num(r.get("B_taux_xpra"))
        examens = num(r.get("optionnel_nombre_examen_total_tout_passage_BC"))
        if tous is not None and examens:
            e["taux_tous"] = round(tous, 4)
            e["examens_tous"] = int(examens)
        labels = [code for col, code in LABELS.items() if flag(r[col])]
        if labels:
            e["labels"] = labels
        for f in PRICE_FIELDS:
            v = (prix.get(e["id"]) or {}).get(f)
            if v is not None:
                e[f] = v
        par_dep.setdefault(dep, []).append(e)

    if not par_dep:
        sys.exit("Aucune auto-école enseignant le permis B n'a été trouvée dans ce fichier.")

    DEP_DIR.mkdir(parents=True, exist_ok=True)
    for old in DEP_DIR.glob("*.json"):
        old.unlink()

    index_deps, tot_n, tot_ok, nb_taux = [], 0, 0.0, 0
    for dep in sorted(par_dep, key=dep_sort_key):
        ecoles = sorted(par_dep[dep], key=lambda e: (e["ville"], e["nom"]))
        classees = [e for e in ecoles if "taux" in e]
        n = sum(e["presentes"] for e in classees)
        ok = sum(e["taux"] * e["presentes"] for e in classees)
        moyenne = round(ok / n, 4) if n else None
        tot_n, tot_ok, nb_taux = tot_n + n, tot_ok + ok, nb_taux + len(classees)
        nom = DEPARTEMENTS.get(dep, f"Département {dep}")
        head = json.dumps({"code": dep, "nom": nom, "moyenne": moyenne}, ensure_ascii=False)[:-1]
        body = ",\n".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in ecoles)
        (DEP_DIR / f"{dep}.json").write_text(f'{head}, "ecoles": [\n{body}\n]}}\n', encoding="utf-8")
        index_deps.append({"code": dep, "nom": nom, "nb": len(ecoles), "nb_taux": len(classees), "moyenne": moyenne})

    index = {
        "meta": {
            "source": "Fichier officiel des auto-écoles, Sécurité routière (autoecoles.securite-routiere.gouv.fr)",
            "importe_le": date.today().isoformat(),
            "nb_auto_ecoles": nb_b,
            "nb_avec_taux": nb_taux,
            "moyenne_nationale": round(tot_ok / tot_n, 4) if tot_n else None,
            "nb_avec_prix": sum(1 for v in prix.values() if v.get("forfait") is not None),
        },
        "departements": index_deps,
    }
    (DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"{nb_b} auto-écoles du permis B importées, dont {nb_taux} avec un taux de réussite publié.")
    print(f"{len(index_deps)} départements écrits dans {DEP_DIR.relative_to(ROOT)}/.")
    if tot_n:
        print(f"Réussite moyenne au 1er passage en France : {tot_ok / tot_n:.1%}")


if __name__ == "__main__":
    main()
