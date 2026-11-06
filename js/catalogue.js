"use strict";
/* Liste d'une catégorie du catalogue : étoiles nommées, galaxies, planètes, nébuleuses ou amas. */

const CATEGORIES = {
  etoile: { titre: "Étoiles", source: "etoiles" },
  galaxie: { titre: "Galaxies", source: "profond", familles: ["G"] },
  planete: { titre: "Planètes", source: "planetes" },
  nebuleuse: { titre: "Nébuleuses", source: "profond", familles: ["N", "PN", "SNR"] },
  amas: { titre: "Amas", source: "profond", familles: ["OC", "GC"] },
};

const FAMILLES = {
  G: "Galaxie",
  N: "Nébuleuse",
  PN: "Nébuleuse planétaire",
  SNR: "Rémanent de supernova",
  OC: "Amas ouvert",
  GC: "Amas globulaire",
};

const CONSTELLATIONS = {
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

const PLANETES = [
  { nom: "Mercure", detail: "Planète tellurique" },
  { nom: "Vénus", detail: "Planète tellurique" },
  { nom: "Terre", detail: "Planète tellurique" },
  { nom: "Mars", detail: "Planète tellurique" },
  { nom: "Jupiter", detail: "Planète géante gazeuse" },
  { nom: "Saturne", detail: "Planète géante gazeuse, avec anneaux" },
  { nom: "Uranus", detail: "Planète géante de glaces" },
  { nom: "Neptune", detail: "Planète géante de glaces" },
];

const $ = (id) => document.getElementById(id);
const cle = (ra, dec) => ra + "_" + dec;
const triNom = (a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" });

function magnitude(m) {
  if (m === null || m === undefined || Number.isNaN(Number(m))) return "";
  return "magnitude " + Number(m).toFixed(1).replace(".", ",");
}

let pret;
window.arcturusPret = new Promise((resoudre) => { pret = resoudre; });

function afficher(items) {
  const liste = $("liste");
  const compte = $("compte");
  const q = $("filtre").value.trim().toLocaleLowerCase("fr");
  const visibles = q
    ? items.filter((item) => (item.nom + " " + item.detail).toLocaleLowerCase("fr").includes(q))
    : items;
  liste.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of visibles) {
    const li = document.createElement("li");
    const nom = document.createElement("strong");
    nom.textContent = item.nom;
    li.append(nom);
    if (item.detail) {
      const detail = document.createElement("span");
      detail.textContent = item.detail;
      li.append(detail);
    }
    fragment.append(li);
  }
  liste.append(fragment);
  const n = visibles.length;
  compte.textContent = n === 0 ? "Aucun objet" : n === 1 ? "1 objet" : n.toLocaleString("fr-FR") + " objets";
}

async function chargerEtoiles() {
  const donnees = await (await fetch("data/etoiles.json")).json();
  const magnitudes = new Map(donnees.etoiles.map((s) => [cle(s[0], s[1]), s[2]]));
  const constellations = new Map((donnees.details || []).map((d) => [cle(d[0], d[1]), CONSTELLATIONS[d[3]] || d[3]]));
  return (donnees.noms || []).map(([ra, dec, nom]) => {
    const parties = [];
    const constellation = constellations.get(cle(ra, dec));
    if (constellation) parties.push(constellation);
    const mag = magnitude(magnitudes.get(cle(ra, dec)));
    if (mag) parties.push(mag);
    return { nom, detail: parties.join(" · ") };
  }).sort(triNom);
}

async function chargerProfond(familles) {
  const donnees = await (await fetch("data/ciel-profond.json")).json();
  const voulu = new Set(familles);
  return donnees.objets.filter((o) => voulu.has(o[3])).map((o) => {
    const [,, mag, famille, , , , nom, commun] = o;
    const parties = [FAMILLES[famille] || famille];
    if (commun && commun !== nom) parties.unshift(nom);
    const magTexte = magnitude(mag);
    if (magTexte) parties.push(magTexte);
    return { nom: commun || nom, detail: parties.join(" · ") };
  }).sort(triNom);
}

async function demarrer() {
  const cat = new URLSearchParams(location.search).get("cat");
  const categorie = CATEGORIES[cat];
  const titre = $("titre-liste");
  if (!categorie) {
    titre.textContent = "Catalogue";
    $("compte").textContent = "Cette catégorie n'existe pas.";
    $("filtre").hidden = true;
    pret();
    return;
  }
  titre.textContent = categorie.titre;
  document.title = "Arcturus : " + categorie.titre;
  let items = [];
  try {
    if (categorie.source === "etoiles") items = await chargerEtoiles();
    else if (categorie.source === "profond") items = await chargerProfond(categorie.familles);
    else items = PLANETES;
  } catch {
    $("compte").textContent = "Impossible de charger cette liste.";
    pret();
    return;
  }
  afficher(items);
  $("filtre").addEventListener("input", () => afficher(items));
  pret();
}

demarrer();
