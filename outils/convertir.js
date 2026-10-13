"use strict";
/* Transforme le catalogue HYG (CSV) en data/etoiles.json, léger et prêt pour la carte. */
(function (racine) {
  function decouperLigne(ligne) {
    if (ligne.indexOf('"') === -1) return ligne.split(",");
    const champs = [];
    let courant = "";
    let guillemets = false;
    for (let i = 0; i < ligne.length; i++) {
      const c = ligne[i];
      if (c === '"') {
        if (guillemets && ligne[i + 1] === '"') { courant += '"'; i++; } else guillemets = !guillemets;
      } else if (c === "," && !guillemets) {
        champs.push(courant);
        courant = "";
      } else {
        courant += c;
      }
    }
    champs.push(courant);
    return champs;
  }

  function convertir(texte, magMax) {
    magMax = magMax === undefined ? 6.5 : magMax;
    const lignes = texte.split(/\r?\n/);
    const entete = decouperLigne(lignes[0]).map((s) => s.trim().toLowerCase());
    const iRa = entete.indexOf("ra");
    const iDec = entete.indexOf("dec");
    const iMag = entete.indexOf("mag");
    const iCi = entete.indexOf("ci");
    const iNom = entete.indexOf("proper");
    if (iRa < 0 || iDec < 0 || iMag < 0) {
      throw new Error("Colonnes ra, dec ou mag introuvables : ce fichier n'est pas un catalogue HYG.");
    }

    const gardees = [];
    let raMax = 0;
    for (let i = 1; i < lignes.length; i++) {
      if (!lignes[i]) continue;
      const c = decouperLigne(lignes[i]);
      const mag = parseFloat(c[iMag]);
      const ra = parseFloat(c[iRa]);
      const dec = parseFloat(c[iDec]);
      if (!Number.isFinite(mag) || !Number.isFinite(ra) || !Number.isFinite(dec)) continue;
      const nom = iNom >= 0 ? (c[iNom] || "").trim() : "";
      if (mag > magMax || mag < -10 || nom === "Sol") continue;
      const ci = iCi >= 0 ? parseFloat(c[iCi]) : NaN;
      if (ra > raMax) raMax = ra;
      gardees.push({ ra, dec, mag, ci: Number.isFinite(ci) ? ci : 0.6, nom });
    }

    // Dans HYG, l'ascension droite est en heures ; on la convertit en degrés.
    const facteur = raMax <= 24.001 ? 15 : 1;
    const arrondi = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
    const etoiles = gardees.map((s) => [arrondi(s.ra * facteur, 3), arrondi(s.dec, 3), arrondi(s.mag, 2), arrondi(s.ci, 2)]);
    const noms = gardees.filter((s) => s.nom).map((s) => [arrondi(s.ra * facteur, 3), arrondi(s.dec, 3), s.nom]);

    const json = JSON.stringify({
      source: "HYG Database (Hipparcos, Yale, Gliese), licence CC BY-SA 4.0, astronexus.com/hyg",
      magMax,
      etoiles,
      noms,
    });
    return { json, nbEtoiles: etoiles.length, nbNoms: noms.length, taille: json.length };
  }

  racine.ConvertirEtoiles = { convertir };
  if (typeof module !== "undefined") module.exports = { convertir };
})(typeof window !== "undefined" ? window : globalThis);
