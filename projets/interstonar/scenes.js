/* Interstonar — fichiers de scène et lancements proposés par la page.
   REPO  : fichiers du dépôt, copiés tels quels (tests/*.toml).
   PAGE  : fichiers écrits pour cette page, dans le même format. */
(function (root) {
  'use strict';

  var files = {};

  /* ───── fichiers du dépôt, copiés tels quels ───── */
  files['tests/local_all_shapes.toml'] =
'[[body]]\nname = "s1"\nposition = {x = 0, y = 0, z = 0}\ntype = "sphere"\nradius = 1\n\n' +
'[[body]]\nposition = {x = 0, y = 0, z = 0}\ntype = "cylinder"\nradius = 1\nheight = 100\n\n' +
'[[body]]\nposition = {x = 0, y = 0, z = 0}\ntype = "box"\nsides = {x = 10, y = 10, z = 10}\n\n' +
'[[body]]\nname = "t1"\nposition = {x = 0, y = 0, z = 0}\ntype = "torus"\ninner_radius = 3\nouter_radius = 1\n';

  files['tests/infinite_cylinder.toml'] =
'[[body]]\nposition = {x = 0, y = 0, z = 12}\ntype = "cylinder"\nradius = 1\n';

  /* ───── fichiers écrits pour cette page ─────
     Masses et rayons : NASA, Planetary Fact Sheets (Terre, Lune). Distances en mètres, masses en kilos. */
  files['terre_lune.toml'] =
'# Terre et Lune. Valeurs : NASA Planetary Fact Sheet.\n' +
'# Distances en metres, masses en kilos.\n\n' +
'[[body]]\nname = "Terre"\nposition = {x = 0, y = 0, z = 0}\nmass = 5.9722e24\nradius = 6_371_000\n\n' +
'[[body]]\nname = "Lune"\nposition = {x = 384_400_000, y = 0, z = 0}\nmass = 7.346e22\nradius = 1_737_400\n';

  files['terre.toml'] =
'# La Terre seule. Valeurs : NASA Planetary Fact Sheet.\n\n' +
'[[body]]\nname = "Terre"\nposition = {x = 0, y = 0, z = 0}\nmass = 5.9722e24\nradius = 6_371_000\n';

  files['fusion.toml'] =
'# Scene fictive : deux blocs de roche qui se touchent.\n' +
'# Au premier pas, le programme les fusionne en un seul corps.\n\n' +
'[[body]]\nname = "Pollux"\nposition = {x = 300, y = 0, z = 0}\ndirection = {x = -0.02, y = 0, z = 0}\nmass = 5e11\nradius = 400\n\n' +
'[[body]]\nname = "Castor"\nposition = {x = -300, y = 0, z = 0}\ndirection = {x = 0.02, y = 0, z = 0}\nmass = 5e11\nradius = 400\n';

  files['anneau.toml'] =
'# Scene fictive pour le mode local : un anneau, une boule derriere, une boite a cote.\n\n' +
'[[body]]\nname = "anneau"\nposition = {x = 0, y = 0, z = 0}\ntype = "torus"\ninner_radius = 4\nouter_radius = 1\n\n' +
'[[body]]\nname = "boule"\nposition = {x = 0, y = 0, z = -12}\ntype = "sphere"\nradius = 2\n\n' +
'[[body]]\nposition = {x = 9, y = 0, z = -6}\ntype = "box"\nsides = {x = 4, y = 4, z = 6}\n';

  /* ───── lancements proposés ─────
     Les commandes sont choisies pour cette page : le dépôt ne fournit que les fichiers. */
  var presets = [
    { id: 'lune', group: 'page', label: 'Tir vers la Lune', file: 'terre_lune.toml', plane: 'xy',
      cmd: './interstonar --global terre_lune.toml -d 120 6571000 0 0 12000 0 0',
      note: 'La roche part à 200 km au-dessus de la Terre, à 12 km/s, droit vers la Lune. Le programme s\'arrête à 1000 pas : il faut un pas d\'au moins 2 minutes pour arriver.' },
    { id: 'orbite', group: 'page', label: 'Mise en orbite', file: 'terre.toml', plane: 'xy',
      cmd: './interstonar --global terre.toml -d 10 6771000 0 0 0 7672 0',
      note: 'À 400 km d\'altitude et 7 672 m/s, la roche devrait tourner en cercle. Avec un pas de 10 s, elle s\'éloigne peu à peu : c\'est l\'erreur du calcul.' },
    { id: 'frole', group: 'page', label: 'Astéroïde qui frôle la Terre', file: 'terre.toml', plane: 'xy',
      cmd: './interstonar --global terre.toml -d 60 -150000000 44700000 0 6000 0 0',
      note: 'Un astéroïde fictif arrive à 6 km/s. La Terre courbe sa route sans le capturer. Baissez le point de départ pour le faire tomber.' },
    { id: 'fusion', group: 'page', label: 'Deux corps qui fusionnent', file: 'fusion.toml', plane: 'xy',
      cmd: './interstonar --global fusion.toml -d 60 0 -1500 0 0.21 0 0',
      note: 'Scène fictive. Les deux blocs se touchent : le programme les réunit en « Castor-Pollux », puis la roche tourne autour.' },
    { id: 'formes', group: 'repo', label: 'local_all_shapes.toml', file: 'tests/local_all_shapes.toml', plane: 'xz',
      cmd: './interstonar --local tests/local_all_shapes.toml 20 0.5 14 -1 0 -0.6',
      note: 'Les quatre formes du mode local, toutes posées au centre. La roche avance jusqu\'à la plus proche.' },
    { id: 'cylindre', group: 'repo', label: 'infinite_cylinder.toml', file: 'tests/infinite_cylinder.toml', plane: 'xz',
      cmd: './interstonar --local tests/infinite_cylinder.toml 2 0 0 0 0 1',
      note: 'La roche longe un cylindre sans fin, à distance fixe. Elle ne le touche jamais : le programme s\'arrête à 1000 pas.' },
    { id: 'anneau', group: 'page', label: 'À travers l\'anneau', file: 'anneau.toml', plane: 'xz',
      cmd: './interstonar --local anneau.toml 0.5 0 15 0 0 -1',
      note: 'Scène fictive. La roche passe dans le trou de l\'anneau, ralentit près du bord, puis touche la boule derrière.' }
  ];

  var api = { files: files, presets: presets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InterstonarScenes = api;
})(typeof self !== 'undefined' ? self : this);
