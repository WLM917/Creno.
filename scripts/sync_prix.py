#!/usr/bin/env python3
"""
Récupère dans Supabase :
- les déclarations de prix des élèves -> médianes par auto-école -> data/prix.json
- les prix annoncés par les auto-écoles (table tarifs_proposes, lignes valide = true) -> data/tarifs.json
puis régénère les données et les pages du site.

Utilisation (la clé service_role est SECRÈTE : ne la mets jamais dans un fichier du dépôt) :
    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="la clé service_role"
    python3 scripts/sync_prix.py

Seules les déclarations marquées valide = true sont prises en compte. Pour écarter
une réponse douteuse, passe sa colonne « valide » à false dans le tableau de bord Supabase.
Les tarifs d'une auto-école n'apparaissent qu'après ta vérification : passe leur « valide » à true.
"""
import json
import os
import statistics
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRIX = ROOT / "data" / "prix.json"
TARIFS = ROOT / "data" / "tarifs.json"


def fetch_all(url, key, table="declarations"):
    rows, start, step = [], 0, 1000
    headers = {"apikey": key, "Range-Unit": "items"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    while True:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/{table}?select=*&valide=eq.true&order=id",
            headers={**headers, "Range": f"{start}-{start + step - 1}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.loads(r.read().decode("utf-8"))
        rows += batch
        if len(batch) < step:
            return rows
        start += step


def med(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values)) if values else None


def main():
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("Renseigne SUPABASE_URL et SUPABASE_SERVICE_KEY (voir l'aide en haut du fichier).")
    rows = fetch_all(url, key)
    par_ecole = {}
    for r in rows:
        if r.get("auto_ecole_id"):
            par_ecole.setdefault(r["auto_ecole_id"], []).append(r)
    ecoles = {}
    for ae_id, decl in sorted(par_ecole.items()):
        ecoles[ae_id] = {
            "forfait": med(d["forfait"] for d in decl),
            "heures_incluses": med(d["heures_incluses"] for d in decl),
            "prix_heure": med(d["prix_heure"] for d in decl),
            "heures_moyennes": med(d["heures_total"] for d in decl),
            "frais_examen": med(d.get("frais_examen") for d in decl),
            "declarations": len(decl),
            "accelere_declarations": sum(1 for d in decl if d.get("accelere")),
        }
    old = json.loads(PRIX.read_text(encoding="utf-8")) if PRIX.exists() else {}
    old["ecoles"] = ecoles
    PRIX.write_text(json.dumps(old, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    # Prix annoncés par les auto-écoles elles-mêmes (vérifiés à la main) : la ligne la plus récente gagne.
    tarifs = {}
    try:
        lignes = fetch_all(url, key, "tarifs_proposes")
    except Exception as exc:  # table pas encore créée
        print(f"Tarifs des auto-écoles non lus ({exc}).")
        lignes = []
    for t in lignes:
        if not t.get("auto_ecole_id"):
            continue
        tarifs[t["auto_ecole_id"]] = {k: t.get(k) for k in (
            "forfait", "heures_forfait", "prix_heure", "frais_examen", "accelere", "accelere_details", "lien")}
        tarifs[t["auto_ecole_id"]]["mis_a_jour"] = str(t.get("created_at", ""))[:10]
        tarifs[t["auto_ecole_id"]]["source"] = "auto-ecole"
    old_t = json.loads(TARIFS.read_text(encoding="utf-8")) if TARIFS.exists() else {}
    # Les tarifs ajoutés à la main dans data/tarifs.json (source « site ») sont gardés.
    garde = {k: v for k, v in (old_t.get("ecoles") or {}).items() if v.get("source") != "auto-ecole"}
    old_t["ecoles"] = {**garde, **tarifs}
    TARIFS.write_text(json.dumps(old_t, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(tarifs)} auto-écoles avec des tarifs vérifiés.")

    sans_id = sum(1 for r in rows if not r.get("auto_ecole_id"))
    print(f"{len(rows)} déclarations lues, {len(ecoles)} auto-écoles avec des prix."
          + (f" {sans_id} déclarations sans auto-école reconnue (à vérifier à la main)." if sans_id else ""))
    subprocess.run([sys.executable, str(ROOT / "scripts" / "import_auto_ecoles.py"), "--prix-seulement"], check=True)


if __name__ == "__main__":
    main()
