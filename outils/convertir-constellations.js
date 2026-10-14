"use strict";
/* Transforme les tracés de constellations de d3-celestial (GeoJSON) en data/constellations.json. */
(function (racine) {
  const NOMS = {
    And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aqr: "Aquarius", Aql: "Aquila", Ara: "Ara", Ari: "Aries",
    Aur: "Auriga", Boo: "Boötes", Cae: "Caelum", Cam: "Camelopardalis", Cnc: "Cancer", CVn: "Canes Venatici",
    CMa: "Canis Major", CMi: "Canis Minor", Cap: "Capricornus", Car: "Carina", Cas: "Cassiopeia", Cen: "Centaurus",
    Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon", Cir: "Circinus", Col: "Columba", Com: "Coma Berenices",
    CrA: "Corona Australis", CrB: "Corona Borealis", Crv: "Corvus", Crt: "Crater", Cru: "Crux", Cyg: "Cygnus",
    Del: "Delphinus", Dor: "Dorado", Dra: "Draco", Equ: "Equuleus", Eri: "Eridanus", For: "Fornax", Gem: "Gemini",
    Gru: "Grus", Her: "Hercules", Hor: "Horologium", Hya: "Hydra", Hyi: "Hydrus", Ind: "Indus", Lac: "Lacerta",
    Leo: "Leo", LMi: "Leo Minor", Lep: "Lepus", Lib: "Libra", Lup: "Lupus", Lyn: "Lynx", Lyr: "Lyra", Men: "Mensa",
    Mic: "Microscopium", Mon: "Monoceros", Mus: "Musca", Nor: "Norma", Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion",
    Pav: "Pavo", Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", Pic: "Pictor", Psc: "Pisces", PsA: "Piscis Austrinus",
    Pup: "Puppis", Pyx: "Pyxis", Ret: "Reticulum", Sge: "Sagitta", Sgr: "Sagittarius", Sco: "Scorpius",
    Scl: "Sculptor", Sct: "Scutum", Ser: "Serpens", Sex: "Sextans", Tau: "Taurus", Tel: "Telescopium",
    Tri: "Triangulum", TrA: "Triangulum Australe", Tuc: "Tucana", UMa: "Ursa Major", UMi: "Ursa Minor",
    Vel: "Vela", Vir: "Virgo", Vol: "Volans", Vul: "Vulpecula",
  };

  function convertir(texte) {
    const geo = typeof texte === "string" ? JSON.parse(texte) : texte;
    if (!geo || !Array.isArray(geo.features)) throw new Error("Ce fichier n'est pas un tracé de constellations (GeoJSON attendu).");
    const arrondi = (v) => Math.round(v * 1000) / 1000;
    const parId = new Map();
    for (const f of geo.features) {
      if (!f.geometry || f.geometry.type !== "MultiLineString") continue;
      if (!parId.has(f.id)) parId.set(f.id, { id: f.id, nom: NOMS[f.id] || String(f.id), lignes: [] });
      for (const ligne of f.geometry.coordinates) {
        // Longitude de -180 à 180 -> ascension droite de 0 à 360 degrés.
        parId.get(f.id).lignes.push(ligne.map(([lon, lat]) => [arrondi((lon + 360) % 360), arrondi(lat)]));
      }
    }
    const constellations = [...parId.values()];
    if (!constellations.length) throw new Error("Aucune constellation trouvée dans ce fichier.");
    const json = JSON.stringify({
      source: "Tracés de d3-celestial (Olaf Frohn), licence BSD 3-Clause, github.com/ofrohn/d3-celestial",
      constellations,
    });
    return { json, nb: constellations.length, taille: json.length };
  }

  racine.ConvertirConstellations = { convertir };
  if (typeof module !== "undefined") module.exports = { convertir };
})(typeof window !== "undefined" ? window : globalThis);
