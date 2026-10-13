"use strict";

const CLE_POSITION = "arcturus.position";
const $ = (sel) => document.querySelector(sel);

/* ---------- Position (mémorisée sur l'appareil) ---------- */
function lirePosition() {
  try { return JSON.parse(localStorage.getItem(CLE_POSITION)); } catch { return null; }
}
function ecrirePosition(p) {
  try { localStorage.setItem(CLE_POSITION, JSON.stringify(p)); } catch { /* stockage indisponible */ }
}

/* ---------- Heure en temps réel ---------- */
function majHeure() {
  $("#heure").textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
majHeure();
setInterval(majHeure, 1000);

/* ---------- Météo (Open-Meteo, sans clé) ---------- */
function ligneMesure(label, valeur) {
  const div = document.createElement("div");
  div.className = "mesure";
  const span = document.createElement("span");
  span.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = valeur;
  div.append(span, strong);
  return div;
}

function messageMeteo(texte) {
  const p = document.createElement("p");
  p.className = "vide";
  p.textContent = texte;
  $("#meteo-valeurs").replaceChildren(p);
}

async function chargerMeteo(pos) {
  if (!pos) {
    messageMeteo("Choisis une position pour voir la météo.");
    return;
  }
  messageMeteo("Chargement…");
  try {
    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${pos.lat}&longitude=${pos.lon}`
      + "&current=temperature_2m,relative_humidity_2m,cloud_cover&timezone=auto";
    const rep = await fetch(url);
    if (!rep.ok) throw new Error("HTTP " + rep.status);
    const { current } = await rep.json();
    $("#meteo-valeurs").replaceChildren(
      ligneMesure("Température", `${Math.round(current.temperature_2m)} °C`),
      ligneMesure("Humidité", `${Math.round(current.relative_humidity_2m)} %`),
      ligneMesure("Nuages", `${Math.round(current.cloud_cover)} %`)
    );
  } catch {
    messageMeteo("Météo indisponible. Vérifie ta connexion.");
  }
}

/* ---------- Actualités : prochains événements ---------- */
function prochaineDate(evt) {
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  let date = new Date(aujourdhui.getFullYear(), evt.mois - 1, evt.jour);
  if (date < aujourdhui) date = new Date(aujourdhui.getFullYear() + 1, evt.mois - 1, evt.jour);
  const jours = Math.round((date - aujourdhui) / 86400000);
  return { date, jours };
}

function texteDelai(jours) {
  if (jours === 0) return "aujourd'hui";
  if (jours === 1) return "demain";
  return `dans ${jours} jours`;
}

async function chargerEvenements() {
  const liste = $("#liste-evenements");
  try {
    const rep = await fetch("data/evenements.json");
    if (!rep.ok) throw new Error("HTTP " + rep.status);
    const evenements = (await rep.json())
      .map((e) => ({ ...e, ...prochaineDate(e) }))
      .sort((a, b) => a.jours - b.jours)
      .slice(0, 3);

    liste.replaceChildren(...evenements.map((e) => {
      const li = document.createElement("li");
      const bloc = document.createElement("div");
      const nom = document.createElement("strong");
      nom.textContent = e.nom;
      const date = document.createElement("small");
      date.textContent = e.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
      bloc.append(nom, date);
      const quand = document.createElement("span");
      quand.className = "quand";
      quand.textContent = texteDelai(e.jours);
      li.append(bloc, quand);
      return li;
    }));
  } catch {
    const li = document.createElement("li");
    li.className = "vide";
    li.textContent = "Événements indisponibles pour le moment.";
    liste.replaceChildren(li);
  }
}

/* ---------- Fenêtre « ma position » ---------- */
const dialogue = $("#dialogue-position");
const message = (texte) => { $("#message-position").textContent = texte; };

function appliquerPosition(pos) {
  $("#btn-position").textContent = pos ? pos.nom : "ma position";
  chargerMeteo(pos);
}

function choisir(pos) {
  ecrirePosition(pos);
  appliquerPosition(pos);
  dialogue.close();
}

async function nomDuLieu(lat, lon) {
  try {
    const rep = await fetch(
      "https://api.bigdatacloud.net/data/reverse-geocode-client"
      + `?latitude=${lat}&longitude=${lon}&localityLanguage=fr`
    );
    const donnees = await rep.json();
    return donnees.city || donnees.locality || "Position GPS";
  } catch {
    return "Position GPS";
  }
}

async function chercherVille(texte) {
  if (texte.trim().length < 2) return;
  message("Recherche…");
  const liste = $("#resultats-villes");
  liste.replaceChildren();
  try {
    const rep = await fetch(
      "https://geocoding-api.open-meteo.com/v1/search"
      + `?name=${encodeURIComponent(texte.trim())}&count=5&language=fr&format=json`
    );
    const { results = [] } = await rep.json();
    if (!results.length) { message("Aucune ville trouvée."); return; }
    message("");
    liste.replaceChildren(...results.map((v) => {
      const li = document.createElement("li");
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.textContent = [v.name, v.admin1, v.country].filter(Boolean).join(", ");
      bouton.addEventListener("click", () => choisir({ nom: v.name, lat: v.latitude, lon: v.longitude }));
      li.append(bouton);
      return li;
    }));
  } catch {
    message("Recherche impossible. Vérifie ta connexion.");
  }
}

$("#btn-position").addEventListener("click", () => {
  message("");
  $("#resultats-villes").replaceChildren();
  dialogue.showModal();
});

$("#btn-fermer").addEventListener("click", () => dialogue.close());

$("#btn-gps").addEventListener("click", () => {
  if (!navigator.geolocation) {
    message("La géolocalisation n'est pas disponible sur cet appareil.");
    return;
  }
  message("Recherche de ta position…");
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const nom = await nomDuLieu(coords.latitude, coords.longitude);
      choisir({ nom, lat: coords.latitude, lon: coords.longitude });
    },
    () => message("Position introuvable. Autorise la localisation ou cherche une ville."),
    { timeout: 10000 }
  );
});

$("#btn-chercher").addEventListener("click", () => chercherVille($("#champ-ville").value));
$("#champ-ville").addEventListener("keydown", (e) => {
  if (e.key === "Enter") chercherVille(e.target.value);
});

/* ---------- Démarrage ---------- */
appliquerPosition(lirePosition());
chargerEvenements();
setInterval(() => chargerMeteo(lirePosition()), 10 * 60 * 1000);
