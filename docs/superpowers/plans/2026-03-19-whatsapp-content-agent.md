# WhatsApp Content Agent — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a WhatsApp-based AI content agent with vectorial memory that serves as a "second brain" for content creation — note ideas, write posts, search history, manage statuses, generate visuals.

**Architecture:** Orchestrator pattern — one main n8n workflow (WF-Main) receives WhatsApp messages, classifies intent via Gemini Flash, then dispatches to 5 specialized sub-workflows (WF-A through WF-E). Qdrant Cloud provides persistent vectorial memory. A sync workflow (WF-Sync) keeps Qdrant in sync with Notion.

**Tech Stack:** n8n (orchestration), WhatsApp Business API, Gemini 2.5 Flash/Pro, OpenAI Whisper, Qdrant Cloud, fal.ai (Flux LoRA + NanoBanana 2), Notion API, Google Drive API, Gmail

**Spec:** `docs/superpowers/specs/2026-03-19-whatsapp-content-agent-design.md`

**Conventions n8n (ref CLAUDE.md) :**
- Tous les nodes nommes explicitement (verbe + objet)
- Error workflow global : `N8N_RESOURCE_ID_26`
- Notion API via HTTP Request (headers en dur, meme pattern que les WF v2 existants)
- Code node v2 : toujours `$input.all().map()` pour N items, `$input.first()` pour 1 item
- Gemini : `responseMimeType: 'application/json'` + toujours gerer `Array.isArray()`
- `onError: continueRegularOutput` + `alwaysOutputData: true` sur nodes critiques
- Retry x2 avec backoff sur HTTP Request externes
- **Timestamps Qdrant** : toujours en epoch millisecondes (`Date.now()`), field_schema `integer` — permet le tri client-side et les comparaisons simples

**Credentials existants :**
- `googlePalmApi` (id: `N8N_RESOURCE_ID_06`) — Gemini API (Flash, Pro, Embeddings)
- `googleDriveOAuth2Api` (id: `N8N_RESOURCE_ID_18`) — Google Drive
- `gmailOAuth2` (id: `N8N_RESOURCE_ID_10`) — Gmail

**Credentials a creer (Phase 0, manuellement par Alex) :**
- `whatsAppBusinessApi` — WhatsApp Business API token
- `httpHeaderAuth` OpenAI — pour Whisper (`Authorization: Bearer sk-...`)
- `httpHeaderAuth` fal.ai — pour generation visuels (`Authorization: Key fal_...`)
- `qdrantApi` — Qdrant Cloud API key (Header Auth)

**Notion databases (ref memoire projet) :**
- Idees : `NOTION_ID_02`
- Contenus : `NOTION_ID_03`
- Profils : `NOTION_ID_04`

---

## Chunk 1 : Infrastructure Qdrant + WF-Sync

### Task 1 : Creer la collection Qdrant Cloud

**Prerequis :** Alex a cree son compte Qdrant Cloud, obtenu l'URL du cluster + API key, et cree le credential `qdrantApi` dans n8n.

- [ ] **Step 1 : Creer la collection `content_system` via API Qdrant**

Utiliser un workflow n8n temporaire (ou curl) pour creer la collection :

```
PUT {QDRANT_URL}/collections/content_system
Body:
{
  "vectors": {
    "size": 768,
    "distance": "Cosine"
  }
}
Headers: api-key: {QDRANT_API_KEY}
```

- [ ] **Step 2 : Creer les index de filtrage (payload index)**

```
PUT {QDRANT_URL}/collections/content_system/index
Body: { "field_name": "type", "field_schema": "keyword" }

PUT {QDRANT_URL}/collections/content_system/index
Body: { "field_name": "phoneNumber", "field_schema": "keyword" }

PUT {QDRANT_URL}/collections/content_system/index
Body: { "field_name": "profilId", "field_schema": "keyword" }

PUT {QDRANT_URL}/collections/content_system/index
Body: { "field_name": "etat", "field_schema": "keyword" }

PUT {QDRANT_URL}/collections/content_system/index
Body: { "field_name": "canal", "field_schema": "keyword" }

PUT {QDRANT_URL}/collections/content_system/index
Body: { "field_name": "timestamp", "field_schema": "integer" }
```

- [ ] **Step 3 : Verifier la collection**

```
GET {QDRANT_URL}/collections/content_system
```

Attendu : `"status": "green"`, `"vectors_count": 0`, 6 payload indexes.

---

### Task 2 : Creer WF-Sync (synchronisation Notion → Qdrant)

**Workflow n8n :** `Content - Agent Sync Qdrant`
**Trigger :** Schedule Trigger, quotidien 2h du matin (`0 2 * * *`)
**Nodes :** ~12 nodes

- [ ] **Step 1 : Creer le workflow avec le trigger**

Utiliser `n8n_create_workflow` :
- Nom : `Content - Agent Sync Qdrant`
- Node 1 : `Declencheur quotidien 2h` (scheduleTrigger, cron `0 2 * * *`)
- Settings : timezone `Europe/Paris`, errorWorkflow `N8N_RESOURCE_ID_26`
- `active: false`

- [ ] **Step 2 : Ajouter le node "Charger curseur sync"**

Code node qui lit le `staticData` pour recuperer le timestamp de derniere sync :

```javascript
// lastSync est en ISO 8601 (pas epoch ms) car il sert dans les filtres Notion API
// qui attendent du ISO 8601. Ne pas confondre avec le timestamp Qdrant (epoch ms).
const staticData = $getWorkflowStaticData('global');
const lastSync = staticData.lastSync || '2020-01-01T00:00:00.000Z';
return [{ json: { lastSync, isInitialSync: lastSync === '2020-01-01T00:00:00.000Z' } }];
```

Connexion : Declencheur → Charger curseur sync

- [ ] **Step 3 : Ajouter les nodes "Requeter idees modifiees" (avec pagination)**

La Notion API retourne max 100 resultats par appel. Pour la sync initiale (potentiellement > 100 pages), il faut paginer.

**Node "Requeter idees modifiees"** (HTTP Request) :
- POST `https://api.notion.com/v1/databases/<NOTION_DATABASE_ID>/query`
- Headers Notion (Authorization + Notion-Version)
- Body : filtre `last_edited_time` > `$json.lastSync`, page_size 100
- `onError: continueRegularOutput`, `alwaysOutputData: true`

**Node "Paginer idees"** (Code node) :
```javascript
const response = $input.first().json;
const allResults = response.results || [];
// Si has_more, on stocke le next_cursor pour la prochaine iteration
// Le SplitInBatches en amont gere la boucle de pagination
return allResults.map(page => ({ json: page }));
```

Note : si le volume attendu est < 100 pages par sync (delta quotidien), la pagination ne sera pas declenchee. Pour la sync initiale, prevoir un SplitInBatches avec `has_more` / `start_cursor` ou executer la sync initiale en plusieurs passes manuelles.

Connexion : Charger curseur sync → Requeter idees modifiees → Paginer idees

- [ ] **Step 4 : Ajouter les nodes "Requeter contenus modifies" (avec pagination)**

Meme pattern que Step 3 pour la base contenus :
- POST `https://api.notion.com/v1/databases/NOTION_ID_05/query`
- Headers Notion
- Body : filtre `last_edited_time` > `$json.lastSync`, page_size 100
- `onError: continueRegularOutput`, `alwaysOutputData: true`

+ Code node "Paginer contenus" identique.

Connexion : Charger curseur sync → Requeter contenus modifies (en parallele avec Step 3)

- [ ] **Step 5 : Ajouter le node "Preparer points idees"**

Code node qui transforme les pages Notion en format Qdrant :

```javascript
const pages = $input.first()?.json?.results || [];
return pages.map(page => {
  const props = page.properties;
  const getText = (prop) => {
    if (!prop) return '';
    if (prop.type === 'rich_text') return (prop.rich_text || []).map(t => t.plain_text).join('');
    if (prop.type === 'title') return (prop.title || []).map(t => t.plain_text).join('');
    if (prop.type === 'select') return prop.select?.name || '';
    if (prop.type === 'number') return String(prop.number || 0);
    if (prop.type === 'status') return prop.status?.name || '';
    return '';
  };
  const titre = getText(props['Nom']);
  const angle = getText(props['Angle']);
  const textToEmbed = titre + (angle ? ' - ' + angle : '');
  return {
    json: {
      pointId: page.id.replace(/-/g, ''),
      textToEmbed,
      payload: {
        type: 'idee',
        pageId: page.id,
        canal: getText(props['Canal']),
        score: Number(getText(props['Score'])) || 0,
        priorite: getText(props['Priorité']),
        etat: getText(props['État']),
        profilId: (props['Profil']?.relation || [])[0]?.id || '',
        createdAt: page.created_time
      }
    }
  };
}).filter(item => item.json.textToEmbed.length > 0);
```

Connexion : Paginer idees → Preparer points idees

- [ ] **Step 6 : Ajouter le node "Preparer points contenus"**

Code node similaire pour les contenus :

```javascript
const pages = $input.first()?.json?.results || [];
return pages.map(page => {
  const props = page.properties;
  const getText = (prop) => {
    if (!prop) return '';
    if (prop.type === 'rich_text') return (prop.rich_text || []).map(t => t.plain_text).join('');
    if (prop.type === 'title') return (prop.title || []).map(t => t.plain_text).join('');
    if (prop.type === 'select') return prop.select?.name || '';
    if (prop.type === 'status') return prop.status?.name || '';
    return '';
  };
  const titre = getText(props['Contenu']);
  const ideeDePost = getText(props['Idée de post']);
  const canal = getText(props['Canal']);
  const textToEmbed = titre + (ideeDePost ? ' - ' + ideeDePost : '') + (canal ? ' - ' + canal : '');
  return {
    json: {
      pointId: page.id.replace(/-/g, ''),
      textToEmbed,
      payload: {
        type: 'contenu',
        pageId: page.id,
        canal,
        etat: getText(props['État']),
        profilId: (props['Profil']?.relation || [])[0]?.id || '',
        publicationDate: props['Publication']?.date?.start || '',
        createdAt: page.created_time
      }
    }
  };
}).filter(item => item.json.textToEmbed.length > 0);
```

Connexion : Paginer contenus → Preparer points contenus

- [ ] **Step 7 : Ajouter le node "Fusionner tous les points"**

Merge node (mode: Append) qui combine les items des 2 branches (idees + contenus).

Connexion : Preparer points idees → Fusionner / Preparer points contenus → Fusionner

- [ ] **Step 8 : Ajouter les nodes "Batches embedding" + "Generer embeddings"**

**Node "Batches embedding"** (SplitInBatches) :
- Batch size : 50 (rate limit Gemini Embedding API)
- Connexion : Fusionner → Batches embedding

**Node "Generer embeddings"** (HTTP Request) :
- POST `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`
- Auth : `googlePalmApi` (predefined credential)
- Body : `{{ JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text: $json.textToEmbed }] } }) }}`
- Retry x2, timeout 30s

Connexion : Batches embedding → Generer embeddings → Batches embedding (boucle SplitInBatches)

Note : le SplitInBatches boucle automatiquement jusqu'a epuisement des items. Apres la derniere batch, la sortie "done" continue vers le node suivant.

- [ ] **Step 9 : Ajouter le node "Assembler upsert Qdrant"**

Code node qui combine l'embedding recu avec les donnees originales.

**Important :** Apres le HTTP Request Embedding, `$json` contient la reponse Gemini et non les donnees preparees. On utilise `$('Batches embedding').all()` pour acceder aux items originaux qui contiennent `pointId` et `payload` (le SplitInBatches preserve les champs d'entree).

```javascript
return $input.all().map((embeddingItem, index) => {
  // HTTP Request Gemini remplace $json — on recupere les donnees originales
  // via le node amont "Batches embedding" qui les a conservees
  const originalItem = $('Batches embedding').all()[index]?.json || {};
  const pointId = originalItem.pointId || '';
  const payload = originalItem.payload || {};
  const vector = embeddingItem.json?.embedding?.values || [];
  return {
    json: {
      id: pointId,
      vector,
      payload: { ...payload, timestamp: Date.now() }
    }
  };
});
```

**Important — pattern $json remplacement (ref CLAUDE.md)** : Le HTTP Request Gemini ecrase `$json` avec la reponse API. Les donnees originales (`pointId`, `payload`) sont recuperees via `$('Batches embedding').all()[index]` qui reference le dernier node stable avant le HTTP Request. Ce pattern est valide car SplitInBatches preserve le pairedItem tracking.

Connexion : Generer embeddings → Assembler upsert Qdrant

- [ ] **Step 10 : Ajouter le node "Upsert dans Qdrant"**

HTTP Request node :
- PUT `{QDRANT_URL}/collections/content_system/points`
- Headers : `api-key: {QDRANT_API_KEY}`
- Body : `{{ JSON.stringify({ points: $input.all().map(i => i.json) }) }}`
- Retry x2, timeout 30s
- `onError: continueRegularOutput`

Connexion : Assembler upsert Qdrant → Upsert dans Qdrant

Note : l'URL et l'API key Qdrant seront en dur pour le moment (comme le pattern Notion). A migrer vers credential plus tard.

- [ ] **Step 11 : Ajouter le node "Purger conversations anciennes"**

HTTP Request node :
- POST `{QDRANT_URL}/collections/content_system/points/delete`
- Body : filtre `type=conversation` AND `timestamp < (now - 30 jours en ms)`
- `onError: continueRegularOutput`

Connexion : Upsert dans Qdrant → Purger conversations anciennes

- [ ] **Step 12 : Ajouter le node "Sauvegarder curseur sync"**

Code node qui met a jour le staticData :

```javascript
const staticData = $getWorkflowStaticData('global');
staticData.lastSync = new Date().toISOString();
return [{ json: { status: 'sync_complete', lastSync: staticData.lastSync, pointsProcessed: $('Upsert dans Qdrant').first()?.json?.status || 'unknown' } }];
```

Connexion : Purger conversations anciennes → Sauvegarder curseur sync

- [ ] **Step 13 : Ajouter les sticky notes**

4 sticky notes pour documenter les sections du workflow.

- [ ] **Step 14 : Tester manuellement**

1. Executer le workflow manuellement dans n8n
2. Verifier que les idees et contenus Notion apparaissent dans Qdrant
3. Verifier via `GET {QDRANT_URL}/collections/content_system` que `vectors_count` > 0
4. Re-executer : verifier que seuls les deltas sont traites (pas de doublons)

- [ ] **Step 15 : Commit**

```bash
git add -A && git commit -m "feat: WF-Sync - synchronisation Notion vers Qdrant (idees + contenus)"
```

---

## Chunk 2 : WF-Main (routeur WhatsApp)

### Task 3 : Creer WF-Main — structure de base et securite

**Workflow n8n :** `Content - WhatsApp Agent`
**Trigger :** WhatsApp Trigger (webhook)
**Nodes initiaux :** ~6 nodes (trigger, securite, routage media)

- [ ] **Step 1 : Creer le workflow avec le WhatsApp Trigger**

Utiliser `n8n_create_workflow` :
- Nom : `Content - WhatsApp Agent`
- Node 1 : `Reception WhatsApp` (whatsAppTrigger)
- Settings : timezone `Europe/Paris`, errorWorkflow `N8N_RESOURCE_ID_26`
- Credential : `whatsAppBusinessApi`
- `active: false`

- [ ] **Step 2 : Verifier le format de sortie du WhatsApp Trigger**

**IMPORTANT — a faire en premier :** Le format exact de sortie du WhatsApp Trigger n8n n'est pas documente de facon fiable. Avant de coder les nodes suivants :

1. Connecter un Code node temporaire "Logger sortie brute" au trigger :
```javascript
console.log(JSON.stringify($input.first().json, null, 2));
return $input.all();
```
2. Envoyer un message texte + un vocal via WhatsApp
3. Examiner la structure dans les executions n8n
4. Adapter les champs dans les nodes suivants (`$json.from`, `$json.type`, `$json.text.body`, etc.) selon la structure reelle

Les noms de champs utilises dans ce plan (`from`, `type`, `text.body`, `audio.id`, `image.id`) sont bases sur l'API WhatsApp Business Cloud — le node n8n peut les restructurer differemment.

- [ ] **Step 3 : Ajouter le node "Verifier expediteur"**

Code node — allowlist + deduplication :

```javascript
const ALLOWED_PHONES = ['NUMERO_JESSY']; // A remplacer par le vrai numero
const phoneNumber = $json.from || ''; // Adapter selon Step 2
const messageId = $json.id || ''; // Adapter selon Step 2

if (!ALLOWED_PHONES.includes(phoneNumber)) {
  return []; // Ignore silencieusement
}

// Deduplication via staticData
const staticData = $getWorkflowStaticData('global');
const recentIds = staticData.recentMessageIds || [];
if (recentIds.includes(messageId)) {
  return []; // Doublon
}
recentIds.push(messageId);
if (recentIds.length > 20) recentIds.shift();
staticData.recentMessageIds = recentIds;

return [{ json: { ...$json, phoneNumber, messageId } }];
```

Connexion : Reception WhatsApp → Verifier expediteur

- [ ] **Step 4 : Ajouter le node "Identifier type media"**

Code node qui detecte le type de message :

```javascript
const msg = $input.first().json;
let type = 'texte';
let texte = '';
let mediaId = '';

if (msg.type === 'text') {
  texte = msg.text?.body || msg.body || '';
} else if (msg.type === 'audio' || msg.type === 'voice') {
  type = 'vocal';
  mediaId = msg.audio?.id || msg.voice?.id || '';
} else if (msg.type === 'image') {
  type = 'image';
  mediaId = msg.image?.id || '';
  texte = msg.image?.caption || '';
}

return [{ json: { type, texte, mediaId, phoneNumber: msg.phoneNumber, messageId: msg.messageId } }];
```

Connexion : Verifier expediteur → Identifier type media

- [ ] **Step 5 : Ajouter les nodes de transcription vocale**

3 nodes en chaine pour le chemin vocal :

**Node "Telecharger media WhatsApp"** (HTTP Request) :
- GET `https://graph.facebook.com/v21.0/{{ $json.mediaId }}`
- Auth : WhatsApp token (header `Authorization: Bearer ...`)
- Retourne l'URL du media

**Node "Recuperer fichier audio"** (HTTP Request) :
- GET `{{ $json.url }}`  (URL retournee par le node precedent)
- Response format : File (binaire)

**Node "Transcrire vocal Whisper"** (HTTP Request) :
- POST `https://api.openai.com/v1/audio/transcriptions`
- Auth : httpHeaderAuth OpenAI
- Body : form-data avec `file` (binaire) + `model: whisper-1` + `language: fr`
- Retourne `{ "text": "..." }`

Connexion (branche conditionnelle depuis Identifier type media) :
- Si `type === 'vocal'` : → Telecharger media → Recuperer fichier → Transcrire vocal → rejoint le flux principal
- Si `type === 'texte'` : → passe directement au classifieur

Note : le branchement conditionnel sera fait avec 2 Code nodes en parallele (pattern anti-IF valide, ref CLAUDE.md). Le Code node "texte" retourne l'item si `type === 'texte'`, sinon `[]`. Le Code node "vocal" retourne l'item si `type === 'vocal'`, sinon `[]`.

- [ ] **Step 6 : Ajouter le node "Unifier texte"**

Code node qui recoit les 2 branches (texte direct ou transcription) et unifie :

```javascript
// Recoit soit le texte direct, soit la transcription Whisper
const items = $input.all();
const item = items[0]?.json || {};
const texte = item.texte || item.text || '';
const phoneNumber = item.phoneNumber || $('Verifier expediteur').first()?.json?.phoneNumber || '';
return [{ json: { texte, phoneNumber } }];
```

- [ ] **Step 7 : Commit structure de base**

```bash
git commit -m "feat: WF-Main - structure WhatsApp trigger, securite, transcription vocale"
```

---

### Task 4 : WF-Main — classifieur d'intention et dispatch

- [ ] **Step 1 : Ajouter le node "Charger contexte session"**

HTTP Request vers Qdrant — recherche les 5 derniers echanges :
- POST `{QDRANT_URL}/collections/content_system/points/scroll`
- Body :
```json
{
  "filter": {
    "must": [
      { "key": "type", "match": { "value": "conversation" } },
      { "key": "phoneNumber", "match": { "value": "{{ $json.phoneNumber }}" } }
    ]
  },
  "limit": 20,
  "with_payload": true,
  "with_vectors": false
}
```
- `onError: continueRegularOutput`, `alwaysOutputData: true`

Note : Qdrant `scroll` ne supporte PAS `order_by`. On recupere 20 points puis on trie cote client dans le Code node "Assembler prompt classifieur" (tri par `payload.timestamp` desc, garder les 5 premiers).

Connexion : Unifier texte → Charger contexte session

- [ ] **Step 2 : Ajouter le node "Verifier brouillon actif"**

HTTP Request vers Qdrant — cherche un draft en cours :
- POST `{QDRANT_URL}/collections/content_system/points/scroll`
- Body : filtre `type=draft` AND `phoneNumber=$json.phoneNumber`, limit 1

Connexion : en parallele avec Charger contexte session

- [ ] **Step 3 : Ajouter le node "Joindre contextes" (Merge)**

Merge node (mode: Wait, combineBy: Position) qui attend les 2 branches paralleles (Charger contexte session + Verifier brouillon actif) avant de continuer.

Connexion : Charger contexte session → Joindre contextes (input 1) / Verifier brouillon actif → Joindre contextes (input 2)

Note : sans ce Merge, le classifieur s'executerait 2 fois (1 par branche). Le Merge attend les 2 reponses et combine en 1 item.

- [ ] **Step 4 : Ajouter le node "Classifier intention"**

HTTP Request vers Gemini Flash :
- POST `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
- Auth : `googlePalmApi`
- Body : prompt systeme de classification avec le message, le contexte session, et la presence/absence d'un brouillon actif
- `responseMimeType: 'application/json'`, temperature 0

Prompt systeme (dans un Code node "Assembler prompt classifieur" en amont) :

```javascript
const texte = $('Unifier texte').first().json.texte;
// Apres le Merge "Joindre contextes", les 2 reponses sont combinees.
// Acceder aux nodes amont par leur nom (pas via $json qui est ecrase par le Merge).
const rawPoints = $('Charger contexte session').first()?.json?.result?.points || [];
// Qdrant scroll ne supporte pas order_by — tri client-side par timestamp desc, garder top 5
const contextPoints = rawPoints
  .sort((a, b) => (b.payload?.timestamp || 0) - (a.payload?.timestamp || 0))
  .slice(0, 5);
const hasDraft = ($('Verifier brouillon actif').first()?.json?.result?.points || []).length > 0;

const contextStr = contextPoints.map(p =>
  'User: ' + (p.payload?.messageUser || '') + '\nAgent: ' + (p.payload?.reponseAgent || '')
).join('\n---\n');

const prompt = `Tu es un classifieur d'intentions pour un agent de creation de contenu WhatsApp.

Message de l'utilisateur : "${texte}"

Contexte des derniers echanges :
${contextStr || '(aucun)'}

Brouillon en cours : ${hasDraft ? 'OUI' : 'NON'}

Classe l'intention parmi :
- noter_idee : l'utilisateur veut enregistrer une idee de contenu
- rediger_post : l'utilisateur demande de rediger un nouveau post (LinkedIn, Substack, etc.)
- affiner_post : l'utilisateur veut modifier un brouillon en cours (UNIQUEMENT si brouillon = OUI)
- valider_brouillon : l'utilisateur confirme/valide le brouillon ("ok", "c'est bon", "enregistre", "parfait") (UNIQUEMENT si brouillon = OUI)
- consulter_pipeline : l'utilisateur veut voir l'etat de son calendrier editorial
- rechercher : l'utilisateur cherche une idee, un post, ou une information dans son historique
- valider_idee : l'utilisateur veut valider une idee pour generation
- marquer_publie : l'utilisateur indique avoir publie un post
- generer_visuel : l'utilisateur veut generer un visuel (photo avec lui ou infographie)
- conversation_libre : tout autre message (question, salutation, etc.)

Retourne un JSON : { "intention": "...", "parametres": { "sujet": "...", "canal": "..." } }
Le champ parametres est optionnel selon l'intention.`;

return [{ json: { prompt, texte, phoneNumber: $('Unifier texte').first().json.phoneNumber } }];
```

- [ ] **Step 5 : Ajouter le node "Parser intention"**

Code node qui parse la reponse Gemini :

```javascript
const response = $input.first().json;
const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
let result;
try {
  result = JSON.parse(text);
  if (Array.isArray(result)) result = result[0];
} catch(e) {
  result = { intention: 'conversation_libre', parametres: {} };
}

const meta = $('Assembler prompt classifieur').first().json;
return [{
  json: {
    intention: result.intention || 'conversation_libre',
    parametres: result.parametres || {},
    texte: meta.texte,
    phoneNumber: meta.phoneNumber
  }
}];
```

- [ ] **Step 6 : Ajouter le Switch node "Dispatcher intention"**

Switch node sur `$json.intention` avec les branches :
- `noter_idee` → Execute Sub-workflow WF-A
- `rediger_post` → Execute Sub-workflow WF-B
- `affiner_post` → Execute Sub-workflow WF-B
- `valider_brouillon` → Execute Sub-workflow WF-B
- `consulter_pipeline` → Execute Sub-workflow WF-C
- `rechercher` → Execute Sub-workflow WF-C
- `valider_idee` → Execute Sub-workflow WF-D
- `marquer_publie` → Execute Sub-workflow WF-D
- `generer_visuel` → Execute Sub-workflow WF-E
- `conversation_libre` → Gemini Flash inline (reponse directe)

Note : les Execute Sub-workflow nodes seront connectes au fur et a mesure que les sub-workflows sont crees (Tasks 5-9). En attendant, chaque branche renvoie un message placeholder.

- [ ] **Step 7 : Ajouter le node "Conversation libre" (inline)**

Pour l'intention `conversation_libre`, un HTTP Request Gemini Flash repond directement :
- Prompt : contexte session + message, ton amical et professionnel
- Retourne le texte de reponse

- [ ] **Step 8 : Ajouter les nodes de sortie "Sauvegarder echange" + "Repondre WhatsApp"**

**Node "Generer embedding echange"** (HTTP Request Gemini Embedding) :
- Vectorise `message_user + reponse_agent`

**Node "Sauvegarder dans Qdrant"** (HTTP Request Qdrant upsert) :
- Point avec type=conversation, phoneNumber, timestamp (epoch ms via `Date.now()`), messageUser, reponseAgent

**Node "Repondre WhatsApp texte"** (WhatsApp node) :
- Send Message au phoneNumber avec le texte de reponse

**Node "Verifier image" (Code node)** :
- Verifie si la reponse du sub-WF contient un champ `imageUrl`
- Si oui : retourne l'item (sinon `[]`)

**Node "Repondre WhatsApp image" (WhatsApp node)** :
- Send Image au phoneNumber avec l'URL de l'image
- Connexion : Verifier image → Repondre WhatsApp image

Note : les 2 branches (texte + image) sont paralleles. Le texte est toujours envoye, l'image uniquement si presente.

- [ ] **Step 9 : Tester le routeur**

1. Envoyer un message texte WhatsApp → verifier que le classifieur repond
2. Envoyer un vocal → verifier la transcription + classification
3. Verifier que les echanges sont sauvegardes dans Qdrant

- [ ] **Step 10 : Commit**

```bash
git commit -m "feat: WF-Main - classifieur intention, dispatch, sauvegarde Qdrant"
```

---

## Chunk 3 : Sub-workflows WF-A, WF-B, WF-C

### Task 5 : WF-A — Noter Idee

**Workflow n8n :** `Content - Agent Noter Idee`
**Trigger :** Execute Workflow Trigger (appele par WF-Main)
**Nodes :** ~6 nodes

- [ ] **Step 1 : Creer le workflow**

- Nom : `Content - Agent Noter Idee`
- Trigger : `executeWorkflowTrigger`
- Settings : errorWorkflow `N8N_RESOURCE_ID_26`

- [ ] **Step 2 : Ajouter le node "Extraire idee" (Gemini Flash)**

Code node assemblage prompt + HTTP Request Gemini :

Prompt : "A partir de ce message, extrais une idee de contenu structuree. Retourne un JSON : { titre, angle, canal_suggere, tags }. Canaux possibles : LinkedIn, Substack Article, Substack Notes, Newsletter."

- [ ] **Step 3 : Ajouter le node "Creer page Notion"**

HTTP Request POST `/v1/pages` :
- Parent : base idees
- Properties : Nom (titre), Angle (rich_text), Canal (select), Etat (status: "Nouvelle"), Profil (relation)
- Note : si la propriete `Tags` (multi_select) existe dans la base idees, ecrire aussi les tags extraits par Gemini. Sinon, ignorer ce champ (deferred — a creer dans Notion si souhaite).

- [ ] **Step 4 : Ajouter le node "Indexer dans Qdrant"**

2 nodes : Gemini Embedding (titre + angle) → Qdrant upsert (type: idee, payload avec pageId, canal, etc.)

- [ ] **Step 5 : Ajouter le node "Formatter reponse"**

Code node qui retourne le message WhatsApp :
```javascript
return [{ json: { reponse: 'Idee notee : ' + $json.titre + '\nAngle : ' + $json.angle + '\nCanal suggere : ' + $json.canal_suggere } }];
```

- [ ] **Step 6 : Connecter WF-A dans WF-Main**

Mettre a jour le Switch node de WF-Main pour que `noter_idee` → Execute Sub-workflow WF-A.

- [ ] **Step 7 : Tester**

Envoyer "j'ai decouvert un outil IA pour le montage video, ca pourrait faire un bon post" → verifier creation dans Notion + indexation Qdrant.

- [ ] **Step 8 : Commit**

```bash
git commit -m "feat: WF-A - noter idee via WhatsApp (Notion + Qdrant)"
```

---

### Task 6 : WF-B — Rediger Post (cycle complet)

**Workflow n8n :** `Content - Agent Rediger Post`
**Trigger :** Execute Workflow Trigger
**Nodes :** ~18 nodes (le plus complexe)

Ce workflow recoit un parametre `intention` (rediger_post / affiner_post / valider_brouillon) et branche en interne.

- [ ] **Step 1 : Creer le workflow avec le trigger et le Switch interne**

- Nom : `Content - Agent Rediger Post`
- Trigger : `executeWorkflowTrigger`
- Node 2 : Switch sur `$json.intention` → 3 branches

- [ ] **Step 2 : Branche "rediger_post" — charger le contexte**

4 nodes en sequence :
1. **Requeter profil actif** (HTTP Request Notion, meme pattern WF2/WF3)
2. **Valider et extraire profil** (Code node, meme code que WF2)
3. **Telecharger guide editorial** (Google Drive download + Extract text)
4. **Telecharger prompt canal** (Google Drive download + Extract text — fileId dynamique selon le canal demande dans `$json.parametres.canal`)

- [ ] **Step 3 : Branche "rediger_post" — anti-redondance + generation**

3 nodes :
1. **Recherche anti-redondance Qdrant** : embedding du sujet → recherche Qdrant (type=contenu, top 5) → extraire titres similaires
2. **Assembler prompt redaction** : Code node qui injecte profil, guide, prompt canal, anti-redondance dans le template (meme pattern que WF2 "Assembler prompt")
3. **Gemini Pro generer post** : HTTP Request, temperature 0.7, responseMimeType JSON

- [ ] **Step 4 : Branche "rediger_post" — sauvegarder brouillon**

3 nodes :
1. **Parser contenu** : Code node (meme pattern WF2 "Parser contenu genere" avec gestion Array)
2. **Creer brouillon Notion** : HTTP Request POST `/v1/pages` (base contenus, Canal, Etat: "Brouillon Agent") + ecriture blocs
3. **Stocker draft Qdrant** : Embedding + upsert (type: draft, phoneNumber, notionPageId)
4. **Formatter reponse** : retourne le post complet en texte WhatsApp

- [ ] **Step 5 : Branche "affiner_post"**

8 nodes :
1. **Charger draft Qdrant** : scroll type=draft, phoneNumber → recuperer notionPageId
2. **Lire brouillon Notion** : GET page properties + GET `/v1/blocks/{pageId}/children` (HTTP Request Notion) → extraire le texte des blocs
3. **Gemini Pro affiner** : prompt = brouillon actuel + demande modification
4. **Lister blocs existants** : GET `/v1/blocks/{pageId}/children` → recuperer tous les block IDs
5. **Supprimer blocs existants** : Pour chaque bloc, DELETE `/v1/blocks/{blockId}` (SplitInBatches si > 1 bloc)
6. **Ecrire nouveaux blocs** : PATCH `/v1/blocks/{pageId}/children` avec les nouveaux blocs generes
7. **Mettre a jour embedding draft** : re-vectoriser le nouveau contenu et upsert dans Qdrant
8. **Formatter reponse** : retourne la version affinee

Note : Notion ne supporte pas le remplacement in-place de blocs. Le pattern est : lister → supprimer → re-creer.

- [ ] **Step 6 : Branche "valider_brouillon"**

7 nodes :
1. **Charger draft Qdrant** → notionPageId + texte du draft
2. **Update Notion** : Etat → "Generes par IA" (PATCH page)
3. **Lire contenu final Notion** : GET blocs de la page → extraire texte complet
4. **Regenerer embedding contenu** : Gemini Embedding sur le texte final (le contenu a pu evoluer via affinage, l'embedding du draft initial n'est plus representatif)
5. **Creer point contenu Qdrant** : upsert nouveau point avec type=contenu, le nouvel embedding, et les metadonnees (canal, etat, publicationDate vide, profilId)
6. **Supprimer draft Qdrant** : DELETE point (ancien ID draft)
7. **Formatter reponse** : "Post enregistre dans Notion - pret pour relecture"

- [ ] **Step 7 : Connecter WF-B dans WF-Main**

3 branches du Switch : rediger_post, affiner_post, valider_brouillon → Execute Sub-workflow WF-B (avec param `intention`).

- [ ] **Step 8 : Tester le cycle complet**

1. "Redige-moi un post LinkedIn sur l'IA souveraine" → verifier brouillon dans WhatsApp + Notion (Brouillon Agent)
2. "Change l'accroche, c'est trop long" → verifier version affinee
3. "C'est bon, enregistre" → verifier Etat = "Generes par IA" dans Notion

- [ ] **Step 9 : Commit**

```bash
git commit -m "feat: WF-B - rediger post WhatsApp (cycle redaction/affinage/validation)"
```

---

### Task 7 : WF-C — Consulter & Rechercher

**Workflow n8n :** `Content - Agent Consulter Rechercher`
**Trigger :** Execute Workflow Trigger
**Nodes :** ~10 nodes

- [ ] **Step 1 : Creer le workflow avec Switch interne**

Switch sur `$json.parametres.mode` ou `$json.intention` → 2 branches : consulter_pipeline / rechercher

- [ ] **Step 2 : Branche "consulter_pipeline"**

4 nodes :
1. **Calculer dates du mois** (Code node) :
```javascript
const now = new Date();
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
return [{ json: { startOfMonth, endOfMonth } }];
```
2. **Requeter contenus du mois** (HTTP Request Notion API) :
- POST `/v1/databases/{contenus_db_id}/query`
- Filtre compound OR :
  - Branche A : `Publication` (date) `on_or_after` startOfMonth AND `on_or_before` endOfMonth
  - Branche B : `Publication` `is_empty: true` AND `État` `does_not_equal` "Publies" (contenus en cours sans date)
- Ceci inclut les brouillons/generes qui n'ont pas encore de date de publication
3. **Resumer pipeline** (Gemini Flash) : prompt = "Resume ces contenus par statut en message court et lisible pour WhatsApp"
4. **Formatter reponse**

- [ ] **Step 3 : Branche "rechercher"**

4 nodes :
1. **Generer embedding requete** (Gemini Embedding API)
2. **Rechercher dans Qdrant** (POST search, filter type in [idee, contenu], limit 5)
3. **Formuler reponse** (Gemini Flash) : prompt = "Voici les resultats de recherche, formule une reponse naturelle"
4. **Formatter reponse**

- [ ] **Step 4 : Connecter WF-C dans WF-Main**

consulter_pipeline et rechercher → Execute Sub-workflow WF-C.

- [ ] **Step 5 : Tester**

1. "Qu'est-ce que j'ai dans mon pipeline ?" → verifier resume des statuts
2. "C'etait quoi mon idee sur le montage video ?" → verifier recherche semantique

- [ ] **Step 6 : Commit**

```bash
git commit -m "feat: WF-C - consulter pipeline et recherche semantique Qdrant"
```

---

## Chunk 4 : Sub-workflows WF-D, WF-E, finalisation

### Task 8 : WF-D — Gerer Statuts

**Workflow n8n :** `Content - Agent Gerer Statuts`
**Trigger :** Execute Workflow Trigger
**Nodes :** ~8 nodes

- [ ] **Step 1 : Creer le workflow avec Switch interne**

Switch sur `$json.intention` → 2 branches : valider_idee / marquer_publie

- [ ] **Step 2 : Branche "valider_idee"**

3 nodes :
1. **Rechercher idee** : embedding du message → Qdrant search (type=idee, limit 1)
2. **Update Notion** : PATCH page, Etat → "Confiees a l'IA"
3. **Update Qdrant** : set_payload etat → "Confiees a l'IA"
4. **Formatter reponse** : "Idee '{titre}' validee"

- [ ] **Step 3 : Branche "marquer_publie"**

3 nodes :
1. **Rechercher contenu** : embedding → Qdrant search (type=contenu, limit 1)
2. **Update Notion** : PATCH page, Etat → "Publies", Publication → date du jour
3. **Update Qdrant** : set_payload etat → "Publies"
4. **Formatter reponse** : "Post '{titre}' marque comme publie"

- [ ] **Step 4 : Connecter WF-D dans WF-Main**

- [ ] **Step 5 : Tester**

1. "Valide l'idee sur le montage video" → verifier statut Notion
2. "J'ai publie le post sur l'IA souveraine" → verifier Publies + date Publication

- [ ] **Step 6 : Commit**

```bash
git commit -m "feat: WF-D - gestion statuts via WhatsApp (valider idee, marquer publie)"
```

---

### Task 9 : WF-E — Generer Visuel

**Workflow n8n :** `Content - Agent Generer Visuel`
**Trigger :** Execute Workflow Trigger
**Nodes :** ~12 nodes

**Prerequis :** Alex a cree le credential fal.ai dans n8n + ajoute la propriete "Charte graphique" sur le profil Notion avec l'URL du Google Doc.

- [ ] **Step 1 : Creer le workflow avec detection du mode**

- Trigger : executeWorkflowTrigger
- Code node "Detecter mode" : Gemini Flash analyse le message et retourne `{ mode: 'flux_lora' | 'infographie' }`
- Switch sur le mode

- [ ] **Step 2 : Branche "flux_lora"**

5 nodes :
1. **Charger post** : Qdrant search ou Notion query pour recuperer le contenu du post
2. **Charger trigger LoRA** : Requeter profil Notion → extraire la propriete `Trigger LoRA` (rich_text, deja presente dans le profil Notion)
3. **Generer prompt Flux** (Gemini Flash) : prompt = sujet du post + trigger word LoRA + consigne personnage celebre (ref feedback_flux-lora-style.md) + format 3:4
4. **Appeler fal.ai Flux** (HTTP Request POST `https://fal.run/fal-ai/flux-lora`) :
```json
{
  "prompt": "...",
  "lora_url": "{{ $json.loraUrl }}",
  "aspect_ratio": "3:4"
}
```
Headers : `Authorization: Key {{ $credentials.falApi }}`
5. **Formatter reponse** : retourne URL image

- [ ] **Step 3 : Branche "infographie"**

5 nodes :
1. **Charger post** : meme que Step 2
2. **Telecharger charte graphique** (GDrive download + Extract text)
3. **Generer prompt NanoBanana** (Gemini Flash) : prompt = donnees du post + style charte graphique + format 3:4
4. **Appeler fal.ai NanoBanana 2** (HTTP Request POST `https://fal.run/fal-ai/nano-banana-2`) :
```json
{
  "prompt": "...",
  "aspect_ratio": "3:4",
  "num_images": 1
}
```
Headers : `Authorization: Key {{ $credentials.falApi }}`
5. **Formatter reponse**

- [ ] **Step 4 : Nodes communs de sortie**

4 nodes apres les 2 branches :
1. **Telecharger image** (HTTP Request GET URL fal.ai → binaire)
2. **Uploader dans Google Drive** (Google Drive upload, dossier dedie)
3. **Rendre image publique** (HTTP Request POST `https://www.googleapis.com/drive/v3/files/{{ $json.id }}/permissions`) :
```json
{ "role": "reader", "type": "anyone" }
```
Auth : `googleDriveOAuth2Api`. Ceci rend l'image accessible via URL publique pour Notion et WhatsApp.
4. **Ajouter image Notion** (HTTP Request PATCH `/v1/blocks/{pageId}/children` → bloc image avec external URL `https://drive.google.com/uc?id={{ $json.fileId }}`)

Retourne : `{ reponse: "Visuel genere", imageUrl: "..." }`

- [ ] **Step 5 : Connecter WF-E dans WF-Main**

Ajouter dans WF-Main : apres reception de la reponse de WF-E, si `imageUrl` est present, envoyer via WhatsApp Send Image en plus du texte.

- [ ] **Step 6 : Tester**

1. "Genere un visuel avec moi pour le post sur l'IA" → verifier appel fal.ai Flux LoRA + image WhatsApp
2. "Fais une infographie pour ce post" → verifier NanoBanana 2 + image WhatsApp

- [ ] **Step 7 : Commit**

```bash
git commit -m "feat: WF-E - generation visuels WhatsApp (Flux LoRA + NanoBanana 2)"
```

---

### Task 10 : Finalisation et test end-to-end

- [ ] **Step 1 : Verifier toutes les connexions WF-Main → sub-workflows**

Passer en revue chaque branche du Switch dans WF-Main et confirmer que chaque Execute Sub-workflow pointe vers le bon workflow.

- [ ] **Step 2 : Test end-to-end complet**

Scenario de test sequentiel via WhatsApp :

1. "Salut" → conversation_libre, reponse amicale
2. (vocal) "J'ai vu un super outil d'IA pour le montage video, ca s'appelle Runway Gen-4" → transcription + noter_idee
3. "C'etait quoi deja mon idee sur le montage video ?" → rechercher, retrouve l'idee
4. "Qu'est-ce que j'ai dans mon pipeline ce mois-ci ?" → consulter_pipeline
5. "Redige-moi un post LinkedIn sur l'IA pour le montage video" → rediger_post
6. "L'accroche est trop longue, raccourcis" → affiner_post
7. "C'est bon, enregistre" → valider_brouillon
8. "Genere un visuel avec moi pour ce post" → generer_visuel (flux_lora)
9. "J'ai publie le post sur le montage video" → marquer_publie
10. "Valide l'idee sur le cloud souverain" → valider_idee

- [ ] **Step 3 : Verifier la coherence Notion**

- Idee "Montage video IA" dans base idees avec Etat "Nouvelle"
- Post LinkedIn dans base contenus avec Etat "Publies"
- Idee cloud souverain avec Etat "Confiees a l'IA"

- [ ] **Step 4 : Verifier Qdrant**

- Points type=idee, type=contenu, type=conversation presents
- Pas de drafts residuels
- Recherche semantique retourne des resultats pertinents

- [ ] **Step 5 : Documenter les actions manuelles pour Alex**

Liste finale des prerequis (actions manuelles Alex) :
1. **Credentials n8n** : creer 4 credentials (WhatsApp Business API, httpHeaderAuth OpenAI, httpHeaderAuth fal.ai, httpHeaderAuth Qdrant)
2. **Proprietes Notion profil** : ajouter `Charte graphique` (URL, Google Doc lié) et `Telephone` (phone_number) sur la base Profils
3. **Statut Notion contenus** : ajouter `🤖 Brouillon Agent` dans la propriete Etat de la base Contenus (en plus des statuts existants)
4. **Qdrant Cloud** : creer compte, obtenir URL cluster + API key
5. **WhatsApp Business** : configurer le numero Business, obtenir le token API
6. **fal.ai** : creer compte, obtenir API key
7. **OpenAI** : obtenir API key (pour Whisper uniquement)
8. Creer collection Qdrant (Task 1 du plan)
9. Executer WF-Sync une premiere fois (sync initiale)
10. Tester chaque sub-workflow manuellement
11. Activer WF-Main et WF-Sync

- [ ] **Step 6 : Commit final**

```bash
git commit -m "feat: WhatsApp Content Agent complet (7 workflows, Qdrant, fal.ai)"
```

- [ ] **Step 7 : Mettre a jour la memoire projet**

Sauvegarder dans `memory/project_whatsapp-content-agent.md` : IDs des workflows, statut, actions manuelles restantes.
