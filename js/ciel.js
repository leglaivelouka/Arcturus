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

  const etoiles = { n: 0, x: null, y: null, z: null, mag: null, couleur: [] };
  let noms = []; // { vx, vy, vz, nom, mag }
  const profond = { n: 0, x: null, y: null, z: null, mag: null, maj: null, min: null, pa: null, famille: [], nom: [], commun: [] };
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
    etoiles.couleur = new Array(n);
    for (let i = 0; i < n; i++) {
      const [ra, dec, mag, ci] = liste[i];
      const v = vecteurEquatorial(ra, dec);
      etoiles.x[i] = v[0];
      etoiles.y[i] = v[1];
      etoiles.z[i] = v[2];
      etoiles.mag[i] = mag;
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
      return { ...c, ra: eq.ra * 15, dec: eq.dec, mag: Astronomy.Illumination(corps, date).mag };
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
    const MJ = Astro.mulMat(Astro.mulMat(Astro.matriceCamera(base), Astro.matriceHorizon(position.lat, lstDeg)), Astro.matricePrecession(maintenant));

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
    if (astronomieOk) {
      try {
        dessinerCorps(calculerCorps(maintenant), lstDeg, vSoleil, base, echelle, cx, cy, boost, limite);
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
    if (aRedessiner) dessiner();
    requestAnimationFrame(boucle);
  })();
})();
