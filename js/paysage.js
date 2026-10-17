"use strict";
/* Paysage généré : collines lointaines et forêt, décrits par leur hauteur (en degrés) pour chaque azimut. */
(function (racine) {
  const RAD = Math.PI / 180;
  const BASE = -0.4; // les silhouettes descendent un peu sous l'horizon pour éviter tout interstice avec le sol

  /* Générateur pseudo-aléatoire à graine : le paysage est identique à chaque ouverture. */
  function graine(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function profil(hauteurs) {
    const cos = new Float32Array(hauteurs.length);
    const sin = new Float32Array(hauteurs.length);
    for (let i = 0; i < hauteurs.length; i++) {
      cos[i] = Math.cos(hauteurs[i] * RAD);
      sin[i] = Math.sin(hauteurs[i] * RAD);
    }
    return { hauteurs, cos, sin };
  }

  function construire(pas, seed) {
    pas = pas || 0.1;
    const n = Math.round(360 / pas);
    const collines = new Float32Array(n + 1);
    const arbres = new Float32Array(n + 1).fill(BASE);

    // Collines : somme de sinusoïdes entières, donc continues au passage de 360° à 0°.
    for (let i = 0; i <= n; i++) {
      const a = i * pas * RAD;
      collines[i] = Math.max(0.3, 1.6 + 0.9 * Math.sin(3 * a + 1) + 0.6 * Math.sin(7 * a + 2) + 0.35 * Math.sin(13 * a));
    }

    // Arbres : feuillus arrondis et sapins pointus, en bosquets séparés par des clairières.
    const alea = graine(seed === undefined ? 7 : seed);
    const bosquets = [];
    for (let g = 0; g < 14; g++) bosquets.push(alea() * 360);
    for (let t = 0; t < 150; t++) {
      // Les arbres se regroupent en bosquets, avec quelques arbres isolés entre deux.
      const centre = alea() < 0.85
        ? (bosquets[Math.floor(alea() * bosquets.length)] + (alea() + alea() + alea() - 1.5) * 12 + 360) % 360
        : alea() * 360;
      const demi = 0.7 + alea() * 1.6;           // demi-largeur en degrés
      const haut = 1.8 + Math.pow(alea(), 1.5) * 6.5; // hauteur en degrés
      const sapin = alea() < 0.45;
      const i0 = Math.floor((centre - demi) / pas);
      const i1 = Math.ceil((centre + demi) / pas);
      for (let i = i0; i <= i1; i++) {
        const d = Math.abs(i * pas - centre) / demi;
        if (d > 1) continue;
        const h = sapin ? haut * Math.pow(1 - d, 0.9) : haut * (0.2 + 0.8 * Math.sqrt(1 - d * d));
        const idx = ((i % n) + n) % n;
        if (h > arbres[idx]) arbres[idx] = h;
      }
    }
    arbres[n] = arbres[0];

    const sinAz = new Float32Array(n + 1);
    const cosAz = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      sinAz[i] = Math.sin(i * pas * RAD);
      cosAz[i] = Math.cos(i * pas * RAD);
    }
    return { pas, n, base: BASE, sinAz, cosAz, collines: profil(collines), arbres: profil(arbres) };
  }

  racine.Paysage = { construire };
  if (typeof module !== "undefined") module.exports = { construire };
})(typeof window !== "undefined" ? window : globalThis);
