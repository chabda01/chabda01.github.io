/* CodeWash — cœur du calcul (fonctions pures, sans DOM).
   Reconstitution en JavaScript vanilla des règles réelles du jeu React
   "Level Up RPG" (module G-ING-400, dossier G-ING-400-COT-4-1-codewash-14).
   Les formules, les tables de difficulté et les listes de mots viennent
   telles quelles de src/utils/gameUtils.js, src/hooks/useBattle.js,
   src/utils/skillCardUtils.js et src/constants/writingData.js du dépôt.
   Chargé par la page et par node (tests). Aucun Math.random() non injectable :
   chaque fonction qui tire au hasard reçoit un `rng` (par défaut Math.random)
   pour pouvoir être testée. */
(function (root) {
'use strict';

/* ─────────────────────────────────────────────────────────────────────────
   1. Progression RPG — copié de src/utils/gameUtils.js (constantes et
      formules identiques) et src/hooks/useBattle.js (déroulé d'un coup).
   ───────────────────────────────────────────────────────────────────────── */

var LEVEL_SCALING_FACTOR = 1.035;      // +3.5 % d'XP requise par niveau
var DIFFICULTY_PENALTY_FACTOR = 0.3;   // pénalité si on joue sous la difficulté attendue
var BASE_DAMAGE = 12;                  // 5 coups pour tuer, à n'importe quel niveau
var BASE_MOB_HEALTH = 60;              // 5 * BASE_DAMAGE
var BASE_XP_REWARD = 100;              // 1 monstre tué = 1 niveau, au départ
var BASE_XP_TO_LEVEL = 100;

var BADGE_TIERS = [
  { level: 20, title: 'Bois' }, { level: 40, title: 'Pierre' },
  { level: 60, title: 'Or' }, { level: 80, title: 'Fer' },
  { level: 100, title: 'Émeraude' }, { level: 120, title: 'Diamant' },
  { level: 140, title: 'Netherite' }, { level: 160, title: 'Obsidienne' }
];

function getDifficultyMultiplier(difficulty) { return Math.pow(3, difficulty - 1); }

function calculateDamage(playerLevel, difficulty) {
  return BASE_DAMAGE * getDifficultyMultiplier(difficulty);
}

function calculateMobHealth(difficulty) {
  return BASE_MOB_HEALTH * getDifficultyMultiplier(difficulty);
}

function getExpectedDifficulty(playerLevel) {
  return Math.min(7, Math.floor((playerLevel - 1) / 20) + 1);
}

function calculateXPReward(difficulty, playerLevel) {
  var expected = getExpectedDifficulty(playerLevel);
  var baseXPScaled = BASE_XP_REWARD * Math.pow(LEVEL_SCALING_FACTOR, playerLevel - 1);
  var fullReward = Math.floor(baseXPScaled * getDifficultyMultiplier(difficulty));
  if (difficulty >= expected) return fullReward;
  var gap = expected - difficulty;
  var penalty = Math.pow(DIFFICULTY_PENALTY_FACTOR, gap);
  return Math.floor(fullReward * penalty);
}

function calculateXPToLevel(difficulty, playerLevel) {
  var expected = getExpectedDifficulty(playerLevel);
  var baseXPForLevel = BASE_XP_TO_LEVEL * Math.pow(LEVEL_SCALING_FACTOR, playerLevel - 1);
  return Math.floor(baseXPForLevel * getDifficultyMultiplier(expected));
}

/** État initial d'un skill (une "carte"), comme src/utils/skillsInit.js. */
function createSkillState(difficulty) {
  difficulty = difficulty || 1;
  var hp = calculateMobHealth(difficulty);
  return {
    level: 1, xp: 0, difficulty: difficulty,
    mobHealth: hp, mobMaxHealth: hp,
    earnedBadges: [], lostLevel: false, recoveryDifficulty: null
  };
}

/**
 * Un coup correct porté au monstre de la carte.
 * Reconstitue buildNextSkillState() + computeXpPerHit() + computeRemainingXP()
 * + computeLevelUp() de src/hooks/useBattle.js, à l'identique (mêmes calculs,
 * mêmes arrondis). `xpMultiplier` est un ajout de confort pour la démo web
 * (voir page) : à 1, le résultat est rigoureusement celui du vrai jeu.
 */
function applyCorrectAnswer(skill, difficultyUsed, xpMultiplier) {
  xpMultiplier = xpMultiplier || 1;
  var damage = calculateDamage(skill.level, difficultyUsed);
  var mobHealthBefore = skill.mobHealth;
  var mobMaxHealth = skill.mobMaxHealth;
  var newMobHealth = mobHealthBefore - damage;
  var totalXP = Math.round(calculateXPReward(difficultyUsed, skill.level) * xpMultiplier);
  var hitsToKill = Math.ceil(mobMaxHealth / damage);
  var xpPerHit = Math.floor(totalXP / hitsToKill);

  var events = { damage: damage, defeated: false, leveledUp: false, badgeTier: null, levelRestored: false, xpGain: 0 };

  if (newMobHealth > 0) {
    events.xpGain = xpPerHit;
    return {
      skill: assign({}, skill, { mobHealth: newMobHealth, xp: skill.xp + xpPerHit }),
      events: events
    };
  }

  // Le monstre meurt sur ce coup : XP restante pour compenser les arrondis.
  var hitsDealt = Math.ceil((mobMaxHealth - mobHealthBefore) / damage);
  var remaining = totalXP - hitsDealt * xpPerHit;
  var newXp = skill.xp + remaining;
  events.xpGain = remaining;
  events.defeated = true;

  var newLevel = skill.level;
  var lostLevel = skill.lostLevel;
  var recoveryDifficulty = skill.recoveryDifficulty;
  if (lostLevel) {
    newLevel += 1; lostLevel = false; recoveryDifficulty = null;
    events.levelRestored = true;
  }

  var newDifficulty = skill.difficulty;
  var newBadges = skill.earnedBadges.slice();
  var xpToLevel = calculateXPToLevel(newDifficulty, newLevel);
  if (newXp >= xpToLevel) {
    var levelsGained = Math.floor(newXp / xpToLevel);
    var oldLevel = newLevel;
    newLevel += levelsGained;
    newXp = newXp % xpToLevel;
    for (var lvl = oldLevel; lvl < newLevel; lvl++) {
      if (lvl % 20 === 0 && lvl > 0) {
        var tier = lvl / 20;
        if (newDifficulty < 7) newDifficulty++;
        if (newBadges.indexOf(tier) === -1 && tier <= 7) { newBadges.push(tier); events.badgeTier = tier; }
      }
    }
    events.leveledUp = true;
  }

  var newMobMaxHealth = calculateMobHealth(newDifficulty);
  return {
    skill: {
      level: newLevel, xp: newXp, difficulty: newDifficulty, earnedBadges: newBadges,
      mobHealth: newMobMaxHealth, mobMaxHealth: newMobMaxHealth,
      lostLevel: lostLevel, recoveryDifficulty: recoveryDifficulty
    },
    events: events
  };
}

/** Mauvaise réponse : le joueur perd un cœur (handleWrongAnswer, hors combat de boss — non repris ici). */
function applyWrongAnswer(playerHealth) {
  var h = playerHealth - 1;
  if (h <= 0) return { playerHealth: 10, died: true };
  return { playerHealth: h, died: false };
}

/** Mort du joueur sur un skill : il perd un niveau sur CE skill (handlePlayerDeath). */
function onPlayerDeath(skill) {
  return assign({}, skill, {
    level: Math.max(1, skill.level - 1),
    lostLevel: skill.level > 1,
    recoveryDifficulty: Math.max(1, (skill.difficulty || 1) - 1)
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   2. Génération des défis — copié de src/utils/challengeUtils.js et
      src/utils/gameUtils.js (generateMathProblem, getReadingWord,
      getWordForDifficulty), tables de difficulté de src/constants/difficulty.js.
   ───────────────────────────────────────────────────────────────────────── */

var MATH_DIFFICULTY = {
  1: { operations: ['+'], range: [0, 9] },
  2: { operations: ['+'], range: [0, 20] },
  3: { operations: ['+', '-'], range: [0, 20] },
  4: { operations: ['+', '-', '*'], range: [0, 20], multiplyRange: [1, 10] },
  5: { operations: ['+', '-', '*', '/'], range: [0, 20], divisionRange: [1, 10] },
  6: { pemdas: true },
  7: { nightmare: true }
};

var PEMDAS_PROBLEMS = [
  { question: '3 + 4 × 2', answer: '11' }, { question: '(2 + 3) × 4', answer: '20' },
  { question: '10 - 2 × 3', answer: '4' }, { question: '(5 + 5) ÷ 2', answer: '5' },
  { question: '8 ÷ 2 + 3', answer: '7' }, { question: '2 × 3 + 4', answer: '10' },
  { question: '15 - 3 × 3', answer: '6' }, { question: '(4 + 2) × 3', answer: '18' },
  { question: '12 ÷ 3 + 5', answer: '9' }, { question: '2 + 6 ÷ 2', answer: '5' },
  { question: '(8 - 3) × 2', answer: '10' }, { question: '4 × 2 - 1', answer: '7' }
];

var NIGHTMARE_PROBLEMS = [
  { question: '((25 - 10) × 4 + 18) ÷ 2 - 7', answer: '32' },
  { question: '(50 ÷ 5 + 3) × 6 - 28', answer: '50' },
  { question: '100 - (8 × 7 - 12) ÷ 2', answer: '78' },
  { question: '((15 + 9) × 3 - 20) ÷ 4', answer: '13' },
  { question: '(80 - 32) ÷ 6 + 15 × 2', answer: '38' },
  { question: '((40 ÷ 8 + 7) × 6 - 18) ÷ 3', answer: '18' },
  { question: '120 ÷ (12 - 2) + 8 × 5', answer: '52' },
  { question: '(18 + 22) × 2 - 35 ÷ 7', answer: '75' },
  { question: '((64 - 16) ÷ 4 + 9) × 3', answer: '63' },
  { question: '(100 - 45) ÷ 5 + 17 × 2', answer: '45' },
  { question: '((36 ÷ 6 + 8) × 4 - 20) ÷ 2', answer: '18' },
  { question: '(72 ÷ 9 - 3) × 7 + 15', answer: '50' },
  { question: '150 - ((20 + 10) × 3 - 15)', answer: '75' },
  { question: '((48 - 12) ÷ 9 + 11) × 5', answer: '75' },
  { question: '(90 ÷ 6 + 25) × 2 - 18', answer: '62' },
  { question: '((56 + 24) ÷ 8 - 3) × 6', answer: '42' },
  { question: '200 - (15 × 6 + 20) ÷ 2', answer: '145' },
  { question: '((32 + 8) × 3 - 40) ÷ 10', answer: '8' },
  { question: '(144 ÷ 12 + 16) × 2 - 25', answer: '31' },
  { question: '((75 - 30) ÷ 5 + 8) × 4', answer: '68' },
  { question: '(180 ÷ 9 - 10) × 6 + 24', answer: '84' },
  { question: '((100 + 50) ÷ 6 - 5) × 3', answer: '60' },
  { question: '(96 - 36) ÷ 12 + 9 × 7', answer: '68' },
  { question: '((84 ÷ 7 + 18) × 2 - 16) ÷ 4', answer: '11' },
  { question: '250 - ((18 + 12) × 4 - 25)', answer: '155' }
];

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

function generateMathProblem(difficulty, rng) {
  rng = rng || Math.random;
  var config = MATH_DIFFICULTY[difficulty] || MATH_DIFFICULTY[1];
  if (config.nightmare) {
    var np = pick(NIGHTMARE_PROBLEMS, rng);
    return { question: np.question + ' = ?', answer: np.answer, tag: 'Cauchemar' };
  }
  if (config.pemdas) {
    var pp = pick(PEMDAS_PROBLEMS, rng);
    return { question: pp.question + ' = ?', answer: pp.answer, tag: 'Priorités opératoires' };
  }
  var ops = config.operations || ['+'];
  var range = config.range || [1, 9];
  var minVal = range[0], maxVal = range[1];
  var op = pick(ops, rng);
  var a, b, question, answer;
  if (op === '+') {
    a = Math.floor(rng() * (maxVal - minVal + 1)) + minVal;
    b = Math.floor(rng() * (maxVal - minVal + 1)) + minVal;
    question = a + ' + ' + b + ' = ?'; answer = String(a + b);
  } else if (op === '-') {
    a = Math.floor(rng() * (maxVal - minVal + 1)) + minVal;
    b = Math.floor(rng() * a) + 1;
    question = a + ' - ' + b + ' = ?'; answer = String(a - b);
  } else if (op === '*') {
    var mr = config.multiplyRange || [1, 12];
    a = Math.floor(rng() * (mr[1] - mr[0] + 1)) + mr[0];
    b = Math.floor(rng() * (mr[1] - mr[0] + 1)) + mr[0];
    question = a + ' × ' + b + ' = ?'; answer = String(a * b);
  } else { // '/'
    var dr = config.divisionRange || [1, 12];
    b = Math.floor(rng() * (dr[1] - dr[0] + 1)) + dr[0];
    var quotient = Math.floor(rng() * 10) + 1;
    a = b * quotient;
    question = a + ' ÷ ' + b + ' = ?'; answer = String(quotient);
  }
  return { question: question, answer: answer, tag: null };
}

var READING_WORDS = {
  3: ['CAT', 'DOG', 'SUN', 'BAT', 'HAT', 'RUN', 'BIG', 'RED', 'FOX', 'MOM', 'DAD', 'CUP', 'BUS', 'PEN', 'ANT', 'BEE'],
  4: ['BOOK', 'TREE', 'FISH', 'BALL', 'CAKE', 'BIRD', 'FROG', 'PLAY', 'JUMP', 'MILK', 'DOOR', 'DUCK', 'STAR', 'MOON', 'RAIN'],
  5: ['APPLE', 'HOUSE', 'WATER', 'HAPPY', 'MUSIC', 'TIGER', 'BEACH', 'PLANT', 'CLOUD', 'SMILE', 'PIZZA', 'GRAPE', 'HORSE', 'SHEEP'],
  6: ['BANANA', 'ORANGE', 'PURPLE', 'GARDEN', 'FRIEND', 'SCHOOL', 'FLOWER', 'RABBIT', 'MONKEY', 'BUTTON', 'CASTLE', 'DRAGON', 'FOREST'],
  7: ['DIAMOND', 'EMERALD', 'CHICKEN', 'RAINBOW', 'DOLPHIN', 'PENGUIN', 'GIRAFFE', 'PUMPKIN', 'VOLCANO', 'TORNADO', 'MONSTER', 'TEACHER'],
  8: ['SKELETON', 'ELEPHANT', 'TREASURE', 'CROCODILE', 'FIREWORK', 'BIRTHDAY', 'SANDWICH', 'DINOSAUR', 'COMPUTER', 'MUSHROOM']
};
var FUNNY_LONG_WORDS = [
  'ANTIDISESTABLISHMENTARIANISM', 'PNEUMONOULTRAMICROSCOPICSILICOVOLCANOCONIOSIS',
  'HIPPOPOTOMONSTROSESQUIPPEDALIOPHOBIA', 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS',
  'FLOCCINAUCINIHILIPILIFICATION', 'PSEUDOPSEUDOHYPOPARATHYROIDISM',
  'INCOMPREHENSIBILITIES', 'HONORIFICABILITUDINITY'
];
var READING_CHAR_LENGTH = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8 };

function getReadingWord(difficulty, rng) {
  rng = rng || Math.random;
  if (difficulty === 7) return pick(FUNNY_LONG_WORDS, rng);
  var len = READING_CHAR_LENGTH[difficulty] || 3;
  return pick(READING_WORDS[len] || READING_WORDS[3], rng);
}

/* Index des mots d'artisanat (noms de mobs/objets du jeu), copié intégralement de
   src/constants/writingData.js::WRITING_WORD_INDEX — displayName et length (qui est
   la longueur du displayName, espace compris, exactement comme dans le vrai fichier)
   sont repris tels quels. Seuls les chemins d'image sont omis (droits non clairs —
   voir page, « ce que je n'ai pas repris »). */
var WRITING_WORD_INDEX = [
  { displayName: 'Allay', length: 5 }, { displayName: 'Armadillo', length: 9 }, { displayName: 'Bunny', length: 5 },
  { displayName: 'Camel', length: 5 }, { displayName: 'Cat', length: 3 }, { displayName: 'Chicken', length: 7 },
  { displayName: 'Copper Golem', length: 12 }, { displayName: 'Cow', length: 3 }, { displayName: 'Fish', length: 4 },
  { displayName: 'Frog', length: 4 }, { displayName: 'Glow Squid', length: 10 }, { displayName: 'Goat', length: 4 },
  { displayName: 'Horse', length: 5 }, { displayName: 'Iron Golem', length: 10 }, { displayName: 'Mooshroom', length: 9 },
  { displayName: 'Nautilus', length: 8 }, { displayName: 'Panda', length: 5 }, { displayName: 'Pig', length: 3 },
  { displayName: 'Polar Bear', length: 10 }, { displayName: 'Sheep', length: 5 }, { displayName: 'Sniffer', length: 7 },
  { displayName: 'Snow Golem', length: 10 }, { displayName: 'Squid', length: 5 }, { displayName: 'Strider', length: 7 },
  { displayName: 'Turtle', length: 6 }, { displayName: 'Wolf', length: 4 },
  { displayName: 'Blaze', length: 5 }, { displayName: 'Bogged', length: 6 }, { displayName: 'Breeze', length: 6 },
  { displayName: 'Creeper', length: 7 }, { displayName: 'Drowned', length: 7 }, { displayName: 'Enderman', length: 8 },
  { displayName: 'Evoker', length: 6 }, { displayName: 'Ghast', length: 5 }, { displayName: 'Guardian', length: 8 },
  { displayName: 'Hoglin', length: 6 }, { displayName: 'Magma Cube', length: 10 }, { displayName: 'Parched', length: 7 },
  { displayName: 'Phantom', length: 7 }, { displayName: 'Piglin', length: 6 }, { displayName: 'Pillager', length: 8 },
  { displayName: 'Skeleton', length: 8 }, { displayName: 'Slime', length: 5 }, { displayName: 'Spider', length: 6 },
  { displayName: 'Witch', length: 5 }, { displayName: 'Zombie', length: 6 },
  { displayName: 'Creaking', length: 8 }, { displayName: 'Elder Guardian', length: 14 }, { displayName: 'Ravager', length: 7 },
  { displayName: 'Wither Skeleton', length: 15 },
  { displayName: 'Ender Dragon', length: 12 }, { displayName: 'Herobrine', length: 9 }, { displayName: 'Warden', length: 6 },
  { displayName: 'Wither', length: 6 },
  { displayName: 'Axe', length: 3 }, { displayName: 'Bed', length: 3 }, { displayName: 'Boat', length: 4 },
  { displayName: 'Book', length: 4 }, { displayName: 'Bow', length: 3 }, { displayName: 'Bundle', length: 6 },
  { displayName: 'Cake', length: 4 }, { displayName: 'Egg', length: 3 }, { displayName: 'Hoe', length: 3 },
  { displayName: 'Map', length: 3 }, { displayName: 'Milk', length: 4 }, { displayName: 'TNT', length: 3 },
  { displayName: 'Barrel', length: 6 }, { displayName: 'Chest', length: 5 }, { displayName: 'Ender Chest', length: 11 },
  { displayName: 'Shulker Box', length: 11 }, { displayName: 'Trapped Chest', length: 13 },
  { displayName: 'Dirt', length: 4 }, { displayName: 'Door', length: 4 }, { displayName: 'Ice', length: 3 },
  { displayName: 'Sand', length: 4 }, { displayName: 'Wool', length: 4 }
];
var WRITING_DIFFICULTY_POOLS = {
  1: WRITING_WORD_INDEX.filter(function (w) { return w.length >= 3 && w.length <= 5; }),
  2: WRITING_WORD_INDEX.filter(function (w) { return w.length >= 5 && w.length <= 7; }),
  3: WRITING_WORD_INDEX.filter(function (w) { return w.length >= 6 && w.length <= 8; }),
  4: WRITING_WORD_INDEX.filter(function (w) { return w.length >= 7 && w.length <= 10; }),
  5: WRITING_WORD_INDEX.filter(function (w) { return w.length >= 9 && w.length <= 15; })
};

/** Comme buildWritingChallenge() dans challengeUtils.js : la réponse attendue
 * est le nom affiché, en majuscules (espace compris pour "Copper Golem" etc.). */
function getWordForDifficulty(difficulty, rng) {
  rng = rng || Math.random;
  var poolNumber = Math.min(difficulty, 5);
  var pool = WRITING_DIFFICULTY_POOLS[poolNumber] || WRITING_DIFFICULTY_POOLS[1];
  var item = pick(pool, rng);
  return { displayName: item.displayName, answer: item.displayName.toUpperCase() };
}

/* ─────────────────────────────────────────────────────────────────────────
   3. Patterns / Simon Says (Logic Building) — copié de
      src/hooks/usePatternsGame.js et src/utils/skillCardUtils.js (tempo).
   ───────────────────────────────────────────────────────────────────────── */

var AXOLOTL_COLORS = ['Pink', 'Cyan', 'Gold', 'Brown', 'Blue', 'Red', 'Green', 'Black'];
var PATTERNS_AXOLOTL_COUNT = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8 };
var MAX_TEMPO_DELAY = 800, MIN_TEMPO_DELAY = 200;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

function getTempoDelays(completedRounds, currentDifficulty) {
  var round = completedRounds + 1;
  var startingDelay = lerp(MAX_TEMPO_DELAY, MIN_TEMPO_DELAY, (currentDifficulty - 1) / 6);
  var maxRunwayRounds = lerp(10, 1, (currentDifficulty - 1) / 6);
  var runwayProgress = maxRunwayRounds > 1 ? (round - 1) / (maxRunwayRounds - 1) : 1;
  var rawOnDelay = lerp(startingDelay, MIN_TEMPO_DELAY, runwayProgress);
  var onDelay = clamp(rawOnDelay, MIN_TEMPO_DELAY, MAX_TEMPO_DELAY);
  var offDelay = Math.max(100, Math.round(onDelay * 0.35));
  return { onDelay: onDelay, offDelay: offDelay };
}

function availableAxolotls(difficulty) {
  var n = PATTERNS_AXOLOTL_COUNT[difficulty] || 2;
  return AXOLOTL_COLORS.slice(0, n);
}

/* ─────────────────────────────────────────────────────────────────────────
   util
   ───────────────────────────────────────────────────────────────────────── */
function assign(target) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
  }
  return target;
}

var api = {
  BADGE_TIERS: BADGE_TIERS,
  getDifficultyMultiplier: getDifficultyMultiplier, calculateDamage: calculateDamage,
  calculateMobHealth: calculateMobHealth, getExpectedDifficulty: getExpectedDifficulty,
  calculateXPReward: calculateXPReward, calculateXPToLevel: calculateXPToLevel,
  createSkillState: createSkillState, applyCorrectAnswer: applyCorrectAnswer,
  applyWrongAnswer: applyWrongAnswer, onPlayerDeath: onPlayerDeath,
  generateMathProblem: generateMathProblem, getReadingWord: getReadingWord,
  getWordForDifficulty: getWordForDifficulty,
  AXOLOTL_COLORS: AXOLOTL_COLORS, availableAxolotls: availableAxolotls,
  getTempoDelays: getTempoDelays
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.CW = api;

})(typeof self !== 'undefined' ? self : this);
