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
  function supabaseReady() { return !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey); }
  function supaHeaders(extra) {
    var h = { "apikey": CONFIG.supabaseAnonKey, "Content-Type": "application/json" };
    if (CONFIG.supabaseAnonKey.indexOf("sb_") !== 0) h.Authorization = "Bearer " + CONFIG.supabaseAnonKey;
    for (var k in (extra || {})) h[k] = extra[k];
    return h;
  }
  function supaInsert(table, row, keepalive) {
    return fetch(CONFIG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + table, {
      method: "POST", keepalive: !!keepalive,
      headers: supaHeaders({ "Prefer": "return=minimal" }),
      body: JSON.stringify(row)
    });
  }
  // Appelle une fonction serveur Supabase (supabase/functions/<nom>). Renvoie le JSON, ou lève une erreur lisible.
  function callFn(name, body) {
    return fetch(CONFIG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/" + name, {
      method: "POST", headers: supaHeaders(), body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.erreur || "Le service ne répond pas. Réessaie dans quelques minutes.");
        return j;
      });
    }, function () { throw new Error("Pas de connexion. Vérifie ton réseau et réessaie."); });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  function setStatus(el, ok, text) {
    el.textContent = text;
    el.className = "form-status " + (ok ? "is-ok" : "is-error");
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
  var TABLES = {
    declaration: "declarations", loueur: "loueurs_proposes", alerte: "alertes",
    demande_pro: "demandes_pros", pro: "pros_proposes", contact_pro: "contacts_pros"
  };
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
        $all("input[name], select[name], textarea[name]", form).forEach(function (f) {
          if (f.type === "checkbox") { row[f.name] = f.checked; return; }
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
        if (supabaseReady()) {
          req = supaInsert(TABLES[type], row);
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
          var merci = {
            declaration: "Merci, ta réponse est envoyée.",
            demande_pro: "Merci, ta demande est envoyée. Un pro de ton département te recontacte.",
            pro: "Merci, on vérifie tes informations et on revient vers toi."
          };
          done(true, merci[type] || "Merci, c'est envoyé.");
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

  /* ---------- Alertes partagées ---------- */
  function initAlertes() {
    var forms = $all("form[data-alertes]");
    if (!forms.length) return;
    if (!supabaseReady()) {
      $all("[data-alertes-off]").forEach(function (el) { el.hidden = false; });
      forms.forEach(function (f) { $all("button[type=submit]", f).forEach(function (b) { b.disabled = true; }); });
      return;
    }
    forms.forEach(function (form) {
      var action = form.getAttribute("data-alertes");
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var statusEl = $(".form-status", form);
        var button = $("button[type=submit]", form);
        var body = { action: action };
        $all("input[name], select[name]", form).forEach(function (f) { body[f.name] = f.value.trim(); });
        button.disabled = true;
        statusEl.textContent = "Envoi…";
        statusEl.className = "form-status";
        callFn("alertes", body).then(function (j) {
          if (j.paiement) { location.href = j.paiement; return; }
          if (j.continuer) { location.href = j.continuer; return; }
          button.disabled = false;
          if (j.deja) {
            setStatus(statusEl, true, "Tu suis déjà le " + j.departement + " : tes alertes sont actives jusqu'au " + j.expire_txt + ".");
          } else if (j.confirmation) {
            setStatus(statusEl, true, "C'est presque fini : on t'a envoyé un e-mail. Clique sur le lien pour activer " +
              (j.payant ? "ton essai gratuit de " + j.essai_jours + " jours." : "tes alertes."));
            form.reset();
          } else if (action === "signaler") {
            setStatus(statusEl, true, j.prevenus
              ? "Merci ! " + plural(j.prevenus, "candidat a été prévenu", "candidats ont été prévenus") + "."
              : "Merci, ton signalement est enregistré.");
            form.reset();
          }
        }).catch(function (e) {
          button.disabled = false;
          setStatus(statusEl, false, e.message);
        });
      });
    });
  }

  /* ---------- Pages de confirmation (alertes, accès au pack) ---------- */
  function initEtat() {
    var msg = $("#etat-msg");
    if (!msg) return;
    var etat = msg.getAttribute("data-etat");
    function show(ok, text) { msg.textContent = text; msg.classList.toggle("is-error", !ok); }
    if (!supabaseReady()) { show(false, "Ce service ouvre très bientôt."); return; }

    if (etat === "pack") {
      var sid = queryParam("session_id") || store.get("creno-pack-session", "");
      if (!sid) { show(false, "Aucun achat trouvé sur cet appareil. Ouvre le lien reçu après ton paiement, ou écris-nous."); return; }
      callFn("pack", { session_id: sid }).then(function (j) {
        store.set("creno-pack-session", sid);
        show(true, "C'est tout bon, ton pack est prêt.");
        var a = $("#etat-bouton");
        a.href = j.url;
        a.textContent = "Télécharger le Pack candidat libre (PDF)";
        $("#etat-actions").hidden = false;
        var note = $("#etat-note");
        note.textContent = "Le lien de téléchargement marche pendant une heure. Ensuite, reviens sur cette page depuis le même appareil pour en obtenir un nouveau.";
        note.hidden = false;
      }).catch(function (e) { show(false, e.message); });
      return;
    }

    var params = { confirmer: { action: "confirmer", t: queryParam("t") },
                   paiement: { action: "paiement", session_id: queryParam("session_id") },
                   desabonner: { action: "desabonner", t: queryParam("t") } }[etat];
    if (!params || !(params.t || params.session_id)) { show(false, "Ce lien est incomplet. Ouvre-le directement depuis ton e-mail."); return; }
    callFn("alertes", params).then(function (j) {
      if (j.continuer) { location.href = j.continuer; return; }
      if (etat === "desabonner") {
        if (j.abonnement && !j.resilie) show(false, "Les alertes sont arrêtées, mais ton abonnement n'a pas pu être résilié automatiquement. Écris-nous et on l'arrête tout de suite.");
        else show(true, "C'est fait : tu ne recevras plus d'alertes pour ce département." + (j.abonnement ? " Ton abonnement est résilié : tu ne seras plus prélevé." : ""));
      } else if (j.plan === "abonne") {
        show(true, "C'est activé : ton abonnement aux alertes du " + j.departement + " est en place. Prochain renouvellement vers le " +
          j.expire_txt + ". Tu peux l'arrêter à tout moment avec le lien en bas de chaque e-mail.");
      } else if (j.plan === "essai" && j.payant) {
        show(true, "C'est activé : ton essai gratuit court jusqu'au " + j.expire_txt + ". Tu recevras les alertes du " + j.departement +
          ". Quelques jours avant la fin, on t'enverra un e-mail si tu veux continuer.");
      } else {
        show(true, "C'est activé : tu recevras les alertes du " + j.departement + (j.expire_txt ? " jusqu'au " + j.expire_txt : "") + ".");
      }
    }).catch(function (e) { show(false, e.message); });
  }

  /* ---------- Achat du pack ---------- */
  function initPack() {
    var form = $("#pack-form");
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var statusEl = $(".form-status", form);
      if (!CONFIG.lienPaiementPack) { setStatus(statusEl, false, "Le paiement ouvre très bientôt. Reviens dans quelques jours."); return; }
      var url = CONFIG.lienPaiementPack + (CONFIG.lienPaiementPack.indexOf("?") === -1 ? "?" : "&") +
        "client_reference_id=pack-" + uuid();
      location.href = url;
    });
  }

  /* ---------- Badge des auto-écoles (espace pros) ---------- */
  function initBadge() {
    var depSel = $("#badge-dep");
    if (!depSel) return;
    var input = $("#badge-ecole");
    var list = $("#badge-ecoles");
    var result = $("#badge-result");
    var canonical = ($("link[rel=canonical]") || {}).href || location.href;
    var base = canonical.replace(/pro\/?(index\.html)?$/, "");
    var badges = null;
    var ecoles = [];

    function getBadges() {
      if (!badges) badges = fetchJSON("data/badges.json");
      return badges;
    }
    depSel.addEventListener("change", function () {
      input.value = ""; list.innerHTML = ""; result.hidden = true; input.disabled = true;
      if (!depSel.value) return;
      fetchJSON("data/departements/" + encodeURIComponent(depSel.value) + ".json").then(function (dep) {
        ecoles = dep.ecoles;
        list.innerHTML = ecoles.map(function (e) { return '<option value="' + esc(e.nom + ", " + e.ville) + '"></option>'; }).join("");
        input.disabled = false;
        input.focus();
      });
    });
    function show() {
      var e = null;
      ecoles.forEach(function (x) { if (x.nom + ", " + x.ville === input.value) e = x; });
      if (!e) { result.hidden = true; return; }
      getBadges().then(function (b) {
        var depUrl = b.deps[depSel.value];
        var fiche = base + depUrl + "#ae-" + e.id;
        var top = b.top[e.id];
        if (!top) {
          result.innerHTML = '<p>Le badge est réservé aux 10 premières auto-écoles de chaque département. ' +
            (e.taux == null ? "Ton auto-école n'a pas encore de taux de réussite publié." : "Ta fiche est en ligne :") +
            ' <a href="' + esc(depUrl ? link(depUrl) + "#ae-" + e.id : "#") + '">Voir ma fiche</a></p>';
        } else {
          var rang = top[0] === 1 ? "1re" : top[0] + "e";
          var code = '<a href="' + fiche + '" title="Classement Créno des auto-écoles"><img src="' + base + 'badges/' + e.id +
            '.svg" alt="' + esc(e.nom) + ' : ' + rang + ' sur ' + top[1] + ' auto-écoles, classement Créno" width="280" height="88"></a>';
          result.innerHTML =
            '<p><strong>Bravo, ' + esc(e.nom) + ' est ' + rang + ' sur ' + top[1] + ' dans le ' + esc(depSel.value) + '.</strong> Voici ton badge :</p>' +
            '<p><img src="' + ROOT + 'badges/' + esc(e.id) + '.svg" alt="" width="280" height="88"></p>' +
            '<div class="field"><label for="badge-code">Code à coller sur ton site</label>' +
            '<textarea id="badge-code" rows="4" readonly>' + esc(code) + '</textarea></div>' +
            '<button class="btn" type="button" id="badge-copy">Copier le code</button> <span class="form-status" role="status"></span>' +
            '<p class="small">Le badge se met à jour tout seul à chaque nouveau fichier officiel. S\'il n\'est plus dans le top 10, il indique simplement son rang.</p>';
          $("#badge-copy").addEventListener("click", function () {
            var ta = $("#badge-code");
            var st = $(".form-status", result);
            var ok = function () { setStatus(st, true, "Copié."); };
            if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(ok, function () { ta.select(); });
            else { ta.select(); }
          });
        }
        result.hidden = false;
      });
    }
    input.addEventListener("change", show);
    input.addEventListener("input", show);
  }

  /* ---------- Clics vers les partenaires (preuve des clients envoyés) ---------- */
  // Compte un clic vers une auto-école ou un loueur (fonction serveur « stats »).
  // Une même personne compte une fois par jour et par bouton : le serveur s'en occupe.
  var dejaCompte = {};
  function compter(cible) {
    if (!supabaseReady() || !cible || dejaCompte[cible]) return;
    dejaCompte[cible] = true;
    try {
      fetch(CONFIG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/stats", {
        method: "POST", keepalive: true, headers: supaHeaders(),
        body: JSON.stringify({ action: "clic", cible: cible, page: location.pathname, dep: BODY.getAttribute("data-dep") || "" })
      }).catch(function () { /* sans importance */ });
    } catch (e) { /* sans importance */ }
  }

  function initClics() {
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest && ev.target.closest("[data-clic]");
      if (a) compter(a.getAttribute("data-clic"));
    });
    // Ouvrir le volet « Contacter » d'une auto-école compte aussi (sauf ouverture automatique par un lien).
    document.addEventListener("toggle", function (ev) {
      var d = ev.target;
      if (!d.matches || !d.matches("details[data-pro]") || !d.open) return;
      if (d.getAttribute("data-auto")) { d.removeAttribute("data-auto"); return; }
      compter(d.getAttribute("data-pro") + "-ouvert");
    }, true);
  }

  /* ---------- Contacter une auto-école du classement ---------- */
  var MESSAGES = {
    ae: "Bonjour, j'ai trouvé votre auto-école sur Créno. Je voudrais connaître le prix de votre forfait permis B, " +
      "le nombre d'heures comprises et le prix d'une heure en plus. Merci !",
    loueur: "Bonjour, j'ai trouvé votre agence sur Créno. Je voudrais louer une voiture à double commande pour m'entraîner " +
      "et pour le jour de mon examen du permis. Quels sont vos prix et vos disponibilités ? Merci !"
  };

  function prefillDecl(id) {
    var form = $("#contrib-form");
    if (!form || !id) return false;
    var opt = $all("#decl-ecoles option", form).filter(function (o) { return o.getAttribute("data-id") === id; })[0];
    if (!opt) return false;
    $("#decl-ecole", form).value = opt.value;
    $("input[name=auto_ecole_id]", form).value = id;
    return true;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error("copie impossible"));
    });
  }

  function initContact() {
    var rows = $all(".rank-row");
    $all("[data-message]").forEach(function (b) { b.hidden = false; });
    rows.forEach(function (li) { if ($(".rank-more", li)) li.classList.add("is-clickable"); });

    document.addEventListener("click", function (ev) {
      var t = ev.target;
      // Bouton « Copier un message tout prêt »
      var btn = t.closest && t.closest("[data-message]");
      if (btn) {
        var msg = $(".rank-msg", btn.closest(".rank-panel, .renter"));
        var texte = MESSAGES[btn.getAttribute("data-message")] || MESSAGES.ae;
        copyText(texte).then(function () {
          msg.textContent = "Message copié. Colle-le dans un SMS, un e-mail ou le formulaire de leur site : « " + texte + " »";
        }, function () {
          msg.textContent = "Copie ce message : « " + texte + " »";
        });
        msg.hidden = false;
        return;
      }
      // « J'y suis inscrit » : on préremplit le formulaire de la page
      var decl = t.closest && t.closest("[data-decl]");
      if (decl) {
        if ((decl.getAttribute("href") || "").charAt(0) === "#") prefillDecl(decl.getAttribute("data-decl"));
        return;
      }
      // Toucher la carte d'une auto-école ouvre ou ferme son volet « Contacter »
      var li = t.closest && t.closest(".rank-row.is-clickable");
      if (!li || t.closest("a, button, summary, input, select, label, .rank-panel")) return;
      var d = $(".rank-more", li);
      d.open = !d.open;
    });

    // Arrivée depuis un lien vers une auto-école (#ae-...) : son volet est ouvert
    if (location.hash.indexOf("#ae-") === 0) {
      var el = document.getElementById(location.hash.slice(1));
      var det = el && $(".rank-more", el);
      if (det) { det.setAttribute("data-auto", "1"); det.open = true; }
    }
    // Arrivée depuis une page ville avec ?ae=... : l'auto-école est déjà choisie dans le formulaire
    var ae = queryParam("ae");
    if (ae) prefillDecl(ae);
  }

  /* ---------- Continuer les alertes après l'essai ---------- */
  function initContinuer() {
    var form = $("#cont-form");
    if (!form) return;
    var msg = $("#cont-msg");
    function show(ok, text) { msg.textContent = text; msg.classList.toggle("is-error", !ok); }
    if (!supabaseReady()) { show(false, "Ce service ouvre très bientôt."); return; }
    var t = queryParam("t");
    if (!t) { show(false, "Ce lien est incomplet. Ouvre-le directement depuis ton e-mail."); return; }
    var lien = "";
    callFn("alertes", { action: "continuer", t: t }).then(function (j) {
      if (j.deja) { show(true, "Tu es déjà abonné aux alertes du " + j.departement + ", jusqu'au " + j.expire_txt + " au moins. Tu n'as rien à faire."); return; }
      if (j.gratuit) { show(true, "Bonne nouvelle : les alertes sont gratuites pendant le lancement. Tu n'as rien à payer."); return; }
      lien = j.paiement;
      show(true, "Continue à recevoir les places signalées dans le " + j.departement + ", dès qu'un candidat les voit.");
      $("#cont-offre").hidden = false;
    }).catch(function (e) { show(false, e.message); });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (lien) location.href = lien;
    });
  }

  /* ---------- Noms des auto-écoles et des loueurs (tableau de bord, rapport) ---------- */
  var depCache = {};
  function chargerDep(code) {
    if (!depCache[code]) depCache[code] = fetchJSON("data/departements/" + encodeURIComponent(code) + ".json").catch(function () { return { ecoles: [] }; });
    return depCache[code];
  }
  var loueursCache = null;
  function chargerLoueurs() {
    if (!loueursCache) loueursCache = fetchJSON("data/loueurs.json").then(function (j) { return j.loueurs || []; }).catch(function () { return []; });
    return loueursCache;
  }
  function slugJS(s) { return norm(s).replace(/ /g, "-"); }
  // Renvoie { nom, lieu, type, e } pour « ae-<agrément> » ou « loueur-<nom> »
  function decrirePro(p, dep) {
    if (p.indexOf("loueur-") === 0) {
      return chargerLoueurs().then(function (ls) {
        var l = ls.filter(function (x) { return "loueur-" + slugJS(x.nom) === p; })[0];
        return { type: "loueur", nom: l ? l.nom : p.slice(7), lieu: l ? l.ville + " (" + l.dep + ")" : "" };
      });
    }
    var id = p.slice(3);
    if (!dep) return Promise.resolve({ type: "ae", nom: "Auto-école " + id, lieu: "" });
    return chargerDep(dep).then(function (d) {
      var e = (d.ecoles || []).filter(function (x) { return x.id === id; })[0];
      return { type: "ae", e: e, nom: e ? e.nom : "Auto-école " + id, lieu: e ? e.ville + " (" + dep + ")" : "Département " + dep };
    });
  }
  var moisFmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
  function moisTxt(m) { var p = String(m).split("-"); return moisFmt.format(new Date(Number(p[0]), Number(p[1]) - 1, 1)); }
  function dateTxt(iso) { var p = String(iso).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); }
  function baseSite() {
    var canonical = ($("link[rel=canonical]") || {}).href || location.href;
    return canonical.replace(/(admin|rapport)\/?(index\.html)?(\?.*)?$/, "");
  }

  /* ---------- Tableau de bord (page privée /admin/) ---------- */
  function initAdmin() {
    var form = $("#admin-form");
    if (!form) return;
    var statusEl = $(".form-status", form);
    var saved = "";
    try { saved = window.sessionStorage.getItem("creno-admin") || ""; } catch (e) { saved = ""; }
    if (saved) $("#admin-code").value = saved;

    function fact(n, txt) { return "<div><dt>" + n + "</dt><dd>" + txt + "</dd></div>"; }
    function charger(code) {
      if (!supabaseReady()) { setStatus(statusEl, false, "Supabase n'est pas encore branché (assets/config.js)."); return; }
      statusEl.textContent = "Chargement…"; statusEl.className = "form-status";
      callFn("stats", { action: "admin", code: code }).then(function (j) {
        try { window.sessionStorage.setItem("creno-admin", code); } catch (e) { /* sans importance */ }
        statusEl.textContent = "";
        form.hidden = true;
        $("#admin-board").hidden = false;
        var a = j.alertes || {};
        $("#admin-alertes").innerHTML =
          fact(intFmt.format(a.abonnes || 0), "abonnés payants") +
          fact(eur(a.revenu_mensuel || 0), "par mois avec ces abonnés (avant frais Stripe)") +
          fact(intFmt.format(a.essais || 0), "essais gratuits en cours") +
          fact(intFmt.format(a.signalements_30j || 0), "places signalées ces 30 derniers jours");
        var pros = j.pros || [];
        var t30 = 0, tout = 0;
        pros.forEach(function (p) { t30 += p.j30; tout += p.total; });
        $("#admin-totaux").innerHTML = fact(intFmt.format(t30), "élèves envoyés ces 30 derniers jours") +
          fact(intFmt.format(tout), "élèves envoyés depuis le début") + fact(intFmt.format(pros.length), "auto-écoles et loueurs contactés");
        $("#admin-vide").hidden = pros.length > 0;
        var base = baseSite();
        Promise.all(pros.map(function (p) { return decrirePro(p.p, p.departement).then(function (d) { p.d = d; return p; }); })).then(function () {
          $("#admin-rows").innerHTML = pros.map(function (p, i) {
            var url = base + "rapport/?p=" + encodeURIComponent(p.p) + (p.departement ? "&d=" + encodeURIComponent(p.departement) : "") + "&k=" + p.k;
            p.q = norm(p.d.nom + " " + p.d.lieu + " " + (p.departement || ""));
            return '<tr data-i="' + i + '"><td class="cell-titre"><strong>' + esc(p.d.nom) + '</strong><span class="sub">' + esc((p.d.type === "loueur" ? "Loueur · " : "Auto-école · ") + p.d.lieu) + '</span></td>' +
              '<td data-label="30 derniers jours"><span>' + intFmt.format(p.j30) + '<span class="sub">dont ' + intFmt.format(p.j30_action) + ' avec un clic de contact</span></span></td>' +
              '<td data-label="Depuis le début"><span>' + intFmt.format(p.total) + '<span class="sub">dont ' + intFmt.format(p.total_action) + ' avec un clic de contact</span></span></td>' +
              '<td data-label="Rapport"><div class="rap-actions"><button class="btn btn-small btn-ghost" type="button" data-copier="' + esc(url) + '">Copier le lien</button>' +
              '<a class="btn btn-small btn-ghost" href="' + esc(url) + '" target="_blank" rel="noopener">Voir</a></div></td></tr>';
          }).join("");
        });
        $("#admin-filtre").addEventListener("input", function (ev) {
          var q = norm(ev.target.value);
          $all("#admin-rows tr").forEach(function (tr) { var p = pros[Number(tr.getAttribute("data-i"))]; tr.hidden = !!q && (p.q || "").indexOf(q) === -1; });
        });
      }).catch(function (e) { setStatus(statusEl, false, e.message); });
    }
    form.addEventListener("submit", function (ev) { ev.preventDefault(); charger($("#admin-code").value.trim()); });
    document.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-copier]");
      if (!b) return;
      copyText(b.getAttribute("data-copier")).then(function () { b.textContent = "Lien copié"; }, function () { b.textContent = "Copie impossible"; });
    });
    if (saved) charger(saved);
  }

  /* ---------- Rapport envoyé à une auto-école ou un loueur (page /rapport/) ---------- */
  function initRapport() {
    var box = $("#rap-contenu");
    if (!box) return;
    var lieu = $("#rap-lieu");
    function erreur(text) { lieu.textContent = text; lieu.classList.add("is-error"); }
    if (!supabaseReady()) { erreur("Ce service ouvre très bientôt."); return; }
    var p = queryParam("p"), k = queryParam("k"), dep = queryParam("d");
    if (!p || !k) { erreur("Ce lien de rapport est incomplet. Demandez un nouveau lien à Créno."); return; }
    Promise.all([callFn("stats", { action: "rapport", p: p, k: k }), decrirePro(p, dep), fetchJSON("data/badges.json").catch(function () { return null; })])
      .then(function (res) {
        var j = res[0], d = res[1], badges = res[2];
        var loueur = d.type === "loueur";
        $("#rap-nom").textContent = d.nom;
        document.title = "Rapport Créno : " + d.nom;
        lieu.textContent = (d.lieu ? d.lieu + " · " : "") + (j.depuis ? "chiffres depuis le " + dateTxt(j.depuis) : "aucun contact compté pour l'instant");
        var total = loueur ? j.total.personnes_action : j.total.personnes;
        $("#rap-total").textContent = intFmt.format(total);
        $("#rap-total-txt").textContent = loueur
          ? (total > 1 ? "élèves ont cliqué pour réserver chez vous ou vous contacter depuis Créno" : "élève a cliqué pour réserver chez vous ou vous contacter depuis Créno")
          : (total > 1 ? "élèves ont cliqué sur « Contacter » sur votre fiche Créno" : "élève a cliqué sur « Contacter » sur votre fiche Créno");
        var ceMois = (j.mois || []).filter(function (m) { return m.mois === j.ce_mois; })[0] || { personnes: 0, personnes_action: 0 };
        var facts = '<div><dt>' + intFmt.format(loueur ? ceMois.personnes_action : ceMois.personnes) + '</dt><dd>en ' + esc(moisTxt(j.ce_mois)) + '</dd></div>';
        if (!loueur) facts += '<div><dt>' + intFmt.format(j.total.personnes_action) + '</dt><dd>ont ensuite cliqué pour vous appeler, venir ou aller sur votre site</dd></div>';
        if (d.e && d.e.taux != null) {
          var top = badges && badges.top && badges.top[d.e.id];
          facts += '<div><dt>' + Math.round(d.e.taux * 100) + ' %</dt><dd>de réussite au 1er passage' +
            (top ? ", " + (top[0] === 1 ? "1re" : top[0] + "e") + " sur " + top[1] + " dans le " + esc(dep) + " au classement Créno" : ", taux officiel de la Sécurité routière") + '</dd></div>';
        }
        $("#rap-facts").innerHTML = facts;
        var cols = loueur
          ? [["personnes_action", "Élèves"], ["reserver", "Réserver"], ["site", "Site web"], ["carte", "Téléphone et itinéraire"], ["message", "Message copié"]]
          : [["personnes", "Élèves"], ["carte", "Téléphone et itinéraire"], ["site", "Site web"], ["email", "E-mail"], ["message", "Message copié"]];
        cols = cols.filter(function (c, i) { return i === 0 || (j.mois || []).some(function (m) { return m[c[0]] > 0; }) || c[0] === "carte"; });
        $("#rap-table thead").innerHTML = "<tr><th scope=\"col\">Mois</th>" + cols.map(function (c) { return '<th scope="col" class="num">' + c[1] + "</th>"; }).join("") + "</tr>";
        $("#rap-table tbody").innerHTML = (j.mois || []).slice().reverse().map(function (m) {
          return "<tr><th scope=\"row\">" + esc(moisTxt(m.mois)) + "</th>" + cols.map(function (c) { return '<td class="num" data-label="' + esc(c[1]) + '">' + intFmt.format(m[c[0]]) + "</td>"; }).join("") + "</tr>";
        }).join("") || '<tr><td colspan="' + (cols.length + 1) + '">Pas encore de chiffres. Revenez dans quelques jours.</td></tr>';
        box.hidden = false;
      }).catch(function (e) { erreur(e.message); });
  }

  /* ---------- Compteur public (espace pros) ---------- */
  function initTotal() {
    var el = $("#total-contacts");
    if (!el || !supabaseReady()) return;
    callFn("stats", { action: "total" }).then(function (j) {
      if (!j.total || j.total < 50) return; // on n'affiche pas un chiffre trop petit
      el.innerHTML = "<strong>" + intFmt.format(j.total) + "</strong> fois, un élève a déjà cliqué sur Créno pour contacter une auto-école ou un loueur.";
      el.hidden = false;
    }).catch(function () { /* sans importance */ });
  }

  /* ---------- Démarrage ---------- */
  function start() {
    $all("form[data-finder]").forEach(initFinder);
    initRanking();
    initCalc();
    initForms();
    initChecklist();
    initAlertes();
    initEtat();
    initPack();
    initBadge();
    initClics();
    initContact();
    initContinuer();
    initAdmin();
    initRapport();
    initTotal();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
