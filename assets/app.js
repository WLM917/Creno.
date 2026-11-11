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
        if (!r.ok) {
          var e = new Error(j.erreur || "Le service ne répond pas. Réessaie dans quelques minutes.");
          e.status = r.status;
          throw e;
        }
        return j;
      });
    }, function () { throw new Error("Pas de connexion. Vérifie ton réseau et réessaie."); });
  }
  function setStatus(el, ok, text) {
    el.textContent = text;
    el.className = "form-status " + (ok ? "is-ok" : "is-error");
  }

  function queryParam(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  /* ---------- Compte : connexion par e-mail et mot de passe (Supabase Auth, sans bibliothèque) ---------- */
  // La session est gardée sur l'appareil. Son jeton est envoyé aux fonctions serveur, qui vérifient elles-mêmes
  // qui est connecté : le site ne lit jamais la base directement.
  var SESSION = "creno-session";
  var AUTH_ERREURS = {
    invalid_credentials: "E-mail ou mot de passe incorrect.",
    invalid_grant: "E-mail ou mot de passe incorrect.",
    email_not_confirmed: "Confirme d'abord ton adresse : clique sur le lien reçu par e-mail.",
    user_already_exists: "Un compte existe déjà avec cet e-mail. Connecte-toi (onglet « Se connecter »).",
    email_exists: "Un compte existe déjà avec cet e-mail. Connecte-toi (onglet « Se connecter »).",
    weak_password: "Mot de passe trop faible : 8 caractères au moins, avec des lettres et des chiffres.",
    same_password: "Choisis un mot de passe différent de l'ancien.",
    email_address_invalid: "Cette adresse e-mail n'est pas valide.",
    validation_failed: "Vérifie ton e-mail et ton mot de passe.",
    over_request_rate_limit: "Trop d'essais d'un coup. Attends quelques minutes puis réessaie.",
    over_email_send_rate_limit: "Trop d'e-mails envoyés. Attends un peu puis réessaie.",
    signup_disabled: "Les inscriptions sont fermées pour le moment.",
    email_address_not_authorized: "L'envoi d'e-mails n'est pas encore branché. Écris-nous depuis la page Nous contacter, on t'aide.",
    session_not_found: "Ta connexion a expiré : reconnecte-toi.",
    refresh_token_not_found: "Ta connexion a expiré : reconnecte-toi.",
    reauthentication_needed: "Pour changer ton mot de passe, reconnecte-toi d'abord."
  };
  function authFetch(path, body, jeton, method) {
    var h = { "apikey": CONFIG.supabaseAnonKey, "Content-Type": "application/json" };
    if (jeton) h.Authorization = "Bearer " + jeton;
    else if (CONFIG.supabaseAnonKey.indexOf("sb_") !== 0) h.Authorization = "Bearer " + CONFIG.supabaseAnonKey;
    return fetch(CONFIG.supabaseUrl.replace(/\/$/, "") + "/auth/v1/" + path, {
      method: method || "POST", headers: h, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        var code = j.error_code || j.error || "";
        if (!AUTH_ERREURS[code] && /already registered/i.test(j.msg || "")) code = "user_already_exists";
        var e = new Error(AUTH_ERREURS[code] || (r.status === 429 ? AUTH_ERREURS.over_request_rate_limit
          : "Ça n'a pas marché. Vérifie tes réponses et réessaie."));
        e.code = code; e.status = r.status;
        throw e;
      });
    }, function () { throw new Error("Pas de connexion. Vérifie ton réseau et réessaie."); });
  }
  var rafraichir = null;
  var auth = {
    session: function () {
      var s = store.get(SESSION, null);
      return s && s.access_token && s.user && s.user.id ? s : null;
    },
    garder: function (j, user) {
      var u = user || j.user;
      var s = {
        access_token: j.access_token, refresh_token: j.refresh_token,
        expires_at: Number(j.expires_at) || Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600),
        user: { id: u.id, email: u.email, type: (u.user_metadata || {}).type === "pro" ? "pro" : "eleve", pro_type: (u.user_metadata || {}).pro_type || "" }
      };
      store.set(SESSION, s);
      majIconeCompte();
      return s;
    },
    oublier: function () {
      try { window.localStorage.removeItem(SESSION); } catch (e) { /* rien */ }
      majIconeCompte();
    },
    // Un jeton valable (renouvelé tout seul quand il expire), ou null si personne n'est connecté.
    jeton: function () {
      var s = auth.session();
      if (!s) return Promise.resolve(null);
      if (s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(s.access_token);
      if (!rafraichir) {
        rafraichir = authFetch("token?grant_type=refresh_token", { refresh_token: s.refresh_token }).then(function (j) {
          rafraichir = null;
          return auth.garder(j).access_token;
        }, function (e) {
          rafraichir = null;
          if (e.status && e.status < 500) { auth.oublier(); return null; }
          throw e;
        });
      }
      return rafraichir;
    },
    connexion: function (email, mdp) {
      return authFetch("token?grant_type=password", { email: email, password: mdp }).then(function (j) { return auth.garder(j); });
    },
    // Renvoie la session, ou null si un e-mail de confirmation doit d'abord être ouvert.
    inscription: function (email, mdp, donnees, retour) {
      return authFetch("signup?redirect_to=" + encodeURIComponent(retour), { email: email, password: mdp, data: donnees }).then(function (j) {
        return j.access_token ? auth.garder(j) : null;
      });
    },
    depuisLien: function (p) {
      return authFetch("user", null, p.access_token, "GET").then(function (u) { return auth.garder(p, u); });
    },
    oubli: function (email, retour) {
      return authFetch("recover?redirect_to=" + encodeURIComponent(retour), { email: email });
    },
    motDePasse: function (mdp) {
      return auth.jeton().then(function (t) {
        if (!t) throw new Error(AUTH_ERREURS.session_not_found);
        return authFetch("user", { password: mdp }, t, "PUT");
      });
    },
    deconnexion: function () {
      var s = auth.session();
      auth.oublier();
      if (s) authFetch("logout", {}, s.access_token).catch(function () { /* la session est déjà oubliée ici */ });
    }
  };
  // Appelle une fonction serveur avec le jeton du compte. Sans connexion (ou connexion expirée) : erreur 401.
  function callFnCompte(name, body) {
    return auth.jeton().then(function (t) {
      if (!t) { var e = new Error("Connecte-toi à ton compte pour continuer."); e.status = 401; throw e; }
      body.jeton = t;
      return callFn(name, body);
    }).catch(function (e) {
      if (e.status === 401) auth.oublier();
      throw e;
    });
  }
  // Icône du compte (en haut à droite) : « Se connecter » ou « Gérer mon compte »
  function majIconeCompte() {
    var s = auth.session();
    $all("[data-compte-btn]").forEach(function (a) {
      a.classList.toggle("is-connecte", !!s);
      a.setAttribute("aria-label", s ? "Gérer mon compte (connecté)" : "Se connecter ou créer un compte");
      a.title = s ? "Gérer mon compte" : "Se connecter";
    });
  }
  // Adresse du compte, avec la page où revenir ensuite (chemin interne seulement)
  function suiteValide(s) { return !!s && /^[a-z0-9\-\/]+(#[a-z0-9\-]+)?$/.test(s) && s.indexOf("//") === -1; }
  function lienCompte(suite, extra) {
    return link("compte/") + "?suite=" + encodeURIComponent(suite || "") + (extra || "");
  }

  /* ---------- Formulaires réservés aux comptes (pack, alertes, demandes, espace pros) ---------- */
  // data-compte="tous" (élève ou pro) ou "pro" ; data-suite = où revenir après la connexion ;
  // data-compte-txt = pourquoi il faut un compte ; data-compte-pro = activité préchoisie à l'inscription.
  function initGates() {
    var forms = $all("form[data-compte]");
    if (!forms.length || !supabaseReady()) return;
    var s = auth.session();
    forms.forEach(function (form) {
      var qui = form.getAttribute("data-compte");
      var suite = form.getAttribute("data-suite") || "";
      var pro = form.getAttribute("data-compte-pro") || "";
      var extra = qui === "pro" ? "&type=pro" + (pro ? "&pro=" + pro : "") : "";
      var box = document.createElement("div");
      box.className = "compte-gate";
      if (!s || (qui === "pro" && s.user.type !== "pro")) {
        if (!s) {
          box.innerHTML = '<p><strong>' + (qui === "pro" ? "Connecte-toi à ton compte pro pour continuer." : "Connecte-toi pour continuer.") +
            "</strong> " + esc(form.getAttribute("data-compte-txt") || "") + "</p>" +
            '<div class="rank-actions"><a class="btn btn-signal btn-small" href="' + esc(lienCompte(suite, extra)) + '">Se connecter</a>' +
            '<a class="btn btn-ghost btn-small" href="' + esc(lienCompte(suite, extra + "&onglet=inscription")) + '">Créer un compte</a></div>';
        } else {
          box.innerHTML = "<p><strong>Ce formulaire est réservé aux comptes pros.</strong> Tu es connecté avec un compte élève (" +
            esc(s.user.email) + "). Pour ton établissement, crée un compte pro avec une autre adresse e-mail.</p>" +
            '<div class="rank-actions"><button class="btn btn-ghost btn-small" type="button" data-sortir>Me déconnecter et créer un compte pro</button></div>';
          $("[data-sortir]", box).addEventListener("click", function () {
            auth.deconnexion();
            location.href = lienCompte(suite, extra + "&onglet=inscription");
          });
        }
        form.parentNode.insertBefore(box, form);
        form.hidden = true;
        return;
      }
      remplirCompte(form);
      box.className = "compte-qui";
      box.innerHTML = "Connecté : <strong>" + esc(s.user.email) + '</strong> · <a href="' + esc(link("compte/")) + '">Gérer mon compte</a>';
      var titre = form.firstElementChild && /^H[23]$/.test(form.firstElementChild.tagName) ? form.firstElementChild : null;
      form.insertBefore(box, titre ? titre.nextSibling : form.firstChild);
    });
  }
  // Connecté : l'e-mail du compte est prérempli (ou fixé, pour les alertes). Aussi après chaque envoi (form.reset()).
  function remplirCompte(form) {
    var s = auth.session();
    if (!s || !form.hasAttribute("data-compte")) return;
    $all("input[type=email][name=email]", form).forEach(function (f) {
      if (!f.value) f.value = s.user.email;
      if (f.hasAttribute("data-email-compte")) {
        f.required = false;
        f.closest(".field").hidden = true;
      }
    });
  }

  /* ---------- Bouton « œil » des mots de passe : voir ce qu'on tape ---------- */
  var OEIL = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  var OEIL_BARRE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function initMotsDePasse() {
    $all('input[type="password"]').forEach(function (input) {
      var boite = document.createElement("div");
      boite.className = "mdp-champ";
      input.parentNode.insertBefore(boite, input);
      boite.appendChild(input);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mdp-oeil";
      b.setAttribute("aria-controls", input.id);
      boite.appendChild(b);
      function montrer(oui) {
        input.type = oui ? "text" : "password";
        b.setAttribute("aria-pressed", oui ? "true" : "false");
        b.setAttribute("aria-label", oui ? "Masquer le mot de passe" : "Afficher le mot de passe");
        b.title = oui ? "Masquer" : "Afficher";
        b.innerHTML = oui ? OEIL_BARRE : OEIL;
      }
      montrer(false);
      b.addEventListener("click", function () {
        montrer(input.type === "password");
        input.focus();
      });
      // Avant l'envoi, le mot de passe redevient masqué (le navigateur peut alors proposer de l'enregistrer)
      if (input.form) {
        input.form.addEventListener("submit", function () { montrer(false); }, true);
        input.form.addEventListener("reset", function () { montrer(false); });
      }
    });
  }

  /* ---------- Page « Gérer mon compte » ---------- */
  var PRO_TYPES = { "auto-ecole": "Auto-école", moniteur: "Moniteur", loueur: "Loueur de voitures à double commande" };
  var SUITE_TXT = {
    "pack-candidat-libre": "Pour acheter le pack, connecte-toi ou crée ton compte. Ton PDF y restera : tu pourras le retélécharger quand tu veux.",
    "alertes": "Pour recevoir les alertes, connecte-toi ou crée ton compte. Tu y verras aussi toutes les places signalées dans ton département.",
    "moniteurs": "Pour publier ta demande, connecte-toi ou crée ton compte : les réponses des pros s'y afficheront aussi.",
    "pro": "Pour cette démarche, connecte-toi à ton compte pro, ou crée-le en une minute. C'est gratuit."
  };
  function jourTxt(iso) { return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); }

  function initCompte() {
    var page = $("#compte-page");
    if (!page) return;
    if (!supabaseReady()) { $("#compte-off").hidden = false; return; }
    var hors = $("#compte-hors"), dedans = $("#compte-in"), nouveau = $("#compte-nouveau-mdp");
    var retour = (($("link[rel=canonical]") || {}).href || location.href).replace(/[?#].*$/, "");
    var suite = queryParam("suite");
    if (!suiteValide(suite)) suite = "";

    function apresConnexion(depuisEmail) {
      var s = suite;
      if (depuisEmail) { s = store.get("creno-suite", ""); }
      store.set("creno-suite", "");
      if (suiteValide(s)) { location.href = link(s); return; }
      charger();
    }

    /* --- pas connecté : se connecter / créer un compte --- */
    function afficherHors(message) {
      dedans.hidden = true; nouveau.hidden = true; hors.hidden = false;
      var cle = suite.split("/")[0];
      if (SUITE_TXT[cle]) $("#compte-lede").textContent = SUITE_TXT[cle];
      if (message) setStatus($("#compte-hors-etat"), false, message);
      var type = queryParam("type") === "pro" ? "pro" : "eleve";
      var radio = $('#inscription-form input[name=type][value="' + type + '"]');
      if (radio) radio.checked = true;
      var pt = $("#ins-protype");
      if (PRO_TYPES[queryParam("pro")]) pt.value = queryParam("pro");
      majTypeInscription();
      onglet(queryParam("onglet") === "inscription" ? 1 : 0, false);
    }
    var tabs = $all("#compte-hors [role=tab]");
    function onglet(i, focus) {
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { onglet(i, false); });
      t.addEventListener("keydown", function (ev) {
        if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
        ev.preventDefault();
        onglet(1 - i, true);
      });
    });
    function majTypeInscription() {
      var pro = ($("#inscription-form input[name=type]:checked") || {}).value === "pro";
      $("#ins-protype-champ").hidden = !pro;
      $("#ins-protype").required = pro;
    }
    $all("#inscription-form input[name=type]").forEach(function (r) { r.addEventListener("change", majTypeInscription); });

    function envoi(form, promesse, ok) {
      var statusEl = $(".form-status", form), button = $("button[type=submit]", form);
      button.disabled = true;
      statusEl.textContent = "Un instant…"; statusEl.className = "form-status";
      return promesse().then(function (r) {
        button.disabled = false;
        statusEl.textContent = "";
        ok(r, statusEl);
      }, function (e) {
        button.disabled = false;
        setStatus(statusEl, false, e.message);
      });
    }
    $("#connexion-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      envoi(f, function () { return auth.connexion(f.email.value.trim(), f.password.value); }, function () {
        f.reset();
        apresConnexion(false);
      });
    });
    $("#inscription-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var type = ($("input[name=type]:checked", f) || {}).value === "pro" ? "pro" : "eleve";
      var meta = { type: type };
      if (type === "pro") meta.pro_type = f.pro_type.value;
      if (suite) store.set("creno-suite", suite);
      envoi(f, function () { return auth.inscription(f.email.value.trim(), f.password.value, meta, retour); }, function (s, statusEl) {
        if (s) { f.reset(); apresConnexion(false); return; }
        setStatus(statusEl, true, "Presque fini : ouvre l'e-mail qu'on vient de t'envoyer et clique sur le lien pour activer ton compte.");
      });
    });
    $("#oubli-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      envoi(f, function () { return auth.oubli(f.email.value.trim(), retour); }, function (r, statusEl) {
        setStatus(statusEl, true, "Si un compte existe avec cette adresse, tu vas recevoir un e-mail avec un lien pour choisir un nouveau mot de passe. Pense à regarder dans les spams.");
      });
    });
    $("#nouveau-mdp-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      envoi(f, function () { return auth.motDePasse(f.password.value); }, function () {
        f.reset();
        nouveau.hidden = true;
        charger("Ton nouveau mot de passe est enregistré.");
      });
    });

    /* --- connecté --- */
    function charger(message) {
      hors.hidden = true; nouveau.hidden = true; dedans.hidden = false;
      var s = auth.session();
      $("#compte-email").textContent = s ? s.user.email : "";
      var etat = $("#compte-etat");
      etat.textContent = "Chargement de ton compte…"; etat.className = "form-status";
      callFnCompte("compte", { action: "moi" }).then(function (j) {
        if (message) setStatus(etat, true, message); else { etat.textContent = ""; etat.className = "form-status"; }
        afficher(j);
      }).catch(function (e) {
        if (e.status === 401) { afficherHors(e.message); return; }
        setStatus(etat, false, e.message);
      });
    }
    function afficher(j) {
      var p = j.profil || {};
      var pro = p.type === "pro";
      $("#compte-type").textContent = pro ? "Compte pro" + (p.pro_type ? " · " + (PRO_TYPES[p.pro_type] || p.pro_type) : "") : "Compte élève";
      $("#compte-eleve").hidden = pro;
      $("#compte-pro").hidden = !pro;
      // Mes informations
      var f = $("#profil-form");
      f.prenom.value = p.prenom || "";
      f.telephone.value = p.telephone || "";
      f.departement.value = p.departement || "";
      $("#profil-email").textContent = j.user.email;
      $("#profil-cree").textContent = j.user.cree ? "Compte créé le " + jourTxt(j.user.cree) + "." : "";
      if (!pro) afficherEleve(j); else afficherPro(j);
      // Arrivée sur une partie précise (#pack, #alertes...) une fois le contenu en place
      var cible = location.hash && document.getElementById(location.hash.slice(1));
      if (cible && dedans.contains(cible)) setTimeout(function () { cible.scrollIntoView({ block: "start" }); }, 0);
    }

    function afficherEleve(j) {
      // Mon pack
      var zp = $("#pack-zone");
      if (j.pack && j.pack.achete) {
        zp.innerHTML = "<p>Acheté le " + esc(jourTxt(j.pack.date)) + ". Le lien de téléchargement marche pendant une heure : redemande-le ici quand tu veux.</p>" +
          '<div class="rank-actions"><button class="btn btn-signal btn-small" type="button" id="pack-dl">Télécharger le PDF</button>' +
          '<button class="btn btn-ghost btn-small" type="button" id="pack-mail">Me l\'envoyer par e-mail</button></div>' +
          '<p class="form-status" role="status" id="pack-etat"></p>';
        $("#pack-dl").addEventListener("click", function () {
          var b = this, st = $("#pack-etat");
          b.disabled = true; st.textContent = "Préparation du lien…"; st.className = "form-status";
          callFnCompte("compte", { action: "pack" }).then(function (r) {
            b.disabled = false;
            st.innerHTML = 'C\'est prêt. <a href="' + esc(r.url) + '" target="_blank" rel="noopener">Ouvrir le Pack candidat libre (PDF)</a>';
            st.className = "form-status is-ok";
            window.open(r.url, "_blank", "noopener");
          }).catch(function (e) { b.disabled = false; setStatus(st, false, e.message); });
        });
        $("#pack-mail").addEventListener("click", function () {
          var b = this, st = $("#pack-etat");
          b.disabled = true; st.textContent = "Envoi…"; st.className = "form-status";
          callFnCompte("compte", { action: "pack_email" }).then(function () {
            b.disabled = false;
            setStatus(st, true, "C'est envoyé à " + j.user.email + ". Le lien marche pendant 7 jours.");
          }).catch(function (e) { b.disabled = false; setStatus(st, false, e.message); });
        });
      } else {
        zp.innerHTML = "<p>Tu n'as pas encore le pack. Il te guide du dossier jusqu'au jour J, en boîte manuelle ou automatique.</p>" +
          '<a class="link-strong" href="' + esc(link("pack-candidat-libre/")) + '">Découvrir le pack</a>' +
          '<p class="small">Tu l\'as acheté avant d\'avoir un compte ? Utilise le lien reçu après ton paiement, ou écris-nous : on le relie à ton compte.</p>';
      }
      // Mes alertes
      var za = $("#alertes-zone");
      var al = j.alertes || [];
      za.innerHTML = al.length ? '<ul class="compte-liste">' + al.map(function (a) {
        var etat = a.statut === "actif" ? "Active" + (a.expire_le ? " jusqu'au " + jourTxt(a.expire_le) : "")
          : a.statut === "en_attente" ? (j.emails ? "À confirmer : clique sur le lien reçu par e-mail" : "Enregistrée : les e-mails d'alerte arrivent bientôt. En attendant, les places signalées s'affichent ici.")
          : "Arrêtée";
        return '<li><span class="dep-code">' + esc(a.departement) + "</span><span>" + esc(etat) + "</span></li>";
      }).join("") + "</ul>" : '<p>Tu ne suis aucun département pour l\'instant.</p>';
      za.innerHTML += '<a class="link-strong" href="' + esc(link("alertes/")) + '#suivre">' + (al.length ? "Suivre un autre département" : "Recevoir les alertes") + "</a>";
      var depSel = $("#places-dep");
      var depDefaut = (al[0] && al[0].departement) || (j.profil && j.profil.departement) || "";
      if (depDefaut && !depSel.value) depSel.value = depDefaut;
      chargerPlaces();
      // Mes demandes aux pros
      var zd = $("#demandes-zone");
      var dm = j.demandes || [];
      zd.innerHTML = dm.length ? '<ul class="demandes">' + dm.map(function (d) {
        var ouverte = d.statut === "ouverte";
        return '<li class="demande"><div class="demande-head"><span class="dep-code">' + esc(d.departement) + "</span><strong>" +
          esc(BESOINS[d.besoin] || d.besoin) + "</strong></div>" +
          "<p>" + esc(d.ville || "Ville non précisée") + " · publiée le " + esc(jourTxt(d.created_at)) + " · " + (ouverte ? "ouverte" : "fermée") + "</p>" +
          (d.reponses && d.reponses.length ? '<ul class="compte-reponses">' + d.reponses.map(function (r) {
            return "<li><strong>" + esc(r.pro_nom) + "</strong> <span class=\"small\">(" + esc(PRO_TYPES[r.pro_type] || r.pro_type) + ", le " + esc(jourTxt(r.created_at)) + ")</span>" +
              (r.message ? "<p>« " + esc(r.message) + " »</p>" : "") +
              '<p>Pour lui répondre : <strong>' + esc(r.contact) + "</strong></p></li>";
          }).join("") + "</ul>" : '<p class="small">Pas encore de réponse. Les pros de ton département la voient sur Créno.</p>') +
          (ouverte ? '<a class="btn btn-ghost btn-small" href="' + esc(link("pro/demandes/fermer/")) + "?t=" + encodeURIComponent(d.token) + '">J\'ai trouvé : fermer ma demande</a>' : "") +
          "</li>";
      }).join("") + "</ul>" : "<p>Tu n'as publié aucune demande. Besoin d'un examen blanc, d'heures avec un moniteur ou d'une voiture à double commande ?</p>";
      zd.innerHTML += '<a class="link-strong" href="' + esc(link("moniteurs/")) + '#demande">Publier une demande</a>';
    }
    function chargerPlaces() {
      var dep = $("#places-dep").value;
      var ul = $("#places-liste"), st = $("#places-etat");
      ul.innerHTML = "";
      if (!dep) { st.textContent = "Choisis un département pour voir les places signalées."; return; }
      st.textContent = "Chargement…";
      callFnCompte("compte", { action: "places", departement: dep }).then(function (r) {
        var pl = r.places || [];
        st.textContent = pl.length ? plural(pl.length, "signalement", "signalements") + " dans le " + dep + " ces 30 derniers jours. Une place signalée peut déjà être prise."
          : "Aucune place signalée dans le " + dep + " ces 30 derniers jours.";
        ul.innerHTML = pl.map(function (x) {
          return "<li><span><strong>" + esc(x.centre) + "</strong>" + (x.creneau ? " · " + esc(x.creneau) : "") + "</span>" +
            '<span class="sub">' + esc(ilYa(x.created_at)) + (x.details ? " · " + esc(x.details) : "") + "</span></li>";
        }).join("");
      }).catch(function (e) { st.textContent = e.message; });
    }
    $("#places-dep").addEventListener("change", chargerPlaces);

    function afficherPro(j) {
      var p = j.profil || {};
      var liens = j.liens || [];
      var zl = $("#liens-zone");
      var lf = $("#lier-form");
      if (!lf.pro_type.value && p.pro_type) lf.pro_type.value = p.pro_type;
      majLier();
      $("#lier-titre").textContent = liens.length ? "Ajouter un autre établissement" : "Relier mon établissement";
      if (!liens.length) {
        zl.innerHTML = "<p>Relie ton compte à ton auto-école ou à ton agence : tu verras ton rang, ton badge, les élèves qui ont cliqué pour te contacter et ton abonnement Créno Pro.</p>";
        $("#cpro-zone").innerHTML = "<p>Relie d'abord ton établissement, juste au-dessus.</p>";
      } else {
        zl.innerHTML = '<ul class="compte-etabs">' + liens.map(function (l, i) {
          return '<li class="panel compte-etab" data-lien="' + i + '"><h3>' + esc(l.nom) + "</h3>" +
            '<p class="small">' + esc(l.departement ? "Département " + l.departement : "") + "</p>" +
            (l.statut === "verifie" ? '<div class="compte-etab-detail">Chargement…</div>'
              : l.statut === "refuse" ? '<p class="form-status is-error">Nous n\'avons pas pu vérifier que tu représentes cet établissement. Écris-nous si c\'est une erreur.</p>'
              : '<p class="notice">En attente de vérification. On t\'appelle ou on t\'écrit pour vérifier que c\'est bien toi, puis tes chiffres s\'affichent ici.</p>') +
            "</li>";
        }).join("") + "</ul>";
        Promise.all([fetchJSON("data/badges.json").catch(function () { return { top: {}, deps: {} }; }),
                     fetchJSON("data/partenaires.json").catch(function () { return {}; }), chargerLoueurs()]).then(function (r) {
          var badges = r[0], partenaires = (r[1] && r[1].auto_ecoles) || {}, loueurs = r[2];
          var cpro = [];
          liens.forEach(function (l, i) {
            var zone = $('[data-lien="' + i + '"] .compte-etab-detail', zl);
            var ae = l.pro_ref.indexOf("ae-") === 0;
            var id = ae ? l.pro_ref.slice(3) : "";
            var loueur = l.pro_ref.indexOf("loueur-") === 0 ? loueurs.filter(function (x) { return "loueur-" + slugJS(x.nom) === l.pro_ref; })[0] : null;
            if (l.statut === "verifie") {
              cpro.push({ nom: l.nom, ae: ae, actif: ae ? !!partenaires[id] : !!(loueur && loueur.formule === "partenaire"),
                          depuis: ae && partenaires[id] ? partenaires[id].depuis : "", id: id, pro_ref: l.pro_ref });
            }
            if (!zone) return;
            detailEtab(zone, l, ae, id, loueur, badges);
          });
          afficherCrenoPro(cpro, j.user.email);
        });
      }
      // Mes réponses aux élèves
      var rz = $("#reponses-zone");
      var env = j.reponses_envoyees || [];
      rz.innerHTML = (env.length ? '<ul class="compte-liste compte-liste-col">' + env.map(function (r) {
        var d = r.demandes_pros || {};
        return "<li><strong>" + esc(BESOINS[d.besoin] || d.besoin || "Demande") + "</strong>" +
          '<span class="sub">' + esc([d.ville, d.departement].filter(Boolean).join(", ")) + " · le " + esc(jourTxt(r.created_at)) +
          (d.statut && d.statut !== "ouverte" ? " · demande fermée" : "") + "</span>" +
          (r.message ? '<span class="sub">Ton message : « ' + esc(r.message) + " »</span>" : "") + "</li>";
      }).join("") + "</ul>" : "<p>Tu n'as encore répondu à aucune demande.</p>") +
        '<p class="small">L\'élève reçoit ta réponse par e-mail, avec ton contact : il te répond directement, par e-mail ou par téléphone.</p>' +
        '<a class="link-strong" href="' + esc(link("pro/demandes/")) + '">Voir les demandes d\'élèves</a>';
    }
    function detailEtab(zone, l, ae, id, loueur, badges) {
      var mois = (l.mois || []).slice().sort(function (a, b) { return a.mois < b.mois ? 1 : -1; });
      var dernier = mois[0];
      var total = mois.reduce(function (t, m) { return t + (m.personnes_action || 0); }, 0);
      var chiffres = '<dl class="facts compte-facts">' +
        "<div><dt>" + intFmt.format(dernier ? dernier.personnes_action : 0) + "</dt><dd>élèves ont cliqué pour te contacter" +
        (dernier ? " en " + esc(moisTxt(dernier.mois)) : " ce mois-ci") + "</dd></div>" +
        "<div><dt>" + intFmt.format(total) + "</dt><dd>depuis le début</dd></div>" +
        "<div><dt>" + intFmt.format(l.reponses_demandes || 0) + "</dt><dd>élèves contactés grâce aux demandes</dd></div></dl>" +
        (l.rapport ? '<a class="link-strong" href="' + esc(l.rapport) + '">Voir mon rapport complet</a>' : "");
      if (!ae) {
        zone.innerHTML = (loueur ? "<p>Ton agence est affichée sur Créno (" + esc(loueur.ville) + ")" +
          (loueur.formule === "partenaire" ? ", en tête de liste avec Créno Pro." : ", avec l'inscription gratuite.") + "</p>"
          : l.pro_ref.indexOf("loueur-") === 0 ? '<p>Ton agence n\'est pas encore affichée sur Créno. <a href="' + esc(link("pro/")) + '#inscrire-agence">Inscris-la</a> (gratuit).</p>' : "") +
          chiffres;
        return;
      }
      fetchJSON("data/rangs/" + encodeURIComponent(l.departement) + ".json").catch(function () { return {}; }).then(function (rangs) {
        var r = rangs[id];
        var fiche = badges.deps && badges.deps[l.departement] ? link(badges.deps[l.departement]) + "#ae-" + encodeURIComponent(id) : "";
        var rangTxt = r ? '<p class="compte-rang"><span class="rank-plate">' + r[0] + "</span> <span><strong>" + r[0] + (r[0] === 1 ? "re" : "e") +
          " sur " + intFmt.format(r[1]) + "</strong> auto-écoles classées dans le " + esc(l.departement) + " (indice " + r[2] + " sur 100)</span></p>"
          : "<p>Ton auto-école n'a pas encore de taux de réussite publié : elle est listée à part, sans rang. Elle sera classée dès que la Sécurité routière publiera son taux.</p>";
        var badge = badges.top && badges.top[id] ? '<div class="compte-badge"><img src="' + esc(ROOT + "badges/" + id + ".svg") + '" alt="Badge Créno : top 10 du département" width="200" loading="lazy">' +
          '<a class="link-strong" href="' + esc(link("pro/")) + '#badge">Mettre le badge sur mon site</a></div>' : "";
        zone.innerHTML = rangTxt + (fiche ? '<a class="link-strong" href="' + esc(fiche) + '">Voir ma fiche dans le classement</a>' : "") + badge + chiffres;
      });
    }
    function afficherCrenoPro(liste, email) {
      var z = $("#cpro-zone");
      if (!liste.length) { z.innerHTML = "<p>Ton abonnement s'affiche ici dès que ton établissement est vérifié.</p>"; return; }
      var gerer = CONFIG.lienGererAbonnement
        ? '<a class="btn btn-ghost btn-small" href="' + esc(CONFIG.lienGererAbonnement) + (email ? "?prefilled_email=" + encodeURIComponent(email) : "") +
          '" target="_blank" rel="noopener">Gérer mon abonnement (factures, carte, arrêt)</a>'
        : '<a class="btn btn-ghost btn-small" href="' + esc(link("contact/")) + '">Arrêter ou modifier : écris-nous</a>';
      z.innerHTML = '<ul class="compte-liste compte-liste-col">' + liste.map(function (c) {
        return "<li><strong>" + esc(c.nom) + "</strong><span class=\"sub\">" + (c.actif ? "Créno Pro actif" + (c.depuis ? " depuis le " + esc(jourTxt(c.depuis)) : "") +
          " : mis en avant, avec la mention « Partenaire payant ». Ton rang ne change pas." : "Pas d'abonnement Créno Pro (facultatif).") + "</span>" +
          (c.actif ? "" : '<a class="link-strong" href="' + esc(link("pro/")) + (c.ae ? "#creno-pro" : "#inscrire-agence") + '">Passer à Créno Pro (' +
            esc(page.getAttribute("data-prix-pro") || "") + " par mois)</a>") + "</li>";
      }).join("") + "</ul>" +
        (liste.some(function (c) { return c.actif; }) ? '<div class="rank-actions">' + gerer + "</div>" : "");
    }
    // Relier un établissement
    var lf = $("#lier-form");
    initSchoolPicker(lf);
    function majLier() {
      var t = lf.pro_type.value;
      $("#lier-ae").hidden = t !== "auto-ecole";
      $("#lier-nom-champ").hidden = !(t === "loueur" || t === "moniteur");
      $("#lier-ecole").required = t === "auto-ecole";
      $("#lier-nom").required = t === "loueur" || t === "moniteur";
      $("#lier-nom-label").textContent = t === "loueur" ? "Nom de ton agence" : "Ton nom et ton auto-école de rattachement";
    }
    lf.pro_type.addEventListener("change", majLier);
    lf.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var corps = { action: "lier", pro_type: lf.pro_type.value, departement: lf.departement.value };
      if (corps.pro_type === "auto-ecole") {
        corps.auto_ecole_id = lf.auto_ecole_id.value;
        if (!corps.auto_ecole_id) { setStatus($(".form-status", lf), false, "Choisis ton auto-école dans la liste qui s'affiche quand tu tapes son nom."); return; }
      } else corps.nom = lf.nom.value.trim();
      envoi(lf, function () { return callFnCompte("compte", corps); }, function () {
        lf.reset();
        charger("C'est envoyé. On vérifie que tu représentes bien cet établissement, puis tes chiffres s'affichent ici.");
      });
    });
    // Mes informations
    $("#profil-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      envoi(f, function () {
        return callFnCompte("compte", { action: "profil", prenom: f.prenom.value.trim(), telephone: f.telephone.value.trim(), departement: f.departement.value });
      }, function (r, statusEl) { setStatus(statusEl, true, "C'est enregistré."); });
    });
    $("#mdp-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      envoi(f, function () { return auth.motDePasse(f.password.value); }, function (r, statusEl) {
        f.reset();
        setStatus(statusEl, true, "Ton nouveau mot de passe est enregistré.");
      });
    });
    $("#deconnexion").addEventListener("click", function () {
      auth.deconnexion();
      afficherHors();
      setStatus($("#compte-hors-etat"), true, "Tu es déconnecté.");
      window.scrollTo(0, 0);
    });
    $("#supprimer-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      if (f.confirmation.value.trim() !== "SUPPRIMER") { setStatus($(".form-status", f), false, "Écris SUPPRIMER en majuscules pour confirmer."); return; }
      envoi(f, function () { return callFnCompte("compte", { action: "supprimer", confirmation: "SUPPRIMER" }); }, function () {
        auth.oublier();
        dedans.hidden = true;
        hors.hidden = false;
        setStatus($("#compte-hors-etat"), true, "Ton compte est supprimé, avec tes demandes et tes alertes. À bientôt sur la route !");
        onglet(0, false);
      });
    });

    /* --- démarrage : retour d'un lien e-mail (#access_token=...), sinon session de l'appareil --- */
    var h = location.hash.slice(1);
    if (/(^|&)(access_token|error_description)=/.test(h)) {
      var p = {};
      h.split("&").forEach(function (kv) {
        var i = kv.indexOf("=");
        if (i > 0) p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
      });
      if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
      if (p.error_description || !p.access_token) {
        afficherHors("Ce lien ne marche plus : il a peut-être expiré ou déjà servi. Connecte-toi, ou redemande un lien avec « Mot de passe oublié ».");
        return;
      }
      auth.depuisLien(p).then(function () {
        if (p.type === "recovery") {
          hors.hidden = true; dedans.hidden = true; nouveau.hidden = false;
          $("#nouveau-mdp").focus();
          return;
        }
        apresConnexion(true);
      }).catch(function (e) { afficherHors(e.message); });
      return;
    }
    if (auth.session()) charger(); else afficherHors();
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
    // La barre « Budget maximum » n'existe que si filtre_budget vaut true dans site.json.
    var fBudget = $("#f-budget"), fUnknown = $("#f-unknown");
    var unranked = $all("#unranked li[data-q]");
    var crits = $all("#filters input[data-label]");
    var saved = store.get("creno-filtres", null) || {};
    var state = {
      search: queryParam("q") || "",
      budget: fBudget ? saved.budget || BUDGET_MAX : BUDGET_MAX,
      sort: saved.sort || "indice",
      unknown: fUnknown && typeof saved.unknown === "boolean" ? saved.unknown : true,
      crit: saved.crit || {},
      limit: PAGE
    };

    $("#f-search").value = state.search;
    if (fBudget) fBudget.value = state.budget;
    $("#f-sort").value = state.sort;
    if (fUnknown) fUnknown.checked = state.unknown;
    crits.forEach(function (c) {
      if (c.disabled) state.crit[c.getAttribute("data-label")] = false;
      c.checked = !!state.crit[c.getAttribute("data-label")];
    });
    if (fBudget) fBudget.disabled = !avecPrix;
    if (fUnknown) fUnknown.disabled = !avecPrix;
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
        : "Aucune auto-école ne correspond. Retire un filtre" + (fBudget ? " ou monte ton budget." : ".");
      if (fBudget) $("#f-budget-out").textContent = state.budget >= BUDGET_MAX ? "pas de limite" : eur(state.budget);
    }

    function update() { state.limit = PAGE; target = ""; render(); save(); }

    $("#f-search").addEventListener("input", function (ev) { state.search = ev.target.value; update(); });
    if (fBudget) fBudget.addEventListener("input", function (ev) { state.budget = Number(ev.target.value); update(); });
    $("#f-sort").addEventListener("change", function (ev) { state.sort = ev.target.value; update(); });
    if (fUnknown) fUnknown.addEventListener("change", function (ev) { state.unknown = ev.target.checked; update(); });
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
    demande_pro: "demandes_pros", pro: "pros_proposes", contact_pro: "contacts_pros", tarifs: "tarifs_proposes"
  };
  var NUMBERS = ["forfait", "heures_incluses", "prix_heure", "heures_total", "frais_examen", "heures_forfait"];
  // Ces formulaires passent par la fonction serveur « pros » : elle enregistre et te prévient par e-mail.
  var VIA_PROS = { demande_pro: true, pro: true, contact_pro: true, tarifs: true, loueur: true, creno_pro: true };
  var MERCI = {
    declaration: "Merci, ta réponse est envoyée.",
    demande_pro: "C'est en ligne ! Les pros qui peuvent t'aider te répondront : leurs réponses s'affichent dans ton compte (Gérer mon compte), et par e-mail.",
    pro: "Merci, on vérifie tes informations et on revient vers toi.",
    contact_pro: "Merci, ton message est envoyé. On te répond vite.",
    tarifs: "Merci ! On vérifie tes tarifs (avec ta page de tarifs ou par téléphone) avant de les afficher sur ta fiche.",
    loueur: "Merci ! On vérifie ton agence et on l'ajoute sur Créno, gratuitement.",
    loueur_pro: "Merci ! On te recontacte très vite pour activer Créno Pro.",
    creno_pro: "Merci ! On te recontacte très vite pour activer Créno Pro."
  };

  function initSchoolPicker(form) {
    var input = $("input[name=auto_ecole_nom][list]", form);
    if (!input) return;
    var hidden = $("input[name=auto_ecole_id]", form);
    var datalist = document.getElementById(input.getAttribute("list"));
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
          if (f.type === "radio") { if (f.checked) row[f.name] = f.value; return; }
          if (f.type === "checkbox") { row[f.name] = f.checked; return; }
          var v = f.value.trim();
          if (NUMBERS.indexOf(f.name) !== -1) row[f.name] = v === "" ? null : Math.round(Number(v));
          else row[f.name] = v === "" ? null : v;
        });

        function done(ok, text) {
          statusEl.textContent = text;
          statusEl.className = "form-status " + (ok ? "is-ok" : "is-error");
          button.disabled = false;
          if (ok) { form.reset(); remplirCompte(form); }
        }

        var req = null;
        if (supabaseReady() && VIA_PROS[type]) {
          var corps = {};
          for (var k in row) corps[k] = row[k];
          if (type === "demande_pro") corps.action = "demande";
          else { corps.action = "formulaire"; corps.type_formulaire = type; }
          button.disabled = true;
          (form.hasAttribute("data-compte") ? callFnCompte : callFn)("pros", corps).then(function (j) {
            // Créno Pro (auto-école, ou loueur qui choisit Créno Pro) : direction le paiement Stripe
            var pro = type === "creno_pro" || (type === "loueur" && row.formule === "partenaire");
            // Deux produits Stripe : un pour les auto-écoles, un pour les loueurs (sinon le même lien).
            var lien = type === "creno_pro" ? CONFIG.lienCrenoPro : (CONFIG.lienCrenoProLoueur || CONFIG.lienCrenoPro);
            if (pro && lien && j.id) {
              var mail = row.email || (auth.session() || { user: {} }).user.email;
              location.href = lien + (lien.indexOf("?") === -1 ? "?" : "&") + "client_reference_id=pro-" +
                (type === "creno_pro" ? "ae-" : "loueur-") + j.id + (mail ? "&prefilled_email=" + encodeURIComponent(mail) : "");
              return;
            }
            done(true, MERCI[type === "loueur" && pro ? "loueur_pro" : type] || "Merci, c'est envoyé.");
          }).catch(function (e) {
            if (e.status === 401 && form.hasAttribute("data-compte")) {
              done(false, e.message);
              location.href = lienCompte(form.getAttribute("data-suite") || "", form.getAttribute("data-compte") === "pro" ? "&type=pro" : "");
              return;
            }
            done(false, e.message);
          });
          return;
        }
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
          done(true, MERCI[type] || "Merci, c'est envoyé.");
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
        (form.hasAttribute("data-compte") ? callFnCompte : callFn)("alertes", body).then(function (j) {
          if (j.paiement) { location.href = j.paiement; return; }
          if (j.continuer) { location.href = j.continuer; return; }
          button.disabled = false;
          if (j.deja) {
            setStatus(statusEl, true, "Tu suis déjà le " + j.departement + " : tes alertes sont actives jusqu'au " + j.expire_txt + ".");
          } else if (j.compte && !j.confirmation) {
            setStatus(statusEl, true, "C'est noté : tu suis le " + j.departement + ". Les places signalées s'affichent dans ton compte (Gérer mon compte), et les e-mails d'alerte arrivent très bientôt.");
          } else if (j.confirmation) {
            setStatus(statusEl, true, "C'est presque fini : on t'a envoyé un e-mail. Clique sur le lien pour activer " +
              (j.payant ? "ton essai gratuit de " + j.essai_jours + " jours." : "tes alertes."));
            form.reset();
            remplirCompte(form);
          } else if (action === "signaler") {
            setStatus(statusEl, true, j.prevenus
              ? "Merci ! " + plural(j.prevenus, "candidat a été prévenu", "candidats ont été prévenus") + "."
              : "Merci, ton signalement est enregistré.");
            form.reset();
          }
        }).catch(function (e) {
          button.disabled = false;
          setStatus(statusEl, false, e.message);
          if (e.status === 401 && form.hasAttribute("data-compte")) location.href = lienCompte(form.getAttribute("data-suite") || "");
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
        note.textContent = "Le lien de téléchargement marche pendant une heure. Ensuite, retrouve ton pack dans ton compte (icône en haut à droite, « Gérer mon compte ») : tu peux le retélécharger quand tu veux.";
        note.hidden = false;
      }).catch(function (e) { show(false, e.message); });
      return;
    }

    if (etat === "fermer") {
      if (!queryParam("t")) { show(false, "Ce lien est incomplet. Ouvre-le directement depuis ton e-mail."); return; }
      callFn("pros", { action: "fermer", t: queryParam("t") }).then(function () {
        show(true, "C'est fait : ta demande est fermée. Plus aucun pro ne pourra y répondre. Bonne route !");
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
      var button = $("button[type=submit]", form);
      if (!CONFIG.lienPaiementPack) { setStatus(statusEl, false, "Le paiement ouvre très bientôt. Reviens dans quelques jours."); return; }
      var s = auth.session();
      if (!s) { location.href = lienCompte("pack-candidat-libre/#acheter"); return; }
      button.disabled = true;
      statusEl.textContent = "Un instant…"; statusEl.className = "form-status";
      // Le paiement est relié au compte : le PDF se retrouve ensuite dans « Gérer mon compte ».
      callFnCompte("compte", { action: "moi" }).then(function (j) {
        if (j.pack && j.pack.achete) {
          button.disabled = false;
          statusEl.innerHTML = 'Tu as déjà le pack sur ce compte. <a href="' + esc(link("compte/")) + '#pack">Le télécharger depuis ton compte</a>';
          statusEl.className = "form-status is-ok";
          return;
        }
        location.href = CONFIG.lienPaiementPack + (CONFIG.lienPaiementPack.indexOf("?") === -1 ? "?" : "&") +
          "client_reference_id=pack-" + s.user.id + "&prefilled_email=" + encodeURIComponent(s.user.email);
      }).catch(function (e) {
        button.disabled = false;
        if (e.status === 401) { location.href = lienCompte("pack-candidat-libre/#acheter"); return; }
        setStatus(statusEl, false, e.message);
      });
    });
  }

  /* ---------- Badge des auto-écoles (espace pros) ---------- */
  // Transforme le badge (SVG) en image PNG nette (3 fois sa taille) et la télécharge.
  function telechargerBadge(url, nom, statusEl) {
    fetch(url).then(function (r) { return r.text(); }).then(function (svg) {
      var img = new Image();
      var blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      img.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = 840; canvas.height = 264;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 840, 264);
        URL.revokeObjectURL(blobUrl);
        canvas.toBlob(function (blob) {
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = nom;
          document.body.appendChild(a); a.click(); a.remove();
          setStatus(statusEl, true, "Image téléchargée.");
        }, "image/png");
      };
      img.onerror = function () { setStatus(statusEl, false, "Le téléchargement n'a pas marché. Réessaie."); };
      img.src = blobUrl;
    }).catch(function () { setStatus(statusEl, false, "Le téléchargement n'a pas marché. Réessaie."); });
  }

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
    var affiche = "";
    function show() {
      var e = null;
      ecoles.forEach(function (x) { if (x.nom + ", " + x.ville === input.value) e = x; });
      if (!e) { result.hidden = true; affiche = ""; return; }
      // Déjà affiché : on ne refait pas le bloc (sinon un clic sur ses boutons serait perdu)
      if (affiche === e.id && !result.hidden) return;
      affiche = e.id;
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
            '.svg" alt="' + esc(e.nom) + ' : ' + rang + ' sur ' + top[1] + ' auto-écoles, classement Créno" width="280" height="88"' +
            ' onerror="this.parentNode.style.display=\'none\'"></a>';
          result.innerHTML =
            '<p><strong>Bravo, ' + esc(e.nom) + ' est ' + rang + ' sur ' + top[1] + ' dans le ' + esc(depSel.value) + '.</strong> Voici ton badge :</p>' +
            '<p><img src="' + ROOT + 'badges/' + esc(e.id) + '.svg" alt="" width="280" height="88"></p>' +
            '<div class="field"><label for="badge-code">Code à coller sur ton site</label>' +
            '<textarea id="badge-code" rows="4" readonly>' + esc(code) + '</textarea></div>' +
            '<div class="rank-actions"><button class="btn" type="button" id="badge-copy">Copier le code pour mon site</button>' +
            '<button class="btn btn-ghost" type="button" id="badge-png">Télécharger l\'image</button></div> <span class="form-status" role="status"></span>' +
            '<p class="small">Sur ton site, le badge se met à jour tout seul à chaque nouveau classement. Si ton auto-école sort du top 10, il disparaît de ton site sans laisser de trou. ' +
            'L\'image téléchargée, elle, ne change pas : elle porte le mois du classement.</p>';
          $("#badge-png").addEventListener("click", function () {
            telechargerBadge(ROOT + "badges/" + e.id + ".svg", "badge-creno-" + slugJS(e.nom) + ".png", $(".form-status", result));
          });
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
    var board = $("#admin-board");
    var saved = "";
    try { saved = window.sessionStorage.getItem("creno-admin") || ""; } catch (e) { saved = ""; }
    if (saved) $("#admin-code").value = saved;
    var prixPro = parseFloat(String(board.getAttribute("data-prix-pro") || "").replace(/[^0-9,.]/g, "").replace(",", ".")) || 19.99;
    var etat = { per: "j30", code: "", j: null, noms: {}, cles: {}, limite: 50, partenaires: {}, loueursPro: 0 };
    try { etat.per = window.sessionStorage.getItem("creno-admin-per") || "j30"; } catch (e) { etat.per = "j30"; }
    var PER = { j7: "ces 7 derniers jours", j30: "ces 30 derniers jours", tout: "depuis le début" };
    var eur2 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

    // Textes fixes et nombres seulement : les noms (données) passent toujours par esc().
    function fact(n, txt, sub) { return "<div><dt>" + n + "</dt><dd>" + txt + (sub ? '<span class="sub">' + sub + "</span>" : "") + "</dd></div>"; }
    function somme(rows, k) { return rows.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); }
    function pct(a, b) { return b ? Math.round(100 * a / b) + " %" : "—"; }
    function jourIso(decalage) { return new Date(Date.now() - decalage * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }); }
    function jourLong(iso) { return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); }
    function jourCourt(iso) { return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); }

    function lienRapport(p, dep) {
      return baseSite() + "rapport/?p=" + encodeURIComponent(p) + (dep ? "&d=" + encodeURIComponent(dep) : "") + "&k=" + (etat.cles[p] || "");
    }
    function actionsRapport(p, dep) {
      var url = lienRapport(p, dep);
      return '<div class="rap-actions"><button class="btn btn-small btn-ghost" type="button" data-copier="' + esc(url) + '">Copier le lien</button>' +
        '<a class="btn btn-small btn-ghost" href="' + esc(url) + '" target="_blank" rel="noopener">Voir</a></div>';
    }
    function num(v, label) { return '<td class="num" data-label="' + label + '">' + intFmt.format(v || 0) + "</td>"; }

    function lignes() { return (etat.j && etat.j.periodes && etat.j.periodes[etat.per]) || []; }

    function afficher() {
      var j = etat.j, rows = lignes();
      $all(".adm-per").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-per") === etat.per ? "true" : "false"); });
      var ae = rows.filter(function (r) { return String(r.p).indexOf("ae-") === 0; });
      var lou = rows.filter(function (r) { return String(r.p).indexOf("loueur-") === 0; });
      var envoyes = somme(rows, "action"), personnes = somme(rows, "personnes");

      // L'essentiel
      var v = j.ventes || {};
      var ventesEur = v.ok ? ["pack", "pro_ae", "pro_loueur"].reduce(function (s, k) { return s + ((v[k] && v[k][etat.per] && v[k][etat.per].eur) || 0); }, 0) : null;
      var dm = j.demandes || {};
      var demandes = etat.per === "j7" ? dm.recues_7j : etat.per === "j30" ? dm.recues_30j : dm.recues_tout;
      var a = j.alertes || {};
      $("#adm-kpis").innerHTML =
        fact(intFmt.format(envoyes), "élèves envoyés aux pros " + PER[etat.per], "une personne qui clique pour contacter un pro, une fois par jour") +
        fact(intFmt.format(somme(rows, "ouvert")), "fiches « Contacter » ouvertes") +
        fact(pct(envoyes, personnes), "des personnes qui ouvrent une fiche cliquent ensuite pour contacter") +
        fact(ventesEur == null ? "—" : eur2.format(ventesEur), "de ventes " + PER[etat.per], v.ok ? "pack et Créno Pro, avant frais Stripe" : "ventes indisponibles") +
        fact(intFmt.format(demandes || 0), "demandes d'élèves reçues") +
        fact(intFmt.format(a.actifs || 0), "abonnés aux alertes places", "en ce moment");

      // Les clics par bouton
      $("#adm-boutons").innerHTML =
        fact(intFmt.format(somme(rows, "ouvert")), "fiches ouvertes") +
        fact(intFmt.format(somme(rows, "carte")), "Téléphone et itinéraire") +
        fact(intFmt.format(somme(rows, "site")), "Site web") +
        fact(intFmt.format(somme(rows, "email")), "E-mail", "auto-écoles") +
        fact(intFmt.format(somme(rows, "message")), "Message tout prêt copié") +
        fact(intFmt.format(somme(rows, "reserver")), "Réserver", "loueurs");

      tableAe(ae);
      tableLoueurs(lou);
      departements(rows);
      ventes(v);
      var sig = etat.per === "j7" ? a.signalements_7j : a.signalements_30j;
      $("#admin-alertes").innerHTML =
        fact(intFmt.format(a.actifs || 0), "abonnés actifs") +
        fact(intFmt.format(a.en_attente || 0), "en attente de confirmation par e-mail") +
        fact(intFmt.format(sig || 0), "places signalées " + (etat.per === "j7" ? PER.j7 : PER.j30)) +
        (a.payantes ? fact(intFmt.format(a.abonnes || 0), "abonnés payants") + fact(eur(a.revenu_mensuel || 0), "par mois (avant frais Stripe)") : "");
    }

    function nomDe(r) { return (etat.noms[r.p] || {}).nom || r.p; }
    function tableAe(ae) {
      var q = norm($("#adm-ae-q").value), tri = $("#adm-ae-tri").value;
      var liste = ae.filter(function (r) {
        var d = etat.noms[r.p] || {};
        return !q || norm((d.nom || "") + " " + (d.lieu || "") + " " + (r.departement || "")).indexOf(q) !== -1;
      });
      liste.sort(tri === "nom"
        ? function (x, y) { return nomDe(x).localeCompare(nomDe(y), "fr"); }
        : function (x, y) { return (y[tri] || 0) - (x[tri] || 0) || (y.action || 0) - (x.action || 0); });
      var pros = {};
      ((etat.j && etat.j.pros) || []).forEach(function (p) { pros[p.p] = p; });
      var dem = etat.per === "j7" ? "demandes_7j" : etat.per === "j30" ? "demandes_30j" : "demandes";
      $("#adm-ae").innerHTML = liste.slice(0, etat.limite).map(function (r) {
        var d = etat.noms[r.p] || {}, p = pros[r.p] || {};
        var id = String(r.p).slice(3);
        return '<tr><td class="cell-titre"><strong>' + esc(d.nom || r.p) + "</strong>" +
          (etat.partenaires[id] ? ' <span class="chip chip-flag">Créno Pro</span>' : "") +
          '<span class="sub">' + esc(d.lieu || "") + "</span>" +
          (p[dem] ? '<span class="sub">' + plural(p[dem], "élève contacté", "élèves contactés") + " via les demandes</span>" : "") + "</td>" +
          num(r.ouvert, "Fiches ouvertes") + num(r.carte, "Téléphone et itinéraire") + num(r.site, "Site web") +
          num(r.email, "E-mail") + num(r.message, "Message copié") +
          '<td class="num adm-fort" data-label="Élèves envoyés">' + intFmt.format(r.action || 0) + "</td>" +
          '<td data-label="Rapport">' + actionsRapport(r.p, r.departement) + "</td></tr>";
      }).join("");
      $("#adm-ae-vide").hidden = liste.length > 0;
      var reste = liste.length - etat.limite, plus = $("#adm-ae-plus");
      plus.hidden = reste <= 0;
      if (reste > 0) plus.textContent = "Afficher " + Math.min(50, reste) + " de plus (" + intFmt.format(reste) + " restantes)";
    }

    function tableLoueurs(lou) {
      lou = lou.slice().sort(function (x, y) { return (y.action || 0) - (x.action || 0); });
      $("#adm-lou").innerHTML = lou.map(function (r) {
        var d = etat.noms[r.p] || {};
        return '<tr><td class="cell-titre"><strong>' + esc(d.nom || r.p) + '</strong><span class="sub">' + esc(d.lieu || "") + "</span></td>" +
          num(r.ouvert, "Fiches ouvertes") + num((r.reserver || 0) + (r.site || 0), "Réserver ou site") +
          num(r.carte, "Téléphone et itinéraire") + num(r.message, "Message copié") +
          '<td class="num adm-fort" data-label="Élèves envoyés">' + intFmt.format(r.action || 0) + "</td>" +
          '<td data-label="Rapport">' + actionsRapport(r.p, r.departement) + "</td></tr>";
      }).join("");
      $("#adm-lou-vide").hidden = lou.length > 0;
    }

    function departements(rows) {
      var par = {};
      rows.forEach(function (r) { if (r.departement && r.action) par[r.departement] = (par[r.departement] || 0) + r.action; });
      var liste = Object.keys(par).map(function (k) { return { dep: k, n: par[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
      var max = liste.length ? liste[0].n : 0;
      var ol = $("#adm-deps");
      ol.textContent = "";
      liste.forEach(function (x) {
        var li = document.createElement("li");
        var nom = document.createElement("span"); nom.className = "adm-dep-nom"; nom.textContent = x.dep;
        var piste = document.createElement("span"); piste.className = "adm-dep-piste";
        var barre = document.createElement("span"); barre.className = "adm-dep-barre"; barre.style.width = (100 * x.n / max) + "%";
        piste.appendChild(barre);
        var val = document.createElement("span"); val.className = "adm-dep-val"; val.textContent = plural(x.n, "élève", "élèves");
        li.appendChild(nom); li.appendChild(piste); li.appendChild(val);
        ol.appendChild(li);
      });
      $("#adm-deps-vide").hidden = liste.length > 0;
    }

    function ventes(v) {
      var actifsAe = Object.keys(etat.partenaires).length, actifs = actifsAe + etat.loueursPro;
      var html = "";
      if (v.ok) {
        var per = function (k) { return (v[k] && v[k][etat.per]) || { n: 0, eur: 0 }; };
        html += fact(intFmt.format(per("pack").n), "packs vendus " + PER[etat.per], eur2.format(per("pack").eur)) +
          fact(intFmt.format(per("pro_ae").n), "paiements Créno Pro d'auto-écoles", eur2.format(per("pro_ae").eur)) +
          fact(intFmt.format(per("pro_loueur").n), "paiements Créno Pro de loueurs", eur2.format(per("pro_loueur").eur));
      }
      html += fact(intFmt.format(actifs), "pros Créno Pro affichés sur le site", plural(actifsAe, "auto-école", "auto-écoles") + ", " + plural(etat.loueursPro, "loueur", "loueurs")) +
        fact(eur2.format(actifs * prixPro), "par mois avec ces abonnements Créno Pro");
      $("#adm-ventes").innerHTML = html;
      $("#adm-ventes-note").textContent = v.ok
        ? "Montants lus chez Stripe, avant frais, remboursements non déduits. Seuls les paiements de Créno sont comptés (pas ceux de tes autres sites)."
        : "Ventes Stripe indisponibles : " + (v.raison || "erreur inconnue") + " Vérifie le secret STRIPE_SECRET_KEY sur GitHub, puis relance le robot.";
    }

    // Courbe des 30 derniers jours : une barre par jour, détail au toucher ou au clavier.
    function courbe(jours) {
      var box = $("#adm-chart"), axe = $("#adm-chart-x"), tip = $("#adm-tip"), tbody = $("#adm-jours");
      var parJour = {};
      (jours || []).forEach(function (d) { parJour[d.jour] = d; });
      var liste = [];
      for (var i = 29; i >= 0; i--) {
        var iso = jourIso(i), x = parJour[iso] || {};
        liste.push({ iso: iso, eleves: Number(x.eleves) || 0, fiches: Number(x.fiches) || 0 });
      }
      var max = Math.max.apply(null, liste.map(function (l) { return l.eleves; }));
      $("#adm-chart-max").textContent = max ? "max. " + intFmt.format(max) : "Aucun élève envoyé pour l'instant";
      box.textContent = "";
      function montrer(l, b) {
        tip.textContent = "";
        var fort = document.createElement("strong"); fort.textContent = plural(l.eleves, "élève envoyé", "élèves envoyés");
        var jour = document.createElement("span"); jour.textContent = jourLong(l.iso);
        var fi = document.createElement("span"); fi.textContent = plural(l.fiches, "fiche ouverte", "fiches ouvertes");
        tip.appendChild(fort); tip.appendChild(jour); tip.appendChild(fi);
        tip.hidden = false;
        var centre = b.offsetLeft + b.offsetWidth / 2, w = tip.offsetWidth, W = box.parentNode.offsetWidth;
        tip.style.left = Math.max(0, Math.min(W - w, centre - w / 2)) + "px";
      }
      liste.forEach(function (l) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "adm-col";
        b.setAttribute("aria-label", jourLong(l.iso) + " : " + plural(l.eleves, "élève envoyé", "élèves envoyés") + ", " + plural(l.fiches, "fiche ouverte", "fiches ouvertes"));
        var barre = document.createElement("span");
        barre.style.height = max ? (100 * l.eleves / max) + "%" : "0";
        b.appendChild(barre);
        ["pointerenter", "focus", "click"].forEach(function (ev) { b.addEventListener(ev, function () { montrer(l, b); }); });
        ["pointerleave", "blur"].forEach(function (ev) { b.addEventListener(ev, function () { tip.hidden = true; }); });
        box.appendChild(b);
      });
      axe.textContent = "";
      [liste[0], liste[15], liste[29]].forEach(function (l, k) {
        var s = document.createElement("span"); s.textContent = k === 2 ? "aujourd'hui" : jourCourt(l.iso); axe.appendChild(s);
      });
      tbody.textContent = "";
      liste.slice().reverse().forEach(function (l) {
        var tr = document.createElement("tr");
        [jourLong(l.iso), intFmt.format(l.eleves), intFmt.format(l.fiches)].forEach(function (t, k) {
          var td = document.createElement("td"); td.textContent = t; if (k) td.className = "num"; tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    function charger(code) {
      if (!supabaseReady()) { setStatus(statusEl, false, "Supabase n'est pas encore branché (assets/config.js)."); return; }
      statusEl.textContent = "Chargement…"; statusEl.className = "form-status";
      $("#adm-maj").textContent = "Chargement…";
      callFn("stats", { action: "admin", code: code }).then(function (j) {
        try { window.sessionStorage.setItem("creno-admin", code); } catch (e) { /* sans importance */ }
        etat.code = code; etat.j = j;
        statusEl.textContent = "";
        form.hidden = true;
        board.hidden = false;
        (j.pros || []).forEach(function (p) { etat.cles[p.p] = p.k; });
        var tous = ((j.periodes && j.periodes.tout) || []).concat(j.pros || []);
        var vus = {};
        var noms = tous.filter(function (r) { if (vus[r.p]) return false; vus[r.p] = 1; return true; }).map(function (r) {
          return decrirePro(r.p, r.departement).then(function (d) { etat.noms[r.p] = d; });
        });
        var part = fetchJSON("data/partenaires.json").then(function (x) { etat.partenaires = (x && x.auto_ecoles) || {}; }).catch(function () { etat.partenaires = {}; });
        var lpro = chargerLoueurs().then(function (ls) {
          etat.loueursPro = ls.filter(function (l) { return l.formule === "partenaire" || l.partenaire; }).length;
        });
        return Promise.all(noms.concat([part, lpro])).then(function () {
          courbe(j.jours);
          afficher();
          afficherDemandes(j, code);
          $("#adm-maj").textContent = "Mis à jour à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + ".";
        });
      }).catch(function (e) { setStatus(statusEl, false, e.message); $("#adm-maj").textContent = ""; });
    }

    form.addEventListener("submit", function (ev) { ev.preventDefault(); charger($("#admin-code").value.trim()); });
    $all(".adm-per").forEach(function (b) {
      b.addEventListener("click", function () {
        etat.per = b.getAttribute("data-per"); etat.limite = 50;
        try { window.sessionStorage.setItem("creno-admin-per", etat.per); } catch (e) { /* sans importance */ }
        if (etat.j) afficher();
      });
    });
    $("#adm-actualiser").addEventListener("click", function () { if (etat.code) charger(etat.code); });
    $("#adm-ae-q").addEventListener("input", function () { etat.limite = 50; if (etat.j) tableAe(lignes().filter(function (r) { return String(r.p).indexOf("ae-") === 0; })); });
    $("#adm-ae-tri").addEventListener("change", function () { if (etat.j) tableAe(lignes().filter(function (r) { return String(r.p).indexOf("ae-") === 0; })); });
    $("#adm-ae-plus").addEventListener("click", function () { etat.limite += 50; tableAe(lignes().filter(function (r) { return String(r.p).indexOf("ae-") === 0; })); });
    document.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-copier]");
      if (!b) return;
      copyText(b.getAttribute("data-copier")).then(function () { b.textContent = "Lien copié"; }, function () { b.textContent = "Copie impossible"; });
    });
    if (saved) charger(saved);
  }

  // Tableau de bord : demandes d'élèves, réponses des pros, formulaires à traiter
  function afficherDemandes(j, code) {
    var box = $("#admin-demandes");
    if (!box) return;
    var dm = j.demandes || { liste: [], reponses: [] };
    var at = j.a_traiter || {};
    function fact(n, txt) { return "<div><dt>" + n + "</dt><dd>" + txt + "</dd></div>"; }
    function date(iso) { return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); }
    var cpt = j.comptes || {};
    $("#admin-dem-faits").innerHTML = fact(intFmt.format(cpt.eleves || 0), "comptes élèves") +
      fact(intFmt.format(cpt.pros || 0), "comptes pros") +
      fact(intFmt.format(dm.ouvertes || 0), "demandes ouvertes") +
      fact(intFmt.format(dm.recues_30j || 0), "demandes reçues ces 30 jours") +
      fact(intFmt.format((dm.reponses || []).length), "réponses de pros (50 dernières)");
    $("#admin-reponses").innerHTML = (dm.reponses || []).map(function (r) {
      var d = r.demandes_pros || {};
      return '<tr><td class="cell-titre"><strong>' + esc(r.pro_nom) + '</strong><span class="sub">' + esc(r.pro_type) + " · " + esc(r.contact) + "</span></td>" +
        '<td data-label="Demande"><span>' + esc(BESOINS[d.besoin] || d.besoin || "") + '<span class="sub">' + esc((d.ville ? d.ville + ", " : "") + (d.departement || "")) + "</span></span></td>" +
        '<td data-label="Date">' + date(r.created_at) + "</td></tr>";
    }).join("") || '<tr><td colspan="3">Aucune réponse de pro pour l\'instant.</td></tr>';

    var blocs = [
      ["liens", "Comptes pros à vérifier", "Valider", function (x) {
        var ae = String(x.pro_ref || "").indexOf("ae-") === 0;
        return "<strong>" + esc(x.nom) + "</strong>" + (x.departement ? " (" + esc(x.departement) + ")" : "") +
          " · " + esc(PRO_TYPES[x.pro_type] || (ae ? "Auto-école" : x.pro_ref)) +
          '<span class="sub">Compte : ' + esc([x.email, x.telephone].filter(Boolean).join(" · ") || "contact inconnu") + "</span>" +
          '<span class="sub">' + (ae ? "Appelle l'auto-école (numéro sur sa fiche Google) et demande si cette personne en fait partie. Agrément " + esc(String(x.pro_ref).slice(3)) + "."
            : "Vérifie que cette personne représente bien l'établissement (site, appel).") +
          " « Valider » lui montre ses chiffres ; « Supprimer » refuse le lien.</span>";
      }],
      ["creno_pro", "Auto-écoles qui veulent Créno Pro", "C'est fait", function (x) {
        return "<strong>" + esc(x.auto_ecole_nom) + "</strong>" + (x.departement ? " (" + esc(x.departement) + ")" : "") +
          '<span class="sub">' + esc([x.contact, x.email].filter(Boolean).join(" · ")) + "</span>" +
          (x.message ? '<span class="sub">Réduction proposée : ' + esc(x.message) + "</span>" : "") +
          '<span class="sub">Vérifie le paiement dans Stripe, puis ajoute-la dans data/partenaires.json.</span>';
      }],
      ["tarifs", "Tarifs envoyés par des auto-écoles", "Publier", function (x) {
        return "<strong>" + esc(x.auto_ecole_nom) + "</strong> (" + esc(x.departement) + ") : forfait " + eur(x.forfait) +
          (x.heures_forfait ? " pour " + x.heures_forfait + " h" : "") + ", heure en plus " + eur(x.prix_heure) +
          (x.frais_examen != null ? ", examen " + eur(x.frais_examen) : "") + (x.accelere ? ", formation accélérée" + (x.accelere_details ? " (" + esc(x.accelere_details) + ")" : "") : "") +
          '<span class="sub">' + esc(x.contact) + (x.lien ? ' · <a href="' + esc(x.lien) + '" target="_blank" rel="noopener">leur page de tarifs</a>' : "") + "</span>";
      }],
      ["loueurs", "Loueurs qui veulent s'inscrire", "C'est fait", function (x) {
        return "<strong>" + esc(x.nom) + "</strong>, " + esc(x.ville) + (x.departement ? " (" + esc(x.departement) + ")" : "") +
          " · " + esc(x.formule === "partenaire" ? "Créno Pro (payant)" : "inscription gratuite") +
          '<span class="sub">' + esc([x.contact, x.email, x.site].filter(Boolean).join(" · ")) + "</span>";
      }],
      ["pros", "Pros qui proposent leurs services", "C'est fait", function (x) {
        return "<strong>" + esc(x.nom) + "</strong> (" + esc(x.type) + "), " + esc(x.ville) + " (" + esc(x.departement) + ")" +
          '<span class="sub">' + esc([x.etablissement, x.numero_agrement, x.offres, x.prix, x.contact].filter(Boolean).join(" · ")) + "</span>";
      }],
      ["messages", "Messages reçus (page Nous contacter)", "Lu", function (x) {
        var qui = { eleve: "élève ou parent", "auto-ecole": "auto-école", moniteur: "moniteur", loueur: "loueur", autre: "autre" }[x.type] || x.type;
        return "<strong>" + esc(x.nom || "Sans nom") + "</strong> (" + esc(qui) + ")" + (x.ville ? ", " + esc(x.ville) : "") +
          '<span class="sub">' + esc(x.contact) + "</span>" + (x.message ? '<span class="sub">« ' + esc(x.message) + " »</span>" : "");
      }]
    ];
    $("#admin-a-traiter").innerHTML = blocs.map(function (b) {
      var items = at[b[0]] || [];
      return '<section class="block"><h3>' + b[1] + " (" + items.length + ")</h3>" +
        (items.length ? '<ul class="a-traiter">' + items.map(function (x) {
          return '<li><p>' + b[3](x) + '</p><p class="small">' + date(x.created_at) + "</p>" +
            '<div class="rap-actions"><button class="btn btn-small" type="button" data-traiter="' + b[0] + '" data-id="' + x.id + '">' + b[2] + "</button>" +
            '<button class="btn btn-small btn-ghost" type="button" data-traiter="' + b[0] + '" data-id="' + x.id + '" data-decision="supprimer">Supprimer</button></div></li>';
        }).join("") + "</ul>" : '<p class="small">Rien à traiter.</p>') + "</section>";
    }).join("");
    box.hidden = false;
    var zone = $("#admin-a-traiter");
    if (zone.getAttribute("data-pret")) return;
    zone.setAttribute("data-pret", "1");
    zone.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-traiter]");
      if (!b) return;
      var decision = b.getAttribute("data-decision") || "ok";
      b.disabled = true;
      callFn("stats", { action: "traiter", code: code, quoi: b.getAttribute("data-traiter"), id: Number(b.getAttribute("data-id")), decision: decision })
        .then(function () {
          var li = b.closest("li");
          li.innerHTML = '<p class="form-status is-ok">' + (decision === "supprimer" ? (b.getAttribute("data-traiter") === "liens" ? "Refusé." : "Supprimé.") :
            b.getAttribute("data-traiter") === "liens" ? "Validé : le pro voit maintenant ses chiffres dans son compte." :
            b.getAttribute("data-traiter") === "tarifs" ? "Validé : les prix s'afficheront sur sa fiche à la prochaine mise à jour du site." : "C'est noté.") + "</p>";
        }).catch(function (e) { b.disabled = false; alertStatus(b, e.message); });
    });
  }
  function alertStatus(el, text) {
    var p = document.createElement("p"); p.className = "form-status is-error"; p.textContent = text; el.parentNode.appendChild(p);
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
        if (j.demandes && j.demandes.total) {
          facts += '<div><dt>' + intFmt.format(j.demandes.total) + '</dt><dd>' + (j.demandes.total > 1 ? "élèves contactés" : "élève contacté") +
            " grâce aux demandes publiées sur Créno" + (j.demandes.ce_mois ? ", dont " + intFmt.format(j.demandes.ce_mois) + " ce mois-ci" : "") + "</dd></div>";
        }
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

  /* ---------- Demandes d'élèves, vues par les pros (/pro/demandes/) ---------- */
  var BESOINS = {
    "examen-blanc": "Une évaluation ou un examen blanc",
    "presentation-examen": "Être présenté à l'examen par une auto-école",
    "heures": "Des heures de conduite avec un moniteur",
    "location-voiture": "Louer une voiture à double commande"
  };
  function ilYa(iso) {
    var j = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : "il y a " + j + " jours";
  }
  function initDemandesPros() {
    var liste = $("#dem-liste");
    if (!liste) return;
    var etatEl = $("#dem-etat");
    var form = $("#rep-form");
    var filtre = $("#dem-filtre-dep");
    var repondues = store.get("creno-reponses", {}) || {};
    var demandes = [];
    if (!supabaseReady()) { etatEl.textContent = "Les demandes d'élèves ouvrent très bientôt."; return; }

    // Formulaire de réponse : champs selon le type de pro
    initSchoolPicker(form);
    var typeSel = $("#rep-type", form);
    function majType() {
      var t = typeSel.value;
      $all("[data-pour]", form).forEach(function (el) {
        var pour = el.getAttribute("data-pour");
        el.hidden = !((pour === "ae" && (t === "auto-ecole" || t === "moniteur")) || pour === t);
      });
      $("#rep-dep", form).required = $("#rep-ecole", form).required = (t === "auto-ecole" || t === "moniteur");
      $("#rep-nom", form).required = t === "moniteur";
      $("#rep-loueur", form).required = t === "loueur";
    }
    typeSel.addEventListener("change", majType);
    majType();
    chargerLoueurs().then(function (ls) {
      $("#rep-loueur", form).innerHTML = '<option value="">Choisis</option>' + ls.map(function (l) {
        return '<option value="' + esc(slugJS(l.nom)) + '">' + esc(l.nom + " (" + l.ville + ")") + "</option>";
      }).join("");
    });

    function afficher() {
      var dep = filtre.value;
      var vis = demandes.filter(function (d) { return !dep || d.departement === dep; });
      etatEl.textContent = vis.length
        ? plural(vis.length, "demande ouverte", "demandes ouvertes") + (dep ? " dans le " + dep : "") + "."
        : "Aucune demande ouverte" + (dep ? " dans le " + dep : "") + " pour l'instant. Reviens bientôt.";
      liste.innerHTML = vis.map(function (d) {
        var deja = repondues[d.id];
        return '<li class="demande" data-id="' + d.id + '"><div class="demande-head"><span class="dep-code">' + esc(d.departement) + "</span>" +
          "<strong>" + esc(BESOINS[d.besoin] || d.besoin) + "</strong></div>" +
          "<p>" + esc(d.ville || "Ville non précisée") + " · " + ilYa(d.created_at) + "</p>" +
          (d.disponibilites ? '<p class="small">Disponibilités : ' + esc(d.disponibilites) + "</p>" : "") +
          '<p class="small">' + d.nb_reponses + " réponse" + (d.nb_reponses > 1 ? "s" : "") + " sur 3</p>" +
          (deja ? '<p class="form-status is-ok">Tu as répondu à cette demande.</p>'
                : '<button class="btn btn-signal btn-small" type="button" data-repondre="' + d.id + '">Répondre à cet élève</button>') +
          "</li>";
      }).join("");
    }
    function charger() {
      callFn("pros", { action: "liste" }).then(function (j) { demandes = j.demandes || []; afficher(); })
        .catch(function (e) { etatEl.textContent = e.message; });
    }
    filtre.addEventListener("change", afficher);
    liste.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-repondre]");
      if (!b) return;
      var li = b.closest("li");
      var sess = auth.session();
      if (!sess) { location.href = lienCompte("pro/demandes/", "&type=pro"); return; }
      if (sess.user.type !== "pro") {
        var msgEl = $(".compte-gate", li) || document.createElement("p");
        msgEl.className = "compte-gate";
        msgEl.innerHTML = "Pour répondre, il faut un compte pro. Tu es connecté avec un compte élève. " +
          '<a href="' + esc(link("compte/")) + '">Gérer mon compte</a>';
        li.appendChild(msgEl);
        return;
      }
      if (!$("#rep-contact", form).value) $("#rep-contact", form).value = sess.user.email;
      if (!typeSel.value && sess.user.pro_type) { typeSel.value = sess.user.pro_type; majType(); }
      if (!$(".compte-qui", form)) {
        var qui = document.createElement("p");
        qui.className = "compte-qui";
        qui.innerHTML = "Connecté : <strong>" + esc(sess.user.email) + '</strong> · <a href="' + esc(link("compte/")) + '">Gérer mon compte</a>';
        form.insertBefore(qui, form.firstElementChild.nextSibling);
      }
      var d = demandes.filter(function (x) { return String(x.id) === b.getAttribute("data-repondre"); })[0];
      form.elements.demande.value = d.id;
      if (!form.elements.message.value) {
        form.elements.message.value = "Bonjour, j'ai vu ta demande sur Créno (" + (BESOINS[d.besoin] || "").toLowerCase() +
          "). Je peux t'aider : appelle-moi ou écris-moi pour en parler.";
      }
      if (!$("#rep-dep", form).value && d.departement) {
        $("#rep-dep", form).value = d.departement;
        $("#rep-dep", form).dispatchEvent(new Event("change"));
      }
      $(".form-status", form).textContent = "";
      $all("[data-repondre]", liste).forEach(function (x) { x.hidden = false; });
      b.hidden = true;
      li.appendChild(form);
      form.hidden = false;
      typeSel.focus();
    });
    $("#rep-annuler").addEventListener("click", function () {
      form.hidden = true;
      $all("[data-repondre]", liste).forEach(function (x) { x.hidden = false; });
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var statusEl = $(".form-status", form);
      var button = $("button[type=submit]", form);
      var corps = { action: "repondre" };
      $all("input[name], select[name], textarea[name]", form).forEach(function (f) {
        corps[f.name] = f.type === "checkbox" ? f.checked : f.value.trim();
      });
      corps.demande = Number(corps.demande);
      button.disabled = true;
      statusEl.textContent = "Envoi…"; statusEl.className = "form-status";
      callFnCompte("pros", corps).then(function (j) {
        button.disabled = false;
        repondues[corps.demande] = true;
        store.set("creno-reponses", repondues);
        var li = form.closest("li");
        form.hidden = true;
        document.querySelector("main") ? $("main").appendChild(form) : document.body.appendChild(form);
        var msg = "C'est envoyé : l'élève reçoit ton message avec ton contact, et te répond directement. Tes réponses sont dans ton compte." +
          (j.telephone ? " Il accepte aussi d'être appelé : " + j.telephone + "." : "");
        if (li) {
          var ok = document.createElement("p");
          ok.className = "form-status is-ok";
          ok.textContent = msg;
          var btn = $("[data-repondre]", li);
          if (btn) btn.replaceWith(ok); else li.appendChild(ok);
        }
        form.elements.message.value = "";
      }).catch(function (e) {
        button.disabled = false;
        setStatus(statusEl, false, e.message);
        if (e.status === 401) location.href = lienCompte("pro/demandes/", "&type=pro");
      });
    });
    charger();
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

  /* ---------- Onglets de l'espace pros (auto-écoles, moniteurs, loueurs) ---------- */
  // Sans JavaScript, les trois parties restent affichées l'une sous l'autre.
  function initProTabs() {
    var tabs = $all(".pro-tabs [role=tab]");
    if (!tabs.length) return;
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
    function activer(i, focus) {
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        panels[k].hidden = !on;
      });
      if (focus) tabs[i].focus();
    }
    // Quel onglet ouvrir : celui du lien (#pour-loueurs) ou celui qui contient l'élément visé (#badge, #inscrire-agence...)
    function depuisAdresse() {
      var id = location.hash.slice(1);
      var cible = id && document.getElementById(id);
      var i = 0;
      panels.forEach(function (p, k) { if (cible && (p === cible || p.contains(cible))) i = k; });
      activer(i, false);
      if (cible && panels.indexOf(cible) === -1) setTimeout(function () { cible.scrollIntoView({ block: "start" }); }, 0);
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function (ev) {
        ev.preventDefault();
        activer(i, false);
        if (history.replaceState) history.replaceState(null, "", "#" + panels[i].id);
      });
      t.addEventListener("keydown", function (ev) {
        var n = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
        if (ev.key === "Home") n = -i; else if (ev.key === "End") n = tabs.length - 1 - i;
        if (n === undefined) return;
        ev.preventDefault();
        var j = (i + n + tabs.length) % tabs.length;
        activer(j, true);
        if (history.replaceState) history.replaceState(null, "", "#" + panels[j].id);
      });
    });
    // Liens internes vers une partie d'un autre onglet (ex. « Donner mes tarifs »)
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest && ev.target.closest('a[href^="#"]');
      if (!a || a.getAttribute("role") === "tab") return;
      var cible = document.getElementById(a.getAttribute("href").slice(1));
      if (!cible) return;
      panels.forEach(function (p, k) { if (p.contains(cible) && p.hidden) activer(k, false); });
    });
    window.addEventListener("hashchange", depuisAdresse);
    depuisAdresse();
  }

  /* ---------- Menu à trois barres (téléphone) ---------- */
  // Sans JavaScript, le bouton reste caché et les onglets restent affichés comme avant.
  function initMenu() {
    var btn = $(".menu-btn");
    var header = $(".site-header");
    if (!btn || !header) return;
    document.documentElement.classList.add("js-menu");
    btn.hidden = false;
    function ouvrir(oui, rendreFocus) {
      header.classList.toggle("menu-ouvert", oui);
      btn.setAttribute("aria-expanded", oui ? "true" : "false");
      btn.setAttribute("aria-label", oui ? "Fermer le menu" : "Ouvrir le menu");
      if (!oui && rendreFocus) btn.focus();
    }
    btn.addEventListener("click", function () { ouvrir(btn.getAttribute("aria-expanded") !== "true", false); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && header.classList.contains("menu-ouvert")) ouvrir(false, true);
    });
    document.addEventListener("click", function (ev) {
      if (header.classList.contains("menu-ouvert") && !header.contains(ev.target)) ouvrir(false, false);
    });
    $all(".site-nav a", header).forEach(function (a) { a.addEventListener("click", function () { ouvrir(false, false); }); });
  }

  /* ---------- Démarrage ---------- */
  function start() {
    initMenu();
    majIconeCompte();
    initGates();
    initMotsDePasse();
    initCompte();
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
    initDemandesPros();
    initProTabs();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
