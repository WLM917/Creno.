/* Créno : navigation, classement, calculateur, formulaires, checklist. */
(function () {
  "use strict";

  var CONFIG = window.CRENO_CONFIG || {};
  var VIEWS = ["accueil", "classement", "candidat-libre", "examen", "methode"];
  var VIEW_TITLES = {
    "accueil": "Créno",
    "classement": "Classement des auto-écoles | Créno",
    "candidat-libre": "Candidat libre | Créno",
    "examen": "Jour de l'examen | Créno",
    "methode": "Méthode | Créno"
  };
  var LABEL_NAMES = {
    qualite: "Label qualité",
    permis1euro: "Permis à 1 € par jour",
    associative: "Associative",
    enligne: "En ligne"
  };
  var SHRINK_K = 40;          // poids de la moyenne du département pour les petites auto-écoles
  var SMALL_SAMPLE = 50;      // en dessous, on signale que le taux est ajusté
  var W_TAUX = 0.6, W_COUT = 0.4;
  var BUDGET_MAX = 3000;
  var PAGE = 30;

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
  function pct(x) { return Math.round(x * 100) + " %"; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-']/g, " ").trim();
  }
  function plural(n, one, many) { return intFmt.format(n) + " " + (n > 1 ? many : one); }

  function fetchJSON(path) {
    // Version en un seul fichier (scripts/build_preview.py) : données intégrées dans la page.
    var inline = window.CRENO_DATA && window.CRENO_DATA[path];
    if (inline) return Promise.resolve(inline);
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ---------- Données ---------- */
  var INDEX = null;
  var depCache = {};
  function depInfo(code) {
    if (!INDEX) return null;
    for (var i = 0; i < INDEX.departements.length; i++) if (INDEX.departements[i].code === code) return INDEX.departements[i];
    return null;
  }
  function depLabel(d) { return d.nom + " (" + d.code + ")"; }
  function loadDep(code) {
    if (!depCache[code]) {
      depCache[code] = fetchJSON("data/departements/" + encodeURIComponent(code) + ".json").catch(function (err) {
        delete depCache[code];
        throw err;
      });
    }
    return depCache[code];
  }

  /* ---------- Navigation ---------- */
  var currentView = null;
  function showView() {
    var v = (location.hash || "").replace("#", "");
    if (VIEWS.indexOf(v) === -1) v = "accueil";
    $all("[data-view]").forEach(function (s) { s.hidden = s.getAttribute("data-view") !== v; });
    $all("[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === v) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = VIEW_TITLES[v];
    if (currentView !== null && currentView !== v) {
      window.scrollTo(0, 0);
      var main = $("#main");
      if (main) main.focus({ preventScroll: true });
    }
    currentView = v;
  }
  window.addEventListener("hashchange", showView);

  /* ---------- Classement ---------- */
  function coutReel(e) {
    if (e.forfait == null || e.heures_incluses == null || e.prix_heure == null) return null;
    var heures = e.heures_moyennes == null ? e.heures_incluses : e.heures_moyennes;
    var enPlus = Math.max(0, heures - e.heures_incluses);
    return Math.round(e.forfait + enPlus * e.prix_heure + (e.frais_examen || 0));
  }

  function scale(value, min, max, invert) {
    if (max === min) return 50;
    var s = (value - min) / (max - min) * 100;
    return invert ? 100 - s : s;
  }

  // Classe les auto-écoles d'un département les unes par rapport aux autres.
  function rankDep(dep) {
    var ecoles = dep.ecoles.filter(function (e) { return typeof e.taux === "number" && e.presentes > 0; });
    var sansTaux = dep.ecoles.filter(function (e) { return typeof e.taux !== "number"; });
    var moyenne = dep.moyenne || 0;

    var rows = ecoles.map(function (e) {
      var ajuste = (e.taux * e.presentes + moyenne * SHRINK_K) / (e.presentes + SHRINK_K);
      return { e: e, ajuste: ajuste, cout: coutReel(e) };
    });
    var aj = rows.map(function (r) { return r.ajuste; });
    var couts = rows.filter(function (r) { return r.cout != null; }).map(function (r) { return r.cout; });
    var ajMin = Math.min.apply(null, aj), ajMax = Math.max.apply(null, aj);
    var cMin = Math.min.apply(null, couts), cMax = Math.max.apply(null, couts);
    var avecPrix = couts.length > 0;

    rows.forEach(function (r) {
      var sTaux = scale(r.ajuste, ajMin, ajMax, false);
      if (!avecPrix) { r.indice = Math.round(sTaux); return; }
      var sCout = r.cout == null ? 50 : scale(r.cout, cMin, cMax, true);
      r.indice = Math.round(W_TAUX * sTaux + W_COUT * sCout);
    });
    rows.sort(function (a, b) { return b.indice - a.indice || b.ajuste - a.ajuste; });
    rows.forEach(function (r, i) { r.rang = i + 1; });
    return { rows: rows, moyenne: moyenne, avecPrix: avecPrix, nbPrix: couts.length, sansTaux: sansTaux };
  }

  function chipsHTML(e) {
    var html = "";
    if (e.partenaire) html += '<span class="chip chip-flag">Partenaire payant</span>';
    (e.labels || []).forEach(function (l) {
      if (LABEL_NAMES[l]) html += '<span class="chip">' + LABEL_NAMES[l] + '</span>';
    });
    return html;
  }

  function rowHTML(r, moyenne, compact) {
    var e = r.e;
    var coutHTML = r.cout == null
      ? '<span class="metric-value is-missing">Prix pas encore déclaré</span>'
      : '<span class="metric-value">' + eur(r.cout) + '</span>';
    var coutNote = r.cout == null
      ? '<span class="metric-note">Aucune déclaration d\'élève pour l\'instant</span>'
      : '<span class="metric-note">' + plural(e.declarations || 0, "déclaration d'élève", "déclarations d'élèves") + '</span>';
    var tauxNote = e.presentes < SMALL_SAMPLE
      ? "Seulement " + plural(e.presentes, "élève", "élèves") + ", taux ajusté"
      : plural(e.presentes, "élève", "élèves") + " au 1er passage";
    var place = compact ? esc(e.ville) : esc(e.adresse ? e.adresse + ", " : "") + esc(e.ville);
    var site = !compact && e.site
      ? ' <a class="rank-site" href="' + esc(e.site) + '" target="_blank" rel="noopener">Site web<span class="visually-hidden"> de ' + esc(e.nom) + '</span></a>'
      : "";
    return '' +
      '<li class="rank-row' + (r.rang === 1 ? " is-first" : "") + '">' +
        '<span class="rank-plate"><span class="visually-hidden">Rang </span>' + r.rang + '</span>' +
        '<div class="rank-main">' +
          '<h3 class="rank-name">' + esc(e.nom) + '</h3>' +
          '<p class="rank-place">' + place + site + '</p>' +
          (compact ? "" : '<p class="rank-chips">' + chipsHTML(e) + '</p>') +
        '</div>' +
        '<div class="metric metric-taux">' +
          '<span class="metric-label">Réussite au 1er passage</span>' +
          '<span class="metric-value">' + pct(e.taux) + '</span>' +
          '<span class="bar" role="img" aria-label="' + pct(e.taux) + ' de réussite, moyenne du département ' + pct(moyenne) + '">' +
            '<span class="bar-fill" style="width:' + Math.round(e.taux * 100) + '%"></span>' +
            '<span class="bar-avg" style="left:calc(' + Math.round(moyenne * 100) + '% - 1px)"></span>' +
          '</span>' +
          '<span class="metric-note">' + tauxNote + '</span>' +
        '</div>' +
        '<div class="metric metric-cout">' +
          '<span class="metric-label">Coût réel estimé</span>' + coutHTML + coutNote +
        '</div>' +
        '<div class="rank-score"><strong>' + r.indice + '</strong><span>sur 100</span></div>' +
      '</li>';
  }

  function loadingHTML(text) { return '<li class="loading">' + esc(text) + '</li>'; }
  function errorHTML() {
    return '<li class="empty">Le classement n\'a pas pu se charger. Vérifie ta connexion et recharge la page.</li>';
  }

  function initRanking() {
    var deps = INDEX.departements.filter(function (d) { return d.nb_taux > 0; });
    var codes = deps.map(function (d) { return d.code; });
    var options = deps.map(function (d) { return '<option value="' + esc(d.code) + '">' + esc(depLabel(d)) + '</option>'; }).join("");
    $("#f-zone").innerHTML = options;
    var alertDep = $("#alert-dep");
    if (alertDep) {
      alertDep.innerHTML = '<option value="">Choisis</option>' +
        INDEX.departements.map(function (d) { return '<option value="' + esc(d.code) + '">' + esc(depLabel(d)) + '</option>'; }).join("");
    }

    var saved = store.get("creno-filtres", null) || {};
    var fallback = codes.indexOf(String(CONFIG.departementParDefaut)) !== -1 ? String(CONFIG.departementParDefaut) : codes[0];
    var state = {
      zone: codes.indexOf(saved.zone) !== -1 ? saved.zone : fallback,
      search: "",
      budget: saved.budget || BUDGET_MAX,
      sort: saved.sort || "indice",
      unknown: typeof saved.unknown === "boolean" ? saved.unknown : true,
      crit: { permis1euro: !!(saved.crit && saved.crit.permis1euro), qualite: !!(saved.crit && saved.crit.qualite), aac: !!(saved.crit && saved.crit.aac) },
      limit: PAGE
    };
    $("#f-zone").value = state.zone;
    $("#f-budget").value = state.budget;
    $("#f-sort").value = state.sort;
    $("#f-unknown").checked = state.unknown;
    $("#f-1euro").checked = state.crit.permis1euro;
    $("#f-qualite").checked = state.crit.qualite;
    $("#f-aac").checked = state.crit.aac;

    var ranked = null;
    var token = 0;

    function save() {
      store.set("creno-filtres", { zone: state.zone, budget: state.budget, sort: state.sort, unknown: state.unknown, crit: state.crit });
    }

    function renderHome(code) {
      var info = depInfo(code);
      $all("[data-zone-label]").forEach(function (el) { el.textContent = "dans le " + code; });
      $("#home-ranking").innerHTML = loadingHTML("Chargement du classement…");
      loadDep(code).then(function (dep) {
        var res = rankDep(dep);
        $("#home-ranking").innerHTML = res.rows.slice(0, 5).map(function (r) { return rowHTML(r, res.moyenne, true); }).join("");
        $("#home-zone").textContent = info.nom + ". Réussite moyenne au 1er passage : " + pct(res.moyenne) +
          " (" + pct(INDEX.meta.moyenne_nationale) + " en France).";
      }).catch(function () { $("#home-ranking").innerHTML = errorHTML(); });
    }

    function matches(e, q) {
      if (q && norm(e.nom + " " + e.ville + " " + e.cp + " " + (e.adresse || "")).indexOf(q) === -1) return false;
      var labels = e.labels || [];
      if (state.crit.permis1euro && labels.indexOf("permis1euro") === -1) return false;
      if (state.crit.qualite && labels.indexOf("qualite") === -1) return false;
      if (state.crit.aac && labels.indexOf("aac") === -1) return false;
      return true;
    }

    function render() {
      if (!ranked) return;
      var res = ranked;
      var q = norm(state.search);
      // Sans aucun prix déclaré dans le département, le budget ne peut rien filtrer.
      $("#f-budget").disabled = !res.avecPrix;
      $("#f-unknown").disabled = !res.avecPrix;
      var rows = res.rows.filter(function (r) {
        if (!matches(r.e, q)) return false;
        if (!res.avecPrix) return true;
        if (r.cout == null) return state.unknown;
        return state.budget >= BUDGET_MAX || r.cout <= state.budget;
      });
      if (state.sort === "taux") rows = rows.slice().sort(function (a, b) { return b.e.taux - a.e.taux; });
      if (state.sort === "cout") rows = rows.slice().sort(function (a, b) {
        if (a.cout == null && b.cout == null) return a.rang - b.rang;
        if (a.cout == null) return 1;
        if (b.cout == null) return -1;
        return a.cout - b.cout;
      });

      $("#ranking").innerHTML = rows.slice(0, state.limit).map(function (r) { return rowHTML(r, res.moyenne, false); }).join("");
      $("#ranking-empty").hidden = rows.length > 0;
      var more = $("#ranking-more");
      var left = rows.length - state.limit;
      more.hidden = left <= 0;
      more.textContent = "Afficher " + Math.min(PAGE, Math.max(left, 0)) + " de plus (" + intFmt.format(Math.max(left, 0)) + " restantes)";

      var info = depInfo(state.zone);
      var n = res.rows.length;
      var summary = plural(n, "auto-école classée", "auto-écoles classées") + " dans le " + state.zone + " (" + info.nom + ")" +
        ", réussite moyenne au 1er passage : " + pct(res.moyenne) + ".";
      if (rows.length !== n) summary += " " + plural(rows.length, "correspond", "correspondent") + " à tes filtres.";
      $("#zone-summary").textContent = summary;

      var note = $("#price-note");
      note.textContent = res.avecPrix
        ? plural(res.nbPrix, "auto-école a", "auto-écoles ont") + " des prix déclarés par des élèves dans ce département."
        : "Aucun prix déclaré pour l'instant dans ce département. L'indice se base donc sur la réussite, et le filtre budget comptera dès les premières déclarations d'élèves.";

      var unranked = res.sansTaux.filter(function (e) { return matches(e, q); });
      $("#unranked").hidden = unranked.length === 0;
      $("#unranked-title").textContent = plural(unranked.length, "auto-école", "auto-écoles") + " sans taux de réussite publié";
      $("#unranked-list").innerHTML = unranked.map(function (e) {
        return '<li><strong>' + esc(e.nom) + '</strong><span>' + esc(e.ville) + '</span></li>';
      }).join("");

      $("#f-budget-out").textContent = state.budget >= BUDGET_MAX ? "pas de limite" : eur(state.budget);
      save();
    }

    function loadZone() {
      var my = ++token;
      ranked = null;
      $("#ranking").innerHTML = loadingHTML("Chargement des auto-écoles du " + state.zone + "…");
      $("#ranking-more").hidden = true;
      $("#ranking-empty").hidden = true;
      loadDep(state.zone).then(function (dep) {
        if (my !== token) return;
        ranked = rankDep(dep);
        render();
      }).catch(function () {
        if (my !== token) return;
        $("#ranking").innerHTML = errorHTML();
      });
    }

    function reset() { state.limit = PAGE; render(); }

    $("#f-zone").addEventListener("change", function (ev) {
      state.zone = ev.target.value; state.limit = PAGE; save();
      loadZone(); renderHome(state.zone);
    });
    $("#f-search").addEventListener("input", function (ev) { state.search = ev.target.value; reset(); });
    $("#f-budget").addEventListener("input", function (ev) { state.budget = Number(ev.target.value); reset(); });
    $("#f-sort").addEventListener("change", function (ev) { state.sort = ev.target.value; reset(); });
    $("#f-unknown").addEventListener("change", function (ev) { state.unknown = ev.target.checked; reset(); });
    $("#f-1euro").addEventListener("change", function (ev) { state.crit.permis1euro = ev.target.checked; reset(); });
    $("#f-qualite").addEventListener("change", function (ev) { state.crit.qualite = ev.target.checked; reset(); });
    $("#f-aac").addEventListener("change", function (ev) { state.crit.aac = ev.target.checked; reset(); });
    $("#ranking-more").addEventListener("click", function () { state.limit += PAGE; render(); });

    renderHome(state.zone);
    loadZone();
  }

  function initDataStatus() {
    var m = INDEX.meta;
    var d = new Date(m.importe_le + "T12:00:00");
    var when = isNaN(d) ? m.importe_le : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    $("#data-status").textContent = "Fichier importé le " + when + " : " +
      intFmt.format(m.nb_auto_ecoles) + " auto-écoles enseignent le permis B, dont " +
      intFmt.format(m.nb_avec_taux) + " avec un taux de réussite publié. Réussite moyenne au 1er passage en France : " +
      pct(m.moyenne_nationale) + ".";
  }

  function indexError() {
    $("#ranking").innerHTML = errorHTML();
    $("#home-ranking").innerHTML = errorHTML();
  }

  /* ---------- Calculateur ---------- */
  function initCalc() {
    var ids = ["calc-forfait", "calc-incluses", "calc-prix", "calc-besoin", "calc-frais", "calc-budget"];
    var saved = store.get("creno-calc", null);
    if (saved) ids.forEach(function (id) { if (saved[id] != null && $("#" + id)) $("#" + id).value = saved[id]; });

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

  /* ---------- Loueurs ---------- */
  function initRenters(data) {
    var list = (data && data.loueurs) || [];
    $("#renters").innerHTML = list.length
      ? list.map(function (l) {
          var site = l.site ? '<a href="' + esc(l.site) + '" target="_blank" rel="noopener">Voir le site</a>' : "";
          return '<li><strong>' + esc(l.nom) + '</strong><span>' + esc(l.ville) + ' (' + esc(l.dep) + ')</span>' + site + '</li>';
        }).join("")
      : '<li><span>Aucun loueur pour l\'instant. Ajoute le premier ci-dessous.</span></li>';
  }

  /* ---------- Formulaires ---------- */
  function initForms() {
    $all("form[data-form-type]").forEach(function (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var statusEl = $(".form-status", form);
        var button = $("button[type=submit]", form);
        var payload = { type: form.getAttribute("data-form-type"), envoye_le: new Date().toISOString(), reponses: {} };
        $all("input[name], select[name]", form).forEach(function (f) { payload.reponses[f.name] = f.value; });

        function done(ok, text) {
          statusEl.textContent = text;
          statusEl.className = "form-status " + (ok ? "is-ok" : "is-error");
          button.disabled = false;
          if (ok) form.reset();
        }

        button.disabled = true;
        if (CONFIG.formEndpoint) {
          fetch(CONFIG.formEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(payload)
          }).then(function (r) {
            if (!r.ok) throw new Error();
            done(true, "Merci, c'est envoyé.");
          }).catch(function () {
            done(false, "L'envoi n'a pas marché. Vérifie ta connexion et réessaie.");
          });
        } else {
          var pending = store.get("creno-envois", []);
          pending.push(payload);
          store.set("creno-envois", pending);
          done(true, "Enregistré sur cet appareil. L'envoi en ligne n'est pas encore branché.");
        }
      });
    });
  }

  /* ---------- Checklist ---------- */
  function initChecklist() {
    var boxes = $all("#checklist input[type=checkbox]");
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
    showView();
    initCalc();
    initForms();
    initChecklist();
    fetchJSON("data/index.json").then(function (index) {
      INDEX = index;
      initDataStatus();
      initRanking();
    }).catch(indexError);
    fetchJSON("data/loueurs.json").then(initRenters).catch(function () { initRenters(null); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
