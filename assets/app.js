/* Créno : recherche de ville, filtres du classement, calculateur, formulaires, checklist.
   Les pages sont générées par scripts/build_site.py et lisibles sans JavaScript.
   Ce fichier ajoute seulement l'interactivité. */
(function () {
  "use strict";

  var CONFIG = window.CRENO_CONFIG || {};
  var BODY = document.body;
  var ROOT = BODY.getAttribute("data-root") || "";
  var EXPLICIT = BODY.getAttribute("data-links") === "explicit";
  var PAGE = 30;
  var BUDGET_MAX = 3000;

  /* ---------- Outils ---------- */
  var store = {
    get: function (key, fallback) {
      try { var v = window.localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* stockage indisponible */ }
    }
  };
  var eurFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  var intFmt = new Intl.NumberFormat("fr-FR");
  function eur(n) { return n == null || isNaN(n) ? "—" : eurFmt.format(n); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function plural(n, one, many) { return intFmt.format(n) + " " + (n > 1 ? many : one); }
  function link(path) {
    var url = ROOT + path;
    if (EXPLICIT) url = url.replace(/\/(\?|#|$)/, "/index.html$1");
    return url;
  }
  function fetchJSON(path) {
    return fetch(ROOT + path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function queryParam(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  /* ---------- Recherche de ville ---------- */
  var searchIndex = null;
  // data/recherche.json : { d: [[code, nom, url, nb]], v: [[nom, codes postaux, code dép., slug, nb]] }
  function expandSearch(raw) {
    var deps = {};
    var list = raw.d.map(function (d) {
      deps[d[0]] = d;
      return { t: "d", n: d[1], s: "Département " + d[0], u: d[2], c: d[3], k: norm(d[1] + " " + d[0]) };
    });
    raw.v.forEach(function (v) {
      var dep = deps[v[2]];
      if (!dep) return;
      var cps = v[1].split(" ");
      list.push({
        t: "v", n: v[0], s: cps.slice(0, 2).join(", ") + ", " + dep[1], c: v[4], k: norm(v[0] + " " + v[1]),
        u: v[3] ? dep[2] + v[3] + "/" : dep[2] + "?q=" + encodeURIComponent(norm(v[0])).replace(/%20/g, "+")
      });
    });
    return list;
  }
  function loadSearch() {
    if (!searchIndex) {
      searchIndex = fetchJSON("data/recherche.json").then(expandSearch).catch(function (e) { searchIndex = null; throw e; });
    }
    return searchIndex;
  }

  function findMatches(list, q) {
    var nq = norm(q);
    if (!nq) return [];
    var digits = /^\d{2,5}$/.test(nq.replace(/\s/g, ""));
    var out = [];
    for (var i = 0; i < list.length && out.length < 40; i++) {
      var it = list[i];
      var keys = it.k;
      var score = -1;
      if (digits) {
        var d = nq.replace(/\s/g, "");
        if ((" " + keys + " ").indexOf(" " + d) !== -1) score = it.t === "d" && keys.slice(-d.length) === d ? 3 : 2;
      } else if (keys.indexOf(nq) === 0) {
        score = 3;
      } else if ((" " + keys).indexOf(" " + nq) !== -1) {
        score = 2;
      } else if (nq.length >= 3 && keys.indexOf(nq) !== -1) {
        score = 1;
      }
      if (score >= 0) out.push({ it: it, score: score });
    }
    out.sort(function (a, b) {
      return b.score - a.score || (a.it.t === "d" ? -1 : 0) - (b.it.t === "d" ? -1 : 0) || b.it.c - a.it.c;
    });
    return out.slice(0, 8).map(function (x) { return x.it; });
  }

  function initFinder(form) {
    var input = $("input[type=search]", form);
    var list = $(".finder-list", form);
    var msg = $(".finder-msg", form);
    var results = [];
    var active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }
    function setActive(i) {
      var items = $all("[role=option]", list);
      items.forEach(function (el, j) { el.setAttribute("aria-selected", j === i ? "true" : "false"); });
      active = i;
      if (items[i]) input.setAttribute("aria-activedescendant", items[i].id);
    }
    function render() {
      var q = input.value;
      msg.textContent = "";
      if (norm(q).length < 2) { close(); return; }
      loadSearch().then(function (data) {
        if (input.value !== q) return;
        results = findMatches(data, q);
        if (!results.length) {
          close();
          msg.textContent = "Aucune ville ni département trouvé pour « " + q + " ». Vérifie l'orthographe ou tape le code postal.";
          return;
        }
        list.innerHTML = results.map(function (it, i) {
          var count = it.t === "d" ? plural(it.c, "auto-école classée", "auto-écoles classées") : plural(it.c, "auto-école", "auto-écoles");
          return '<li role="option" id="finder-opt-' + i + '" aria-selected="false">' +
            '<a href="' + esc(link(it.u)) + '" tabindex="-1">' +
            '<span class="opt-name">' + esc(it.n) + '</span>' +
            '<span class="opt-sub">' + esc(it.s) + '</span>' +
            '<span class="opt-count">' + count + '</span></a></li>';
        }).join("");
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        setActive(0);
      }).catch(function () {
        msg.textContent = "La recherche n'a pas pu se charger. Vérifie ta connexion.";
      });
    }
    function go(i) {
      if (results[i]) location.href = link(results[i].u);
    }

    input.addEventListener("input", render);
    input.addEventListener("focus", function () { loadSearch().catch(function () {}); if (input.value) render(); });
    input.addEventListener("keydown", function (ev) {
      if (list.hidden) return;
      if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(Math.min(active + 1, results.length - 1)); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(Math.max(active - 1, 0)); }
      else if (ev.key === "Escape") { close(); }
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (results.length && !list.hidden) { go(active < 0 ? 0 : active); return; }
      var q = input.value;
      if (norm(q).length < 2) { msg.textContent = "Tape au moins deux lettres ou un code postal."; return; }
      loadSearch().then(function (data) {
        results = findMatches(data, q);
        if (results.length) go(0);
        else msg.textContent = "Aucune ville ni département trouvé pour « " + q + " ».";
      });
    });
    document.addEventListener("click", function (ev) { if (!form.contains(ev.target)) close(); });

    if (input.hasAttribute("data-prefill")) {
      var q = queryParam("q");
      if (q) { input.value = q; render(); }
    }
  }

  /* ---------- Classement d'un département ---------- */
  function initRanking() {
    var ol = $("#ranking[data-dynamic]");
    if (!ol) return;
    var filters = $("#filters");
    filters.hidden = false;
    var dep = BODY.getAttribute("data-dep");

    var rows = $all("li.rank-row", ol).map(function (li) {
      var cout = li.getAttribute("data-cout");
      return {
        li: li,
        id: li.id,
        rang: Number(li.getAttribute("data-rang")),
        taux: Number(li.getAttribute("data-taux")),
        cout: cout === "" ? null : Number(cout),
        labels: (li.getAttribute("data-labels") || "").split(" "),
        q: li.getAttribute("data-q") || ""
      };
    });
    var avecPrix = rows.some(function (r) { return r.cout != null; });
    var unranked = $all("#unranked li[data-q]");
    var crits = $all("#filters input[data-label]");
    var saved = store.get("creno-filtres", null) || {};
    var state = {
      search: queryParam("q") || "",
      budget: saved.budget || BUDGET_MAX,
      sort: saved.sort || "indice",
      unknown: typeof saved.unknown === "boolean" ? saved.unknown : true,
      crit: saved.crit || {},
      limit: PAGE
    };

    $("#f-search").value = state.search;
    $("#f-budget").value = state.budget;
    $("#f-sort").value = state.sort;
    $("#f-unknown").checked = state.unknown;
    crits.forEach(function (c) { c.checked = !!state.crit[c.getAttribute("data-label")]; });
    $("#f-budget").disabled = !avecPrix;
    $("#f-unknown").disabled = !avecPrix;
    if (window.matchMedia && window.matchMedia("(max-width: 600px)").matches) $(".more-filters").open = false;

    // Arrivée depuis un lien vers une auto-école précise (#ae-...) : on la montre.
    var target = location.hash && location.hash.indexOf("#ae-") === 0 ? location.hash.slice(1) : "";

    function save() {
      store.set("creno-filtres", { budget: state.budget, sort: state.sort, unknown: state.unknown, crit: state.crit });
    }

    function render() {
      var q = norm(state.search);
      var wanted = Object.keys(state.crit).filter(function (k) { return state.crit[k]; });
      var shown = rows.filter(function (r) {
        if (q && r.q.indexOf(q) === -1) return false;
        for (var i = 0; i < wanted.length; i++) if (r.labels.indexOf(wanted[i]) === -1) return false;
        if (!avecPrix) return true;
        if (r.cout == null) return state.unknown;
        return state.budget >= BUDGET_MAX || r.cout <= state.budget;
      });
      if (state.sort === "taux") shown.sort(function (a, b) { return b.taux - a.taux || a.rang - b.rang; });
      else if (state.sort === "cout") shown.sort(function (a, b) {
        if (a.cout == null && b.cout == null) return a.rang - b.rang;
        if (a.cout == null) return 1;
        if (b.cout == null) return -1;
        return a.cout - b.cout;
      });
      else shown.sort(function (a, b) { return a.rang - b.rang; });

      var limit = state.limit;
      if (target) {
        var pos = shown.map(function (r) { return r.id; }).indexOf(target);
        if (pos >= limit) limit = pos + 1;
      }
      var visible = {};
      shown.forEach(function (r, i) { if (i < limit) visible[r.id] = true; });
      rows.forEach(function (r) { r.li.hidden = !visible[r.id]; });
      shown.forEach(function (r) { ol.appendChild(r.li); });
      rows.forEach(function (r) { if (!visible[r.id]) ol.appendChild(r.li); });

      $("#ranking-empty").hidden = shown.length > 0;
      var more = $("#ranking-more");
      var left = shown.length - limit;
      more.hidden = left <= 0;
      if (left > 0) more.textContent = "Afficher " + Math.min(PAGE, left) + " de plus (" + intFmt.format(left) + " restantes)";

      // Les auto-écoles sans taux publié suivent aussi la recherche.
      var nbSans = 0;
      unranked.forEach(function (li) {
        var ok = !q || (li.getAttribute("data-q") || "").indexOf(q) !== -1;
        li.hidden = !ok;
        if (ok) nbSans++;
      });
      var details = $("#unranked");
      if (details && q) details.open = nbSans > 0 && nbSans < unranked.length;

      var summary = plural(rows.length, "auto-école classée", "auto-écoles classées") + " dans le " + dep + ".";
      if (shown.length !== rows.length) {
        summary += shown.length ? " " + plural(shown.length, "correspond", "correspondent") + " à ta recherche." : " Aucune ne correspond à ta recherche.";
      }
      $("#zone-summary").textContent = summary;
      var empty = $("#ranking-empty");
      empty.textContent = q && !shown.length && nbSans
        ? "Aucune auto-école classée ici, mais " + plural(nbSans, "auto-école sans taux publié correspond", "auto-écoles sans taux publié correspondent") + " : elles sont listées plus bas."
        : "Aucune auto-école ne correspond. Retire un filtre ou monte ton budget.";
      $("#f-budget-out").textContent = state.budget >= BUDGET_MAX ? "pas de limite" : eur(state.budget);
    }

    function update() { state.limit = PAGE; target = ""; render(); save(); }

    $("#f-search").addEventListener("input", function (ev) { state.search = ev.target.value; update(); });
    $("#f-budget").addEventListener("input", function (ev) { state.budget = Number(ev.target.value); update(); });
    $("#f-sort").addEventListener("change", function (ev) { state.sort = ev.target.value; update(); });
    $("#f-unknown").addEventListener("change", function (ev) { state.unknown = ev.target.checked; update(); });
    crits.forEach(function (c) {
      c.addEventListener("change", function () { state.crit[c.getAttribute("data-label")] = c.checked; update(); });
    });
    $("#f-zone").addEventListener("change", function (ev) { location.href = link(ev.target.value); });
    $("#ranking-more").addEventListener("click", function () { state.limit += PAGE; render(); });

    render();
    if (target && document.getElementById(target)) {
      var el = document.getElementById(target);
      el.classList.add("is-target");
      el.scrollIntoView({ block: "center" });
    }
  }

  /* ---------- Calculateur ---------- */
  function initCalc() {
    if (!$("#calc")) return;
    var ids = ["calc-forfait", "calc-incluses", "calc-prix", "calc-besoin", "calc-frais", "calc-budget"];
    var saved = store.get("creno-calc", null);
    if (saved) ids.forEach(function (id) { if (saved[id] != null) $("#" + id).value = saved[id]; });

    function val(id) { var n = parseFloat($("#" + id).value); return isNaN(n) ? 0 : n; }
    function update() {
      var forfait = val("calc-forfait"), incluses = val("calc-incluses"), prix = val("calc-prix");
      var besoin = val("calc-besoin"), frais = val("calc-frais"), budget = val("calc-budget");
      var enPlus = Math.max(0, besoin - incluses);
      var total = forfait + enPlus * prix + frais;
      $("#calc-total").textContent = eur(total);
      $("#calc-lines").innerHTML =
        '<div><dt>Forfait</dt><dd>' + eur(forfait) + '</dd></div>' +
        '<div><dt>' + enPlus + (enPlus > 1 ? " heures" : " heure") + ' en plus × ' + eur(prix) + '</dt><dd>' + eur(enPlus * prix) + '</dd></div>' +
        '<div><dt>Présentation à l\'examen</dt><dd>' + eur(frais) + '</dd></div>';
      var verdict = $("#calc-verdict");
      if (budget > 0) {
        var diff = budget - total;
        verdict.textContent = diff >= 0
          ? "Dans ton budget, il te reste " + eur(diff) + "."
          : "Au-dessus de ton budget de " + eur(-diff) + ".";
      } else {
        verdict.textContent = "";
      }
      var snap = {}; ids.forEach(function (id) { snap[id] = $("#" + id).value; });
      store.set("creno-calc", snap);
    }
    ids.forEach(function (id) { $("#" + id).addEventListener("input", update); });
    update();
  }

  /* ---------- Formulaires ---------- */
  // Chaque formulaire va dans sa table Supabase (voir supabase/migrations).
  var TABLES = { declaration: "declarations", loueur: "loueurs_proposes", alerte: "alertes" };
  var NUMBERS = ["forfait", "heures_incluses", "prix_heure", "heures_total", "frais_examen"];

  function initSchoolPicker(form) {
    var input = $("#decl-ecole", form);
    if (!input) return;
    var hidden = $("input[name=auto_ecole_id]", form);
    var datalist = $("#decl-ecoles", form);
    function resolve() {
      hidden.value = "";
      $all("option", datalist).forEach(function (o) { if (o.value === input.value) hidden.value = o.getAttribute("data-id") || ""; });
    }
    input.addEventListener("input", resolve);
    input.addEventListener("change", resolve);

    var depSel = $("select[data-load-ecoles]", form);
    if (depSel) {
      depSel.addEventListener("change", function () {
        datalist.innerHTML = "";
        input.value = ""; hidden.value = "";
        if (!depSel.value) return;
        fetchJSON("data/departements/" + encodeURIComponent(depSel.value) + ".json").then(function (dep) {
          datalist.innerHTML = dep.ecoles.map(function (e) {
            return '<option value="' + esc(e.nom + ", " + e.ville) + '" data-id="' + esc(e.id) + '"></option>';
          }).join("");
        }).catch(function () { /* la saisie libre reste possible */ });
      });
    }
  }

  function initForms() {
    $all("form[data-form-type]").forEach(function (form) {
      var type = form.getAttribute("data-form-type");
      initSchoolPicker(form);
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var statusEl = $(".form-status", form);
        var button = $("button[type=submit]", form);
        var row = {};
        $all("input[name], select[name]", form).forEach(function (f) {
          var v = f.value.trim();
          if (NUMBERS.indexOf(f.name) !== -1) row[f.name] = v === "" ? null : Math.round(Number(v));
          else row[f.name] = v === "" ? null : v;
        });

        function done(ok, text) {
          statusEl.textContent = text;
          statusEl.className = "form-status " + (ok ? "is-ok" : "is-error");
          button.disabled = false;
          if (ok) form.reset();
        }

        var req = null;
        if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
          req = fetch(CONFIG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + TABLES[type], {
            method: "POST",
            headers: {
              "apikey": CONFIG.supabaseAnonKey,
              "Authorization": "Bearer " + CONFIG.supabaseAnonKey,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify(row)
          });
        } else if (CONFIG.formEndpoint) {
          req = fetch(CONFIG.formEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ type: type, envoye_le: new Date().toISOString(), reponses: row })
          });
        }

        button.disabled = true;
        if (!req) {
          var pending = store.get("creno-envois", []);
          pending.push({ type: type, envoye_le: new Date().toISOString(), reponses: row });
          store.set("creno-envois", pending);
          done(true, "Enregistré sur cet appareil. L'envoi en ligne n'est pas encore branché.");
          return;
        }
        req.then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          done(true, type === "declaration" ? "Merci, ta réponse est envoyée." : "Merci, c'est envoyé.");
        }).catch(function () {
          done(false, "L'envoi n'a pas marché. Vérifie tes réponses et ta connexion, puis réessaie.");
        });
      });
    });
  }

  /* ---------- Checklist ---------- */
  function initChecklist() {
    var boxes = $all("#checklist input[type=checkbox]");
    if (!boxes.length) return;
    var saved = store.get("creno-checklist", {});
    boxes.forEach(function (b) { b.checked = !!saved[b.id]; });
    function update() {
      var state = {}; var done = 0;
      boxes.forEach(function (b) { state[b.id] = b.checked; if (b.checked) done++; });
      var p = $("#check-progress");
      p.textContent = done === boxes.length ? "Tout est prêt" : done + " sur " + boxes.length + " prêts";
      p.classList.toggle("is-done", done === boxes.length);
      store.set("creno-checklist", state);
    }
    boxes.forEach(function (b) { b.addEventListener("change", update); });
    update();
  }

  /* ---------- Démarrage ---------- */
  function start() {
    $all("form[data-finder]").forEach(initFinder);
    initRanking();
    initCalc();
    initForms();
    initChecklist();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
