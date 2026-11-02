"""Crée ou met à jour les tables de Créno dans Supabase, sans mot de passe de base de données.

Envoie chaque fichier de supabase/migrations, dans l'ordre, à l'API de gestion de Supabase
(POST https://api.supabase.com/v1/projects/<projet>/database/query) avec le jeton d'accès.
Les fichiers déjà passés sont notés dans supabase_migrations.schema_migrations (la même table
que `supabase db push`), et ne sont pas relancés.

    SUPABASE_ACCESS_TOKEN=sbp_... PROJET=xxxx python3 scripts/migrer_supabase.py

Utilisé par .github/workflows/brancher-supabase.yml. Les migrations doivent rester rejouables
(create ... if not exists, drop ... if exists) : en cas d'erreur au milieu, on relance tout.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
API = os.environ.get("SUPABASE_API", "https://api.supabase.com").rstrip("/")


class ErreurSQL(Exception):
    pass


def requete(sql, jeton, projet):
    req = urllib.request.Request(
        f"{API}/v1/projects/{projet}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {jeton}", "Content-Type": "application/json",
                 "User-Agent": "creno-migrations"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            texte = r.read().decode() or "[]"
    except urllib.error.HTTPError as e:
        corps = e.read().decode(errors="replace")
        try:
            corps = json.loads(corps).get("message", corps)
        except (ValueError, AttributeError):
            pass
        raise ErreurSQL(f"HTTP {e.code} : {corps}") from None
    except urllib.error.URLError as e:
        raise ErreurSQL(f"Supabase injoignable : {e.reason}") from None
    try:
        return json.loads(texte)
    except ValueError:
        return []


def main():
    jeton = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    projet = os.environ.get("PROJET", "").strip()
    if not jeton or not projet:
        sys.exit("Il manque SUPABASE_ACCESS_TOKEN ou PROJET.")

    fichiers = sorted(DOSSIER.glob("*.sql"))
    try:
        requete(
            "create schema if not exists supabase_migrations;\n"
            "create table if not exists supabase_migrations.schema_migrations (version text not null primary key);\n"
            "alter table supabase_migrations.schema_migrations add column if not exists statements text[];\n"
            "alter table supabase_migrations.schema_migrations add column if not exists name text;",
            jeton, projet)
        lignes = requete("select version from supabase_migrations.schema_migrations;", jeton, projet)
    except ErreurSQL as e:
        sys.exit(f"Impossible de lire l'historique des tables : {e}")
    faites = {str(l.get("version")) for l in lignes if isinstance(l, dict)}

    for f in fichiers:
        m = re.match(r"(\d+)_(.+)\.sql$", f.name)
        if not m:
            continue
        version, nom = m.groups()
        if version in faites:
            print(f"Déjà fait : {f.name}")
            continue
        sql = (f.read_text(encoding="utf-8").rstrip() + "\n;\n"
               "insert into supabase_migrations.schema_migrations (version, name) "
               f"values ('{version}', '{nom.replace(chr(39), chr(39) * 2)}') on conflict (version) do nothing;")
        try:
            requete(sql, jeton, projet)
        except ErreurSQL as e:
            print(f"ERREUR dans {f.name} : {e}")
            sys.exit(1)
        print(f"Fait : {f.name}")
    print("Tables à jour.")


if __name__ == "__main__":
    main()
