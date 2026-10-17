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
    paysage: true, constellations: true, atmosphere: true, nuit: false, noms: true, lignes: false, profond: true, magLimite: 6.5,
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
  const canvasPano = $("paysage");
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

  const etoiles = { n: 0, x: null, y: null, z: null, mag: null, ci: null, raDeg: null, decDeg: null, couleur: [] };
  const detailsEtoiles = new Map(); // clé "ra_dec" -> [ra, dec, désignation, constellation, type spectral, distance en a.l., hip]
  const nomsParCle = new Map();     // clé "ra_dec" -> nom propre
  let noms = []; // { vx, vy, vz, nom, mag }
  const profond = { n: 0, x: null, y: null, z: null, mag: null, magConnue: null, raDeg: null, decDeg: null, maj: null, min: null, pa: null, famille: [], nom: [], commun: [] };
  const constellations = { n: 0, x: null, y: null, z: null, sx: null, sy: null, vis: null, polylignes: [], noms: [] };

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
  /* Vecteur unitaire équatorial (x vers le point vernal, z vers le pôle) à partir de RA et Dec en degrés. */
  function vecteurEquatorial(raDeg, decDeg) {
    const cd = Math.cos(decDeg * RAD);
    return [cd * Math.cos(raDeg * RAD), cd * Math.sin(raDeg * RAD), Math.sin(decDeg * RAD)];
  }

  function preparer(liste) {
    const n = liste.length;
    etoiles.n = n;
    etoiles.x = new Float32Array(n);
    etoiles.y = new Float32Array(n);
    etoiles.z = new Float32Array(n);
    etoiles.mag = new Float32Array(n);
    etoiles.ci = new Float32Array(n);
    etoiles.raDeg = new Float64Array(n);
    etoiles.decDeg = new Float64Array(n);
    etoiles.couleur = new Array(n);
    for (let i = 0; i < n; i++) {
      const [ra, dec, mag, ci] = liste[i];
      const v = vecteurEquatorial(ra, dec);
      etoiles.x[i] = v[0];
      etoiles.y[i] = v[1];
      etoiles.z[i] = v[2];
      etoiles.mag[i] = mag;
      etoiles.ci[i] = Number.isFinite(ci) ? ci : 0.6;
      etoiles.raDeg[i] = ra;
      etoiles.decDeg[i] = dec;
      etoiles.couleur[i] = Astro.couleurBV(ci);
    }
  }

  function preparerNoms(liste, etoilesBrutes) {
    const magParCle = new Map(etoilesBrutes.map((s) => [s[0] + "_" + s[1], s[2]]));
    noms = liste.map(([ra, dec, nom]) => {
      const v = vecteurEquatorial(ra, dec);
      return { vx: v[0], vy: v[1], vz: v[2], nom, mag: magParCle.has(ra + "_" + dec) ? magParCle.get(ra + "_" + dec) : 3 };
    });
  }

  function ajouterMessage(texte) {
    const m = $("message-ciel");
    m.textContent = m.textContent ? m.textContent + " " + texte : texte;
    m.hidden = false;
  }

  async function chargerEtoiles() {
    try {
      const rep = await fetch("data/etoiles.json");
      if (!rep.ok) throw new Error("HTTP " + rep.status);
      const donnees = await rep.json();
      preparer(donnees.etoiles);
      preparerNoms(donnees.noms || [], donnees.etoiles);
      for (const nom of donnees.noms || []) nomsParCle.set(nom[0] + "_" + nom[1], nom[2]);
      for (const det of donnees.details || []) detailsEtoiles.set(det[0] + "_" + det[1], det);
    } catch {
      preparer(ETOILES_DEMO.map(([ra, dec, mag, ci]) => [ra * 15, dec, mag, ci]));
      ajouterMessage("Catalogue d'étoiles absent : affichage de démonstration (20 étoiles).");
    }
    aRedessiner = true;
  }

  /* Tracés des constellations : points uniques partagés entre les lignes, centre calculé pour le nom. */
  function preparerConstellations(donnees) {
    const cle = new Map();
    const pts = [];
    const indice = (ra, dec) => {
      const k = ra + "_" + dec;
      let i = cle.get(k);
      if (i === undefined) { i = pts.length; cle.set(k, i); pts.push(vecteurEquatorial(ra, dec)); }
      return i;
    };
    const polylignes = [];
    const nomsC = [];
    for (const c of donnees.constellations) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const ligne of c.lignes) {
        polylignes.push(ligne.map(([ra, dec]) => indice(ra, dec)));
        for (const [ra, dec] of ligne) {
          const v = vecteurEquatorial(ra, dec);
          x += v[0];
          y += v[1];
          z += v[2];
        }
      }
      const norme = Math.hypot(x, y, z);
      if (norme > 1e-6) nomsC.push({ nom: c.nom.toUpperCase(), vx: x / norme, vy: y / norme, vz: z / norme });
    }
    const n = pts.length;
    constellations.n = n;
    constellations.x = Float32Array.from(pts, (v) => v[0]);
    constellations.y = Float32Array.from(pts, (v) => v[1]);
    constellations.z = Float32Array.from(pts, (v) => v[2]);
    constellations.sx = new Float32Array(n);
    constellations.sy = new Float32Array(n);
    constellations.vis = new Uint8Array(n);
    constellations.polylignes = polylignes;
    constellations.noms = nomsC;
  }

  async function chargerConstellations() {
    try {
      const rep = await fetch("data/constellations.json");
      if (!rep.ok) throw new Error("HTTP " + rep.status);
      preparerConstellations(await rep.json());
    } catch {
      ajouterMessage("Tracés des constellations absents : ouvre outils/convertir-constellations.html pour les créer.");
    }
    aRedessiner = true;
  }

  /* Galaxies, nébuleuses, amas (OpenNGC) : [RA, Dec, mag, famille, grand axe ('), petit axe ('), angle, nom, nom commun]. */
  function preparerProfond(objets) {
    const n = objets.length;
    profond.n = n;
    profond.x = new Float32Array(n);
    profond.y = new Float32Array(n);
    profond.z = new Float32Array(n);
    profond.mag = new Float32Array(n);
    profond.magConnue = new Uint8Array(n);
    profond.raDeg = new Float64Array(n);
    profond.decDeg = new Float64Array(n);
    profond.maj = new Float32Array(n);
    profond.min = new Float32Array(n);
    profond.pa = new Float32Array(n);
    profond.famille = new Array(n);
    profond.nom = new Array(n);
    profond.commun = new Array(n);
    objets.forEach(([ra, dec, mag, famille, maj, min, pa, nom, commun], i) => {
      const v = vecteurEquatorial(ra, dec);
      profond.x[i] = v[0];
      profond.y[i] = v[1];
      profond.z[i] = v[2];
      profond.mag[i] = mag === null || mag === undefined ? 10.5 : mag;
      profond.magConnue[i] = mag === null || mag === undefined ? 0 : 1;
      profond.raDeg[i] = ra;
      profond.decDeg[i] = dec;
      profond.maj[i] = maj || 1;
      profond.min[i] = min || maj || 1;
      profond.pa[i] = pa || 0;
      profond.famille[i] = famille;
      profond.nom[i] = nom;
      profond.commun[i] = commun || "";
    });
  }

  async function chargerProfond() {
    try {
      const rep = await fetch("data/ciel-profond.json");
      if (!rep.ok) throw new Error("HTTP " + rep.status);
      preparerProfond((await rep.json()).objets);
    } catch {
      ajouterMessage("Galaxies et nébuleuses absentes : ouvre outils/convertir-profond.html pour les créer.");
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
    canvasPano.width = canvas.width;
    canvasPano.height = canvas.height;
    canvasPano.style.width = largeur + "px";
    canvasPano.style.height = hauteur + "px";
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

  const PAYSAGE = Paysage.construire();
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

  /* Couleurs du paysage : sombres la nuit, un peu plus claires et vertes en plein jour. */
  function couleursPaysage(hauteurSoleil) {
    const t = reglages.atmosphere ? borner((hauteurSoleil + 8) / 14, 0, 1) : 0;
    const m = (nuit, jour) => `rgb(${nuit.map((v, i) => Math.round(v + (jour[i] - v) * t)).join(",")})`;
    return {
      sol: m([6, 9, 12], [38, 52, 34]),
      collines: m([9, 14, 20], [46, 66, 58]),
      arbres: m([3, 5, 7], [14, 22, 16]),
    };
  }

  /* Une couche de silhouette : suite de petits quadrilatères entre l'horizon et la hauteur du profil. */
  function dessinerCouche(profil, couleur, C, echelle, cx, cy, saut) {
    const n = PAYSAGE.n;
    const cosB = Math.cos(PAYSAGE.base * RAD);
    const sinB = Math.sin(PAYSAGE.base * RAD);
    ctx.fillStyle = couleur;
    ctx.beginPath();
    let pbx = 0;
    let pby = 0;
    let phx = 0;
    let phy = 0;
    let precedentOk = false;
    for (let i = 0; ; i += saut) {
      const ii = Math.min(i, n);
      const sa = PAYSAGE.sinAz[ii];
      const ca = PAYSAGE.cosAz[ii];
      let ok = false;
      let bx = 0;
      let by = 0;
      let hx = 0;
      let hy = 0;
      let e = cosB * sa;
      let nn = cosB * ca;
      let z = C[6] * e + C[7] * nn + C[8] * sinB;
      if (z >= -0.9) {
        let k = (2 / (1 + z)) * echelle;
        bx = cx + (C[0] * e + C[1] * nn + C[2] * sinB) * k;
        by = cy - (C[3] * e + C[4] * nn + C[5] * sinB) * k;
        e = profil.cos[ii] * sa;
        nn = profil.cos[ii] * ca;
        const u = profil.sin[ii];
        z = C[6] * e + C[7] * nn + C[8] * u;
        if (z >= -0.9) {
          k = (2 / (1 + z)) * echelle;
          hx = cx + (C[0] * e + C[1] * nn + C[2] * u) * k;
          hy = cy - (C[3] * e + C[4] * nn + C[5] * u) * k;
          ok = true;
        }
      }
      if (ok && precedentOk) {
        ctx.moveTo(pbx, pby);
        ctx.lineTo(bx, by);
        ctx.lineTo(hx, hy);
        ctx.lineTo(phx, phy);
        ctx.closePath();
      }
      pbx = bx;
      pby = by;
      phx = hx;
      phy = hy;
      precedentOk = ok;
      if (ii === n) break;
    }
    ctx.fill();
  }

  function dessinerPaysage(hauteurSoleil, base, echelle, cx, cy) {
    const couleurs = couleursPaysage(hauteurSoleil);
    dessinerSol(echelle, cx, cy, couleurs.sol);
    const C = Astro.matriceCamera(base);
    const saut = borner(Math.round(3 / (echelle * 0.1 * RAD)), 1, 12); // moins d'échantillons quand on ne zoome pas
    dessinerCouche(PAYSAGE.collines, couleurs.collines, C, echelle, cx, cy, saut);
    dessinerCouche(PAYSAGE.arbres, couleurs.arbres, C, echelle, cx, cy, saut);
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

  /* Projette un vecteur équatorial J2000 avec la matrice complète ; renvoie [sx, sy] ou null. */
  function projeterJ2000(M, x, y, z, echelle, cx, cy) {
    const zc = M[6] * x + M[7] * y + M[8] * z;
    if (zc < -0.9) return null;
    const k = (2 / (1 + zc)) * echelle;
    return [cx + (M[0] * x + M[1] * y + M[2] * z) * k, cy - (M[3] * x + M[4] * y + M[5] * z) * k];
  }

  function dessinerConstellations(M, echelle, cx, cy) {
    const c = constellations;
    for (let i = 0; i < c.n; i++) {
      const x = c.x[i];
      const y = c.y[i];
      const z = c.z[i];
      const zc = M[6] * x + M[7] * y + M[8] * z;
      if (zc < -0.9) { c.vis[i] = 0; continue; }
      const k = (2 / (1 + zc)) * echelle;
      c.sx[i] = cx + (M[0] * x + M[1] * y + M[2] * z) * k;
      c.sy[i] = cy - (M[3] * x + M[4] * y + M[5] * z) * k;
      c.vis[i] = 1;
    }

    const maxSaut = 4 * Math.max(largeur, hauteur);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(110, 190, 255, 0.75)";
    ctx.beginPath();
    for (const ligne of c.polylignes) {
      let precedent = -1;
      for (const i of ligne) {
        if (!c.vis[i]) { precedent = -1; continue; }
        if (precedent >= 0 && Math.hypot(c.sx[i] - c.sx[precedent], c.sy[i] - c.sy[precedent]) < maxSaut) ctx.lineTo(c.sx[i], c.sy[i]);
        else ctx.moveTo(c.sx[i], c.sy[i]);
        precedent = i;
      }
    }
    ctx.stroke();

    if (vue.fov < 12) return; // trop zoomé : les noms ne serviraient plus à rien
    ctx.font = "600 12px Poppins, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(130, 215, 255, 0.95)";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
    for (const nom of c.noms) {
      const p = projeterJ2000(M, nom.vx, nom.vy, nom.vz, echelle, cx, cy);
      if (p && p[0] > 20 && p[0] < largeur - 20 && p[1] > 20 && p[1] < hauteur - 20) ctx.fillText(nom.nom, p[0], p[1]);
    }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }

  /* ---------- Paysage photographique : panorama équirectangulaire à ciel transparent (data/paysage.webp), rendu en WebGL ----------
     Si le fichier ou WebGL manque, on garde le paysage généré. */
  const PANORAMA = { pret: false, gl: null, programme: null, u: {}, visible: null };
  const DECALAGE_AZIMUT_PANORAMA = -0.152; // fraction de tour : place le couchant du panorama à l'ouest

  const SOURCE_VERTEX = "attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }";
  const SOURCE_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uEchelle;
uniform vec3 uR;
uniform vec3 uU;
uniform vec3 uF;
uniform vec3 uTeinte;
uniform float uDecal;
uniform sampler2D uTex;
void main() {
  // Pixel -> plan de la projection stéréographique -> direction dans le repère de la caméra.
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uEchelle;
  float r2 = dot(p, p);
  float d = 4.0 + r2;
  vec3 c = vec3(4.0 * p.x / d, 4.0 * p.y / d, (4.0 - r2) / d);
  vec3 v = c.x * uR + c.y * uU + c.z * uF;               // [est, nord, haut]
  float az = atan(v.x, v.y);                              // 0 = nord, positif vers l'est
  float alt = asin(clamp(v.z, -1.0, 1.0));
  vec2 uv = vec2(fract(az / 6.2831853 + uDecal), 0.5 - alt / 3.1415927);
  vec4 t = texture2D(uTex, uv);                           // couleurs déjà multipliées par l'opacité
  gl_FragColor = vec4(t.rgb * uTeinte, t.a);
}`;

  function compilerShader(gl, type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
    return sh;
  }

  function chargerPanorama() {
    try {
      const gl = canvasPano.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) return;
      const prog = gl.createProgram();
      gl.attachShader(prog, compilerShader(gl, gl.VERTEX_SHADER, SOURCE_VERTEX));
      gl.attachShader(prog, compilerShader(gl, gl.FRAGMENT_SHADER, SOURCE_FRAGMENT));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("programme");
      gl.useProgram(prog);

      const tampon = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, tampon);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const u = {};
      for (const nom of ["uRes", "uEchelle", "uR", "uU", "uF", "uTeinte", "uDecal", "uTex"]) u[nom] = gl.getUniformLocation(prog, nom);

      const image = new Image();
      image.onload = () => {
        try {
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.uniform1i(u.uTex, 0);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          PANORAMA.gl = gl;
          PANORAMA.programme = prog;
          PANORAMA.u = u;
          PANORAMA.pret = true;
          aRedessiner = true;
        } catch { /* texture refusée : on garde le paysage généré */ }
      };
      image.src = "data/paysage.webp"; // absent : pas d'erreur visible, le paysage généré reste affiché
    } catch { /* WebGL indisponible : on garde le paysage généré */ }
  }

  function dessinerPanorama(base, echelle, hauteurSoleil) {
    const gl = PANORAMA.gl;
    const u = PANORAMA.u;
    gl.viewport(0, 0, canvasPano.width, canvasPano.height);
    gl.useProgram(PANORAMA.programme);
    gl.uniform2f(u.uRes, canvasPano.width, canvasPano.height);
    gl.uniform1f(u.uEchelle, echelle * ratio);
    gl.uniform3fv(u.uR, base.r);
    gl.uniform3fv(u.uU, base.u);
    gl.uniform3fv(u.uF, base.f);
    gl.uniform1f(u.uDecal, DECALAGE_AZIMUT_PANORAMA);
    // La photo est prise au coucher du soleil : on l'assombrit la nuit et on l'éclaire le jour.
    const t = reglages.atmosphere ? borner((hauteurSoleil + 8) / 14, 0, 1) : 0;
    const m = (nuit, jour) => nuit + (jour - nuit) * t;
    gl.uniform3f(u.uTeinte, m(0.09, 1), m(0.105, 1), m(0.15, 1));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* Symboles du ciel profond : galaxie = ellipse, amas ouvert = cercle pointillé, amas globulaire = cercle croisé,
     nébuleuse planétaire = cercle à repères, nébuleuse = carré, rémanent de supernova = losange. */
  const COULEURS_PROFOND = { G: "#ffb070", OC: "#ffe08a", GC: "#ffe08a", PN: "#7fffd4", N: "#7fd0ff", SNR: "#d0a8ff" };

  function angleGalaxie(M, i, echelle, cx, cy, px, py) {
    // Direction du grand axe à l'écran : on projette un point voisin, dans la direction de l'angle de position (nord vers l'est).
    const x = profond.x[i];
    const y = profond.y[i];
    const z = profond.z[i];
    const alpha = Math.atan2(y, x);
    const delta = Math.asin(z);
    const th = profond.pa[i] * RAD;
    const nx = -Math.sin(delta) * Math.cos(alpha);
    const ny = -Math.sin(delta) * Math.sin(alpha);
    const nz = Math.cos(delta);
    const ex = -Math.sin(alpha);
    const ey = Math.cos(alpha);
    const eps = 0.003;
    const tx = Math.cos(th) * nx + Math.sin(th) * ex;
    const ty = Math.cos(th) * ny + Math.sin(th) * ey;
    const tz = Math.cos(th) * nz;
    const q = projeterJ2000(M, x + eps * tx, y + eps * ty, z + eps * tz, echelle, cx, cy);
    return q ? Math.atan2(q[1] - py, q[0] - px) : 0;
  }

  function dessinerProfond(M, echelle, cx, cy, limite) {
    const magMax = Math.min(12, limite + 4.5); // devient invisible en plein jour ou en crépuscule clair
    if (profond.n === 0 || magMax < 4) return;
    const seuilNom = borner(7 + 2.2 * Math.log2(80 / vue.fov), 5.5, 12);
    ctx.lineWidth = 1.2;
    ctx.font = "12px Poppins, system-ui, sans-serif";
    ctx.textAlign = "left";

    for (let i = 0; i < profond.n; i++) {
      const mag = profond.mag[i];
      if (mag > magMax) continue;
      const x = profond.x[i];
      const y = profond.y[i];
      const z = profond.z[i];
      const zc = M[6] * x + M[7] * y + M[8] * z;
      if (zc < -0.9) continue;
      const k = (2 / (1 + zc)) * echelle;
      const sx = cx + (M[0] * x + M[1] * y + M[2] * z) * k;
      const sy = cy - (M[3] * x + M[4] * y + M[5] * z) * k;
      if (sx < -60 || sx > largeur + 60 || sy < -60 || sy > hauteur + 60) continue;

      const famille = profond.famille[i];
      const a = Math.min(1500, Math.max(5, ((profond.maj[i] / 120) * RAD) * k)); // demi grand axe en pixels, 5 px minimum
      const couleur = COULEURS_PROFOND[famille] || "#ffffff";
      ctx.strokeStyle = couleur;
      ctx.globalAlpha = borner(1.2 - 0.07 * (mag - 4), 0.45, 1);

      ctx.beginPath();
      if (famille === "G") {
        const b = Math.max(3.5, a * (profond.min[i] / profond.maj[i]));
        const angle = a > 6 ? angleGalaxie(M, i, echelle, cx, cy, sx, sy) : 0;
        ctx.ellipse(sx, sy, a, b, angle, 0, DEUX_PI);
      } else if (famille === "OC") {
        ctx.setLineDash([3, 3]);
        ctx.arc(sx, sy, a, 0, DEUX_PI);
      } else if (famille === "GC") {
        ctx.arc(sx, sy, a, 0, DEUX_PI);
        ctx.moveTo(sx - a, sy);
        ctx.lineTo(sx + a, sy);
        ctx.moveTo(sx, sy - a);
        ctx.lineTo(sx, sy + a);
      } else if (famille === "PN") {
        ctx.arc(sx, sy, a * 0.6, 0, DEUX_PI);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.moveTo(sx + dx * a * 0.6, sy + dy * a * 0.6);
          ctx.lineTo(sx + dx * a * 1.2, sy + dy * a * 1.2);
        }
      } else if (famille === "SNR") {
        ctx.moveTo(sx, sy - a);
        ctx.lineTo(sx + a, sy);
        ctx.lineTo(sx, sy + a);
        ctx.lineTo(sx - a, sy);
        ctx.closePath();
      } else {
        ctx.rect(sx - a, sy - a, 2 * a, 2 * a);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      if (reglages.noms && mag <= seuilNom) {
        ctx.fillStyle = couleur;
        const texte = vue.fov < 35 && profond.commun[i] ? `${profond.nom[i]} (${profond.commun[i]})` : profond.nom[i];
        ctx.fillText(texte, sx + Math.min(a, 40) + 4, sy - 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- Planètes et Lune (bibliothèque Astronomy Engine, js/astronomy.browser.min.js) ---------- */
  const CORPS = [
    { id: "Mercury", nom: "Mercure", couleur: "#cfc9c0" },
    { id: "Venus", nom: "Vénus", couleur: "#fff5d6" },
    { id: "Mars", nom: "Mars", couleur: "#ff8f66" },
    { id: "Jupiter", nom: "Jupiter", couleur: "#f5e6c6" },
    { id: "Saturn", nom: "Saturne", couleur: "#eedba5" },
    { id: "Uranus", nom: "Uranus", couleur: "#a5eaf0" },
    { id: "Neptune", nom: "Neptune", couleur: "#86a1ff" },
  ];
  const RAYON_LUNE_UA = 1.1614e-5; // rayon de la Lune en unités astronomiques
  let astronomieOk = typeof Astronomy !== "undefined";
  let cacheCorps = { cle: null, planetes: [], lune: null };

  function calculerCorps(date) {
    const cle = Math.floor(date.getTime() / 1000);
    if (cacheCorps.cle === cle) return cacheCorps;
    const observateur = new Astronomy.Observer(position.lat, position.lon, 0);
    const planetes = CORPS.map((c) => {
      const corps = Astronomy.Body[c.id];
      const eq = Astronomy.Equator(corps, date, observateur, true, true);
      const ill = Astronomy.Illumination(corps, date);
      return { ...c, ra: eq.ra * 15, dec: eq.dec, mag: ill.mag, dist: eq.dist, helio: ill.helio_dist, fraction: ill.phase_fraction };
    });
    const eqLune = Astronomy.Equator(Astronomy.Body.Moon, date, observateur, true, true);
    const phase = Astronomy.Illumination(Astronomy.Body.Moon, date).phase_angle; // 0 = pleine, 180 = nouvelle
    cacheCorps = { cle, planetes, lune: { ra: eqLune.ra * 15, dec: eqLune.dec, dist: eqLune.dist, phase } };
    return cacheCorps;
  }

  /* Dessine la Lune avec sa phase ; theta = direction du Soleil à l'écran (radians). */
  function dessinerLune(x, y, rayon, phaseDeg, theta) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(theta);
    ctx.fillStyle = "#2b2f3b"; // partie dans l'ombre
    ctx.beginPath();
    ctx.arc(0, 0, rayon, 0, DEUX_PI);
    ctx.fill();
    const c = Math.cos(phaseDeg * RAD);
    const rx = Math.abs(c) * rayon;
    ctx.fillStyle = "#f4f0e2"; // partie éclairée : demi-disque côté Soleil, borné par le terminateur
    ctx.beginPath();
    ctx.arc(0, 0, rayon, -Math.PI / 2, Math.PI / 2, false);
    if (c >= 0) ctx.ellipse(0, 0, rx, rayon, 0, Math.PI / 2, Math.PI * 1.5, false);
    else ctx.ellipse(0, 0, rx, rayon, 0, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function dessinerCorps(corps, lstDeg, vSoleil, base, echelle, cx, cy, boost, limite) {
    ctx.font = "12px Poppins, system-ui, sans-serif";
    ctx.textAlign = "left";
    const surEcran = (p) => p && p[0] > -30 && p[0] < largeur + 30 && p[1] > -30 && p[1] < hauteur + 30;

    for (const pl of corps.planetes) {
      if (pl.mag > limite) continue;
      const p = versEcran(Astro.versHorizon(pl.ra, pl.dec, position.lat, lstDeg), base, echelle, cx, cy);
      if (!surEcran(p)) continue;
      const rayon = borner(3.6 - 0.5 * pl.mag, 2, 6.5) * boost;
      ctx.fillStyle = pl.couleur;
      ctx.beginPath();
      ctx.arc(p[0], p[1], rayon, 0, DEUX_PI);
      ctx.fill();
      if (reglages.noms) {
        ctx.fillStyle = "rgba(255, 236, 190, 0.95)";
        ctx.fillText(pl.nom, p[0] + rayon + 5, p[1] - 5);
      }
    }

    const l = corps.lune;
    const vLune = Astro.versHorizon(l.ra, l.dec, position.lat, lstDeg);
    const p = versEcran(vLune, base, echelle, cx, cy);
    if (!surEcran(p)) return;
    const zc = vLune[0] * base.f[0] + vLune[1] * base.f[1] + vLune[2] * base.f[2];
    const rayon = Math.max(9, (RAYON_LUNE_UA / l.dist) * echelle * (2 / (1 + zc)));

    // Direction du Soleil à l'écran : on projette un point voisin de la Lune, sur le grand cercle Lune -> Soleil.
    const ps = vSoleil[0] * vLune[0] + vSoleil[1] * vLune[1] + vSoleil[2] * vLune[2];
    const t = [vSoleil[0] - ps * vLune[0], vSoleil[1] - ps * vLune[1], vSoleil[2] - ps * vLune[2]];
    const nt = Math.hypot(t[0], t[1], t[2]) || 1;
    const voisin = [vLune[0] + (0.01 * t[0]) / nt, vLune[1] + (0.01 * t[1]) / nt, vLune[2] + (0.01 * t[2]) / nt];
    const pv = versEcran(voisin, base, echelle, cx, cy);
    const theta = pv ? Math.atan2(pv[1] - p[1], pv[0] - p[0]) : 0;

    dessinerLune(p[0], p[1], rayon, l.phase, theta);
    if (reglages.noms) {
      ctx.fillStyle = "rgba(255, 236, 190, 0.95)";
      ctx.fillText("Lune", p[0] + rayon + 5, p[1] - 5);
    }
  }

  function dessiner() {
    aRedessiner = false;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const maintenant = new Date(Date.now() + decalageMs);
    const lstDeg = Astro.tempsSideralLocal(maintenant, position.lon);
    const soleil = Astro.positionSoleil(maintenant);
    const vSoleil = Astro.versHorizon(soleil.ra, soleil.dec, position.lat, lstDeg);
    const hauteurSoleil = Astro.azimutHauteur(vSoleil).alt;

    const base = Astro.baseCamera(vue.az, vue.alt);
    const echelle = (hauteur / 2) / (2 * Math.tan((vue.fov * RAD) / 4));
    const cx = largeur / 2;
    const cy = hauteur / 2;
    const boost = Math.pow(80 / vue.fov, 0.3);

    /* Matrice des objets au catalogue J2000 (précession incluse), de l'équatorial vers l'écran. */
    const MH = Astro.mulMat(Astro.matriceHorizon(position.lat, lstDeg), Astro.matricePrecession(maintenant));
    const MJ = Astro.mulMat(Astro.matriceCamera(base), MH);

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
    if (reglages.profond) dessinerProfond(MJ, echelle, cx, cy, limite);
    let couleur = "";
    for (let i = 0; i < etoiles.n; i++) {
      const mag = etoiles.mag[i];
      if (mag > limite) continue;
      const x = etoiles.x[i];
      const y = etoiles.y[i];
      const z = etoiles.z[i];
      const zc = MJ[6] * x + MJ[7] * y + MJ[8] * z;
      if (zc < -0.9) continue;
      const k = (2 / (1 + zc)) * echelle;
      const sx = cx + (MJ[0] * x + MJ[1] * y + MJ[2] * z) * k;
      const sy = cy - (MJ[3] * x + MJ[4] * y + MJ[5] * z) * k;
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

    /* Constellations : lignes et noms */
    if (reglages.constellations && constellations.n > 0) dessinerConstellations(MJ, echelle, cx, cy);

    /* Soleil, planètes, Lune */
    const pSoleil = dessinerSoleil(vSoleil, base, echelle, cx, cy, boost);
    let corps = null;
    if (astronomieOk) {
      try {
        corps = calculerCorps(maintenant);
        dessinerCorps(corps, lstDeg, vSoleil, base, echelle, cx, cy, boost, limite);
      } catch (erreur) {
        astronomieOk = false;
        ajouterMessage("Planètes et Lune indisponibles : " + erreur.message);
      }
    }

    /* Noms des étoiles et du Soleil */
    if (reglages.noms) {
      ctx.font = "12px Poppins, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(185, 218, 255, 0.92)";
      const seuil = borner(2.2 + 2.5 * Math.log2(80 / vue.fov), 1.6, 6.5);
      for (const s of noms) {
        if (s.mag > seuil || s.mag > limite) continue;
        const p = projeterJ2000(MJ, s.vx, s.vy, s.vz, echelle, cx, cy);
        if (!p || p[0] < 0 || p[0] > largeur || p[1] < 0 || p[1] > hauteur) continue;
        ctx.fillText(s.nom, p[0] + 7, p[1] - 6);
      }
      if (pSoleil) ctx.fillText("Soleil", pSoleil[0] + 12, pSoleil[1] - 10);
    }

    /* Mémorise la vue (pour retrouver l'astre touché) et repère l'astre sélectionné */
    derniereVue = { maintenant, lstDeg, vSoleil, base, echelle, cx, cy, MJ, MH, limite, corps };
    dessinerSelection(derniereVue);

    /* Sol (paysage) et points cardinaux */
    const panoramaActif = reglages.paysage && PANORAMA.pret;
    if (reglages.paysage && !PANORAMA.pret) dessinerPaysage(hauteurSoleil, base, echelle, cx, cy);
    if (PANORAMA.visible !== panoramaActif) { PANORAMA.visible = panoramaActif; canvasPano.hidden = !panoramaActif; }
    if (panoramaActif) dessinerPanorama(base, echelle, hauteurSoleil);

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
  const curseurHeure = $("curseur-heure");
  let glisseHeure = false; // vrai tant que l'utilisateur manipule le curseur

  function heureSimulee() { return new Date(Date.now() + decalageMs); }

  function majHorloge() {
    const d = heureSimulee();
    const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    $("ciel-heure").textContent = heure;
    $("ciel-date").textContent = date;
    $("reg-heure").textContent = heure;
    $("reg-date").textContent = date;
    if (!glisseHeure) {
      curseurHeure.value = String(d.getHours() * 60 + d.getMinutes());
      curseurHeure.setAttribute("aria-valuetext", heure);
    }
    aRedessiner = true; // le ciel tourne : on rafraîchit chaque seconde
    rafraichirFiche();
  }

  function decalerMinutes(minutes) { decalageMs += minutes * 60000; majHorloge(); }

  function decalerJours(jours) {
    const d = heureSimulee();
    d.setDate(d.getDate() + jours); // garde la même heure locale, même au changement d'heure
    decalageMs = d.getTime() - Date.now();
    majHorloge();
  }

  function revenirAMaintenant() { decalageMs = 0; majHorloge(); }

  /* Curseur : règle l'heure de la journée affichée (de 0 h 00 à 23 h 59), la date ne change pas. */
  function fixerMinutesDuJour(minutes) {
    const d = heureSimulee();
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    decalageMs = d.getTime() - Date.now();
    majHorloge();
  }

  curseurHeure.addEventListener("pointerdown", () => { glisseHeure = true; });
  curseurHeure.addEventListener("input", () => {
    glisseHeure = true;
    fixerMinutesDuJour(Number(curseurHeure.value));
  });
  ["pointerup", "pointercancel", "change", "blur"].forEach((t) => {
    curseurHeure.addEventListener(t, () => { glisseHeure = false; majHorloge(); });
  });

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
    animation = null;
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
      if (!panneau.hidden) {
        fermerPanneau();
      } else {
        const objet = trouverObjet(e.clientX, e.clientY);
        if (objet) ouvrirFiche(objet);
        else fermerFiche();
      }
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
    fermerFiche();
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
    $("profond-actif").checked = reglages.profond;
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
  $("profond-actif").addEventListener("change", (e) => {
    reglages.profond = e.target.checked;
    sauverReglages();
    appliquerReglages();
  });
  $("mag-limite").addEventListener("input", (e) => {
    reglages.magLimite = borner(parseFloat(e.target.value), 3, 6.5);
    sauverReglages();
    appliquerReglages();
  });

  /* ---------- Fiche d'information : toucher un astre pour en savoir plus ---------- */
  const GREC = {
    Alp: "α", Bet: "β", Gam: "γ", Del: "δ", Eps: "ε", Zet: "ζ", Eta: "η", The: "θ", Iot: "ι", Kap: "κ", Lam: "λ", Mu: "μ",
    Nu: "ν", Xi: "ξ", Omi: "ο", Pi: "π", Rho: "ρ", Sig: "σ", Tau: "τ", Ups: "υ", Phi: "φ", Chi: "χ", Psi: "ψ", Ome: "ω",
  };
  const CONSTELLATIONS_FR = {
    And: "Andromède", Ant: "Machine pneumatique", Aps: "Oiseau de paradis", Aqr: "Verseau", Aql: "Aigle", Ara: "Autel",
    Ari: "Bélier", Aur: "Cocher", Boo: "Bouvier", Cae: "Burin", Cam: "Girafe", Cnc: "Cancer", CVn: "Chiens de chasse",
    CMa: "Grand Chien", CMi: "Petit Chien", Cap: "Capricorne", Car: "Carène", Cas: "Cassiopée", Cen: "Centaure",
    Cep: "Céphée", Cet: "Baleine", Cha: "Caméléon", Cir: "Compas", Col: "Colombe", Com: "Chevelure de Bérénice",
    CrA: "Couronne australe", CrB: "Couronne boréale", Crv: "Corbeau", Crt: "Coupe", Cru: "Croix du Sud", Cyg: "Cygne",
    Del: "Dauphin", Dor: "Dorade", Dra: "Dragon", Equ: "Petit Cheval", Eri: "Éridan", For: "Fourneau", Gem: "Gémeaux",
    Gru: "Grue", Her: "Hercule", Hor: "Horloge", Hya: "Hydre", Hyi: "Hydre mâle", Ind: "Indien", Lac: "Lézard",
    Leo: "Lion", LMi: "Petit Lion", Lep: "Lièvre", Lib: "Balance", Lup: "Loup", Lyn: "Lynx", Lyr: "Lyre", Men: "Table",
    Mic: "Microscope", Mon: "Licorne", Mus: "Mouche", Nor: "Règle", Oct: "Octant", Oph: "Ophiuchus", Ori: "Orion",
    Pav: "Paon", Peg: "Pégase", Per: "Persée", Phe: "Phénix", Pic: "Peintre", Psc: "Poissons", PsA: "Poisson austral",
    Pup: "Poupe", Pyx: "Boussole", Ret: "Réticule", Sge: "Flèche", Sgr: "Sagittaire", Sco: "Scorpion", Scl: "Sculpteur",
    Sct: "Écu de Sobieski", Ser: "Serpent", Sex: "Sextant", Tau: "Taureau", Tel: "Télescope", Tri: "Triangle",
    TrA: "Triangle austral", Tuc: "Toucan", UMa: "Grande Ourse", UMi: "Petite Ourse", Vel: "Voiles", Vir: "Vierge",
    Vol: "Poisson volant", Vul: "Petit Renard",
  };
  const FAMILLES_FR = { G: "Galaxie", OC: "Amas ouvert", GC: "Amas globulaire", PN: "Nébuleuse planétaire", N: "Nébuleuse", SNR: "Rémanent de supernova" };
  const TYPES_PLANETES = {
    Mercury: "Planète tellurique", Venus: "Planète tellurique", Mars: "Planète tellurique", Jupiter: "Planète géante gazeuse",
    Saturn: "Planète géante gazeuse, avec anneaux", Uranus: "Planète géante de glaces", Neptune: "Planète géante de glaces",
  };
  const CLASSES_SPECTRALES = { O: "bleue, très chaude", B: "bleu-blanc", A: "blanche", F: "blanc-jaune", G: "jaune", K: "orange", M: "rouge" };
  const POINTS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const UA_EN_KM = 149597870.7;

  let derniereVue = null;      // paramètres de la dernière image dessinée, pour retrouver ce que le doigt touche
  let selection = null;        // astre sélectionné : { genre, ... }
  let ficheCourante = null;
  let animation = null;        // déplacement fluide de la vue ("Centrer")

  const nf = (v, d) => v.toFixed(d === undefined ? 1 : d).replace(".", ",").replace("-", "−");
  const fmtHeure = (d) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const fmtJour = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  function fmtAD(raDeg) {
    const total = Math.round((((raDeg % 360) + 360) % 360) / 15 * 60) % 1440;
    return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
  }

  function fmtDec(decDeg) {
    const total = Math.round(Math.abs(decDeg) * 60);
    return `${decDeg < 0 ? "−" : "+"}${Math.floor(total / 60)}° ${String(total % 60).padStart(2, "0")}′`;
  }

  function hauteurAzimut(raDeg, decDeg, date) {
    const lst = Astro.tempsSideralLocal(date, position.lon);
    return Astro.azimutHauteur(Astro.versHorizon(raDeg, decDeg, position.lat, lst));
  }

  /* Lever, culmination et coucher sur la journée affichée, par échantillonnage toutes les 10 minutes. */
  function evenementsJour(positionAt, seuil) {
    const debut = heureSimulee();
    debut.setHours(0, 0, 0, 0);
    const pas = 10 * 60000;
    const alts = [];
    let lever = null;
    let coucher = null;
    for (let i = 0; i <= 144; i++) {
      const t = new Date(debut.getTime() + i * pas);
      const p = positionAt(t);
      alts.push(hauteurAzimut(p.ra, p.dec, t).alt);
      if (i > 0) {
        const a0 = alts[i - 1];
        const a1 = alts[i];
        const f = (seuil - a0) / (a1 - a0);
        if (a0 < seuil && a1 >= seuil && !lever) lever = new Date(debut.getTime() + (i - 1 + f) * pas);
        if (a0 >= seuil && a1 < seuil && !coucher) coucher = new Date(debut.getTime() + (i - 1 + f) * pas);
      }
    }
    let imax = 0;
    alts.forEach((a, i) => { if (a > alts[imax]) imax = i; });
    let culmination = null;
    if (imax > 0 && imax < 144) {
      const [a, b, c] = [alts[imax - 1], alts[imax], alts[imax + 1]];
      const denom = a - 2 * b + c;
      const decalage = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      culmination = { t: new Date(debut.getTime() + (imax + decalage) * pas), alt: b - 0.25 * (a - c) * decalage };
    }
    return { lever, coucher, culmination, toujoursAuDessus: alts.every((a) => a >= seuil), toujoursEnDessous: alts.every((a) => a < seuil) };
  }

  function lignesHoraires(ev) {
    if (ev.toujoursAuDessus) return [["Aujourd'hui", "toujours au-dessus de l'horizon"]];
    if (ev.toujoursEnDessous) return [["Aujourd'hui", "reste sous l'horizon"]];
    return [
      ["Lever", ev.lever ? fmtHeure(ev.lever) : "pas aujourd'hui"],
      ["Culmination", ev.culmination ? `${fmtHeure(ev.culmination.t)}, à ${nf(ev.culmination.alt, 0)}°` : "pas aujourd'hui"],
      ["Coucher", ev.coucher ? fmtHeure(ev.coucher) : "pas aujourd'hui"],
    ];
  }

  function vecteurHorizonJ2000(x, y, z, date) {
    const lst = Astro.tempsSideralLocal(date, position.lon);
    const M = Astro.mulMat(Astro.matriceHorizon(position.lat, lst), Astro.matricePrecession(date));
    return [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
  }

  /* Coordonnées de la date d'un point fixe défini en J2000 (pour calculer son lever et son coucher). */
  function equatorialDeLaDate(x, y, z, date) {
    const P = Astro.matricePrecession(date);
    const v = [P[0] * x + P[1] * y + P[2] * z, P[3] * x + P[4] * y + P[5] * z, P[6] * x + P[7] * y + P[8] * z];
    return { ra: ((Math.atan2(v[1], v[0]) / RAD) + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD };
  }

  function classeCouleur(ci) {
    if (ci < 0) return "bleue";
    if (ci < 0.3) return "blanche";
    if (ci < 0.6) return "blanc-jaune";
    if (ci < 0.8) return "jaune";
    if (ci < 1.4) return "orange";
    return "rouge";
  }

  /* "9Alp CMa" -> "α CMa" : la lettre grecque suffit, le numéro de Flamsteed n'apporte rien au lecteur. */
  function nomBayer(bf) {
    return bf.trim().split(/\s+/).map((mot) => {
      const m = /^(\d*)([A-Z][a-z]{2})(\d*)$/.exec(mot);
      return m && GREC[m[2]] ? `${GREC[m[2]]}${m[3]}` : mot;
    }).join(" ");
  }

  function jourCle() { return heureSimulee().toDateString(); }

  function decrireEtoile(i) {
    const cle = etoiles.raDeg[i] + "_" + etoiles.decDeg[i];
    const proprio = nomsParCle.get(cle);
    const det = detailsEtoiles.get(cle); // [ra, dec, désignation, constellation, type spectral, distance en a.l., hip]
    const bayer = det && det[2] ? nomBayer(det[2]) : "";
    const lignes = [["Magnitude", nf(etoiles.mag[i], 2)]];
    if (bayer && proprio) lignes.push(["Désignation", bayer]);
    if (det && det[3]) lignes.push(["Constellation", CONSTELLATIONS_FR[det[3]] || det[3]]);
    const classe = det && det[4] ? CLASSES_SPECTRALES[det[4].trim().charAt(0).toUpperCase()] : null;
    lignes.push(["Type", det && det[4] ? `${det[4].replace(/\.+/g, "")}${classe ? ` (étoile ${classe})` : ""}` : `étoile ${classeCouleur(etoiles.ci[i])}`]);
    if (det && det[5]) lignes.push(["Distance", `${det[5] < 100 ? nf(det[5], 1) : Math.round(det[5]).toLocaleString("fr-FR")} années-lumière`]);
    if (det && det[6]) lignes.push(["Catalogue Hipparcos", "HIP " + det[6]]);
    lignes.push(["Coordonnées (J2000)", `${fmtAD(etoiles.raDeg[i])}, ${fmtDec(etoiles.decDeg[i])}`]);
    const [x, y, z] = [etoiles.x[i], etoiles.y[i], etoiles.z[i]];
    return {
      titre: proprio || bayer || "Étoile sans nom",
      sous: "Étoile",
      statique: lignes,
      position: (date) => vecteurHorizonJ2000(x, y, z, date),
      ephem: { positionAt: () => equatorialDeLaDate(x, y, z, heureSimulee()), seuil: -0.57 },
      extra: [],
    };
  }

  function decrireProfond(i) {
    const [x, y, z] = [profond.x[i], profond.y[i], profond.z[i]];
    const maj = profond.maj[i];
    const min = profond.min[i];
    const taille = maj >= 60 ? `${nf(maj / 60)}° × ${nf(min / 60)}°` : `${nf(maj)}′ × ${nf(min)}′`;
    const lignes = [["Magnitude", profond.magConnue[i] ? nf(profond.mag[i], 1) : "non mesurée"], ["Taille apparente", taille]];
    if (profond.commun[i]) lignes.push(["Nom courant", profond.commun[i]]);
    lignes.push(["Coordonnées (J2000)", `${fmtAD(profond.raDeg[i])}, ${fmtDec(profond.decDeg[i])}`]);
    return {
      titre: profond.nom[i],
      sous: FAMILLES_FR[profond.famille[i]] || "Objet du ciel profond",
      statique: lignes,
      position: (date) => vecteurHorizonJ2000(x, y, z, date),
      ephem: { positionAt: () => equatorialDeLaDate(x, y, z, heureSimulee()), seuil: -0.57 },
      extra: [],
    };
  }

  function decrirePlanete(id) {
    const corps = calculerCorps(heureSimulee());
    const p = corps.planetes.find((c) => c.id === id);
    const observateur = new Astronomy.Observer(position.lat, position.lon, 0);
    const minutesLumiere = p.dist * 8.3167;
    const lignes = [["Magnitude", nf(p.mag, 1)]];
    lignes.push(["Distance à la Terre", `${nf(p.dist, 2)} UA (lumière en ${nf(minutesLumiere, minutesLumiere < 60 ? 1 : 0)} min)`]);
    lignes.push(["Distance au Soleil", `${nf(p.helio, 2)} UA`]);
    if (Number.isFinite(p.fraction)) lignes.push(["Partie éclairée", `${Math.round(p.fraction * 100)} %`]);
    return {
      titre: p.nom,
      sous: TYPES_PLANETES[id] || "Planète",
      statique: lignes,
      position: (date) => {
        const eq = Astronomy.Equator(Astronomy.Body[id], date, observateur, true, true);
        return Astro.versHorizon(eq.ra * 15, eq.dec, position.lat, Astro.tempsSideralLocal(date, position.lon));
      },
      ephem: {
        positionAt: (t) => { const eq = Astronomy.Equator(Astronomy.Body[id], t, observateur, true, true); return { ra: eq.ra * 15, dec: eq.dec }; },
        seuil: -0.57,
      },
      extra: [],
    };
  }

  function nomPhaseLune(angle) {
    const a = ((angle % 360) + 360) % 360;
    if (a < 6.5 || a >= 353.5) return "Nouvelle Lune";
    if (a < 83.5) return "Premier croissant";
    if (a < 96.5) return "Premier quartier";
    if (a < 173.5) return "Gibbeuse croissante";
    if (a < 186.5) return "Pleine Lune";
    if (a < 263.5) return "Gibbeuse décroissante";
    if (a < 276.5) return "Dernier quartier";
    return "Dernier croissant";
  }

  function decrireLune() {
    const date = heureSimulee();
    const corps = calculerCorps(date);
    const l = corps.lune;
    const observateur = new Astronomy.Observer(position.lat, position.lon, 0);
    const lignes = [["Partie éclairée", `${Math.round(((1 + Math.cos(l.phase * RAD)) / 2) * 100)} %`]];
    lignes.push(["Distance à la Terre", `${Math.round(l.dist * UA_EN_KM).toLocaleString("fr-FR")} km`]);
    let sous = "Satellite naturel de la Terre";
    try {
      sous = nomPhaseLune(Astronomy.MoonPhase(date));
      const pleine = Astronomy.SearchMoonPhase(180, date, 40);
      const nouvelle = Astronomy.SearchMoonPhase(0, date, 40);
      if (pleine) lignes.push(["Prochaine pleine Lune", fmtJour(pleine.date)]);
      if (nouvelle) lignes.push(["Prochaine nouvelle Lune", fmtJour(nouvelle.date)]);
    } catch { /* la phase détaillée reste facultative */ }
    return {
      titre: "Lune",
      sous,
      statique: lignes,
      position: (d) => {
        const eq = Astronomy.Equator(Astronomy.Body.Moon, d, observateur, true, true);
        return Astro.versHorizon(eq.ra * 15, eq.dec, position.lat, Astro.tempsSideralLocal(d, position.lon));
      },
      ephem: {
        positionAt: (t) => { const eq = Astronomy.Equator(Astronomy.Body.Moon, t, observateur, true, true); return { ra: eq.ra * 15, dec: eq.dec }; },
        seuil: -0.3,
      },
      extra: [],
    };
  }

  function decrireSoleil() {
    const d = heureSimulee();
    const n = Astro.jourJulien(d) - 2451545.0;
    const g = (357.528 + 0.9856003 * n) * RAD;
    const distance = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g); // en UA
    return {
      titre: "Soleil",
      sous: "Notre étoile",
      statique: [
        ["Magnitude", "−26,7"],
        ["Distance à la Terre", `${nf(distance, 3)} UA (lumière en ${Math.floor(distance * 8.3167)} min ${Math.round(((distance * 8.3167) % 1) * 60)} s)`],
        ["Type", "naine jaune (type G2)"],
      ],
      position: (date) => {
        const s = Astro.positionSoleil(date);
        return Astro.versHorizon(s.ra, s.dec, position.lat, Astro.tempsSideralLocal(date, position.lon));
      },
      ephem: { positionAt: (t) => Astro.positionSoleil(t), seuil: -0.83 },
      extra: [],
      note: "Ne regarde jamais le Soleil sans filtre solaire certifié.",
    };
  }

  function decrire(obj) {
    if (obj.genre === "etoile") return decrireEtoile(obj.i);
    if (obj.genre === "profond") return decrireProfond(obj.i);
    if (obj.genre === "planete") return decrirePlanete(obj.id);
    if (obj.genre === "lune") return decrireLune();
    return decrireSoleil();
  }

  function calculerHoraires(fiche) {
    if (!fiche.ephem) return [];
    try {
      const ev = evenementsJour(fiche.ephem.positionAt, fiche.ephem.seuil);
      const lignes = lignesHoraires(ev);
      if (fiche.titre === "Soleil" && ev.lever && ev.coucher) {
        const minutes = Math.round((ev.coucher - ev.lever) / 60000);
        lignes.push(["Durée du jour", `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`]);
      }
      return lignes;
    } catch {
      return [];
    }
  }

  function rendreFiche() {
    const f = ficheCourante;
    if (!f) return;
    const ah = Astro.azimutHauteur(f.position(heureSimulee()));
    const alt = `${ah.alt < 0 ? "−" : "+"}${nf(Math.abs(ah.alt), 1)}°`;
    const lignes = [
      ["Hauteur", ah.alt < 0 ? `${alt} (sous l'horizon)` : alt],
      ["Azimut", `${Math.round(ah.az) % 360}° (${POINTS_16[Math.round(ah.az / 22.5) % 16]})`],
      ...f.statique,
      ...f.horaires,
      ...f.extra,
    ];
    $("fiche-lignes").replaceChildren(...lignes.flatMap(([libelle, valeur]) => {
      const dt = document.createElement("dt");
      dt.textContent = libelle;
      const dd = document.createElement("dd");
      dd.textContent = valeur;
      return [dt, dd];
    }));
    $("fiche-note").textContent = f.note || "";
    $("fiche-note").hidden = !f.note;
  }

  function ouvrirFiche(obj) {
    let fiche;
    try {
      fiche = decrire(obj);
      fiche.jourCle = jourCle();
      fiche.horaires = calculerHoraires(fiche);
    } catch {
      return; // un échec de calcul ne doit jamais bloquer la carte
    }
    ficheCourante = fiche;
    selection = obj;
    $("fiche-titre").textContent = fiche.titre;
    $("fiche-sous").textContent = fiche.sous;
    rendreFiche();
    $("fiche").hidden = false;
    $("horloge").hidden = true; // l'heure serait cachée sous la fiche
    aRedessiner = true;
    // Si l'astre se trouve sous la fiche, on fait glisser la vue pour qu'il reste visible.
    const p = derniereVue && positionSelection(derniereVue);
    if (p && p[1] > $("fiche").getBoundingClientRect().top - 24) centrerSurSelection();
  }

  function fermerFiche() {
    if (!ficheCourante && !selection) return;
    ficheCourante = null;
    selection = null;
    $("fiche").hidden = true;
    $("horloge").hidden = !$("panneau").hidden; // l'heure revient, sauf si le panneau est ouvert
    aRedessiner = true;
  }

  function rafraichirFiche() {
    if (!ficheCourante) return;
    try {
      const cle = jourCle();
      if (cle !== ficheCourante.jourCle) {
        ficheCourante.jourCle = cle;
        ficheCourante.horaires = calculerHoraires(ficheCourante);
      }
      rendreFiche();
    } catch { /* on garde l'affichage précédent */ }
  }

  /* Retrouve l'astre touché : le plus proche du doigt, avec une préférence pour les plus brillants. */
  function trouverObjet(px, py) {
    const v = derniereVue;
    if (!v) return null;
    const { MJ, MH, echelle, cx, cy, base, lstDeg, limite } = v;
    const cacheParSol = reglages.paysage; // sous l'horizon, le paysage cache l'astre
    let meilleur = null;
    let score = Infinity;
    const essayer = (sx, sy, mag, rayonMax, objet) => {
      const d = Math.hypot(sx - px, sy - py);
      if (d > rayonMax) return;
      const s = d + 2 * Math.max(0, mag + 2);
      if (s < score) { score = s; meilleur = objet; }
    };

    const pSoleil = versEcran(v.vSoleil, base, echelle, cx, cy);
    if (pSoleil && !(cacheParSol && v.vSoleil[2] < -0.01)) essayer(pSoleil[0], pSoleil[1], -26, 30, { genre: "soleil" });

    if (v.corps) {
      const vl = Astro.versHorizon(v.corps.lune.ra, v.corps.lune.dec, position.lat, lstDeg);
      const pl = versEcran(vl, base, echelle, cx, cy);
      if (pl && !(cacheParSol && vl[2] < -0.01)) essayer(pl[0], pl[1], -12, 30, { genre: "lune" });
      for (const pt of v.corps.planetes) {
        if (pt.mag > limite) continue;
        const vp = Astro.versHorizon(pt.ra, pt.dec, position.lat, lstDeg);
        const pp = versEcran(vp, base, echelle, cx, cy);
        if (pp && !(cacheParSol && vp[2] < -0.01)) essayer(pp[0], pp[1], pt.mag, 26, { genre: "planete", id: pt.id });
      }
    }

    const magMax = Math.min(12, limite + 4.5);
    if (reglages.profond && profond.n > 0 && magMax >= 4) {
      for (let i = 0; i < profond.n; i++) {
        if (profond.mag[i] > magMax) continue;
        const [x, y, z] = [profond.x[i], profond.y[i], profond.z[i]];
        const zc = MJ[6] * x + MJ[7] * y + MJ[8] * z;
        if (zc < -0.9 || (cacheParSol && MH[6] * x + MH[7] * y + MH[8] * z < -0.01)) continue;
        const k = (2 / (1 + zc)) * echelle;
        const sx = cx + (MJ[0] * x + MJ[1] * y + MJ[2] * z) * k;
        const sy = cy - (MJ[3] * x + MJ[4] * y + MJ[5] * z) * k;
        const a = Math.min(1500, Math.max(5, ((profond.maj[i] / 120) * RAD) * k));
        essayer(sx, sy, profond.mag[i], Math.max(22, a), { genre: "profond", i });
      }
    }

    for (let i = 0; i < etoiles.n; i++) {
      const mag = etoiles.mag[i];
      if (mag > limite) continue;
      const [x, y, z] = [etoiles.x[i], etoiles.y[i], etoiles.z[i]];
      const zc = MJ[6] * x + MJ[7] * y + MJ[8] * z;
      if (zc < -0.9 || (cacheParSol && MH[6] * x + MH[7] * y + MH[8] * z < -0.01)) continue;
      const k = (2 / (1 + zc)) * echelle;
      essayer(cx + (MJ[0] * x + MJ[1] * y + MJ[2] * z) * k, cy - (MJ[3] * x + MJ[4] * y + MJ[5] * z) * k, mag, 22, { genre: "etoile", i });
    }
    return meilleur;
  }

  /* Position à l'écran de l'astre sélectionné (et rayon de l'anneau de repérage), ou null s'il n'est pas visible. */
  function positionSelection(v) {
    const s = selection;
    if (!s) return null;
    const { MJ, echelle, cx, cy, base, lstDeg } = v;
    if (s.genre === "etoile") {
      const p = projeterJ2000(MJ, etoiles.x[s.i], etoiles.y[s.i], etoiles.z[s.i], echelle, cx, cy);
      return p && [p[0], p[1], 13];
    }
    if (s.genre === "profond") {
      const p = projeterJ2000(MJ, profond.x[s.i], profond.y[s.i], profond.z[s.i], echelle, cx, cy);
      return p && [p[0], p[1], Math.max(14, Math.min(300, ((profond.maj[s.i] / 120) * RAD) * echelle) + 6)];
    }
    if (s.genre === "soleil") {
      const p = versEcran(v.vSoleil, base, echelle, cx, cy);
      return p && [p[0], p[1], 26];
    }
    if (!v.corps) return null;
    if (s.genre === "lune") {
      const l = v.corps.lune;
      const p = versEcran(Astro.versHorizon(l.ra, l.dec, position.lat, lstDeg), base, echelle, cx, cy);
      return p && [p[0], p[1], 22];
    }
    const pt = v.corps.planetes.find((c) => c.id === s.id);
    const p = pt && versEcran(Astro.versHorizon(pt.ra, pt.dec, position.lat, lstDeg), base, echelle, cx, cy);
    return p && [p[0], p[1], 14];
  }

  function dessinerSelection(v) {
    const p = positionSelection(v);
    if (!p) return;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let q = 0; q < 4; q++) ctx.arc(p[0], p[1], p[2], q * (Math.PI / 2) + 0.25, q * (Math.PI / 2) + Math.PI / 2 - 0.25);
    ctx.stroke();
  }

  /* "Centrer" : déplace la vue en douceur vers l'astre et resserre un peu le champ.
     La fiche couvre le bas de l'écran : l'astre est placé dans le quart supérieur, pas au milieu. */
  function centrerSurSelection() {
    if (!ficheCourante) return;
    const ah = Astro.azimutHauteur(ficheCourante.position(heureSimulee()));
    const d = ((ah.az - vue.az + 540) % 360) - 180;
    const fov1 = Math.min(vue.fov, 45);
    animation = { t0: performance.now(), duree: 500, az0: vue.az, dAz: d, alt0: vue.alt, alt1: borner(ah.alt - 0.22 * fov1, -10, 80), fov0: vue.fov, fov1 };
  }

  function avancerAnimation() {
    if (!animation) return;
    const k = Math.min(1, (performance.now() - animation.t0) / animation.duree);
    const e = 1 - Math.pow(1 - k, 3);
    vue.az = (((animation.az0 + animation.dAz * e) % 360) + 360) % 360;
    vue.alt = animation.alt0 + (animation.alt1 - animation.alt0) * e;
    vue.fov = animation.fov0 + (animation.fov1 - animation.fov0) * e;
    aRedessiner = true;
    if (k >= 1) animation = null;
  }

  $("fiche-fermer").addEventListener("click", fermerFiche);
  $("fiche-centrer").addEventListener("click", centrerSurSelection);

  /* Vue de départ facultative dans l'adresse, par exemple ciel.html?az=180&alt=30&fov=60 */
  if (typeof location !== "undefined" && typeof URLSearchParams !== "undefined") {
    const params = new URLSearchParams(location.search);
    for (const [cle, min, max] of [["az", 0, 360], ["alt", -90, 90], ["fov", FOV_MIN, FOV_MAX]]) {
      const v = parseFloat(params.get(cle));
      if (Number.isFinite(v)) vue[cle] = borner(v, min, max);
    }
  }

  /* ---------- Démarrage ---------- */
  window.addEventListener("resize", ajusterTaille);
  ajusterTaille();
  appliquerReglages();
  majHorloge();
  setInterval(majHorloge, 1000);
  if (!astronomieOk) ajouterMessage("Planètes et Lune absentes : ouvre outils/telecharger-astronomy.html pour ajouter la bibliothèque.");
  chargerEtoiles();
  chargerConstellations();
  chargerProfond();
  chargerPanorama();
  (function boucle() {
    avancerAnimation();
    if (aRedessiner) dessiner();
    requestAnimationFrame(boucle);
  })();
})();
