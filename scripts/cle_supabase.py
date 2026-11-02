"""Trouve une clé dans la sortie de `supabase projects api-keys -o json` (lue sur l'entrée standard).

    python3 scripts/cle_supabase.py publique   clé publishable (sb_publishable_...) ou ancienne clé anon
    python3 scripts/cle_supabase.py secrete    ancienne clé service_role, ou clé secrète sb_secret_... lisible

Utilisé par les workflows GitHub (.github/workflows). Affiche seulement la clé, rien d'autre.
Sort en erreur (code 1) si la clé n'est pas trouvée.
"""
import json
import re
import sys


def liste(d):
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if isinstance(d, dict):
        for k in ("api_keys", "keys", "data"):
            if isinstance(d.get(k), list):
                return liste(d[k])
        return [d]
    return []


def valeur(x):
    """La clé en entier, ou "" si elle est absente ou masquée (sb_secret_abcd····)."""
    v = x.get("api_key") or x.get("key") or ""
    return v if isinstance(v, str) and len(v) > 20 and re.fullmatch(r"[A-Za-z0-9_.\-]+", v) else ""


def choisir(cles, quoi):
    if quoi == "publique":
        ordre = [lambda x: valeur(x).startswith("sb_publishable_"),
                 lambda x: x.get("name") == "anon" and valeur(x).startswith("eyJ")]
    else:
        ordre = [lambda x: x.get("name") == "service_role" and valeur(x).startswith("eyJ"),
                 lambda x: valeur(x).startswith("sb_secret_")]
    for test in ordre:
        for x in cles:
            if test(x):
                return valeur(x)
    return ""


def main():
    quoi = sys.argv[1] if len(sys.argv) > 1 else ""
    if quoi not in ("publique", "secrete"):
        sys.exit("Usage : cle_supabase.py publique|secrete < cles.json")
    try:
        cles = liste(json.load(sys.stdin))
    except ValueError:
        sys.exit(1)
    cle = choisir(cles, quoi)
    if not cle:
        sys.exit(1)
    print(cle)


if __name__ == "__main__":
    main()
