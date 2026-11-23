/* demo.js — mise en scène de la démo VoltaLink.
   Les calculs (déplacement, règles de mise à jour, fonctionnalités)
   sont dans core.js. Ici : DOM, canvas, et un faux canal qui reproduit
   le protocole de messages du vrai simulateur (backend/simulator/carSimulator.js
   pour le départ/arrêt, simulator/vehicule_simulator.js pour les étapes de
   progression FOTA). Rien n'est envoyé sur le réseau. */
(function () {
"use strict";

var core = window.VoltaLinkCore;

// ───────────────────────────────────────────────────────────
// Données de départ.
// Les véhicules #1, #4 et #6 et leurs villes sont repris de la liste de
// départ de backend/simulator/carSimulator.js (j'ai corrigé une coquille :
// le dépôt donne 22.3912 pour la longitude de Cotonou au lieu de 2.3912,
// utilisé partout ailleurs dans le même projet). Les deux autres véhicules
// sont des ajouts fictifs, annoncés comme tels, pour une flotte plus vivante.
// ───────────────────────────────────────────────────────────
var CITIES = [
  { name: "Cotonou", lat: 6.3703, lng: 2.3912 },
  { name: "Lagos", lat: 6.5244, lng: 3.3792 },
  { name: "Abidjan", lat: 5.3600, lng: -4.0083 },
  { name: "Nairobi", lat: -1.2921, lng: 36.8219 },
  { name: "Johannesburg", lat: -26.2041, lng: 28.0473 }
];

var vehicles = [
  { id: 1, name: "Black Gezo", city: "Cotonou, Bénin", type: "moto", real: true,
    lat: 6.3703, lng: 2.3912, direction: 40, battery: 82, speed: 0, charging: false,
    isConnected: true, firmwareVersion: "v1.0", isUpdating: false, updateProgress: null,
    pendingUpdate: null, activeFeatures: [], drivingMode: "manual" },
  { id: 4, name: "Orange Gezo", city: "Lagos, Nigeria", type: "car", real: true,
    lat: 6.5244, lng: 3.3792, direction: 160, battery: 58, speed: 0, charging: false,
    isConnected: true, firmwareVersion: "v1.0", isUpdating: false, updateProgress: null,
    pendingUpdate: null, activeFeatures: [], drivingMode: "manual" },
  { id: 6, name: "Red Gezo", city: "Johannesburg, Afrique du Sud", type: "bus", real: true,
    lat: -26.2041, lng: 28.0473, direction: 250, battery: 35, speed: 0, charging: false,
    isConnected: true, firmwareVersion: "v1.0", isUpdating: false, updateProgress: null,
    pendingUpdate: null, activeFeatures: [], drivingMode: "manual" },
  { id: 7, name: "Véhicule démo A", city: "Abidjan, Côte d'Ivoire (fictif)", type: "car", real: false,
    lat: 5.3600, lng: -4.0083, direction: 10, battery: 91, speed: 0, charging: false,
    isConnected: true, firmwareVersion: "v1.1", isUpdating: false, updateProgress: null,
    pendingUpdate: null, activeFeatures: [], drivingMode: "manual" },
  { id: 8, name: "Véhicule démo B", city: "Nairobi, Kenya (fictif)", type: "moto", real: false,
    lat: -1.2921, lng: 36.8219, direction: 300, battery: 12, speed: 0, charging: false,
    isConnected: false, firmwareVersion: "v1.0", isUpdating: false, updateProgress: null,
    pendingUpdate: null, activeFeatures: [], drivingMode: "manual" }
];

var TYPE_LABEL = { moto: "moto", car: "voiture", bus: "bus" };
var DRIVE_LABEL = { manual: "manuelle", autopilot: "Autopilot", "full-self-driving": "autonome totale" };

var selectedId = vehicles[0].id;

// ───────────────────────────────────────────────────────────
// DOM
// ───────────────────────────────────────────────────────────
var canvas = document.getElementById("vl-canvas");
var ctx = canvas.getContext("2d");
var fleetEl = document.getElementById("vl-fleet");
var detailEl = document.getElementById("vl-detail");
var featuresEl = document.getElementById("vl-features");
var journalEl = document.getElementById("vl-journal");
var statusEl = document.getElementById("vl-status");
var firmwareSel = document.getElementById("vl-firmware");
var deployBtn = document.getElementById("vl-deploy");
var stageEl = document.querySelector(".stage.vl");

var reduceMotionMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
var coarse = window.matchMedia("(pointer: coarse)").matches;
var lowCores = (navigator.hardwareConcurrency || 4) <= 4;
var reduceMotion = reduceMotionMQ.matches;
reduceMotionMQ.addEventListener && reduceMotionMQ.addEventListener("change", function (e) {
  reduceMotion = e.matches;
});

// ───────────────────────────────────────────────────────────
// Journal (affiche les messages du protocole, comme la console du vrai serveur)
// ───────────────────────────────────────────────────────────
function logLine(prefix, cls, text) {
  var div = document.createElement("div");
  var p = document.createElement("span");
  p.className = cls;
  p.textContent = prefix + " ";
  div.appendChild(p);
  div.appendChild(document.createTextNode(text));
  journalEl.appendChild(div);
  journalEl.scrollTop = journalEl.scrollHeight;
  while (journalEl.children.length > 60) journalEl.removeChild(journalEl.firstChild);
}

function setStatus(text) { statusEl.textContent = text; }

// ───────────────────────────────────────────────────────────
// Faux canal WebSocket : reproduit les noms de messages de
// backend/simulator/carSimulator.js (ACTIVATE_FEATURE, START_UPDATE,
// FOTA_UPDATE...) avec une petite latence simulée, sans aucun réseau.
// ───────────────────────────────────────────────────────────
function sendMessage(msg) {
  logLine(">", "t-in", JSON.stringify(msg));
  window.setTimeout(function () { handleMessage(msg); }, 60 + Math.random() * 90);
}
function reply(msg, ok) { logLine("<", ok ? "t-ok" : "t-err", JSON.stringify(msg)); }

function handleMessage(msg) {
  var v = null;
  for (var i = 0; i < vehicles.length; i++) if (vehicles[i].id === msg.vehicleId) v = vehicles[i];

  if (msg.type === "ACTIVATE_FEATURE") {
    var r1 = core.activateFeature(v, msg.featureId);
    if (r1.success) {
      v.activeFeatures = r1.activeFeatures; v.drivingMode = r1.drivingMode;
      reply({ type: "FEATURE_ACTIVATED", vehicleId: v.id, featureId: msg.featureId, success: true }, true);
    } else {
      reply({ type: "FEATURE_ERROR", vehicleId: v.id, featureId: msg.featureId, error: r1.error }, false);
    }
    renderAll();

  } else if (msg.type === "DEACTIVATE_FEATURE") {
    var r2 = core.deactivateFeature(v, msg.featureId);
    if (r2.success) {
      v.activeFeatures = r2.activeFeatures; v.drivingMode = r2.drivingMode;
      reply({ type: "FEATURE_DEACTIVATED", vehicleId: v.id, featureId: msg.featureId, success: true }, true);
    } else {
      reply({ type: "FEATURE_ERROR", vehicleId: v.id, featureId: msg.featureId, error: r2.error }, false);
    }
    renderAll();

  } else if (msg.type === "START_UPDATE") {
    if (!v.pendingUpdate) {
      reply({ type: "UPDATE_ERROR", vehicleId: v.id, error: "Aucune mise à jour en attente" }, false);
      return;
    }
    if (!core.canUpdate(v)) {
      var reasons = core.blockReasons(v);
      reply({ type: "UPDATE_ERROR", vehicleId: v.id, error: "Mise à jour impossible : " + reasons.join(", ") }, false);
      renderAll();
      return;
    }
    v.isUpdating = true; v.speed = 0; v.updateProgress = 0;
    reply({ type: "UPDATE_STARTED", vehicleId: v.id, message: "Update started" }, true);
    renderAll();
    runFota(v);

  } else if (msg.type === "FOTA_UPDATE") {
    var version = msg.update.version, count = 0;
    vehicles.forEach(function (x) {
      if (x.firmwareVersion !== version) { x.pendingUpdate = { version: version }; count++; }
    });
    reply({ type: "FOTA_CONFIRMED", message: "Mise à jour " + version + " en file pour " + count + " véhicule(s)" }, true);
    renderAll();
  }
}

// Progression de mise à jour : étapes de 5 %, reprises de
// VehicleSimulator.handleStartUpdate() dans simulator/vehicule_simulator.js
// (1,5 s par étape, 5 % de chance d'échec tant que progress < 95).
function runFota(v) {
  function step() {
    var r = core.fotaStep(v.updateProgress, Math.random);
    if (r.failed) {
      v.isUpdating = false; v.updateProgress = null;
      logLine("<", "t-err", JSON.stringify({ type: "update_completed", vehicleId: v.id, success: false, error: r.error }));
      renderAll();
      return;
    }
    v.updateProgress = r.progress;
    if (selectedId === v.id) renderDetail();
    if (r.progress >= 100) {
      v.firmwareVersion = v.pendingUpdate.version;
      v.pendingUpdate = null; v.isUpdating = false; v.updateProgress = null;
      logLine("<", "t-ok", JSON.stringify({ type: "update_completed", vehicleId: v.id, success: true, new_version: v.firmwareVersion }));
      renderAll();
      return;
    }
    window.setTimeout(step, 1500);
  }
  window.setTimeout(step, 1500);
}

// ───────────────────────────────────────────────────────────
// Simulation (1 fois par seconde, comme setInterval(broadcastVehicleData, 1000)
// dans backend/simulator/carSimulator.js).
// ───────────────────────────────────────────────────────────
function simTick() {
  vehicles.forEach(function (v) {
    if (v.isUpdating) return; // gelé pendant une mise à jour, comme le vrai simulateur
    var wasCharging = v.charging, wasConnected = v.isConnected;
    var after = core.tick(v, Math.random);
    Object.assign(v, after);
    if (!wasCharging && v.charging) logLine("·", "t-dim", v.name + " : batterie basse, recharge automatique");
    else if (wasCharging && !v.charging) logLine("·", "t-dim", v.name + " : recharge terminée (80 %)");
    if (wasConnected !== v.isConnected) logLine("·", "t-dim", v.name + " : " + (v.isConnected ? "reconnecté" : "perte de connexion"));
  });
  renderFleetList();
  renderDetail();
}

// ───────────────────────────────────────────────────────────
// Rendu DOM
// ───────────────────────────────────────────────────────────
function selectedVehicle() {
  for (var i = 0; i < vehicles.length; i++) if (vehicles[i].id === selectedId) return vehicles[i];
  return null;
}

function renderFleetList() {
  fleetEl.innerHTML = "";
  vehicles.forEach(function (v) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip vl-chip";
    b.setAttribute("aria-pressed", String(v.id === selectedId));
    var dot = document.createElement("span");
    dot.className = "vl-dot";
    dot.style.background = core.statusColor(v);
    b.appendChild(dot);
    b.appendChild(document.createTextNode(v.name));
    b.addEventListener("click", function () { selectedId = v.id; renderAll(); });
    fleetEl.appendChild(b);
  });
}

function renderDetail() {
  var v = selectedVehicle();
  detailEl.innerHTML = "";
  if (!v) {
    var p = document.createElement("p");
    p.style.cssText = "color:var(--stage-ink-3);font-size:.85rem";
    p.textContent = "Choisissez un véhicule sur la carte ou dans la liste.";
    detailEl.appendChild(p);
    return;
  }

  var head = document.createElement("div");
  head.className = "vl-detail__head";
  var b = document.createElement("b"); b.textContent = v.name;
  var span = document.createElement("span");
  span.className = "mono"; span.style.cssText = "font-size:.74rem;color:var(--stage-ink-3)";
  span.textContent = "#" + v.id + " · " + v.city + " · " + TYPE_LABEL[v.type];
  head.appendChild(b); head.appendChild(span);
  detailEl.appendChild(head);

  var stats = document.createElement("div");
  stats.className = "stats";
  stats.innerHTML =
    "<div class='stat'><b>" + Math.round(core.displayBattery(v.battery)) + "%</b><span>batterie</span></div>" +
    "<div class='stat'><b>" + v.speed + "</b><span>km/h</span></div>" +
    "<div class='stat'><b>" + core.statusLabel(v) + "</b><span>statut</span></div>" +
    "<div class='stat'><b>" + (v.isConnected ? "En ligne" : "Hors ligne") + "</b><span>connexion</span></div>";
  detailEl.appendChild(stats);

  var fw = document.createElement("p");
  fw.style.cssText = "font-size:.8rem;color:var(--stage-ink-2)";
  fw.textContent = "Firmware " + v.firmwareVersion + " · conduite " + DRIVE_LABEL[v.drivingMode];
  detailEl.appendChild(fw);

  if (v.isUpdating) {
    var wrap = document.createElement("div");
    var lab = document.createElement("span"); lab.className = "label"; lab.textContent = "Mise à jour en cours — " + (v.updateProgress || 0) + " %";
    var bar = document.createElement("div"); bar.className = "vl-progress";
    var i = document.createElement("i"); i.style.width = (v.updateProgress || 0) + "%";
    bar.appendChild(i);
    wrap.appendChild(lab); wrap.appendChild(bar);
    detailEl.appendChild(wrap);
  } else if (v.pendingUpdate) {
    var can = core.canUpdate(v);
    var btn = document.createElement("button");
    btn.className = "btn"; btn.type = "button";
    btn.textContent = "Lancer la mise à jour → " + v.pendingUpdate.version;
    btn.disabled = !can;
    btn.addEventListener("click", function () { sendMessage({ type: "START_UPDATE", vehicleId: v.id }); });
    detailEl.appendChild(btn);
    if (!can) {
      var reason = document.createElement("p");
      reason.className = "vl-reason";
      reason.textContent = "Impossible pour l'instant : " + core.blockReasons(v).join(", ") + ".";
      detailEl.appendChild(reason);
    }
  } else {
    var none = document.createElement("p");
    none.style.cssText = "font-size:.8rem;color:var(--stage-ink-3)";
    none.textContent = "Aucune mise à jour en attente — déployez un firmware à la flotte.";
    detailEl.appendChild(none);
  }
}

function renderFeatures() {
  var v = selectedVehicle();
  featuresEl.innerHTML = "";
  core.FEATURES.forEach(function (f) {
    var active = !!(v && v.activeFeatures.indexOf(f.id) !== -1);
    var row = document.createElement("div");
    row.className = "vl-feat";

    var name = document.createElement("div");
    name.className = "vl-feat__name";
    var bEl = document.createElement("b"); bEl.textContent = f.icon + " " + f.name;
    var sEl = document.createElement("span");
    var reqTxt = f.requires ? (" · nécessite " + core.FEATURES.filter(function (x) { return x.id === f.requires; })[0].name) : "";
    sEl.textContent = f.price.toLocaleString("fr-FR") + " F CFA" + reqTxt;
    name.appendChild(bEl); name.appendChild(sEl);

    var btn = document.createElement("button");
    btn.className = "btn btn--ghost"; btn.type = "button";
    btn.textContent = active ? "Désactiver" : "Activer";
    btn.disabled = !v;
    btn.addEventListener("click", function () {
      if (!v) return;
      sendMessage(active
        ? { type: "DEACTIVATE_FEATURE", vehicleId: v.id, featureId: f.id }
        : { type: "ACTIVATE_FEATURE", vehicleId: v.id, featureId: f.id });
    });

    row.appendChild(name); row.appendChild(btn);
    featuresEl.appendChild(row);
  });
}

function renderAll() { renderFleetList(); renderDetail(); renderFeatures(); }

// ───────────────────────────────────────────────────────────
// Carte (canvas, schématique — pas de fond de carte réel, donc pas d'appel réseau)
// ───────────────────────────────────────────────────────────
var LAT_MIN = -30, LAT_MAX = 10, LNG_MIN = -8, LNG_MAX = 40;
var W = 760, H = 420;
var heavyEffects = !reduceMotion;
var frameTimes = [];

function project(lat, lng) {
  var x = (lng - LNG_MIN) / (LNG_MAX - LNG_MIN) * W;
  var y = (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * H;
  return [x, y];
}

function fitCanvas() {
  var rect = canvas.parentNode.getBoundingClientRect();
  var dprCap = (coarse && lowCores) ? 1 : 2;
  var dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  var w = Math.max(280, Math.round(rect.width));
  var h = Math.round(w * (420 / 760));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  W = w; H = h;
  vehicles.forEach(function (v) { v.sx = null; v.sy = null; });
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0A0907";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(240,234,224,.06)";
  ctx.lineWidth = 1;
  var lng, lat, xy;
  for (lng = Math.ceil(LNG_MIN / 10) * 10; lng <= LNG_MAX; lng += 10) {
    xy = project(0, lng);
    ctx.beginPath(); ctx.moveTo(xy[0], 0); ctx.lineTo(xy[0], H); ctx.stroke();
  }
  for (lat = Math.ceil(LAT_MIN / 10) * 10; lat <= LAT_MAX; lat += 10) {
    xy = project(lat, 0);
    ctx.beginPath(); ctx.moveTo(0, xy[1]); ctx.lineTo(W, xy[1]); ctx.stroke();
  }

  ctx.font = "11px \"Instrument Sans\", system-ui, sans-serif";
  CITIES.forEach(function (c) {
    var p = project(c.lat, c.lng);
    ctx.fillStyle = "rgba(240,234,224,.35)";
    ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(240,234,224,.45)";
    ctx.fillText(c.name, p[0] + 6, p[1] - 6);
  });

  vehicles.forEach(function (v) {
    if (v.sx == null) return;
    var color = core.statusColor(v);
    if (heavyEffects && (v.charging || v.speed > 0)) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(v.sx, v.sy, 11, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(v.sx, v.sy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = v.id === selectedId ? 2.5 : 1.2;
    ctx.strokeStyle = v.id === selectedId ? "#F0EADF" : "rgba(10,9,7,.6)";
    ctx.stroke();
  });
}

canvas.addEventListener("click", function (e) {
  var x = e.offsetX, y = e.offsetY, best = null, bestD = Infinity;
  vehicles.forEach(function (v) {
    if (v.sx == null) return;
    var d = Math.hypot(v.sx - x, v.sy - y);
    if (d < bestD) { bestD = d; best = v; }
  });
  if (best && bestD < 22) { selectedId = best.id; renderAll(); }
});

// ───────────────────────────────────────────────────────────
// Boucles : simulation (1 Hz) + rendu (rAF), arrêtées hors écran / onglet caché.
// ───────────────────────────────────────────────────────────
var simIntervalId = null, rafId = null, stageVisible = true;

function frame() {
  rafId = window.requestAnimationFrame(frame);
  var t0 = performance.now();
  vehicles.forEach(function (v) {
    var p = project(v.lat, v.lng);
    if (reduceMotion || v.sx == null) { v.sx = p[0]; v.sy = p[1]; }
    else { v.sx += (p[0] - v.sx) * 0.12; v.sy += (p[1] - v.sy) * 0.12; }
  });
  draw();
  var dt = performance.now() - t0;
  frameTimes.push(dt);
  if (frameTimes.length > 30) frameTimes.shift();
  if (frameTimes.length === 30) {
    var avg = frameTimes.reduce(function (a, b) { return a + b; }, 0) / 30;
    heavyEffects = !reduceMotion && avg < 6;
  }
}

function startLoops() {
  if (simIntervalId == null) simIntervalId = window.setInterval(simTick, 1000);
  if (rafId == null) rafId = window.requestAnimationFrame(frame);
}
function stopLoops() {
  if (simIntervalId != null) { window.clearInterval(simIntervalId); simIntervalId = null; }
  if (rafId != null) { window.cancelAnimationFrame(rafId); rafId = null; }
}
function syncLoops() {
  var shouldRun = !document.hidden && stageVisible;
  if (shouldRun) startLoops(); else stopLoops();
}

document.addEventListener("visibilitychange", syncLoops);
if (window.IntersectionObserver) {
  var io = new IntersectionObserver(function (entries) {
    stageVisible = entries[0].isIntersecting;
    syncLoops();
  }, { threshold: 0 });
  io.observe(stageEl);
}

var resizePending = false;
window.addEventListener("resize", function () {
  if (resizePending) return;
  resizePending = true;
  window.requestAnimationFrame(function () { fitCanvas(); resizePending = false; });
});

// ───────────────────────────────────────────────────────────
// Démarrage
// ───────────────────────────────────────────────────────────
core.FIRMWARES.forEach(function (f) {
  var opt = document.createElement("option");
  opt.value = f.version;
  opt.textContent = f.version + " — " + f.notes + (f.is_critical ? " (critique)" : "");
  firmwareSel.appendChild(opt);
});
firmwareSel.value = core.FIRMWARES[core.FIRMWARES.length - 1].version;

deployBtn.addEventListener("click", function () {
  sendMessage({ type: "FOTA_UPDATE", update: { version: firmwareSel.value } });
});

fitCanvas();
renderAll();
setStatus("En direct — simulation locale");
logLine("·", "t-dim", "Connecté au simulateur (canal local, sans réseau, 1 message/seconde)");
startLoops();

})();
