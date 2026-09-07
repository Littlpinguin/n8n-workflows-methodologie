# Discord Growth Agent — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer un agent conversationnel Discord connecté au pipeline AI CRM de l'Agence, capable de consulter/créer/enrichir des données CRM et de piloter les workflows de prospection via DM en langage naturel.

**Architecture:** 1 workflow n8n orchestrateur avec AI Agent LangChain (Gemini 2.5 Flash) + 11 sub-workflows outils. Mémoire de conversation dans Notion (children blocks). Les workflows de production existants (Phases 1-9) sont réutilisés via des wrappers.

**Tech Stack:** n8n (workflows + AI Agent LangChain), Gemini 2.5 Flash, Discord API, Notion API, Brevo API, Apollo API, Jina (scraping)

**Spec:** `docs/specs/2026-03-25-discord-growth-agent-design.md`

---

## Prérequis (manuels, avant toute implémentation)

- [ ] Créer l'application Discord sur le Developer Portal
- [ ] Créer le bot, récupérer le token
- [ ] Activer le privileged intent "Message Content"
- [ ] Inviter le bot sur le serveur Discord partagé Alex/Sam
- [ ] Configurer le credential Discord dans n8n avec le token
- [ ] Noter les Discord User IDs d'Alex et Sam
- [ ] Créer la base Notion "Conversations Agent" avec les propriétés :
  - Session ID (title)
  - User (select: alex / yacine)
  - Discord User ID (rich_text)
  - Discord Channel ID (rich_text)
  - Statut (select: active / archivée)
  - Action en attente (rich_text)
- [ ] Noter l'ID de la base Conversations Agent

---

## Chunk 1 — Socle : orchestrateur + 3 outils lecture

### Task 1 : Créer le workflow orchestrateur Discord Growth Agent

**Workflow n8n :** `Discord Growth Agent` (nouveau)

- [ ] **Step 1 : Créer le workflow vide via MCP**

```
n8n_create_workflow:
  name: "Discord Growth Agent"
  nodes: [Sticky Note avec description du workflow]
  settings: { timezone: "Europe/Paris", errorWorkflow: "N8N_RESOURCE_ID_26" }
```

- [ ] **Step 2 : Ajouter le Discord Trigger (DM)**

Node `n8n-nodes-base.discordTrigger` :
- Event: `messageCreate`
- Credential: Discord Bot (configuré en prérequis)
- Options: filtrer les DMs uniquement

- [ ] **Step 3 : Ajouter le Code node "Identifier utilisateur + whitelist"**

```javascript
const message = $json;
const userId = message.author?.id || '';
const username = message.author?.username || '';
const channelId = message.channelId || '';
const content = message.content || '';

// Whitelist (IDs Discord d'Alex et Sam)
const ALLOWED_USERS = {
  'JESSY_DISCORD_ID': 'alex',
  'YACINE_DISCORD_ID': 'yacine'
};

if (!ALLOWED_USERS[userId]) return []; // Ignorer silencieusement

// Rate limiting : max 30 messages/heure par utilisateur (anti-boucle)
const RATE_LIMIT = 30;
const rateCacheKey = 'discord_rate_' + userId;
const now = Date.now();
const rateData = $getWorkflowStaticData('global');
if (!rateData[rateCacheKey]) rateData[rateCacheKey] = [];
// Purger les entrées > 1h
rateData[rateCacheKey] = rateData[rateCacheKey].filter(ts => (now - ts) < 3600000);
if (rateData[rateCacheKey].length >= RATE_LIMIT) {
  return [{ json: { rate_limited: true, channel_id: channelId, agent_response: "Tu as atteint la limite de 30 messages/heure. Réessaie dans quelques minutes." } }];
}
rateData[rateCacheKey].push(now);

return [{
  json: {
    user_id: userId,
    user_name: ALLOWED_USERS[userId],
    channel_id: channelId,
    message: content,
    timestamp: new Date().toISOString()
  }
}];
```

- [ ] **Step 4 : Ajouter le Code node "Charger session Notion"**

Ce node :
1. Query la base Conversations Agent : filtre channel_id + statut=active
2. Vérifie si la session est expirée (> 2h depuis last_edited)
3. Si active : charge les children blocks (messages historique)
4. Si expirée ou inexistante : crée une nouvelle page
5. Vérifie si "Action en attente" est remplie

```javascript
const p = $json;
const CONV_DB_ID = 'ID_BASE_CONVERSATIONS'; // À remplacer
// Accéder au token Notion via variable d'environnement n8n
const NOTION_TOKEN = 'Bearer ' + $env.NOTION_TOKEN;
const TWO_HOURS = 2 * 60 * 60 * 1000;

// 1. Chercher session active
const searchResp = await fetch('https://api.notion.com/v1/databases/' + CONV_DB_ID + '/query', {
  method: 'POST',
  headers: {
    'Authorization': NOTION_TOKEN,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    filter: {
      and: [
        { property: 'Discord Channel ID', rich_text: { equals: p.channel_id } },
        { property: 'Statut', select: { equals: 'active' } }
      ]
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 1
  })
});
const searchData = await searchResp.json();
const existingSession = searchData.results?.[0];

let sessionPageId = null;
let conversationHistory = '';
let pendingAction = null;

if (existingSession) {
  const lastEdited = new Date(existingSession.last_edited_time).getTime();
  const isExpired = (Date.now() - lastEdited) > TWO_HOURS;

  if (!isExpired) {
    sessionPageId = existingSession.id;

    // Charger les children blocks (historique)
    const blocksResp = await fetch('https://api.notion.com/v1/blocks/' + sessionPageId + '/children?page_size=50', {
      headers: { 'Authorization': NOTION_TOKEN, 'Notion-Version': '2022-06-28' }
    });
    const blocksData = await blocksResp.json();
    const messages = (blocksData.results || [])
      .filter(b => b.type === 'paragraph')
      .map(b => (b.paragraph?.rich_text || []).map(t => t.plain_text).join(''))
      .filter(t => t.length > 0);

    // Garder les 20 derniers (2 premiers + 18 derniers si > 20)
    if (messages.length > 20) {
      conversationHistory = [...messages.slice(0, 2), ...messages.slice(-18)].join('\n');
    } else {
      conversationHistory = messages.join('\n');
    }

    // Vérifier action en attente
    const actionText = (existingSession.properties['Action en attente']?.rich_text || [])
      .map(t => t.plain_text).join('');
    if (actionText) {
      try { pendingAction = JSON.parse(actionText); } catch(e) {}
      // Vérifier timeout 5 min
      if (pendingAction?.timestamp) {
        const actionAge = Date.now() - new Date(pendingAction.timestamp).getTime();
        if (actionAge > 5 * 60 * 1000) pendingAction = null; // Expiré
      }
      // Vérifier que c'est le bon user
      if (pendingAction && pendingAction.user_id !== p.user_id) pendingAction = null;
    }
  } else {
    // Archiver l'ancienne session
    await fetch('https://api.notion.com/v1/pages/' + existingSession.id, {
      method: 'PATCH',
      headers: { 'Authorization': NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { 'Statut': { select: { name: 'archivée' } } } })
    });
  }
}

// Créer nouvelle session si nécessaire
if (!sessionPageId) {
  const createResp = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { 'Authorization': NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent: { database_id: CONV_DB_ID },
      properties: {
        'Session ID': { title: [{ text: { content: p.channel_id + '_' + Date.now() } }] },
        'User': { select: { name: p.user_name } },
        'Discord User ID': { rich_text: [{ text: { content: p.user_id } }] },
        'Discord Channel ID': { rich_text: [{ text: { content: p.channel_id } }] },
        'Statut': { select: { name: 'active' } }
      }
    })
  });
  const created = await createResp.json();
  sessionPageId = created.id;
}

return [{
  json: {
    ...p,
    session_page_id: sessionPageId,
    conversation_history: conversationHistory,
    pending_action: pendingAction
  }
}];
```

- [ ] **Step 5 : Ajouter le Code node "Gérer confirmation"**

```javascript
const p = $json;
const pending = p.pending_action;
const msg = p.message.toLowerCase().trim();

if (!pending) {
  // Pas d'action en attente → passer au traitement normal
  return [{ json: { ...p, route: 'agent', confirmation_result: null } }];
}

const positives = ['oui', 'ok', 'go', 'yes', 'valide', 'confirme', 'allez', 'c\'est bon', 'envoie', 'lance'];
const negatives = ['non', 'annule', 'stop', 'cancel', 'pas maintenant', 'attends'];

const isPositive = positives.some(w => msg.includes(w));
const isNegative = negatives.some(w => msg.includes(w));

if (isPositive) {
  return [{ json: { ...p, route: 'execute_pending', confirmation_result: pending } }];
} else if (isNegative) {
  // Annuler → vider action en attente dans Notion
  return [{ json: { ...p, route: 'agent', confirmation_result: null, cancel_pending: true } }];
} else {
  // Question de clarification → injecter le contexte pendante dans le prompt
  return [{ json: { ...p, route: 'agent', confirmation_result: null, pending_context: pending } }];
}
```

- [ ] **Step 6 : Ajouter le node AI Agent (Gemini 2.5 Flash, LangChain)**

Node `@n8n/n8n-nodes-langchain.agent` :
- Chat Model : `@n8n/n8n-nodes-langchain.lmChatGoogleGemini` (model: `gemini-2.5-flash`)
- **Pas de memoryBufferWindow** — la mémoire est gérée via l'historique Notion injecté dans le system prompt via `{conversation_history}` (le buffer window se réinitialise à chaque exécution webhook, donc inutile)
- System prompt : voir spec section 8 (avec placeholders {user_name}, {conversation_history})
- Tools : à ajouter dans les tasks suivantes

- [ ] **Step 6b : Ajouter le Switch "Route confirmation" après "Gérer confirmation"**

Node `n8n-nodes-base.switch` avec 3 routes basées sur `{{ $json.route }}` :
- `execute_pending` → Code node "Exécuter action confirmée"
- `agent` → AI Agent
- (default) → AI Agent

- [ ] **Step 6c : Ajouter le Code node "Exécuter action confirmée"**

Quand l'utilisateur confirme une action pendante, ce node appelle le sub-workflow correspondant via Execute Sub-workflow dynamique :

```javascript
const p = $json;
const action = p.confirmation_result;

// Mapper l'action vers le workflow ID
const TOOL_WORKFLOWS = {
  'source_apollo': 'ID_WF_SOURCE_APOLLO',
  'generate_emails': 'ID_WF_GENERATE_EMAILS',
  'push_lemlist': 'ID_WF_PUSH_LEMLIST',
  'enrich_prospect': 'ID_WF_ENRICH_PROSPECT'
};

const workflowId = TOOL_WORKFLOWS[action.action];
if (!workflowId) {
  return [{ json: { ...p, agent_response: "Action inconnue : " + action.action } }];
}

// Retourner les params pour l'Execute Sub-workflow qui suit
return [{ json: { ...p, execute_workflow_id: workflowId, execute_params: action.params } }];
```

Suivi d'un node `Execute Sub-workflow` (dynamique) qui utilise `{{ $json.execute_workflow_id }}` comme workflow ID et passe `execute_params` en input. La sortie rejoint le node "Sauvegarder échange".

- [ ] **Step 6d : Ajouter la logique d'écriture de l'action pendante dans Notion**

Après la réponse de l'AI Agent, un Code node "Détecter et sauver confirmation" inspecte la réponse :

```javascript
const p = $json;
const response = p.agent_response || '';

// Détecter si l'agent demande une confirmation (pattern dans le system prompt)
const confirmationPattern = /confirme[rz]?\s*(cette action|l'envoi|le sourcing|la génération|le push)/i;
const hasConfirmation = confirmationPattern.test(response);

if (hasConfirmation) {
  // Extraire l'action et les params depuis le contexte du tool call
  const lastToolCall = p.toolCalls?.[p.toolCalls.length - 1];
  if (lastToolCall) {
    const pendingData = {
      action: lastToolCall.toolName,
      params: lastToolCall.params,
      user_id: p.user_id,
      timestamp: new Date().toISOString()
    };
    // Écrire dans Notion "Action en attente"
    await fetch('https://api.notion.com/v1/pages/' + p.session_page_id, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + $env.NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          'Action en attente': { rich_text: [{ text: { content: JSON.stringify(pendingData) } }] }
        }
      })
    });
  }
}

return [{ json: p }];
```

- [ ] **Step 7 : Ajouter le Code node "Sauvegarder échange Notion"**

```javascript
const p = $json;
const NOTION_TOKEN = 'Bearer ' + $env.NOTION_TOKEN;

// Append 2 blocks : user message + assistant response
const blocks = [
  {
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: ('user [' + p.user_name + ']: ' + p.message).substring(0, 2000) } }] }
  },
  {
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: ('assistant: ' + (p.agent_response || '')).substring(0, 2000) } }] }
  }
];

await fetch('https://api.notion.com/v1/blocks/' + p.session_page_id + '/children', {
  method: 'PATCH',
  headers: { 'Authorization': NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  body: JSON.stringify({ children: blocks })
});

// Si cancel_pending, vider le champ Action en attente
if (p.cancel_pending) {
  await fetch('https://api.notion.com/v1/pages/' + p.session_page_id, {
    method: 'PATCH',
    headers: { 'Authorization': NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { 'Action en attente': { rich_text: [] } } })
  });
}

return [{ json: p }];
```

- [ ] **Step 8 : Ajouter le node Discord Send (réponse)**

Node `n8n-nodes-base.discord` :
- Action: Send Message
- Channel ID: `{{ $json.channel_id }}`
- Content: `{{ $json.agent_response }}`

- [ ] **Step 9 : Connecter tous les nodes**

```
Discord Trigger → Identifier utilisateur → Charger session →
Gérer confirmation → Switch "Route confirmation"
  ├─ route=execute_pending → Exécuter action confirmée → Execute Sub-workflow (dynamique) ─┐
  └─ route=agent ──────────→ AI Agent → Détecter et sauver confirmation ──────────────────┤
                                                                                           ↓
                                                                              Sauvegarder échange → Discord Send
```

Note : si `rate_limited` est true (Step 3), router directement vers Discord Send (bypass tout le reste).

- [ ] **Step 10 : Tester le socle**

Envoyer un DM au bot depuis Discord. Vérifier :
- Le bot répond (même sans outils, il doit pouvoir discuter)
- La session est créée dans Notion
- Les messages sont sauvegardés en children blocks
- Un message d'un user non-whitelisté est ignoré

- [ ] **Step 11 : Commit**

```bash
git add -A && git commit -m "feat: Discord Growth Agent - socle orchestrateur (Task 1)"
```

---

### Task 2 : Sub-workflow `query_notion`

**Workflow n8n :** `Agent Tool - Query Notion` (nouveau)

- [ ] **Step 1 : Créer le sub-workflow via MCP**

Nodes :
1. `Execute Workflow Trigger` (input: database_name, filter_type, filter_value)
2. `Code` — Router : mapper database_name → database_id + construire le filtre Notion
3. `HTTP Request` — POST Notion /databases/{id}/query
4. `Code` — Formatter : extraire les propriétés pertinentes selon la base
5. Return résultat formaté

- [ ] **Step 2 : Implémenter le Code node "Router"**

```javascript
const input = $json;
const DB_MAP = {
  'prospects': 'NOTION_ID_12',
  'offres': 'NOTION_ID_09',
  'personas': 'NOTION_ID_15',
  'sequences': 'NOTION_ID_10',
  'signaux': 'NOTION_ID_14',
  'deals': 'NOTION_ID_13',
  'stats': 'NOTION_ID_11'
};

const dbId = DB_MAP[input.database_name] || DB_MAP['prospects'];

// Templates de filtres pré-construits
let filter = {};
let sorts = [];
const ft = input.filter_type || 'all_active';
const fv = input.filter_value || '';

switch (ft) {
  case 'by_status':
    filter = { property: 'Statut pipeline', select: { equals: fv } };
    break;
  case 'by_score_above':
    filter = { property: 'Score IA', number: { greater_than: parseInt(fv) || 0 } };
    sorts = [{ property: 'Score IA', direction: 'descending' }];
    break;
  case 'by_offre':
    // Recherche par nom dans les offres, pas applicable en filtre direct
    // Fallback: fetch all + filter in memory
    filter = {};
    break;
  case 'by_name':
    filter = { property: 'Nom complet', title: { contains: fv } };
    break;
  case 'by_etape':
    filter = { property: '\u00c9tape', select: { equals: fv } };
    break;
  case 'all_active':
    if (input.database_name === 'offres') {
      filter = { property: 'Statut', select: { equals: 'Actif' } };
    } else if (input.database_name === 'personas') {
      filter = { property: 'Statut', select: { equals: 'Actif' } };
    }
    break;
  case 'recent':
    const days = parseInt(fv) || 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    filter = { timestamp: 'last_edited_time', last_edited_time: { after: since } };
    break;
  default:
    filter = {};
}

return [{
  json: {
    db_id: dbId,
    database_name: input.database_name,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    sorts: sorts.length > 0 ? sorts : undefined,
    filter_value: fv
  }
}];
```

- [ ] **Step 3 : Implémenter le Code node "Formatter"**

```javascript
const results = $json.results || [];
const dbName = $('Router').first().json.database_name;
if (results.length === 0) return [{ json: { formatted: 'Aucun résultat trouvé.' } }];

const getTitle = (p) => (p?.title || []).map(t => t.plain_text).join('');
const getText = (p) => (p?.rich_text || []).map(t => t.plain_text).join('');
const getSelect = (p) => p?.select?.name || '';
const getNumber = (p) => p?.number;

let lines = [];

if (dbName === 'prospects') {
  lines = results.slice(0, 15).map(r => {
    const p = r.properties;
    const score = getNumber(p['Score IA']) || '?';
    const nom = getTitle(p['Nom complet']);
    const entreprise = getText(p['Entreprise']);
    const poste = getText(p['Poste actuel']);
    const statut = getSelect(p['Statut pipeline']);
    return score + ' - ' + nom + ', ' + poste + ', ' + entreprise + ' [' + statut + ']';
  });
} else if (dbName === 'offres') {
  lines = results.slice(0, 10).map(r => {
    const p = r.properties;
    return getTitle(p['Nom offre']) + ' (' + getSelect(p['Statut']) + ') - ' + getText(p['Proposition de valeur']).substring(0, 80);
  });
} else if (dbName === 'deals') {
  lines = results.slice(0, 10).map(r => {
    const p = r.properties;
    const montant = getNumber(p['Montant estimé']) || '?';
    return getTitle(p['Nom deal']) + ' - ' + getSelect(p['\u00c9tape']) + ' - ' + montant + '\u20ac';
  });
} else {
  // Fallback générique
  lines = results.slice(0, 10).map(r => {
    const title = Object.values(r.properties).find(p => p.type === 'title');
    return getTitle(title || {}) || r.id;
  });
}

const total = results.length;
let formatted = lines.join('\n');
if (total > lines.length) formatted += '\n(' + total + ' résultats au total)';

// Tronquer pour Discord (1900 chars)
if (formatted.length > 1900) {
  formatted = formatted.substring(0, 1890) + '\n(tronqué)';
}

return [{ json: { formatted, count: total } }];
```

- [ ] **Step 4 : Connecter les nodes et tester**

Tester avec des appels manuels :
- `database_name: "prospects", filter_type: "by_score_above", filter_value: "80"`
- `database_name: "offres", filter_type: "all_active"`
- `database_name: "deals", filter_type: "by_etape", filter_value: "Négociation"`

- [ ] **Step 5 : Brancher comme outil de l'AI Agent**

Ajouter un node `@n8n/n8n-nodes-langchain.toolWorkflow` dans le workflow orchestrateur, pointant vers ce sub-workflow.

Description de l'outil pour l'agent :
```
Interroge les bases Notion du CRM.
Paramètres:
- database_name: prospects, offres, personas, sequences, signaux, deals, stats
- filter_type: by_status, by_score_above, by_offre, by_name, by_etape, all_active, recent
- filter_value: la valeur du filtre (ex: "Enrichi", "80", "7")
```

- [ ] **Step 6 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Query Notion (Task 2)"
```

---

### Task 3 : Sub-workflow `query_brevo`

**Workflow n8n :** `Agent Tool - Query Brevo` (nouveau)

- [ ] **Step 1 : Créer le sub-workflow via MCP**

Nodes :
1. `Execute Workflow Trigger` (input: query_type, filter_value)
2. `Code` — Router : construire l'URL et params Brevo selon query_type
3. `HTTP Request` — GET Brevo API (credential brevoApi)
4. `Code` — Formatter
5. Return résultat

- [ ] **Step 2 : Implémenter le Router**

```javascript
const input = $json;
const PIPELINE_ID = '67c831a51f27cfb9fc9b13d3';
const qt = input.query_type || 'pipeline_summary';
const fv = input.filter_value || '';

let url = '';
let method = 'GET';

switch (qt) {
  case 'pipeline_summary':
    url = 'https://api.brevo.com/v3/crm/pipeline/' + PIPELINE_ID;
    break;
  case 'deals_by_stage':
    url = 'https://api.brevo.com/v3/crm/deals?filters[attributes.deal_stage]=' + fv;
    break;
  case 'all_deals':
    url = 'https://api.brevo.com/v3/crm/deals?limit=50';
    break;
  case 'contact_search':
    url = 'https://api.brevo.com/v3/contacts/' + encodeURIComponent(fv);
    break;
  case 'contacts_recent':
    const days = parseInt(fv) || 7;
    const since = Math.floor((Date.now() - days * 86400000) / 1000);
    url = 'https://api.brevo.com/v3/contacts?limit=50&modifiedSince=' + since;
    break;
  default:
    url = 'https://api.brevo.com/v3/crm/deals?limit=20';
}

return [{ json: { url, method, query_type: qt } }];
```

- [ ] **Step 3 : Implémenter le Formatter**

Adapter la réponse selon le query_type (pipeline_summary → résumé, deals → liste, contact → fiche).

- [ ] **Step 4 : Brancher comme outil de l'AI Agent**

Description :
```
Interroge le CRM Brevo.
Paramètres:
- query_type: pipeline_summary, deals_by_stage, all_deals, contact_search, contacts_recent
- filter_value: ID de stage Brevo, email, ou nombre de jours
```

- [ ] **Step 5 : Tester et commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Query Brevo (Task 3)"
```

---

### Task 4 : Sub-workflow `search_web`

**Workflow n8n :** `Agent Tool - Search Web` (nouveau)

- [ ] **Step 1 : Créer le sub-workflow via MCP**

Nodes :
1. `Execute Workflow Trigger` (input: url)
2. `HTTP Request` — GET `https://r.jina.ai/{url}` (Accept: application/json, timeout: 15s, continueOnFail: true)
3. `Code` — Extraire contenu, tronquer à 4000 chars
4. Return contenu

- [ ] **Step 2 : Implémenter le Code node**

```javascript
const raw = $json;
let content = '';
if (raw && !raw.error) {
  if (raw.data?.content) content = raw.data.content;
  else if (typeof raw.data === 'string') content = raw.data;
  else if (raw.content) content = raw.content;
}
if (!content) return [{ json: { content: 'Impossible de scraper cette URL.' } }];
return [{ json: { content: content.substring(0, 4000) } }];
```

- [ ] **Step 3 : Brancher comme outil de l'AI Agent**

Description :
```
Scrape le contenu d'une URL (site web, page LinkedIn publique, article).
Paramètre: url (URL complète à scraper)
Retourne le contenu en markdown.
```

- [ ] **Step 4 : Tester et commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Search Web (Task 4)"
```

---

### Task 5 : Test end-to-end Chunk 1

- [ ] **Step 1 : Tester le flux complet via DM Discord**

Scénarios à tester :
1. "Combien de prospects scorés ?" → query_notion by_status Scoré
2. "Montre-moi les prospects avec un score > 85" → query_notion by_score_above 85
3. "Quels deals en négociation ?" → query_brevo deals_by_stage
4. "Scrape le site example.com" → search_web
5. Message d'un user non-whitelisté → ignoré
6. Vérifier que la session Notion est créée et les messages sauvegardés
7. Après 2h+ d'inactivité → nouvelle session créée

- [ ] **Step 2 : Corriger les bugs identifiés**

- [ ] **Step 3 : Commit final Chunk 1**

```bash
git add -A && git commit -m "feat: Discord Growth Agent - Chunk 1 complet (socle + 3 outils lecture)"
```

---

## Chunk 2 — Outils de création et enrichissement

### Task 6 : Sub-workflow `create_offre`

**Workflow n8n :** `Agent Tool - Create Offre` (nouveau)

- [ ] **Step 1 : Créer le sub-workflow**

Input: nom, proposition_valeur, arguments, pain_points, prix, secteurs

Nodes :
1. `Execute Workflow Trigger` (input: nom, proposition_valeur, arguments, pain_points, prix, secteurs)
2. `HTTP Request` — POST `https://api.notion.com/v1/pages` (credential: notionApi)

Body :
```json
{
  "parent": { "database_id": "NOTION_ID_09" },
  "properties": {
    "Nom offre": { "title": [{ "text": { "content": "{{ $json.nom }}" } }] },
    "Proposition de valeur": { "rich_text": [{ "text": { "content": "{{ $json.proposition_valeur }}" } }] },
    "Arguments clés": { "rich_text": [{ "text": { "content": "{{ $json.arguments }}" } }] },
    "Pain points adressés": { "multi_select": [] },
    "Prix": { "number": null },
    "Secteurs cibles": { "multi_select": [] },
    "Statut": { "select": { "name": "Actif" } }
  }
}
```
Le Code node en amont construit les `multi_select` arrays à partir de chaînes séparées par virgule et parse le prix en number.

3. `Code` — Formatter : extraire l'URL Notion et retourner confirmation
Output: `{ message: "Offre créée", url: page.url, suggested_next_action: "create_persona" }`

- [ ] **Step 2 : Brancher comme outil + tester**

Test: "Crée une offre Audit Express, proposition: diagnostic IA gratuit 30 min, prix: 0"

- [ ] **Step 3 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Create Offre (Task 6)"
```

---

### Task 7 : Sub-workflow `create_persona`

**Workflow n8n :** `Agent Tool - Create Persona` (nouveau)

- [ ] **Step 1 : Créer le sub-workflow**

Input: nom_persona, intitules_poste, secteurs, taille_min, taille_max, offre_name

Nodes :
1. `Execute Workflow Trigger` (input ci-dessus)
2. `HTTP Request` — POST Notion query Offres (chercher l'offre par nom pour obtenir son page_id)
3. `Code` — Construire le payload Notion Personas avec relation :

```javascript
const items = $input.all();
const offreResults = items[0].json.results || [];
const offreId = offreResults[0]?.id || null;
const input = $('Execute Workflow Trigger').first().json;

const payload = {
  parent: { database_id: 'NOTION_ID_15' },
  properties: {
    'Nom persona': { title: [{ text: { content: input.nom_persona } }] },
    'Intitulés de poste': { multi_select: (input.intitules_poste || '').split(',').map(s => ({ name: s.trim() })) },
    'Secteurs': { multi_select: (input.secteurs || '').split(',').map(s => ({ name: s.trim() })) },
    'Taille entreprise min': { number: parseInt(input.taille_min) || null },
    'Taille entreprise max': { number: parseInt(input.taille_max) || null },
    'Statut': { select: { name: 'Actif' } }
  }
};
if (offreId) payload.properties['Offre'] = { relation: [{ id: offreId }] };

return [{ json: payload }];
```

4. `HTTP Request` — POST `https://api.notion.com/v1/pages` avec le payload
5. `Code` — Formatter : retourner confirmation + URL + `suggested_next_action: "source_apollo"`

- [ ] **Step 2 : Brancher comme outil + tester**

Test: "Crée un persona DAF industrie pour l'offre Audit Express"

- [ ] **Step 3 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Create Persona (Task 7)"
```

---

### Task 8 : Sub-workflow `create_deal_brevo`

**Workflow n8n :** `Agent Tool - Create Deal Brevo` (nouveau)

- [ ] **Step 1 : Créer le sub-workflow**

Input: nom, email, entreprise, montant_estime, etape
Action (inspiré Phase 9 étapes 2-4):
1. POST /contacts (Brevo) — créer ou updater le contact
2. POST /companies (Brevo) — créer l'entreprise
3. POST /crm/deals (Brevo) — créer le deal avec les attributs custom
Output: confirmation + IDs Brevo

- [ ] **Step 2 : Brancher comme outil + tester**

Test: "Crée un deal pour Jean Dupont, jean@example.com, DupontSA, 5000€, qualifié"

- [ ] **Step 3 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Create Deal Brevo (Task 8)"
```

---

### Task 9 : Sub-workflow `enrich_prospect`

**Workflow n8n :** `Agent Tool - Enrich Prospect` (nouveau)

- [ ] **Step 1 : Créer le sub-workflow**

Input: linkedin_url OU email OU nom + entreprise
Action:
1. Apollo `people/match` — email, nom, entreprise → données pro complètes
2. Si site web trouvé : Jina scraping (`r.jina.ai/{site}`)
3. Upsert Notion base Prospects (statut "Enrichi")
4. Construire le résumé formaté

- [ ] **Step 2 : Gérer le warning crédits Apollo**

Dans la description de l'outil pour l'agent :
```
Enrichit un prospect via Apollo + scraping web.
Consomme 1 crédit Apollo par appel (limite 200/h).
Si l'utilisateur demande d'enrichir plus de 5 prospects,
avertis-le du coût en crédits avant de procéder.
Paramètres: linkedin_url, email, nom, entreprise (au moins 1 requis)
```

- [ ] **Step 3 : Tester avec un prospect réel**

- [ ] **Step 4 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Enrich Prospect (Task 9)"
```

---

### Task 10 : Test end-to-end Chunk 2

- [ ] **Step 1 : Tester les scénarios de création**

1. "Crée une offre Formation IA, 2000€, pour les PME industrielles"
2. "Crée un persona responsable production pour cette offre"
3. "Crée un deal Brevo pour Claire Martin, 5000€, qualifié"
4. "Enrichis ce prospect : linkedin.com/in/claire-martin-demo"
5. Vérifier dans Notion et Brevo que les données sont créées correctement

- [ ] **Step 2 : Commit final Chunk 2**

```bash
git add -A && git commit -m "feat: Discord Growth Agent - Chunk 2 complet (4 outils création)"
```

---

## Chunk 3 — Outils pipeline avec confirmation et progression

### Task 11 : Sub-workflow `score_prospects`

**Workflow n8n :** `Agent Tool - Score Prospects` (nouveau)

- [ ] **Step 1 : Créer le wrapper du Phase 3**

Input: offre_name (optionnel), max_count (optionnel), channel_id
Action:
1. Query Notion prospects avec statut "Pré-scoré" ou "Enrichi" non scorés
2. SplitInBatches — pour chaque prospect :
   - Appeler la logique de scoring (réutiliser les nodes Phase 3)
   - Tous les 5 prospects : envoyer message progression Discord via channel_id (`"⏳ Scoring en cours... X/Y"`)
3. Retourner le nombre scoré + top 5
Output: résumé formaté + `suggested_next_action: "generate_emails"`

- [ ] **Step 2 : Brancher + tester**

Description de l'outil :
```
Score les prospects enrichis/pré-scorés via le pipeline Phase 3.
Paramètres: offre_name (optionnel), max_count (optionnel, défaut 20), channel_id
Retourne le résumé et les top 5 scores.
```

- [ ] **Step 3 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Score Prospects (Task 11)"
```

---

### Task 12 : Sub-workflow `source_apollo` (avec confirmation + progression)

**Workflow n8n :** `Agent Tool - Source Apollo` (nouveau)

- [ ] **Step 1 : Créer le wrapper du Phase 2**

Input: secteur, localisation, taille, poste, nombre, channel_id
Action:
1. Construire la requête Apollo à partir des critères
2. SplitInBatches — pour chaque prospect trouvé :
   - Upsert dans Notion (statut "Brut")
   - Tous les 5 : envoyer message progression Discord via channel_id
3. Retourner résumé + top 3
Output: résumé formaté

- [ ] **Step 2 : Implémenter la progression Discord**

```javascript
// Dans le SplitInBatches, tous les 5 items :
const batchIndex = $json.batchIndex || 0;
const total = $json.totalExpected || 20;
if (batchIndex > 0 && batchIndex % 5 === 0) {
  // Envoyer message Discord
  // Node Discord Send avec channel_id
}
```

- [ ] **Step 3 : Configurer la confirmation dans l'orchestrateur**

L'agent doit demander confirmation avant d'appeler cet outil.
La description de l'outil inclut :
```
IMPORTANT: Demande TOUJOURS confirmation à l'utilisateur avant d'appeler cet outil.
Indique le nombre de prospects recherchés et les critères.
```

- [ ] **Step 4 : Tester le flux complet**

1. "Trouve-moi 10 prospects plasturgie en Vendée" → confirmation → exécution → progression → résultat
2. Vérifier les prospects dans Notion

- [ ] **Step 5 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Source Apollo avec confirmation (Task 12)"
```

---

### Task 13 : Sub-workflow `generate_emails` (avec confirmation + progression)

**Workflow n8n :** `Agent Tool - Generate Emails` (nouveau)

- [ ] **Step 1 : Créer le wrapper du Phase 4a**

Input: prospect_ids (optionnel, sinon tous les scorés), channel_id
Action:
1. Si prospect_ids fournis → filtrer, sinon query scorés/enrichis
2. Pour chaque prospect : réutiliser la logique Phase 4a (offre, Jina, Gemini, stockage Notion)
3. Tous les 3 : progression Discord
4. Résumé final
Output: nombre généré + résumé

- [ ] **Step 2 : Configurer confirmation + progression**

- [ ] **Step 3 : Tester**

- [ ] **Step 4 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Generate Emails avec confirmation (Task 13)"
```

---

### Task 14 : Sub-workflow `push_lemlist` (avec confirmation + progression)

**Workflow n8n :** `Agent Tool - Push Lemlist` (nouveau)

- [ ] **Step 1 : Créer le wrapper du Phase 4b**

Input: prospect_ids (optionnel, sinon "Messages validés" cochés), channel_id
Action:
1. Filtrer prospects avec checkbox Messages validés = true
2. Pour chaque : créer le lead Lemlist (réutiliser Phase 4b)
3. Progression Discord
4. Résumé + lien campagne
Output: nombre envoyé

- [ ] **Step 2 : Configurer confirmation (action la plus critique)**

- [ ] **Step 3 : Tester**

- [ ] **Step 4 : Commit**

```bash
git add -A && git commit -m "feat: Agent Tool - Push Lemlist avec confirmation (Task 14)"
```

---

### Task 15 : Test end-to-end Chunk 3

- [ ] **Step 1 : Tester le flux pipeline complet via Discord**

Scénario end-to-end :
1. "Trouve-moi 5 prospects industrie en Vendée" → confirmation → sourcing
2. "Score-les" → scoring
3. "Génère les emails pour les 3 meilleurs" → confirmation → génération
4. (Relire et valider dans Notion)
5. "Envoie les validés sur Lemlist" → confirmation → push

Vérifier :
- Confirmations fonctionnent (oui/non)
- Progression affichée
- Propositions proactives de suite logique
- Mémoire de session (le bot se souvient du contexte)
- Multi-user (tester avec l'autre compte)

- [ ] **Step 2 : Corriger les bugs**

- [ ] **Step 3 : Commit final**

```bash
git add -A && git commit -m "feat: Discord Growth Agent - complet (11 outils, 3 chunks)"
```

- [ ] **Step 4 : Activer le workflow et taguer "verified"**

```
n8n_update_partial_workflow:
  operations: [
    { type: "activateWorkflow" },
    { type: "addTag", tag: "verified" }
  ]
```
