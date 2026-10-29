/* Permiscope : navigation, classement, calculateur, formulaires, checklist. */
(function () {
  "use strict";

  var CONFIG = window.PERMISCOPE_CONFIG || {};
  var VIEWS = ["accueil", "classement", "candidat-libre", "examen", "methode"];
  var VIEW_TITLES = {
    "accueil": "Permiscope",
    "classement": "Classement des auto-écoles | Permiscope",
    "candidat-libre": "Candidat libre | Permiscope",
    "examen": "Jour de l'examen | Permiscope",
    "methode": "Méthode | Permiscope"
  };
  var DEP_NAMES = {
    "75": "Paris", "77": "Seine-et-Marne", "78": "Yvelines", "91": "Essonne",
    "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise"
  };
  var DEP_IN = {
    "75": "à Paris", "77": "en Seine-et-Marne", "78": "dans les Yvelines", "91": "en Essonne",
    "92": "dans les Hauts-de-Seine", "93": "en Seine-Saint-Denis", "94": "dans le Val-de-Marne", "95": "dans le Val-d'Oise",
    "all": "en Île-de-France"
  };
  var SHRINK_K = 40;          // poids de la moyenne de zone pour les petites auto-écoles
  var W_TAUX = 0.6, W_COUT = 0.4;
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
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  }
  function depLabel(dep) { return DEP_NAMES[dep] ? DEP_NAMES[dep] + " (" + dep + ")" : "Département " + dep; }

  function loadJSON(path, inlineName) {
    if (window[inlineName]) return Promise.resolve(window[inlineName]);
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
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

  // Calcule l'indice de chaque auto-école, comparée aux autres de la même zone.
  function rankZone(ecoles) {
    var totalPres = 0, totalReussis = 0;
    ecoles.forEach(function (e) { totalPres += e.presentes; totalReussis += e.taux * e.presentes; });
    var moyenne = totalPres ? totalReussis / totalPres : 0;

    var rows = ecoles.map(function (e) {
      var ajuste = (e.taux * e.presentes + moyenne * SHRINK_K) / (e.presentes + SHRINK_K);
      return { e: e, ajuste: ajuste, cout: coutReel(e) };
    });
    var aj = rows.map(function (r) { return r.ajuste; });
    var couts = rows.filter(function (r) { return r.cout != null; }).map(function (r) { return r.cout; });
    var ajMin = Math.min.apply(null, aj), ajMax = Math.max.apply(null, aj);
    var cMin = couts.length ? Math.min.apply(null, couts) : 0, cMax = couts.length ? Math.max.apply(null, couts) : 0;

    rows.forEach(function (r) {
      var sTaux = scale(r.ajuste, ajMin, ajMax, false);
      var sCout = r.cout == null ? 50 : scale(r.cout, cMin, cMax, true);
      r.indice = Math.round(W_TAUX * sTaux + W_COUT * sCout);
    });
    rows.sort(function (a, b) { return b.indice - a.indice || b.e.taux - a.e.taux; });
    rows.forEach(function (r, i) { r.rang = i + 1; });
    return { rows: rows, moyenne: moyenne, total: totalPres };
  }

  function rowHTML(r, moyenne, isDemo) {
    var e = r.e;
    var small = e.presentes < 50;
    var flags = "";
    if (e.exemple || isDemo) flags += '<span class="chip">Exemple</span>';
    if (e.partenaire) flags += '<span class="chip chip-flag">Partenaire payant</span>';
    var coutHTML = r.cout == null
      ? '<span class="metric-value is-missing">Prix pas encore déclaré</span>'
      : '<span class="metric-value">' + eur(r.cout) + '</span>';
    var coutNote = r.cout == null
      ? '<span class="metric-note">Note de prix neutre en attendant</span>'
      : '<span class="metric-note">' + e.declarations + (e.declarations > 1 ? " déclarations d'élèves" : " déclaration d'élève") + '</span>';
    var tauxNote = small
      ? "Seulement " + e.presentes + " élèves présentés, taux ajusté"
      : e.presentes + " élèves présentés";
    return '' +
      '<li class="rank-row' + (r.rang === 1 ? " is-first" : "") + '">' +
        '<span class="rank-plate" aria-label="Rang ' + r.rang + '">' + r.rang + '</span>' +
        '<div class="rank-main">' +
          '<h3 class="rank-name">' + esc(e.nom) + flags + '</h3>' +
          '<p class="rank-place">' + esc(e.ville) + ' (' + esc(e.dep) + ')</p>' +
        '</div>' +
        '<div class="metric metric-taux">' +
          '<span class="metric-label">Taux de réussite officiel</span>' +
          '<span class="metric-value">' + pct(e.taux) + '</span>' +
          '<span class="bar" role="img" aria-label="' + pct(e.taux) + ' de réussite, moyenne de la zone ' + pct(moyenne) + '">' +
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

  function initRanking(data) {
    var ecoles = (data.ecoles || []).filter(function (e) { return typeof e.taux === "number" && e.presentes > 0; });
    var isDemo = !!(data.meta && data.meta.demo);
    if (isDemo) $all("[data-demo-note]").forEach(function (el) { el.hidden = false; });

    var status = $("#data-status");
    if (status) {
      status.textContent = isDemo
        ? "État des données : version de démonstration, auto-écoles fictives."
        : "Données mises à jour le " + (data.meta && data.meta.mis_a_jour ? data.meta.mis_a_jour : "—") + ".";
    }

    var deps = Array.from(new Set(ecoles.map(function (e) { return e.dep; }))).sort();
    var zoneSel = $("#f-zone");
    zoneSel.innerHTML = '<option value="all">Toute l\'Île-de-France</option>' +
      deps.map(function (d) { return '<option value="' + esc(d) + '">' + esc(depLabel(d)) + '</option>'; }).join("");

    var saved = store.get("permiscope-filtres", null);
    var defaultDep = deps.indexOf(String(CONFIG.departementParDefaut)) !== -1 ? String(CONFIG.departementParDefaut) : "all";
    var state = {
      zone: saved && (saved.zone === "all" || deps.indexOf(saved.zone) !== -1) ? saved.zone : defaultDep,
      search: "",
      budget: saved && saved.budget ? saved.budget : BUDGET_MAX,
      sort: saved && saved.sort ? saved.sort : "indice",
      unknown: saved && typeof saved.unknown === "boolean" ? saved.unknown : true
    };
    zoneSel.value = state.zone;
    $("#f-budget").value = state.budget;
    $("#f-sort").value = state.sort;
    $("#f-unknown").checked = state.unknown;

    function zoneRows(zone) {
      var list = zone === "all" ? ecoles : ecoles.filter(function (e) { return e.dep === zone; });
      return rankZone(list);
    }

    function renderHome() {
      var zone = deps.indexOf(String(CONFIG.departementParDefaut)) !== -1 ? String(CONFIG.departementParDefaut) : "all";
      var res = zoneRows(zone);
      $("#home-ranking").innerHTML = res.rows.slice(0, 5).map(function (r) { return rowHTML(r, res.moyenne, isDemo); }).join("");
      var lbl = $("[data-zone-label]");
      if (lbl) lbl.textContent = DEP_IN[zone] || "";
    }

    function render() {
      var res = zoneRows(state.zone);
      var q = norm(state.search);
      var rows = res.rows.filter(function (r) {
        if (q && norm(r.e.nom + " " + r.e.ville + " " + r.e.cp).indexOf(q) === -1) return false;
        if (state.budget < BUDGET_MAX) {
          if (r.cout == null) return state.unknown;
          return r.cout <= state.budget;
        }
        if (r.cout == null) return state.unknown;
        return true;
      });
      if (state.sort === "taux") rows = rows.slice().sort(function (a, b) { return b.e.taux - a.e.taux; });
      if (state.sort === "cout") rows = rows.slice().sort(function (a, b) {
        if (a.cout == null) return 1; if (b.cout == null) return -1; return a.cout - b.cout;
      });

      $("#ranking").innerHTML = rows.map(function (r) { return rowHTML(r, res.moyenne, isDemo); }).join("");
      $("#ranking-empty").hidden = rows.length > 0;
      var n = res.rows.length;
      $("#zone-summary").textContent = n
        ? n + (n > 1 ? " auto-écoles" : " auto-école") + " " + (DEP_IN[state.zone] || "") +
          ", taux de réussite moyen de la zone : " + pct(res.moyenne) +
          (rows.length !== n ? ". " + rows.length + " affichée" + (rows.length > 1 ? "s" : "") + " avec tes filtres." : ".")
        : "Pas encore d'auto-école dans cette zone.";
      $("#f-budget-out").textContent = state.budget >= BUDGET_MAX ? "pas de limite" : eur(state.budget);
      store.set("permiscope-filtres", { zone: state.zone, budget: state.budget, sort: state.sort, unknown: state.unknown });
    }

    zoneSel.addEventListener("change", function () { state.zone = zoneSel.value; render(); });
    $("#f-search").addEventListener("input", function (ev) { state.search = ev.target.value; render(); });
    $("#f-budget").addEventListener("input", function (ev) { state.budget = Number(ev.target.value); render(); });
    $("#f-sort").addEventListener("change", function (ev) { state.sort = ev.target.value; render(); });
    $("#f-unknown").addEventListener("change", function (ev) { state.unknown = ev.target.checked; render(); });

    renderHome();
    render();
  }

  function rankingError() {
    var msg = '<li class="empty">Le classement n\'a pas pu se charger. Recharge la page. Si tu ouvres le fichier directement sur ton ordinateur, lance plutôt un petit serveur local (voir le README).</li>';
    $("#ranking").innerHTML = msg;
    $("#home-ranking").innerHTML = msg;
  }

  /* ---------- Calculateur ---------- */
  function initCalc() {
    var ids = ["calc-forfait", "calc-incluses", "calc-prix", "calc-besoin", "calc-frais", "calc-budget"];
    var saved = store.get("permiscope-calc", null);
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
      store.set("permiscope-calc", snap);
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
          var pending = store.get("permiscope-envois", []);
          pending.push(payload);
          store.set("permiscope-envois", pending);
          done(true, "Enregistré sur cet appareil. Le site est en mode démo : rien n'est encore envoyé.");
        }
      });
    });
  }

  /* ---------- Checklist ---------- */
  function initChecklist() {
    var boxes = $all("#checklist input[type=checkbox]");
    var saved = store.get("permiscope-checklist", {});
    boxes.forEach(function (b) { b.checked = !!saved[b.id]; });
    function update() {
      var state = {}; var done = 0;
      boxes.forEach(function (b) { state[b.id] = b.checked; if (b.checked) done++; });
      var p = $("#check-progress");
      p.textContent = done === boxes.length ? "Tout est prêt" : done + " sur " + boxes.length + " prêts";
      p.classList.toggle("is-done", done === boxes.length);
      store.set("permiscope-checklist", state);
    }
    boxes.forEach(function (b) { b.addEventListener("change", update); });
    update();
  }

  /* ---------- Démarrage ---------- */
  function initDepSelect() {
    var alertDep = $("#alert-dep");
    if (!alertDep) return;
    alertDep.innerHTML = '<option value="">Choisis</option>' +
      Object.keys(DEP_NAMES).map(function (d) { return '<option value="' + d + '">' + esc(depLabel(d)) + '</option>'; }).join("");
  }

  function start() {
    showView();
    initDepSelect();
    initCalc();
    initForms();
    initChecklist();
    loadJSON("data/auto-ecoles.json", "PERMISCOPE_ECOLES").then(initRanking).catch(rankingError);
    loadJSON("data/loueurs.json", "PERMISCOPE_LOUEURS").then(initRenters).catch(function () { initRenters(null); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
