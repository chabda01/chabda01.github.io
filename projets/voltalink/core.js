/* core.js — calculs purs de la démo VoltaLink.
   Pas de DOM ici : testable avec `node core.js` ou en l'import ant.
   Chaque fonction cite le fichier réel du projet dont elle reprend l'algorithme
   (dépôt source : backend/, frontend/src/, simulator/). */
(function (global) {
"use strict";

// ───────────────────────────────────────────────────────────
// Catalogue des fonctionnalités payantes.
// Repris de frontend/src/services/featureService.js (prix en XOF, tels quels).
// ───────────────────────────────────────────────────────────
var FEATURES = [
  { id: 1, name: "Autopilot", description: "Aide à la conduite : maintien de voie, régulateur adaptatif.", price: 5000, icon: "🧭", category: "Conduite" },
  { id: 2, name: "Conduite autonome totale", description: "Conduite autonome dans la plupart des conditions.", price: 15000, icon: "🚗", category: "Conduite", requires: 1 },
  { id: 3, name: "Connectivité Premium", description: "Internet haut débit, trafic en direct, cartes satellite.", price: 2500, icon: "📶", category: "Connectivité" },
  { id: 4, name: "Audio amélioré", description: "Système audio immersif.", price: 3000, icon: "🔊", category: "Divertissement" },
  { id: 5, name: "Climatisation Plus", description: "Préconditionnement et qualité de l'air.", price: 1500, icon: "❄️", category: "Confort" },
  { id: 6, name: "Mode Sport", description: "Accélération et vitesse de pointe débloquées.", price: 8000, icon: "🏎️", category: "Performance" },
  { id: 7, name: "Mode Sentinelle", description: "Caméras 360° à l'arrêt, pour la sécurité.", price: 2000, icon: "🎥", category: "Sécurité" },
  { id: 8, name: "Mode Animal", description: "Climatisation maintenue pour les animaux à l'arrêt.", price: 500, icon: "🐾", category: "Confort" }
];

// Firmwares disponibles. Repris de backend/database/db.js (insertDemoData).
var FIRMWARES = [
  { version: "v1.0", notes: "Version initiale", size_mb: 10.5, is_critical: false },
  { version: "v1.1", notes: "Optimisation batterie, correction de bugs", size_mb: 15.2, is_critical: false },
  { version: "v1.2", notes: "Correctif sécurité critique", size_mb: 12.8, is_critical: true },
  { version: "v2.0", notes: "Nouvelle interface, mode éco", size_mb: 25.4, is_critical: false }
];

// ───────────────────────────────────────────────────────────
// Un "tick" de simulation = VehicleSimulator.update() dans
// backend/simulator/carSimulator.js (la classe qui alimente vraiment
// la carte en direct du projet). rng() doit renvoyer un flottant [0,1),
// comme Math.random() — on l'injecte pour pouvoir tester de façon déterministe.
// ───────────────────────────────────────────────────────────
function tick(vehicle, rng) {
  var v = Object.assign({}, vehicle);

  // 5% de chance de changer de statut de connexion internet.
  if (rng() > 0.95) v.isConnected = !v.isConnected;

  if (!v.charging && !v.isUpdating) {
    // 30% de chance de changer de vitesse (0 à 79 km/h).
    if (rng() > 0.7) v.speed = Math.floor(rng() * 80);

    if (v.speed > 0) {
      // Déplacement : même formule que le projet (degré ≈ vitesse / 111000).
      var distance = v.speed / 111000;
      v.lat = v.lat + Math.cos((v.direction * Math.PI) / 180) * distance;
      v.lng = v.lng + Math.sin((v.direction * Math.PI) / 180) * distance;

      // 10% de chance de changer de direction.
      if (rng() > 0.9) v.direction = rng() * 360;

      // Consommation de la batterie en roulant.
      v.battery = Math.max(0, v.battery - 0.1);
    }
  }

  // Recharge automatique sous 15%, jusqu'à 80% (pas de borne : le véhicule se recharge seul).
  if (v.battery < 15 && !v.charging) {
    v.charging = true;
    v.speed = 0;
  }
  if (v.charging) {
    v.battery = Math.min(100, v.battery + 0.5);
    if (v.battery >= 80) v.charging = false;
  }

  // Note : on NE round pas ici. Le vrai programme garde this.battery en pleine
  // précision et ne round que la valeur envoyée aux clients (getData()) — sinon
  // l'arrondi s'accumule et la simulation dérive. Voir displayBattery().
  return v;
}

// Arrondi d'affichage. Reprise de getData() dans carSimulator.js
// (Math.round(this.battery * 10) / 10) — jamais appliqué à l'état interne.
function displayBattery(battery) {
  return Math.round(battery * 10) / 10;
}

// Condition pour lancer une mise à jour. Reprise de canUpdate()
// dans backend/simulator/carSimulator.js (et de la même logique dans update_routes.js).
function canUpdate(vehicle) {
  return vehicle.speed === 0 && vehicle.isConnected && vehicle.battery > 20 && !vehicle.isUpdating;
}

// Raisons de blocage. Reprises mot pour mot de startUpdate() dans carSimulator.js.
function blockReasons(vehicle) {
  var reasons = [];
  if (vehicle.speed > 0) reasons.push("le véhicule roule");
  if (!vehicle.isConnected) reasons.push("pas de connexion internet");
  if (vehicle.battery <= 20) reasons.push("batterie trop faible");
  if (vehicle.isUpdating) reasons.push("mise à jour déjà en cours");
  return reasons;
}

// Un pas de progression FOTA (0, 5, 10, ... 100). Reprise de
// VehicleSimulator.handleStartUpdate() dans simulator/vehicule_simulator.js :
// 5% de chance d'échec tant que progress < 95.
function fotaStep(progress, rng) {
  if (progress < 95 && rng() < 0.05) {
    return { progress: progress, failed: true, error: "Connexion perdue pendant le téléchargement" };
  }
  return { progress: Math.min(100, progress + 5), failed: false };
}

// Activer une fonctionnalité payante sur un véhicule.
// Le contrôle "la conduite autonome totale nécessite l'Autopilot" vient de
// frontend/src/services/featureService.js (activateFeature) ; l'effet sur le
// mode de conduite vient de backend/simulator/carSimulator.js (activateFeature()).
function activateFeature(vehicle, featureId) {
  var id = Number(featureId);
  var feature = FEATURES.filter(function (f) { return f.id === id; })[0];
  if (!feature) return { success: false, error: "Fonctionnalité inconnue" };
  if (vehicle.activeFeatures.indexOf(id) !== -1) {
    return { success: false, error: "Fonctionnalité déjà active" };
  }
  if (feature.requires && vehicle.activeFeatures.indexOf(feature.requires) === -1) {
    return { success: false, error: "Nécessite d'abord l'Autopilot" };
  }
  var activeFeatures = vehicle.activeFeatures.concat(id);
  var drivingMode = vehicle.drivingMode;
  if (id === 1) drivingMode = "autopilot";
  else if (id === 2) drivingMode = "full-self-driving";
  return { success: true, activeFeatures: activeFeatures, drivingMode: drivingMode };
}

// Désactiver une fonctionnalité. Reprise de deactivateFeature() dans carSimulator.js.
function deactivateFeature(vehicle, featureId) {
  var id = Number(featureId);
  if (vehicle.activeFeatures.indexOf(id) === -1) {
    return { success: false, error: "Fonctionnalité pas active" };
  }
  var activeFeatures = vehicle.activeFeatures.filter(function (f) { return f !== id; });
  var drivingMode = (id === 1 || id === 2) ? "manual" : vehicle.drivingMode;
  return { success: true, activeFeatures: activeFeatures, drivingMode: drivingMode };
}

// Couleur selon l'état. Reprise de getVehicleColor() dans
// frontend/src/components/LiveMap.vue.
function statusColor(vehicle) {
  if ((vehicle.battery != null ? vehicle.battery : 100) < 20) return "#ef4444"; // rouge
  if (vehicle.charging) return "#3b82f6"; // bleu
  if ((vehicle.speed || 0) > 0) return "#22c55e"; // vert
  return "#6b7280"; // gris
}

// Libellé de statut. Repris de getVehicleStatus() dans LiveMap.vue.
function statusLabel(vehicle) {
  if (vehicle.charging) return "En recharge";
  if ((vehicle.speed || 0) > 0) return "En route";
  if ((vehicle.battery != null ? vehicle.battery : 100) < 20) return "Batterie faible";
  return "À l'arrêt";
}

var api = {
  FEATURES: FEATURES,
  FIRMWARES: FIRMWARES,
  tick: tick,
  canUpdate: canUpdate,
  blockReasons: blockReasons,
  fotaStep: fotaStep,
  activateFeature: activateFeature,
  deactivateFeature: deactivateFeature,
  statusColor: statusColor,
  statusLabel: statusLabel,
  displayBattery: displayBattery
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.VoltaLinkCore = api;

})(typeof window !== "undefined" ? window : globalThis);
