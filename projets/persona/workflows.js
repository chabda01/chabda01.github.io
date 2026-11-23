/* Persona — données des deux vrais workflows n8n.
   Noms de nœuds, types, connexions et paramètres copiés de
   « Persona - Chatbot.json » et « Persona - Newsletter.json » (lecture du JSON exporté).
   Les coordonnées x/y sont redessinées à la main pour la lisibilité (pas les pixels
   exacts du canevas n8n) ; les nœuds, leurs types et leurs connexions sont, eux, réels.
   Aucun secret : les identifiants de connexion réels du dépôt sont déjà remplacés par
   un hachage SHA-256 (pipeline CI du projet) ; ici on ne garde que le nom du compte. */
(function (root) {
  'use strict';

  function node(id, type, kind, x, y, detail, opts) {
    var n = { id: id, type: type, kind: kind, x: x, y: y, detail: detail };
    if (opts) for (var k in opts) n[k] = opts[k];
    return n;
  }

  /* ───────────────────────── Chatbot ─────────────────────────
     2 nœuds seulement dans le vrai fichier : presque toute la logique
     (menu, inscription, connexion, RGPD…) vit dans l'unique nœud de code. */
  var chatbot = {
    title: 'Persona - Chatbot',
    width: 620, height: 170,
    nodes: [
      node('Chat Trigger', '@n8n/n8n-nodes-langchain.chatTrigger', 'trigger', 40, 60, {
        resume: 'Déclencheur de chat n8n, exposé en « public ». N\'importe qui avec le lien peut écrire au bot.',
        fields: [['typeVersion', '1.1'], ['public', 'true'], ['URL du webhook', 'masquée (identifiant interne)']]
      }),
      node('State Machine', 'n8n-nodes-base.code', 'code', 320, 60, {
        resume: 'Un seul nœud de code (545 lignes réelles) qui fait tout : détection de langue, menu, inscription, connexion, mise à jour du profil, envoi de la newsletter sur demande, suppression RGPD, avis. Lit/écrit MongoDB.',
        fields: [['typeVersion', '2'], ['mode', 'runOnceForAllItems (défaut)'], ['états internes', '13 (voir ci-dessous)']],
        code: "const { MongoClient } = require('mongodb');\nconst crypto = require('crypto');\n…\nfunction detectLanguage(text) { /* 6 langues, par mots-clés */ }\n\nconst sessionId = $json.sessionId || 'default';\nconst input = ($json.chatInput || '').trim();\n…\nswitch (session.state) {\n  case 'menu': /* … */\n  case 'reg_username': /* … */\n  // … 13 états en tout\n}"
      })
    ],
    edges: [
      { from: 'Chat Trigger', to: 'State Machine' }
    ]
  };

  /* ───────────────────────── Newsletter ─────────────────────────
     20 nœuds, 3 points d'entrée réels (deux planificateurs + deux webhooks),
     qui convergent sur la même chaîne de traitement. */
  var newsletter = {
    title: 'Persona - Newsletter',
    width: 1540, height: 620,
    nodes: [
      // lane 1 : pré-chargement (cache), toutes les 15 min
      node('Pre-fetch Scheduler', 'n8n-nodes-base.scheduleTrigger', 'trigger', 20, 40, {
        resume: 'Planificateur : se déclenche toutes les 15 minutes.',
        fields: [['rule.interval', 'minutes = 15']]
      }),
      node('Pre-fetch: Load Users & News', 'n8n-nodes-base.code', 'code', 240, 40, {
        resume: 'Cherche les utilisateurs dont l\'heure d\'envoi arrive dans 30 min (±7), va chercher 4 flux RSS (BBC, Reuters, Hacker News, Reddit WorldNews), déduplique et marque les articles recoupés par 2 sources indépendantes.',
        fields: [['mode', 'runOnceForAllItems'], ['fenêtre', '30 min avant l\'heure choisie, ± 7 min']]
      }),
      node('Pre-fetch: Filter Skip', 'n8n-nodes-base.code', 'code', 460, 40, {
        resume: 'Coupe la branche si aucun utilisateur n\'est éligible (champ skip:true).',
        fields: [['mode', 'runOnceForEachItem']],
        code: "if ($json.skip === true) return null;\nreturn $input.item;"
      }),
      node('Pre-fetch: Generate Newsletter', '@n8n/n8n-nodes-langchain.chainLlm', 'llm', 680, 40, {
        resume: 'Demande au modèle Gemini d\'écrire la newsletter HTML, à l\'avance, pour la mettre en cache.',
        fields: [['promptType', 'define'], ['modèle', 'models/gemini-2.5-flash (via le nœud ci-dessous)']],
        prompt: true, promptKey: 'prefetch'
      }),
      node('Pre-fetch: Save to Cache', 'n8n-nodes-base.code', 'code', 900, 40, {
        resume: 'Enregistre le HTML généré dans la collection "newsletterCache" (clé : utilisateur + date du jour).',
        fields: [['mode', 'runOnceForEachItem']]
      }),
      node('Google Gemini Chat Model', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 'lm', 680, 150, {
        resume: 'Modèle de langage branché au nœud LLM du pré-chargement.',
        fields: [['modelName', 'models/gemini-2.5-flash'], ['identifiant', 'Google Gemini (PaLM) API — connecté, masqué']]
      }),

      // lane 2 : envoi (déclenché par le temps ou par le chatbot)
      node('Every Minutes', 'n8n-nodes-base.scheduleTrigger', 'trigger', 20, 280, {
        resume: 'Planificateur : vérifie chaque minute si un envoi est dû (fenêtre ± 15 min autour de l\'heure choisie).',
        fields: [['rule.interval', 'minutes = 1']]
      }),
      node('Webhook: Send Now', 'n8n-nodes-base.webhook', 'webhook', 20, 390, {
        resume: 'Appelé par le chatbot (option 7, « Envoyer la newsletter maintenant »). Deux sorties : un accusé immédiat, et le vrai traitement.',
        fields: [['méthode', 'POST'], ['chemin', '/webhook/persona-newsletter']]
      }),
      node('Respond: Queued', 'n8n-nodes-base.respondToWebhook', 'respond', 240, 390, {
        resume: 'Répond tout de suite « Newsletter queued. » au chatbot, sans attendre la fin du traitement.',
        fields: [['respondWith', 'text'], ['responseBody', 'Newsletter queued.']]
      }),
      node('Load Users & Fetch News', 'n8n-nodes-base.code', 'code', 460, 280, {
        resume: 'Même logique que la version « pré-chargement », mais pour l\'envoi réel : fenêtre ± 15 min (ou utilisateur visé, si appel du chatbot), limite anti-abus (10 s entre deux déclenchements du même utilisateur), réutilise le cache si disponible.',
        fields: [['mode', 'runOnceForAllItems'], ['limite anti-abus', '10 s entre deux appels du même utilisateur']]
      }),
      node('Filter Skip', 'n8n-nodes-base.code', 'code', 680, 280, {
        resume: 'Coupe la branche si personne n\'est éligible.',
        fields: [['mode', 'runOnceForEachItem']],
        code: "if ($json.skip === true) return null;\nreturn $input.item;"
      }),
      node('Generate Newsletter', '@n8n/n8n-nodes-langchain.chainLlm', 'llm', 900, 280, {
        resume: 'Demande au modèle d\'écrire la newsletter, avec les préférences de style (ton, longueur, mise en forme) et l\'avis laissé après la dernière newsletter.',
        fields: [['promptType', 'define'], ['modèle', 'models/gemini-2.5-flash (via le nœud ci-dessous)']],
        prompt: true, promptKey: 'generate'
      }),
      node('Google Gemini Chat Model1', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 'lm', 900, 400, {
        resume: 'Modèle de langage branché au nœud LLM de l\'envoi réel.',
        fields: [['modelName', 'models/gemini-2.5-flash'], ['identifiant', 'Google Gemini (PaLM) API — connecté, masqué']]
      }),
      node('Fallback & Inject', 'n8n-nodes-base.code', 'code', 1120, 280, {
        resume: 'Si le cache a déjà la newsletter, la réutilise. Sinon, vérifie la réponse du modèle (au moins 100 caractères, du vrai HTML) ; si elle est invalide, construit une newsletter de secours sans IA à partir des articles bruts.',
        fields: [['mode', 'runOnceForEachItem'], ['secours', 'modèle de secours sans IA si la réponse est vide ou invalide']]
      }),
      node('Send a message', 'n8n-nodes-base.gmail', 'gmail', 1340, 200, {
        resume: 'Envoie la newsletter par Gmail (OAuth2) à l\'adresse de l\'utilisateur.',
        fields: [['sendTo', "={{ $('Load Users & Fetch News').item.json.email }}"], ['subject', '=Your Persona Newsletter – {{ …date }}'], ['identifiant', 'Gmail — connecté, masqué']]
      }),
      node('Update lastSentAt', 'n8n-nodes-base.code', 'code', 1340, 320, {
        resume: 'Marque l\'utilisateur comme « envoyé aujourd\'hui » pour ne pas lui renvoyer la newsletter deux fois.',
        fields: [['mode', 'runOnceForEachItem']]
      }),

      // lane 3 : désinscription
      node('Webhook: Unsubscribe', 'n8n-nodes-base.webhook', 'webhook', 20, 520, {
        resume: 'Lien « Se désinscrire » présent au bas de chaque newsletter. Le jeton est le nom d\'utilisateur encodé en base64 (pas un vrai secret).',
        fields: [['chemin', '/webhook/persona-newsletter/unsubscribe']]
      }),
      node('Handle Unsubscribe', 'n8n-nodes-base.code', 'code', 240, 520, {
        resume: 'Décode le jeton, marque l\'utilisateur « désinscrit » (il garde son compte : seul l\'envoi s\'arrête).',
        fields: [['mode', 'runOnceForEachItem']]
      }),
      node('Respond: Unsubscribe Page', 'n8n-nodes-base.respondToWebhook', 'respond', 460, 520, {
        resume: 'Renvoie une petite page HTML de confirmation.',
        fields: [['respondWith', 'text (HTML)'], ['Content-Type', 'text/html; charset=utf-8']]
      }),

      // nœud orphelin : laissé de côté dans le vrai fichier
      node('Send Email1', 'n8n-nodes-base.emailSend', 'orphan', 1340, 520, {
        resume: 'Nœud SMTP laissé dans le fichier mais débranché : remplacé par le nœud Gmail « Send a message » lors d\'une correction (commit « update newsletter workflow with Gmail node and SMTP fixes »). Je le montre tel quel : c\'est un vrai reste de l\'historique du projet.',
        fields: [['toEmail', "={{ $('Load Users & Fetch News').item.json.email }}"], ['identifiant', 'SMTP — connecté, masqué, inutilisé']],
        disabled: true
      })
    ],
    edges: [
      { from: 'Pre-fetch Scheduler', to: 'Pre-fetch: Load Users & News' },
      { from: 'Pre-fetch: Load Users & News', to: 'Pre-fetch: Filter Skip' },
      { from: 'Pre-fetch: Filter Skip', to: 'Pre-fetch: Generate Newsletter' },
      { from: 'Pre-fetch: Generate Newsletter', to: 'Pre-fetch: Save to Cache' },
      { from: 'Google Gemini Chat Model', to: 'Pre-fetch: Generate Newsletter', via: 'ai_languageModel' },

      { from: 'Every Minutes', to: 'Load Users & Fetch News' },
      { from: 'Webhook: Send Now', to: 'Respond: Queued' },
      { from: 'Webhook: Send Now', to: 'Load Users & Fetch News' },
      { from: 'Load Users & Fetch News', to: 'Filter Skip' },
      { from: 'Filter Skip', to: 'Generate Newsletter' },
      { from: 'Generate Newsletter', to: 'Fallback & Inject' },
      { from: 'Google Gemini Chat Model1', to: 'Generate Newsletter', via: 'ai_languageModel' },
      { from: 'Fallback & Inject', to: 'Send a message' },
      { from: 'Send a message', to: 'Update lastSentAt' },

      { from: 'Webhook: Unsubscribe', to: 'Handle Unsubscribe' },
      { from: 'Handle Unsubscribe', to: 'Respond: Unsubscribe Page' }
    ]
  };

  /* ───────────────────────── Automate interne du chatbot ─────────────────────────
     Déduit du switch(session.state) réel du nœud "State Machine" (13 états). */
  var automaton = {
    states: ['menu', 'reg_username', 'reg_password', 'reg_email', 'reg_interests', 'reg_schedule',
      'login_username', 'login_password', 'update_interests', 'update_email', 'update_schedule',
      'delete_confirm', 'feedback'],
    labels: {
      menu: 'menu', reg_username: 'nom d\'utilisateur', reg_password: 'mot de passe', reg_email: 'e-mail',
      reg_interests: 'intérêts', reg_schedule: 'horaire', login_username: 'connexion : nom', login_password: 'connexion : mdp',
      update_interests: 'maj intérêts', update_email: 'maj e-mail', update_schedule: 'maj horaire',
      delete_confirm: 'suppression RGPD', feedback: 'avis'
    },
    transitions: [
      ['menu', '1', 'inscription (option 1)', 'reg_username'],
      ['menu', '2', 'connexion (option 2)', 'login_username'],
      ['menu', '3–9, non connecté', 'redirigé vers la connexion', 'login_username'],
      ['menu', '3, connecté', 'affiche le profil', 'menu'],
      ['menu', '4, connecté', 'modifier les intérêts', 'update_interests'],
      ['menu', '5, connecté', 'modifier l\'e-mail', 'update_email'],
      ['menu', '6, connecté', 'modifier l\'horaire', 'update_schedule'],
      ['menu', '7, connecté', 'envoie la newsletter → workflow Newsletter', 'menu'],
      ['menu', '8, connecté', 'demande confirmation', 'delete_confirm'],
      ['menu', '9, connecté', 'demande un avis', 'feedback'],
      ['menu', '0, connecté', 'déconnexion', 'menu'],
      ['reg_username', 'valide et libre', 'nom accepté', 'reg_password'],
      ['reg_username', 'invalide ou déjà pris', 'redemande', 'reg_username'],
      ['reg_password', '≥ 6 caractères', 'mot de passe accepté', 'reg_email'],
      ['reg_password', 'trop court', 'redemande', 'reg_password'],
      ['reg_email', 'adresse valide', 'e-mail accepté', 'reg_interests'],
      ['reg_email', 'invalide', 'redemande', 'reg_email'],
      ['reg_interests', 'non vide', 'intérêts enregistrés', 'reg_schedule'],
      ['reg_interests', 'vide', 'redemande', 'reg_interests'],
      ['reg_schedule', 'HH:MM valide', 'compte créé, connecté', 'menu'],
      ['reg_schedule', 'invalide', 'redemande', 'reg_schedule'],
      ['login_username', 'format valide', 'nom accepté', 'login_password'],
      ['login_username', 'invalide', 'redemande', 'login_username'],
      ['login_password', 'bon mot de passe', 'connecté (ou action demandée)', 'menu'],
      ['login_password', 'mauvais, < 5 essais', 'redemande', 'login_password'],
      ['login_password', '5ᵉ échec', 'compte bloqué', 'menu'],
      ['login_password', 'utilisateur introuvable', 'redemande le nom', 'login_username'],
      ['update_interests', 'non vide', 'intérêts mis à jour', 'menu'],
      ['update_interests', 'vide', 'redemande', 'update_interests'],
      ['update_email', 'valide', 'e-mail mis à jour', 'menu'],
      ['update_email', 'invalide', 'redemande', 'update_email'],
      ['update_schedule', 'valide', 'horaire mis à jour', 'menu'],
      ['update_schedule', 'invalide', 'redemande', 'update_schedule'],
      ['delete_confirm', 'mot-clé exact', 'compte supprimé (RGPD art. 17)', 'menu'],
      ['delete_confirm', 'autre texte', 'annulé', 'menu'],
      ['feedback', 'non vide', 'avis enregistré', 'menu'],
      ['feedback', 'vide', 'redemande', 'feedback']
    ]
  };

  /* Prompts réels envoyés au modèle (texte copié du champ "text" des nœuds,
     avec les expressions n8n {{ … }} laissées visibles telles qu'écrites). */
  var PROMPTS = {
    generate:
"=You are a professional newsletter editor. Write a personalized HTML email newsletter.\n\n" +
"User interests: {{ $json.user.interests.length > 0 ? $json.user.interests.join(', ') : 'general world news' }}\n" +
"Date: {{ $json.date }}\n" +
"Unsubscribe link: {{ $json.unsubUrl }}\n\n" +
"## USER STYLE PREFERENCES\n" +
"{{ (function() {\n" +
"  const s = $json.user.style || {};\n" +
"  const toneMap = { formal: 'professional and objective tone, no contractions, structured sentences', casual: 'friendly and conversational tone, use contractions, speak directly to the reader', playful: 'fun and energetic tone, use emojis sparingly, light humor welcome' };\n" +
"  const lengthMap = { short: '3 articles maximum', medium: '5 to 7 articles', long: '10 or more articles' };\n" +
"  const formatMap = { standard: 'each article: bold linked title + 2-3 sentence paragraph summary', bullets: 'each article: bold linked title + 3-5 bullet points highlighting key facts', detailed: 'each article: bold linked title + in-depth 4-6 sentence analysis with context' };\n" +
"  const tone = toneMap[s.tone] || toneMap.casual;\n" +
"  const length = lengthMap[s.length] || lengthMap.medium;\n" +
"  const format = formatMap[s.format] || formatMap.standard;\n" +
"  return `- Tone: ${tone}\\n- Number of articles: ${length}\\n- Article format: ${format}`;\n" +
"})() }}\n\n" +
"{{ $json.user.lastFeedback ? '## USER FEEDBACK FROM LAST NEWSLETTER (apply this)\\n' + $json.user.lastFeedback + '\\n' : '' }}\n" +
"Available articles (ranked by relevance to user interests):\n" +
"{{ $json.articles.map((a, i) => `${i+1}. [${a.source}]${a.verified ? ' ✓VERIFIED' : ''} ${a.title}\\n   URL: ${a.link}\\n   Summary: ${a.description}`).join('\\n\\n') }}\n\n" +
"Instructions:\n" +
"1. Select articles according to the length preference above\n" +
"2. Prefer ✓VERIFIED articles (corroborated by multiple independent sources) — mention \"Verified by multiple sources\" as a small note next to them\n" +
"3. Write summaries according to the format preference above\n" +
"4. Apply the tone preference throughout the entire newsletter\n" +
"5. If user feedback is provided above, strictly follow it (avoid mentioned sources, adjust topics, etc.)\n" +
"6. Return ONLY valid raw HTML starting with a <div> — no markdown, no code fences\n" +
"7. Structure:\n" +
"   - Header: \"Persona Newsletter\" title with date, dark top border\n" +
"   - Intro: one welcoming sentence mentioning their interests (in their preferred tone)\n" +
"   - Each article: bold linked title, colored source badge, your summary\n" +
"   - Footer: unsubscribe link using the exact URL provided above, text \"Unsubscribe\"\n" +
"8. Use inline CSS — clean, professional, mobile-responsive\n" +
"9. Do NOT include <html>, <head>, or <body> wrapper tags",
    prefetch:
"=You are a professional newsletter editor. Write a personalized HTML email newsletter.\n\n" +
"User interests: {{ $json.user.interests.length > 0 ? $json.user.interests.join(', ') : 'general world news' }}\n" +
"Date: {{ $json.date }}\n" +
"Unsubscribe link: http://localhost:5678/webhook/persona-newsletter/unsubscribe?token={{ Buffer.from($json.user.username).toString('base64') }}\n\n" +
"## USER STYLE PREFERENCES\n" +
"{{ (function() { const s = $json.user.style || {}; const toneMap = { formal: 'professional and objective tone', casual: 'friendly and conversational tone', playful: 'fun and energetic tone' }; const lengthMap = { short: '3 articles maximum', medium: '5 to 7 articles', long: '10 or more articles' }; const formatMap = { standard: 'title + 2-3 sentence summary', bullets: 'title + 3-5 bullet points', detailed: 'title + 4-6 sentence analysis' }; return `- Tone: ${toneMap[s.tone]||toneMap.casual}\\n- Length: ${lengthMap[s.length]||lengthMap.medium}\\n- Format: ${formatMap[s.format]||formatMap.standard}`; })() }}\n\n" +
"{{ $json.user.lastFeedback ? '## USER FEEDBACK\\n' + $json.user.lastFeedback + '\\n' : '' }}\n" +
"Available articles:\n" +
"{{ $json.articles.map((a,i) => `${i+1}. [${a.source}]${a.verified?' ✓VERIFIED':''} ${a.title}\\n   URL: ${a.link}\\n   Summary: ${a.description}`).join('\\n\\n') }}\n\n" +
"Return ONLY valid raw HTML starting with a <div>. No markdown, no code fences. Include an unsubscribe link in the footer."
  };

  root.PersonaWorkflows = { chatbot: chatbot, newsletter: newsletter, automaton: automaton, PROMPTS: PROMPTS };
})(window);
