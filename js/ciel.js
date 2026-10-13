"use strict";
/* Carte du ciel : étoiles, Soleil, noms, grille, atmosphère, paysage, mode nuit, heure modifiable. */
(function () {
  const RAD = Math.PI / 180;
  const DEUX_PI = Math.PI * 2;
  const CLE_POSITION = "arcturus.position";
  const CLE_REGLAGES = "arcturus.reglages";
  const POSITION_DEFAUT = { nom: "Paris", lat: 48.8566, lon: 2.3522 };
  const FOV_MIN = 5;
  const FOV_MAX = 130;
  const REGLAGES_DEFAUT = {
    paysage: true, constellations: true, atmosphere: true, nuit: false, noms: true, lignes: false, magLimite: 6.5,
  };

  /* Étoiles de démonstration, utilisées seulement si data/etoiles.json est absent : [RA en heures, Dec, mag, B-V]. */
  const ETOILES_DEMO = [
    [6.752, -16.716, -1.46, 0.0], [6.399, -52.696, -0.74, 0.15], [14.261, 19.182, -0.05, 1.23],
    [18.616, 38.784, 0.03, 0.0], [5.278, 45.998, 0.08, 0.8], [5.242, -8.202, 0.13, -0.03],
    [7.655, 5.225, 0.34, 0.42], [5.919, 7.407, 0.42, 1.85], [19.846, 8.868, 0.76, 0.22],
    [4.599, 16.509, 0.85, 1.54], [16.49, -26.432, 1.09, 1.83], [13.42, -11.161, 0.97, -0.23],
    [7.755, 28.026, 1.14, 1.0], [22.961, -29.622, 1.16, 0.09], [20.69, 45.28, 1.25, 0.09],
    [10.14, 11.967, 1.35, -0.11], [2.53, 89.264, 1.98, 0.6], [11.062, 61.751, 1.79, 1.07],
    [13.399, 54.925, 2.23, 0.02], [12.9, 55.96, 1.77, -0.02],
  ];

  const $ = (id) => document.getElementById(id);
  const canvas = $("ciel");
  const ctx = canvas.getContext("2d");
  const borner = (v, min, max) => Math.max(min, Math.min(max, v));

  const vue = { az: 0, alt: 40, fov: 80 }; // direction du regard (degrés) et champ vertical
  let decalageMs = 0;                       // décalage entre l'heure simulée et l'heure réelle
  let largeur = 0;
  let hauteur = 0;
  let ratio = 1;
  let aRedessiner = true;
  const position = lirePosition();
  const reglages = lireReglages();

  const etoiles = { n: 0, ra: null, cosDec: null, sinDec: null, mag: null, couleur: [] };
  let noms = []; // { ra, cosDec, sinDec, nom, mag }

  /* ---------- Position (la même que sur l'accueil) et réglages mémorisés ---------- */
  function lirePosition() {
    try {
      const p = JSON.parse(localStorage.getItem(CLE_POSITION));
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
    } catch { /* stockage indisponible */ }
    return POSITION_DEFAUT;
  }

  function lireReglages() {
    const r = { ...REGLAGES_DEFAUT };
    try {
      const mem = JSON.parse(localStorage.getItem(CLE_REGLAGES));
      if (mem && typeof mem === "object") {
        for (const cle of Object.keys(REGLAGES_DEFAUT)) {
          if (typeof mem[cle] === typeof REGLAGES_DEFAUT[cle]) r[cle] = mem[cle];
        }
      }
    } catch { /* stockage indisponible */ }
    r.magLimite = borner(r.magLimite, 3, 6.5);
    return r;
  }

  function sauverReglages() {
    try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(reglages)); } catch { /* stockage indisponible */ }
  }

  /* ---------- Chargement des étoiles ---------- */
  function preparer(liste) {
    const n = liste.length;
    etoiles.n = n;
    etoiles.ra = new Float32Array(n);
    etoiles.cosDec = new Float32Array(n);
    etoiles.sinDec = new Float32Array(n);
    etoiles.mag = new Float32Array(n);
    etoiles.couleur = new Array(n);
    for (let i = 0; i < n; i++) {
      const [ra, dec, mag, ci] = liste[i];
      etoiles.ra[i] = ra * RAD;
      etoiles.cosDec[i] = Math.cos(dec * RAD);
      etoiles.sinDec[i] = Math.sin(dec * RAD);
      etoiles.mag[i] = mag;
      etoiles.couleur[i] = Astro.couleurBV(ci);
    }
  }

  function preparerNoms(liste, etoilesBrutes) {
    const magParCle = new Map(etoilesBrutes.map((s) => [s[0] + "_" + s[1], s[2]]));
    noms = liste.map(([ra, dec, nom]) => ({
      ra: ra * RAD,
      cosDec: Math.cos(dec * RAD),
      sinDec: Math.sin(dec * RAD),
      nom,
      mag: magParCle.has(ra + "_" + dec) ? magParCle.get(ra + "_" + dec) : 3,
    }));
  }

  async function chargerEtoiles() {
    try {
      const rep = await fetch("data/etoiles.json");
      if (!rep.ok) throw new Error("HTTP " + rep.status);
      const donnees = await rep.json();
      preparer(donnees.etoiles);
      preparerNoms(donnees.noms || [], donnees.etoiles);
    } catch {
      preparer(ETOILES_DEMO.map(([ra, dec, mag, ci]) => [ra * 15, dec, mag, ci]));
      const message = $("message-ciel");
      message.textContent = "Catalogue d'étoiles absent : affichage de démonstration (20 étoiles).";
      message.hidden = false;
    }
    aRedessiner = true;
  }

  /* ---------- Géométrie de l'écran ---------- */
  function ajusterTaille() {
    ratio = window.devicePixelRatio || 1;
    largeur = window.innerWidth;
    hauteur = window.innerHeight;
    canvas.width = Math.round(largeur * ratio);
    canvas.height = Math.round(hauteur * ratio);
    canvas.style.width = largeur + "px";
    canvas.style.height = hauteur + "px";
    aRedessiner = true;
  }

  function vecteur(azDeg, altDeg) {
    const a = azDeg * RAD;
    const h = altDeg * RAD;
    return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];
  }

  /* Grille azimut/hauteur : fixe dans le repère de l'horizon, donc calculée une seule fois. */
  const GRILLE = (function () {
    const lignes = [];
    for (let alt = -60; alt <= 75; alt += 15) {
      const pts = [];
      for (let az = 0; az <= 360; az += 3) pts.push(vecteur(az, alt));
      lignes.push({ pts, horizon: alt === 0 });
    }
    for (let az = 0; az < 360; az += 30) {
      const pts = [];
      for (let alt = -87; alt <= 87; alt += 3) pts.push(vecteur(az, alt));
      lignes.push({ pts, horizon: false });
    }
    return lignes;
  })();

  const POINTS_CARDINAUX = [["N", 0], ["E", 90], ["S", 180], ["O", 270]];

  /* ---------- Dessin ---------- */
  function versEcran(v, base, echelle, cx, cy) {
    const p = Astro.projeter(v, base);
    return p ? [cx + p[0] * echelle, cy - p[1] * echelle] : null;
  }

  function tracerPolyligne(pts, base, echelle, cx, cy) {
    const maxSaut = 4 * Math.max(largeur, hauteur);
    let precedent = null;
    for (const v of pts) {
      const p = versEcran(v, base, echelle, cx, cy);
      if (!p) { precedent = null; continue; }
      if (precedent && Math.hypot(p[0] - precedent[0], p[1] - precedent[1]) < maxSaut) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
      precedent = p;
    }
  }

  function dessinerGrille(base, echelle, cx, cy) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(120, 170, 255, 0.28)";
    ctx.beginPath();
    for (const l of GRILLE) if (!l.horizon) tracerPolyligne(l.pts, base, echelle, cx, cy);
    ctx.stroke();
    ctx.strokeStyle = "rgba(170, 205, 255, 0.55)";
    ctx.beginPath();
    for (const l of GRILLE) if (l.horizon) tracerPolyligne(l.pts, base, echelle, cx, cy);
    ctx.stroke();
  }

  function dessinerSol(echelle, cx, cy, couleur) {
    const h = Astro.cercleHorizon(vue.alt);
    ctx.fillStyle = couleur;
    ctx.beginPath();
    if (h.mode === "ligne") {
      ctx.rect(-1, cy, largeur + 2, hauteur - cy + 1);
      ctx.fill();
      return;
    }
    const sy = cy - h.centreY * echelle;
    const R = h.rayon * echelle;
    if (h.mode === "exterieur") ctx.rect(-1, -1, largeur + 2, hauteur + 2);
    ctx.moveTo(cx + R, sy);
    ctx.arc(cx, sy, R, 0, DEUX_PI);
    ctx.fill("evenodd");
  }

  function couleurSol(hauteurSoleil) {
    const t = reglages.atmosphere ? borner((hauteurSoleil + 8) / 14, 0, 1) : 0;
    const m = (nuit, jour) => Math.round(nuit + (jour - nuit) * t);
    return `rgb(${m(6, 38)},${m(9, 52)},${m(12, 34)})`;
  }

  function dessinerSoleil(v, base, echelle, cx, cy, boost) {
    const p = versEcran(v, base, echelle, cx, cy);
    if (!p || p[0] < -80 || p[0] > largeur + 80 || p[1] < -80 || p[1] > hauteur + 80) return null;
    const rayon = 7 * boost;
    const halo = ctx.createRadialGradient(p[0], p[1], rayon * 0.6, p[0], p[1], rayon * 5);
    halo.addColorStop(0, "rgba(255, 236, 170, 0.75)");
    halo.addColorStop(1, "rgba(255, 220, 140, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p[0], p[1], rayon * 5, 0, DEUX_PI);
    ctx.fill();
    ctx.fillStyle = "#fff6d6";
    ctx.beginPath();
    ctx.arc(p[0], p[1], rayon, 0, DEUX_PI);
    ctx.fill();
    return p;
  }

  function dessiner() {
    aRedessiner = false;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const maintenant = new Date(Date.now() + decalageMs);
    const lstDeg = Astro.tempsSideralLocal(maintenant, position.lon);
    const lst = lstDeg * RAD;
    const soleil = Astro.positionSoleil(maintenant);
    const vSoleil = Astro.versHorizon(soleil.ra, soleil.dec, position.lat, lstDeg);
    const hauteurSoleil = Astro.azimutHauteur(vSoleil).alt;

    const base = Astro.baseCamera(vue.az, vue.alt);
    const echelle = (hauteur / 2) / (2 * Math.tan((vue.fov * RAD) / 4));
    const cx = largeur / 2;
    const cy = hauteur / 2;
    const boost = Math.pow(80 / vue.fov, 0.3);

    /* Fond : dégradé de l'atmosphère ancré sur l'horizon, ou espace noir. */
    if (reglages.atmosphere) {
      const couleurs = Astro.couleursCiel(hauteurSoleil);
      const yHorizon = cy + 2 * Math.tan((vue.alt * RAD) / 2) * echelle;
      const hautPx = Math.max(60, 2 * Math.tan((35 * RAD)) * echelle);
      const fond = ctx.createLinearGradient(0, yHorizon - hautPx, 0, yHorizon);
      fond.addColorStop(0, couleurs.haut);
      fond.addColorStop(1, couleurs.bas);
      ctx.fillStyle = fond;
    } else {
      ctx.fillStyle = "#02040a";
    }
    ctx.fillRect(0, 0, largeur, hauteur);

    if (reglages.lignes) dessinerGrille(base, echelle, cx, cy);

    /* Étoiles */
    const limite = reglages.atmosphere ? Astro.magnitudeLimite(hauteurSoleil, reglages.magLimite) : reglages.magLimite;
    const sinLat = Math.sin(position.lat * RAD);
    const cosLat = Math.cos(position.lat * RAD);
    const { r, u, f } = base;
    let couleur = "";

    for (let i = 0; i < etoiles.n; i++) {
      const mag = etoiles.mag[i];
      if (mag > limite) continue;
      const H = lst - etoiles.ra[i];
      const cH = Math.cos(H);
      const cd = etoiles.cosDec[i];
      const sd = etoiles.sinDec[i];
      const e = -cd * Math.sin(H);
      const n = sd * cosLat - cd * sinLat * cH;
      const h = sd * sinLat + cd * cosLat * cH;

      const z = e * f[0] + n * f[1] + h * f[2];
      if (z < -0.9) continue;
      const k = (2 / (1 + z)) * echelle;
      const sx = cx + (e * r[0] + n * r[1] + h * r[2]) * k;
      const sy = cy - (e * u[0] + n * u[1] + h * u[2]) * k;
      if (sx < -6 || sx > largeur + 6 || sy < -6 || sy > hauteur + 6) continue;

      const rayon = Math.max(0.45, Math.min(4.2, 3.4 - 0.46 * mag)) * boost;
      ctx.globalAlpha = Math.min(borner(1.25 - 0.13 * mag, 0.5, 1), borner(limite - mag + 0.5, 0, 1));
      if (etoiles.couleur[i] !== couleur) {
        couleur = etoiles.couleur[i];
        ctx.fillStyle = couleur;
      }
      ctx.beginPath();
      ctx.arc(sx, sy, rayon, 0, DEUX_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* Soleil */
    const pSoleil = dessinerSoleil(vSoleil, base, echelle, cx, cy, boost);

    /* Noms des étoiles et du Soleil */
    if (reglages.noms) {
      ctx.font = "12px Poppins, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(185, 218, 255, 0.92)";
      const seuil = borner(2.2 + 2.5 * Math.log2(80 / vue.fov), 1.6, 6.5);
      for (const s of noms) {
        if (s.mag > seuil || s.mag > limite) continue;
        const H = lst - s.ra;
        const cH = Math.cos(H);
        const e = -s.cosDec * Math.sin(H);
        const n = s.sinDec * cosLat - s.cosDec * sinLat * cH;
        const h = s.sinDec * sinLat + s.cosDec * cosLat * cH;
        const p = versEcran([e, n, h], base, echelle, cx, cy);
        if (!p || p[0] < 0 || p[0] > largeur || p[1] < 0 || p[1] > hauteur) continue;
        ctx.fillText(s.nom, p[0] + 7, p[1] - 6);
      }
      if (pSoleil) ctx.fillText("Soleil", pSoleil[0] + 12, pSoleil[1] - 10);
    }

    /* Sol (paysage) et points cardinaux */
    if (reglages.paysage) dessinerSol(echelle, cx, cy, couleurSol(hauteurSoleil));

    if (reglages.lignes || reglages.paysage) {
      ctx.font = "700 15px Poppins, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      for (const [lettre, az] of POINTS_CARDINAUX) {
        const p = versEcran(vecteur(az, 2), base, echelle, cx, cy);
        if (p && p[0] > 10 && p[0] < largeur - 10 && p[1] > 10 && p[1] < hauteur - 10) ctx.fillText(lettre, p[0], p[1]);
      }
    }
  }

  /* ---------- Heure et date ---------- */
  function heureSimulee() { return new Date(Date.now() + decalageMs); }

  function majHorloge() {
    const d = heureSimulee();
    const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    $("ciel-heure").textContent = heure;
    $("ciel-date").textContent = date;
    $("reg-heure").textContent = heure;
    $("reg-date").textContent = date;
    aRedessiner = true; // le ciel tourne : on rafraîchit chaque seconde
  }

  function decalerMinutes(minutes) { decalageMs += minutes * 60000; majHorloge(); }

  function decalerJours(jours) {
    const d = heureSimulee();
    d.setDate(d.getDate() + jours); // garde la même heure locale, même au changement d'heure
    decalageMs = d.getTime() - Date.now();
    majHorloge();
  }

  function revenirAMaintenant() { decalageMs = 0; majHorloge(); }

  /* Appui maintenu : répète l'action, puis accélère. */
  function lierRepetition(bouton, action) {
    let delai = null;
    let intervalle = null;
    let compte = 0;
    const arreter = () => { clearTimeout(delai); clearInterval(intervalle); delai = null; intervalle = null; };
    bouton.addEventListener("pointerdown", () => {
      arreter();
      compte = 0;
      action(1);
      delai = setTimeout(() => {
        intervalle = setInterval(() => { compte++; action(compte > 12 ? 6 : 1); }, 110);
      }, 450);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((t) => bouton.addEventListener(t, arreter));
    bouton.addEventListener("click", (e) => { if (e.detail === 0) action(1); }); // clavier
  }

  lierRepetition($("h-moins"), (m) => decalerMinutes(-10 * m));
  lierRepetition($("h-plus"), (m) => decalerMinutes(10 * m));
  lierRepetition($("d-moins"), (m) => decalerJours(-m));
  lierRepetition($("d-plus"), (m) => decalerJours(m));
  $("h-reset").addEventListener("click", revenirAMaintenant);
  $("d-reset").addEventListener("click", revenirAMaintenant);

  /* ---------- Gestes : glisser pour tourner, pincer ou molette pour zoomer ---------- */
  const pointeurs = new Map();
  let distancePrecedente = 0;
  let debutAppui = null;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    debutAppui = pointeurs.size === 1 ? { x: e.clientX, y: e.clientY } : null;
    distancePrecedente = 0;
  });

  canvas.addEventListener("pointermove", (e) => {
    const avant = pointeurs.get(e.pointerId);
    if (!avant) return;
    const apres = { x: e.clientX, y: e.clientY };

    if (pointeurs.size === 1) {
      const degParPixel = vue.fov / hauteur;
      const facteur = Math.max(0.2, Math.cos(vue.alt * RAD));
      vue.az = (((vue.az - ((apres.x - avant.x) * degParPixel) / facteur) % 360) + 360) % 360;
      vue.alt = borner(vue.alt + (apres.y - avant.y) * degParPixel, -90, 90);
    } else if (pointeurs.size === 2) {
      pointeurs.set(e.pointerId, apres);
      const [a, b] = [...pointeurs.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distancePrecedente > 0 && distance > 0) {
        vue.fov = borner((vue.fov * distancePrecedente) / distance, FOV_MIN, FOV_MAX);
      }
      distancePrecedente = distance;
    }
    pointeurs.set(e.pointerId, apres);
    aRedessiner = true;
  });

  function relacher(e) {
    // Un simple appui (sans glisser) sur le ciel referme le panneau.
    if (e.type === "pointerup" && debutAppui && pointeurs.size === 1
        && Math.hypot(e.clientX - debutAppui.x, e.clientY - debutAppui.y) < 6) {
      fermerPanneau();
    }
    pointeurs.delete(e.pointerId);
    distancePrecedente = 0;
    debutAppui = null;
  }
  canvas.addEventListener("pointerup", relacher);
  canvas.addEventListener("pointercancel", relacher);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    vue.fov = borner(vue.fov * Math.exp(e.deltaY * 0.001), FOV_MIN, FOV_MAX);
    aRedessiner = true;
  }, { passive: false });

  /* ---------- Panneau de réglages ---------- */
  const boutonMenu = $("btn-menu");
  const panneau = $("panneau");
  const horloge = $("horloge");

  function ouvrirPanneau() {
    panneau.hidden = false;
    boutonMenu.hidden = true;
    horloge.hidden = true; // l'heure est alors affichée dans le panneau
    boutonMenu.setAttribute("aria-expanded", "true");
  }

  function fermerPanneau() {
    if (panneau.hidden) return;
    panneau.hidden = true;
    boutonMenu.hidden = false;
    horloge.hidden = false;
    boutonMenu.setAttribute("aria-expanded", "false");
  }

  boutonMenu.addEventListener("click", ouvrirPanneau);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fermerPanneau(); });

  const interrupteurs = document.querySelectorAll("[data-reglage]");

  function appliquerReglages() {
    for (const b of interrupteurs) b.setAttribute("aria-pressed", String(Boolean(reglages[b.dataset.reglage])));
    $("voile").hidden = !reglages.nuit;
    document.body.classList.toggle("nuit", reglages.nuit);
    $("mag-limite").value = String(reglages.magLimite);
    $("mag-valeur").textContent = reglages.magLimite.toFixed(1).replace(".", ",");
    aRedessiner = true;
  }

  for (const b of interrupteurs) {
    b.addEventListener("click", () => {
      const cle = b.dataset.reglage;
      reglages[cle] = !reglages[cle];
      sauverReglages();
      appliquerReglages();
    });
  }

  const dialogueCarte = $("dialogue-carte");
  $("btn-reglages").addEventListener("click", () => dialogueCarte.showModal());
  $("btn-fermer-carte").addEventListener("click", () => dialogueCarte.close());
  $("mag-limite").addEventListener("input", (e) => {
    reglages.magLimite = borner(parseFloat(e.target.value), 3, 6.5);
    sauverReglages();
    appliquerReglages();
  });

  /* ---------- Démarrage ---------- */
  window.addEventListener("resize", ajusterTaille);
  ajusterTaille();
  appliquerReglages();
  majHorloge();
  setInterval(majHorloge, 1000);
  chargerEtoiles();
  (function boucle() {
    if (aRedessiner) dessiner();
    requestAnimationFrame(boucle);
  })();
})();
