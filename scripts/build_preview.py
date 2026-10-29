#!/usr/bin/env python3
"""
Génère une version de Créno en un seul fichier HTML (styles, scripts et données intégrés),
pratique pour un aperçu rapide. Le vrai site reste index.html + assets/ + data/.

Utilisation :
    python3 scripts/build_preview.py [fichier-de-sortie]   (par défaut : dist/preview.html)
    python3 scripts/build_preview.py --fragment sortie.html   (sans <html>/<head>/<body>)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    fragment = "--fragment" in sys.argv
    out = Path(args[0]) if args else ROOT / "dist" / "preview.html"

    html = read("index.html")
    css = read("assets/style.css")
    config = read("assets/config.js")
    app = read("assets/app.js")
    ecoles = json.loads(read("data/auto-ecoles.json"))
    loueurs = json.loads(read("data/loueurs.json"))

    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)

    title = re.search(r"<title>.*?</title>", head, re.S).group(0)
    fonts = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', head).group(0)

    body = re.sub(r'\s*<script src="assets/config\.js"></script>', "", body)
    body = re.sub(r'\s*<script src="assets/app\.js"></script>', "", body)

    data_js = (
        "window.CRENO_ECOLES = " + json.dumps(ecoles, ensure_ascii=False) + ";\n"
        "window.CRENO_LOUEURS = " + json.dumps(loueurs, ensure_ascii=False) + ";\n"
    )
    scripts = "<script>\n" + config + "\n" + data_js + "\n" + app + "\n</script>\n"

    if fragment:
        page = (
            title + '\n<meta name="claude:viewport-fit-sides" content="cover">\n'
            + fonts + "\n<style>\n" + css + "\n</style>\n" + body + "\n" + scripts
        )
    else:
        page = (
            '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            + title + "\n" + fonts + "\n<style>\n" + css + "\n</style>\n</head>\n<body>\n"
            + body + "\n" + scripts + "</body>\n</html>\n"
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print(f"Aperçu écrit dans {out}")


if __name__ == "__main__":
    main()
