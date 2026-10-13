"use strict";
/* Carte du ciel : étoiles, déplacement au doigt, zoom, heure et date. */
(function () {
  const RAD = Math.PI / 180;
  const DEUX_PI = Math.PI * 2;
  const CLE_POSITION = "arcturus.position";
  const POSITION_DEFAUT = { nom: "Paris", lat: 48.8566, lon: 2.3522 };
  const FOV_MIN = 5;
  const FOV_MAX = 130;

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

  const canvas = document.getElementById("ciel");
  const ctx = canvas.getContext("2d");
  const vue = { az: 0, alt: 40, fov: 80 }; // direction du regard (degrés) et champ vertical
  let decalageMs = 0;                       // décalage de l'heure simulée (étape suivante : flèches)
  let largeur = 0;
  let hauteur = 0;
  let ratio = 1;
  let aRedessiner = true;
  let position = lirePosition();

  const etoiles = { n: 0, ra: null, cosDec: null, sinDec: null, mag: null, couleur: [] };

  /* ---------- Position (la même que sur l'accueil) ---------- */
  function lirePosition() {
    try {
      const p = JSON.parse(localStorage.getItem(CLE_POSITION));
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
    } catch { /* stockage indisponible */ }
    return POSITION_DEFAUT;
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

  async function chargerEtoiles() {
    const message = document.getElementById("message-ciel");
    try {
      const rep = await fetch("data/etoiles.json");
      if (!rep.ok) throw new Error("HTTP " + rep.status);
      const donnees = await rep.json();
      preparer(donnees.etoiles);
    } catch {
      preparer(ETOILES_DEMO.map(([ra, dec, mag, ci]) => [ra * 15, dec, mag, ci]));
      message.textContent = "Catalogue d'étoiles absent : affichage de démonstration (20 étoiles).";
      message.hidden = false;
    }
    aRedessiner = true;
  }

  /* ---------- Dessin ---------- */
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

  function dessinerSol(echelle, cx, cy) {
    const h = Astro.cercleHorizon(vue.alt);
    ctx.fillStyle = "#06090c";
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

  function dessiner() {
    aRedessiner = false;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const fond = ctx.createLinearGradient(0, 0, 0, hauteur);
    fond.addColorStop(0, "#040815");
    fond.addColorStop(1, "#0e1a3a");
    ctx.fillStyle = fond;
    ctx.fillRect(0, 0, largeur, hauteur);

    const maintenant = new Date(Date.now() + decalageMs);
    const lst = Astro.tempsSideralLocal(maintenant, position.lon) * RAD;
    const base = Astro.baseCamera(vue.az, vue.alt);
    const echelle = (hauteur / 2) / (2 * Math.tan((vue.fov * RAD) / 4));
    const cx = largeur / 2;
    const cy = hauteur / 2;
    const sinLat = Math.sin(position.lat * RAD);
    const cosLat = Math.cos(position.lat * RAD);
    const { r, u, f } = base;
    const boost = Math.pow(80 / vue.fov, 0.3);
    let couleur = "";

    for (let i = 0; i < etoiles.n; i++) {
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

      const mag = etoiles.mag[i];
      const rayon = Math.max(0.45, Math.min(4.2, 3.4 - 0.46 * mag)) * boost;
      ctx.globalAlpha = Math.max(0.5, Math.min(1, 1.25 - 0.13 * mag));
      if (etoiles.couleur[i] !== couleur) {
        couleur = etoiles.couleur[i];
        ctx.fillStyle = couleur;
      }
      ctx.beginPath();
      ctx.arc(sx, sy, rayon, 0, DEUX_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    dessinerSol(echelle, cx, cy);
  }

  /* ---------- Heure et date affichées ---------- */
  function majHorloge() {
    const d = new Date(Date.now() + decalageMs);
    document.getElementById("ciel-heure").textContent =
      d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    document.getElementById("ciel-date").textContent =
      d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    aRedessiner = true; // le ciel tourne : on rafraîchit chaque seconde
  }

  /* ---------- Gestes : glisser pour tourner, pincer ou molette pour zoomer ---------- */
  const pointeurs = new Map();
  let distancePrecedente = 0;
  const borner = (v, min, max) => Math.max(min, Math.min(max, v));

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    distancePrecedente = 0;
  });

  canvas.addEventListener("pointermove", (e) => {
    const avant = pointeurs.get(e.pointerId);
    if (!avant) return;
    const apres = { x: e.clientX, y: e.clientY };

    if (pointeurs.size === 1) {
      const degParPixel = vue.fov / hauteur;
      const dx = apres.x - avant.x;
      const dy = apres.y - avant.y;
      const facteur = Math.max(0.2, Math.cos(vue.alt * RAD));
      vue.az = (((vue.az - (dx * degParPixel) / facteur) % 360) + 360) % 360;
      vue.alt = borner(vue.alt + dy * degParPixel, -90, 90);
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
    pointeurs.delete(e.pointerId);
    distancePrecedente = 0;
  }
  canvas.addEventListener("pointerup", relacher);
  canvas.addEventListener("pointercancel", relacher);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    vue.fov = borner(vue.fov * Math.exp(e.deltaY * 0.001), FOV_MIN, FOV_MAX);
    aRedessiner = true;
  }, { passive: false });

  /* ---------- Menu (les six réglages arriveront à l'étape suivante) ---------- */
  const boutonMenu = document.getElementById("btn-menu");
  const panneau = document.getElementById("panneau");
  boutonMenu.addEventListener("click", () => {
    const ouvert = panneau.hidden;
    panneau.hidden = !ouvert;
    boutonMenu.setAttribute("aria-expanded", String(ouvert));
  });

  /* ---------- Démarrage ---------- */
  window.addEventListener("resize", ajusterTaille);
  ajusterTaille();
  majHorloge();
  setInterval(majHorloge, 1000);
  chargerEtoiles();
  (function boucle() {
    if (aRedessiner) dessiner();
    requestAnimationFrame(boucle);
  })();
})();
