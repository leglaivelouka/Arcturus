"use strict";
/* Calculs astronomiques de base, sans dépendance. */
(function (racine) {
  const RAD = Math.PI / 180;

  function jourJulien(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  /* Temps sidéral local en degrés (longitude est positive). */
  function tempsSideralLocal(date, longitudeDeg) {
    const d = jourJulien(date) - 2451545.0;
    const gmst = 280.46061837 + 360.98564736629 * d;
    return (((gmst + longitudeDeg) % 360) + 360) % 360;
  }

  /* Coordonnées équatoriales -> vecteur [est, nord, haut]. */
  function versHorizon(raDeg, decDeg, latDeg, lstDeg) {
    const H = (lstDeg - raDeg) * RAD;
    const dec = decDeg * RAD;
    const lat = latDeg * RAD;
    const cd = Math.cos(dec);
    return [
      -cd * Math.sin(H),
      Math.sin(dec) * Math.cos(lat) - cd * Math.sin(lat) * Math.cos(H),
      Math.sin(dec) * Math.sin(lat) + cd * Math.cos(lat) * Math.cos(H),
    ];
  }

  /* Vecteur [est, nord, haut] -> azimut (0 = nord, 90 = est) et hauteur, en degrés. */
  function azimutHauteur(v) {
    const az = Math.atan2(v[0], v[1]) / RAD;
    return { az: (az + 360) % 360, alt: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD };
  }

  /* Repère de la caméra : avant f, droite r, haut u (dans le repère [est, nord, haut]). */
  function baseCamera(azDeg, altDeg) {
    const A = azDeg * RAD;
    const h = altDeg * RAD;
    return {
      f: [Math.cos(h) * Math.sin(A), Math.cos(h) * Math.cos(A), Math.sin(h)],
      r: [Math.cos(A), -Math.sin(A), 0],
      u: [-Math.sin(h) * Math.sin(A), -Math.sin(h) * Math.cos(A), Math.cos(h)],
    };
  }

  /* Projection stéréographique. Renvoie [X, Y] (unités de rayon 2 = 180°) ou null si derrière. */
  function projeter(v, base) {
    const x = v[0] * base.r[0] + v[1] * base.r[1] + v[2] * base.r[2];
    const y = v[0] * base.u[0] + v[1] * base.u[1] + v[2] * base.u[2];
    const z = v[0] * base.f[0] + v[1] * base.f[1] + v[2] * base.f[2];
    if (z < -0.9) return null;
    const k = 2 / (1 + z);
    return [x * k, y * k];
  }

  /* L'horizon est un cercle à l'écran. Décrit où se trouve le sol selon la hauteur du regard. */
  function cercleHorizon(altDeg) {
    const c = Math.sin(altDeg * RAD);
    const b = Math.cos(altDeg * RAD);
    if (Math.abs(c) < 0.003) return { mode: "ligne" };
    return { mode: c > 0 ? "exterieur" : "interieur", centreY: (2 * b) / c, rayon: 2 / Math.abs(c) };
  }

  /* Indice de couleur B-V -> couleur CSS (arrondi à 0,1 pour limiter les changements de style). */
  function couleurBV(ci) {
    const t = Math.max(-0.3, Math.min(1.6, Math.round((Number.isFinite(ci) ? ci : 0.6) * 10) / 10));
    const points = [
      [-0.3, [155, 176, 255]],
      [0.0, [220, 230, 255]],
      [0.6, [255, 244, 232]],
      [1.2, [255, 205, 150]],
      [1.6, [255, 165, 115]],
    ];
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i][0]) {
        const [t0, c0] = points[i - 1];
        const [t1, c1] = points[i];
        const k = (t - t0) / (t1 - t0);
        const m = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
        return `rgb(${m[0]},${m[1]},${m[2]})`;
      }
    }
    return "rgb(255,165,115)";
  }

  const Astro = { jourJulien, tempsSideralLocal, versHorizon, azimutHauteur, baseCamera, projeter, cercleHorizon, couleurBV };
  racine.Astro = Astro;
  if (typeof module !== "undefined") module.exports = Astro;
})(typeof window !== "undefined" ? window : globalThis);
