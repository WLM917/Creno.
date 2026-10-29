#!/usr/bin/env python3
"""
Récupère les déclarations de prix dans Supabase, calcule les médianes par auto-école,
écrit data/prix.json, puis régénère les données et les pages du site.

Utilisation (la clé service_role est SECRÈTE : ne la mets jamais dans un fichier du dépôt) :
    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="la clé service_role"
    python3 scripts/sync_prix.py

Seules les déclarations marquées valide = true sont prises en compte. Pour écarter
une réponse douteuse, passe sa colonne « valide » à false dans le tableau de bord Supabase.
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


def fetch_all(url, key):
    rows, start, step = [], 0, 1000
    while True:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/declarations?select=*&valide=eq.true&order=id",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": f"{start}-{start + step - 1}"})
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
        }
    old = json.loads(PRIX.read_text(encoding="utf-8")) if PRIX.exists() else {}
    old["ecoles"] = ecoles
    PRIX.write_text(json.dumps(old, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    sans_id = sum(1 for r in rows if not r.get("auto_ecole_id"))
    print(f"{len(rows)} déclarations lues, {len(ecoles)} auto-écoles avec des prix."
          + (f" {sans_id} déclarations sans auto-école reconnue (à vérifier à la main)." if sans_id else ""))
    subprocess.run([sys.executable, str(ROOT / "scripts" / "import_auto_ecoles.py"), "--prix-seulement"], check=True)


if __name__ == "__main__":
    main()
