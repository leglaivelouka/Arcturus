"use strict";
/* Écran de chargement : affiché dès le début de chaque page et à chaque changement de page.
   Il disparaît quand la page est chargée, que les données demandées au réseau sont arrivées
   et, si la page le demande, quand elle a annoncé qu'elle est prête (window.arcturusPret). */
(function () {
  const DUREE_MIN = 700;   // ms : évite un clignotement quand tout se charge très vite
  const DUREE_MAX = 8000;  // ms : on ne bloque jamais l'appli plus longtemps
  const CALME = 200;       // ms sans requête réseau avant de considérer les données arrivées
  const debut = performance.now();
  let enCours = 0;
  let derniereFin = performance.now();

  // Compte les requêtes réseau en cours (fetch) pour savoir quand les données sont arrivées.
  if (typeof window.fetch === "function") {
    const original = window.fetch.bind(window);
    window.fetch = function () {
      enCours++;
      return original.apply(null, arguments).finally(() => {
        enCours--;
        derniereFin = performance.now();
      });
    };
  }

  const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ecran = () => document.getElementById("splash");

  function pageChargee() {
    return document.readyState === "complete"
      ? Promise.resolve()
      : new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  }

  async function pagePrete() {
    await pageChargee();
    if (window.arcturusPret) await window.arcturusPret;
    while (enCours > 0 || performance.now() - derniereFin < CALME) await attendre(50);
  }

  function masquer() {
    const s = ecran();
    if (!s) return;
    const reste = Math.max(0, DUREE_MIN - (performance.now() - debut));
    setTimeout(() => {
      s.classList.add("cache");
      s.setAttribute("aria-hidden", "true");
    }, reste);
  }

  function demarrer() {
    Promise.race([pagePrete(), attendre(DUREE_MAX)]).then(masquer);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();

  // Quand on clique sur un lien vers une autre page de l'appli, l'écran de chargement revient tout de suite.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const lien = e.target.closest && e.target.closest("a[href]");
    if (!lien || (lien.target && lien.target !== "_self") || lien.hasAttribute("download")) return;
    let url;
    try { url = new URL(lien.href, location.href); } catch { return; }
    if (url.origin !== location.origin) return; // lien externe : la page ne change pas
    if (url.pathname === location.pathname && url.search === location.search) return; // même page (ancre)
    const s = ecran();
    if (!s) return;
    s.classList.remove("cache");
    s.removeAttribute("aria-hidden");
  });

  // Retour en arrière : la page revient du cache du navigateur, il faut cacher l'écran de chargement.
  window.addEventListener("pageshow", (e) => {
    const s = ecran();
    if (e.persisted && s) {
      s.classList.add("cache");
      s.setAttribute("aria-hidden", "true");
    }
  });
})();
