#!/usr/bin/env python3
"""
Importe la liste officielle des auto-écoles (taux de réussite) dans data/auto-ecoles.json.

Source : la carte officielle des auto-écoles de la Sécurité routière
(https://autoecoles.securite-routiere.gouv.fr/), dont la liste est téléchargeable
en CSV, aussi référencée sur data.gouv.fr :
https://www.data.gouv.fr/datasets/liste-des-auto-ecoles-et-taux-de-reussite-au-permis-de-conduire

Utilisation :
    python3 scripts/import_auto_ecoles.py chemin/vers/auto-ecoles.csv

Options utiles :
    --departements 75,77,78,91,92,93,94,95   départements à garder (Île-de-France par défaut)
    --apercu                                 affiche les colonnes détectées sans rien écrire
    --col-nom, --col-ville, --col-cp, --col-dep, --col-taux, --col-presentes
                                             force le nom d'une colonne si la détection se trompe

Les prix déjà présents dans data/auto-ecoles.json (déclarations des élèves) sont
conservés : seule la partie officielle (taux, élèves présentés) est mise à jour.
"""
import argparse
import csv
import io
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "auto-ecoles.json"
IDF = ["75", "77", "78", "91", "92", "93", "94", "95"]
PRICE_FIELDS = ["forfait", "heures_incluses", "prix_heure", "heures_moyennes", "frais_examen", "declarations"]


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def read_csv(path):
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = text[:5000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    return reader.fieldnames or [], list(reader)


def find_col(headers, forced, include_any, prefer=(), exclude=()):
    if forced:
        if forced not in headers:
            sys.exit(f"Colonne introuvable : {forced!r}. Colonnes disponibles : {headers}")
        return forced
    scored = []
    for h in headers:
        n = norm(h)
        if not any(k in n for k in include_any):
            continue
        if any(k in n for k in exclude):
            continue
        score = sum(2 for k in prefer if k in n)
        scored.append((score, -len(n), h))
    if not scored:
        return None
    scored.sort(reverse=True)
    return scored[0][2]


SMALL_WORDS = {"de", "des", "du", "la", "le", "les", "sur", "sous", "en", "et", "aux", "au"}


def nice_city(v):
    """SAINTE-GENEVIEVE-DES-BOIS -> Sainte-Genevieve-des-Bois (les accents absents de la source restent absents)."""
    words = re.split(r"([ \-'])", str(v or "").strip().lower())
    out = []
    for i, w in enumerate(words):
        if w in (" ", "-", "'") or not w:
            out.append(w)
        elif i > 0 and w in SMALL_WORDS:
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return "".join(out)


def parse_taux(v):
    if v is None:
        return None
    s = str(v).strip().replace("%", "").replace(" ", "").replace(" ", "").replace(",", ".")
    if not s or s in ("-", "nc", "NC", "n/a"):
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    if x > 1.0:
        x = x / 100.0
    return round(x, 4) if 0 <= x <= 1 else None


def parse_int(v):
    s = re.sub(r"[^\d]", "", str(v or ""))
    return int(s) if s else None


def dep_from(row, col_dep, col_cp):
    if col_dep and row.get(col_dep):
        d = re.sub(r"[^\dAB]", "", str(row[col_dep]).upper())
        if d:
            return d.zfill(2)[:3] if d.startswith("97") else d.zfill(2)[:2]
    if col_cp and row.get(col_cp):
        cp = re.sub(r"\D", "", str(row[col_cp])).zfill(5)
        return cp[:3] if cp.startswith("97") else cp[:2]
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", help="fichier CSV officiel des auto-écoles")
    ap.add_argument("--departements", default=",".join(IDF))
    ap.add_argument("--apercu", action="store_true")
    for c in ("nom", "ville", "cp", "dep", "taux", "presentes"):
        ap.add_argument(f"--col-{c}")
    args = ap.parse_args()

    headers, rows = read_csv(args.csv)
    if not headers:
        sys.exit("Le fichier semble vide ou illisible.")

    cols = {
        "nom": find_col(headers, args.col_nom, ["raison sociale", "nom", "denomination", "enseigne", "etablissement"],
                        prefer=["raison", "nom"], exclude=["prenom", "directeur", "responsable"]),
        "ville": find_col(headers, args.col_ville, ["commune", "ville", "localite"], exclude=["code"]),
        "cp": find_col(headers, args.col_cp, ["code postal", "cp", "postal"]),
        "dep": find_col(headers, args.col_dep, ["departement", "dept", "dpt"], exclude=["moyenne", "taux"]),
        "taux": find_col(headers, args.col_taux, ["taux", "reussite"],
                         prefer=["pratique", " b", "conduite", "b b1"], exclude=["moyenne", "departement", "etg", "code", "theorique"]),
        "presentes": find_col(headers, args.col_presentes, ["present", "candidats", "nombre", "nb "],
                              prefer=["pratique", " b", "conduite"], exclude=["moyenne", "etg", "code", "theorique", "reussi", "admis"]),
    }

    print("Colonnes du fichier :")
    for h in headers:
        print("  -", h)
    print("\nColonnes détectées :")
    for k, v in cols.items():
        print(f"  {k:10s} -> {v}")
    if args.apercu:
        print("\nAperçu terminé, rien n'a été écrit. Utilise --col-... pour corriger une colonne si besoin.")
        return

    missing = [k for k in ("nom", "taux") if not cols[k]]
    if missing:
        sys.exit(f"\nColonnes obligatoires non détectées : {missing}. Indique-les avec --col-nom / --col-taux.")
    if not (cols["dep"] or cols["cp"]):
        sys.exit("\nImpossible de trouver le département ou le code postal. Utilise --col-dep ou --col-cp.")

    keep = {d.strip().zfill(2) for d in args.departements.split(",") if d.strip()}

    previous = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
            if not (old.get("meta") or {}).get("demo"):
                for e in old.get("ecoles", []):
                    previous[(norm(e.get("nom")), e.get("cp"))] = e
        except (json.JSONDecodeError, OSError):
            pass

    ecoles, skipped = [], 0
    for i, row in enumerate(rows):
        dep = dep_from(row, cols["dep"], cols["cp"])
        if dep not in keep:
            continue
        taux = parse_taux(row.get(cols["taux"]))
        presentes = parse_int(row.get(cols["presentes"])) if cols["presentes"] else None
        nom = (row.get(cols["nom"]) or "").strip()
        if not nom or taux is None or not presentes:
            skipped += 1
            continue
        cp = re.sub(r"\D", "", str(row.get(cols["cp"]) or "")).zfill(5) if cols["cp"] else ""
        e = {
            "id": f"ae-{dep}-{i}",
            "nom": nom,
            "ville": nice_city(row.get(cols["ville"])) if cols["ville"] else "",
            "cp": cp,
            "dep": dep,
            "taux": taux,
            "presentes": presentes,
        }
        prev = previous.get((norm(nom), cp))
        for f in PRICE_FIELDS:
            e[f] = prev.get(f) if prev else None
        if e["declarations"] is None:
            e["declarations"] = 0
        ecoles.append(e)

    data = {
        "meta": {
            "demo": False,
            "description": "Taux de réussite officiels (Sécurité routière). Prix : déclarations des élèves.",
            "source_taux": "Carte officielle des auto-écoles, Sécurité routière",
            "mis_a_jour": date.today().isoformat(),
        },
        "ecoles": ecoles,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n{len(ecoles)} auto-écoles écrites dans {OUT.relative_to(ROOT)}"
          f" ({skipped} ligne(s) ignorée(s) faute de nom, de taux ou d'élèves présentés).")


if __name__ == "__main__":
    main()
