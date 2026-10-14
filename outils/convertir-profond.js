"use strict";
/* Transforme le catalogue OpenNGC (NGC.csv + addendum.csv) en data/ciel-profond.json, léger et prêt pour la carte. */
(function (racine) {
  // Types conservés -> famille dessinée sur la carte
  const FAMILLES = {
    G: "G", OCl: "OC", GCl: "GC", PN: "PN", "Cl+N": "N", HII: "N", EmN: "N", RfN: "N", Neb: "N", SNR: "SNR",
  };
  const MAG_MAX = 11;      // magnitude limite des objets conservés
  const TAILLE_SANS_MAG = 15; // arcmin : objets sans magnitude mais grands

  function decouper(ligne, sep) {
    if (ligne.indexOf('"') === -1) return ligne.split(sep);
    const champs = [];
    let courant = "";
    let guillemets = false;
    for (let i = 0; i < ligne.length; i++) {
      const c = ligne[i];
      if (c === '"') {
        if (guillemets && ligne[i + 1] === '"') { courant += '"'; i++; } else guillemets = !guillemets;
      } else if (c === sep && !guillemets) {
        champs.push(courant);
        courant = "";
      } else {
        courant += c;
      }
    }
    champs.push(courant);
    return champs;
  }

  function degres(texte, estRA) {
    const m = /^\s*([+-])?(\d+):(\d+):([\d.]+)\s*$/.exec(texte || "");
    if (!m) return NaN;
    const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
    const signe = m[1] === "-" ? -1 : 1;
    return estRA ? v * 15 : signe * v;
  }

  function designation(nom, messier) {
    // La colonne M contient le numéro seul (« 031 ») ; dans l'addendum le nom peut être « M045 ».
    const m = /^M?0*(\d+)$/.exec(messier || "") || /^M0*(\d+)$/.exec(nom);
    if (m) return "M" + m[1];
    const d = /^([A-Za-z]+)0*(\d+)(.*)$/.exec(nom);
    return d ? `${d[1]} ${d[2]}${d[3]}` : nom;
  }

  function analyser(texte) {
    const lignes = texte.split(/\r?\n/);
    const sep = (lignes[0].match(/;/g) || []).length >= (lignes[0].match(/,/g) || []).length ? ";" : ",";
    const entete = decouper(lignes[0], sep).map((s) => s.trim().toLowerCase());
    const col = (nom) => entete.indexOf(nom);
    const idx = {
      nom: col("name"), type: col("type"), ra: col("ra"), dec: col("dec"), maj: col("majax"), min: col("minax"),
      pa: col("posang"), b: col("b-mag"), v: col("v-mag"), m: col("m"), commun: col("common names"),
    };
    if (idx.nom < 0 || idx.type < 0 || idx.ra < 0 || idx.dec < 0) {
      throw new Error("Ce fichier n'est pas un catalogue OpenNGC (colonnes Name, Type, RA, Dec attendues).");
    }
    const lignesDonnees = [];
    for (let i = 1; i < lignes.length; i++) if (lignes[i]) lignesDonnees.push(decouper(lignes[i], sep));
    return { idx, lignesDonnees };
  }

  function convertir(textes) {
    const liste = Array.isArray(textes) ? textes : [textes];
    const arrondi = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
    const objets = [];
    const vus = new Set();
    const nomsCommuns = new Set();
    for (const texte of liste) {
      const { idx, lignesDonnees } = analyser(texte);
      const lire = (c, i) => (i >= 0 && c[i] !== undefined ? c[i].trim() : "");
      for (const c of lignesDonnees) {
        const famille = FAMILLES[lire(c, idx.type)];
        if (!famille) continue;
        const ra = degres(lire(c, idx.ra), true);
        const dec = degres(lire(c, idx.dec), false);
        if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
        const mV = parseFloat(lire(c, idx.v));
        const mB = parseFloat(lire(c, idx.b));
        const mag = Number.isFinite(mV) ? mV : Number.isFinite(mB) ? mB : null;
        const maj = parseFloat(lire(c, idx.maj));
        const mess = lire(c, idx.m);
        const commun = lire(c, idx.commun).split(",")[0].trim();
        const garde = mess !== "" || (mag !== null && mag <= MAG_MAX) || (mag === null && Number.isFinite(maj) && maj >= TAILLE_SANS_MAG);
        if (!garde) continue;
        const nom = designation(lire(c, idx.nom), mess);
        if (vus.has(nom)) continue;
        // Doublons : même nom commun (ex. M45 et Mel 22 pour les Pléiades) ou même position et même famille.
        if (commun && nomsCommuns.has(commun.toLowerCase())) continue;
        if (objets.some((o) => o[3] === famille && Math.abs(o[1] - dec) < 0.02 && Math.abs(o[0] - ra) < 0.02 / Math.max(0.1, Math.cos(dec * Math.PI / 180)))) continue;
        vus.add(nom);
        if (commun) nomsCommuns.add(commun.toLowerCase());
        const min = parseFloat(lire(c, idx.min));
        const pa = parseFloat(lire(c, idx.pa));
        objets.push([
          arrondi(ra, 3), arrondi(dec, 3), mag === null ? null : arrondi(mag, 1), famille,
          Number.isFinite(maj) ? arrondi(maj, 1) : 1, Number.isFinite(min) ? arrondi(min, 1) : (Number.isFinite(maj) ? arrondi(maj, 1) : 1),
          Number.isFinite(pa) ? Math.round(pa) : 0, nom, commun,
        ]);
      }
    }
    if (!objets.length) throw new Error("Aucun objet retenu : vérifie que le fichier est bien NGC.csv d'OpenNGC.");
    const json = JSON.stringify({
      source: "OpenNGC (Mattia Verga), licence CC BY-SA 4.0, github.com/mattiaverga/OpenNGC",
      objets,
    });
    return { json, nb: objets.length, taille: json.length };
  }

  racine.ConvertirProfond = { convertir };
  if (typeof module !== "undefined") module.exports = { convertir };
})(typeof window !== "undefined" ? window : globalThis);
