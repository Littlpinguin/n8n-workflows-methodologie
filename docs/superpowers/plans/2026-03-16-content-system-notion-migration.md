# Content System Notion Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the 3 Content System workflows (Veille, Generator, Newsletter) from Google Sheets to Notion, with multi-profile support, Flux LoRA prompts, and anti-redundancy.

**Architecture:** 3 n8n workflows interact with 3 Notion databases (idées, __contenus, profils) via HTTP Request nodes (Notion API). Prompts are built in n8n Code nodes with dynamic variable injection from Notion profiles. Content is written as Notion page blocks.

**Tech Stack:** n8n (workflows), Notion API (data), Gemini API (generation), Perplexity API (veille), Google Drive API (docs), Gmail API (notifications)

**Spec:** `docs/superpowers/specs/2026-03-16-content-system-notion-migration-design.md`

---

## Chunk 1: Phase 0 — Prérequis Notion + Error Workflow

### Task 1: Ajouter les propriétés dans la base `idées`

**Context:** La base `idées` (`11be579e-dc02-8139-acca-d85e74d31bd0`) a besoin de 3 nouvelles propriétés simples (la relation sera créée dans Task 4).

- [ ] **Step 1: Ajouter propriété `Score` (number)**

```bash
curl -s -X PATCH 'https://api.notion.com/v1/databases/<NOTION_DATABASE_ID>' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Score": { "number": {} }
    }
  }'
```

Expected: 200 OK, database schema includes `Score` property.

- [ ] **Step 2: Ajouter propriété `Angle` (rich_text)**

```bash
curl -s -X PATCH 'https://api.notion.com/v1/databases/<NOTION_DATABASE_ID>' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Angle": { "rich_text": {} }
    }
  }'
```

- [ ] **Step 3: Ajouter propriété `Priorité` (select)**

```bash
curl -s -X PATCH 'https://api.notion.com/v1/databases/<NOTION_DATABASE_ID>' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Priorité": {
        "select": {
          "options": [
            { "name": "Evergreen", "color": "green" },
            { "name": "Tendance", "color": "orange" },
            { "name": "Urgente", "color": "red" }
          ]
        }
      }
    }
  }'
```

- [ ] **Step 4: Vérifier les 3 propriétés ajoutées**

```bash
curl -s 'https://api.notion.com/v1/databases/<NOTION_DATABASE_ID>' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' | python3 -c "
import json, sys
db = json.load(sys.stdin)
for name in ['Score', 'Angle', 'Priorité']:
    prop = db['properties'].get(name)
    print(f'{name}: {prop[\"type\"] if prop else \"MISSING\"}')"
```

Expected: `Score: number`, `Angle: rich_text`, `Priorité: select`

---

### Task 2: Ajouter les propriétés et modifier la base `__contenus`

**Context:** La base `__contenus` (`11be579e-dc02-81bd-9fab-c403e4570b6c`) a besoin de 2 nouvelles propriétés simples + modifications des options Canal et État. Les relations seront créées dans Task 4.

- [ ] **Step 1: Ajouter propriétés `Logs` et `Prompt visuel validé` (rich_text)**

```bash
curl -s -X PATCH 'https://api.notion.com/v1/databases/11be579edc0281bd9fabc403e4570b6c' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Logs": { "rich_text": {} },
      "Prompt visuel validé": { "rich_text": {} }
    }
  }'
```

- [ ] **Step 2: Ajouter options Canal (Substack Article, Substack Notes, Newsletter)**

Note : L'API Notion ne permet pas d'ajouter des options à un select existant sans risquer d'écraser les options actuelles. On envoie toutes les options (existante + nouvelles).

```bash
curl -s -X PATCH 'https://api.notion.com/v1/databases/11be579edc0281bd9fabc403e4570b6c' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Canal": {
        "select": {
          "options": [
            { "id": "a2d37378-f137-4516-af0f-4bb1fe76cd44", "name": "LinkedIn", "color": "blue" },
            { "name": "Substack Article", "color": "purple" },
            { "name": "Substack Notes", "color": "pink" },
            { "name": "Newsletter", "color": "yellow" }
          ]
        }
      }
    }
  }'
```

- [ ] **Step 3: Ajouter statut `Publié`**

Note : L'API Notion ne permet PAS de modifier les options d'une propriété `status` via l'API. Cette étape doit être faite **manuellement dans l'UI Notion** par Alex.

Action manuelle : Dans Notion, ouvrir la base `__contenus` → propriété `État` → ajouter l'option "Publié" dans le groupe "Complete" (couleur verte).

- [ ] **Step 4: Vérifier**

```bash
curl -s 'https://api.notion.com/v1/databases/11be579edc0281bd9fabc403e4570b6c' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' | python3 -c "
import json, sys
db = json.load(sys.stdin)
props = db['properties']
# Check new properties
for name in ['Logs', 'Prompt visuel validé']:
    prop = props.get(name)
    print(f'{name}: {prop[\"type\"] if prop else \"MISSING\"}')
# Check Canal options
canal = props.get('Canal', {}).get('select', {}).get('options', [])
print(f'Canal options: {[o[\"name\"] for o in canal]}')
# Check État options
etat = props.get('État', {}).get('status', {}).get('options', [])
print(f'État options: {[o[\"name\"] for o in etat]}')"
```

Expected: Logs et Prompt visuel validé présents, Canal avec 4 options, État avec Publié.

---

### Task 3: Ajouter les propriétés dans la base `profils`

**Context:** La base `profils` (`11be579e-dc02-81d9-be51-f60e0d54328f`) a besoin de 4 nouvelles propriétés.

- [ ] **Step 1: Ajouter les 4 propriétés**

```bash
curl -s -X PATCH 'https://api.notion.com/v1/databases/11be579edc0281d9be51f60e0d54328f' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Trigger LoRA": { "rich_text": {} },
      "Guide éditorial": { "url": {} },
      "Référence Newsletter": { "url": {} },
      "Prompt Newsletter": { "url": {} }
    }
  }'
```

- [ ] **Step 2: Vérifier**

```bash
curl -s 'https://api.notion.com/v1/databases/11be579edc0281d9be51f60e0d54328f' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' | python3 -c "
import json, sys
db = json.load(sys.stdin)
for name in ['Trigger LoRA', 'Guide éditorial', 'Référence Newsletter', 'Prompt Newsletter']:
    prop = db['properties'].get(name)
    print(f'{name}: {prop[\"type\"] if prop else \"MISSING\"}')"
```

Expected: 4 propriétés présentes avec les bons types.

---

### Task 4: Créer les relations entre bases

**Context:** 2 relations à créer : bidirectionnelle idées ↔ __contenus, unidirectionnelle __contenus → profils.

- [ ] **Step 1: Créer relation bidirectionnelle idées ↔ __contenus**

On ajoute la relation sur `__contenus` en spécifiant `dual_property` pour la rendre bidirectionnelle (crée automatiquement la propriété inverse `Contenus` dans `idées`).

```bash
curl -s -X PATCH 'https://api.notion.com/v1/databases/11be579edc0281bd9fabc403e4570b6c' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Idée source": {
        "relation": {
          "database_id": "<NOTION_DATABASE_ID>",
          "type": "dual_property",
          "dual_property": {
            "synced_property_name": "Contenus"
          }
        }
      }
    }
  }'
```

Expected: 200 OK. La propriété `Idée source` apparaît dans `__contenus` et `Contenus` apparaît dans `idées`.

- [ ] **Step 2: Créer relation unidirectionnelle __contenus → profils**

```bash
curl -s -X PATCH 'https://api.notion.com/v1/databases/11be579edc0281bd9fabc403e4570b6c' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Profil": {
        "relation": {
          "database_id": "11be579edc0281d9be51f60e0d54328f",
          "type": "single_property",
          "single_property": {}
        }
      }
    }
  }'
```

Expected: 200 OK. La propriété `Profil` apparaît dans `__contenus`. Pas de propriété inverse dans `profils`.

- [ ] **Step 3: Vérifier les relations dans les 3 bases**

```bash
# Vérifier __contenus
curl -s 'https://api.notion.com/v1/databases/11be579edc0281bd9fabc403e4570b6c' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' | python3 -c "
import json, sys
db = json.load(sys.stdin)
for name in ['Idée source', 'Profil']:
    prop = db['properties'].get(name)
    if prop and prop['type'] == 'relation':
        rel = prop['relation']
        print(f'{name}: relation → {rel[\"database_id\"]}, type={rel.get(\"type\",\"?\")}')
    else:
        print(f'{name}: MISSING or wrong type')"

# Vérifier idées (propriété inverse Contenus)
curl -s 'https://api.notion.com/v1/databases/<NOTION_DATABASE_ID>' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' | python3 -c "
import json, sys
db = json.load(sys.stdin)
prop = db['properties'].get('Contenus')
if prop and prop['type'] == 'relation':
    print(f'Contenus: relation → {prop[\"relation\"][\"database_id\"]}')
else:
    print('Contenus: MISSING')"
```

Expected: `__contenus` a `Idée source` et `Profil`, `idées` a `Contenus`.

---

### Task 5: Remplir les données du profil actif (action manuelle Alex)

**Context:** Alex doit remplir les nouvelles propriétés sur son profil ACTIF dans Notion.

- [ ] **Step 1: Identifier le profil ACTIF**

```bash
curl -s -X POST 'https://api.notion.com/v1/databases/11be579edc0281d9be51f60e0d54328f/query' \
  -H 'Authorization: Bearer $NOTION_TOKEN' \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "filter": {
      "property": "STATUT",
      "select": { "equals": "ACTIF" }
    }
  }' | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data['results']:
    title = ''.join(t['plain_text'] for t in r['properties']['Nom Persona']['title'])
    print(f'ID: {r[\"id\"]} — {title}')"
```

- [ ] **Step 2: Action manuelle Alex — remplir les 4 champs sur le profil ACTIF**

Dans Notion, ouvrir la fiche profil ACTIF et remplir :
1. `Trigger LoRA` : le trigger word du LoRA Flux (ex: `JSSYTW`)
2. `Guide éditorial` : URL du Google Doc guide éditorial
3. `Référence Newsletter` : URL du Google Doc référence newsletter
4. `Prompt Newsletter` : URL du Google Doc prompt newsletter

---

### Task 6: Créer le workflow Error Handler

**Context:** Workflow dédié à la gestion d'erreurs, assigné aux 3 workflows Content via Settings.

- [ ] **Step 1: Créer le workflow via n8n MCP**

Utiliser `mcp__n8n-mcp__n8n_create_workflow` pour créer le workflow `Content - Error Handler` avec :
- 1 Error Trigger node
- 1 Code node pour formatter le message d'erreur (workflow name, node name, error message, timestamp)
- 1 Gmail node pour envoyer la notification

Nodes :
```
Error Trigger ("Intercepter erreur")
  → Code ("Formatter message erreur")
  → Gmail ("Notifier erreur par email")
```

Code node (formatter) :
```javascript
const error = $json;
const workflowName = error.workflow?.name || 'Unknown';
const nodeName = error.execution?.lastNodeExecuted || 'Unknown';
const errorMsg = error.execution?.error?.message || JSON.stringify(error);
const timestamp = new Date().toISOString();

return [{
  json: {
    subject: `[Content Error] ${workflowName} - ${nodeName}`,
    body: `Workflow: ${workflowName}\nNode: ${nodeName}\nErreur: ${errorMsg}\nDate: ${timestamp}\n\nExecution ID: ${error.execution?.id || 'N/A'}`,
    timestamp
  }
}];
```

- [ ] **Step 2: Vérifier le workflow créé**

Utiliser `mcp__n8n-mcp__n8n_get_workflow` pour vérifier la structure.

- [ ] **Step 3: Activer le workflow**

Le workflow Error Handler doit être actif pour intercepter les erreurs.

- [ ] **Step 4: Noter l'ID du workflow Error Handler**

Cet ID sera utilisé dans les Settings des 3 workflows Content (Task 7 à venir dans les phases suivantes).

---

### Task 7: Créer le credential Notion dans n8n + configurer automation Notion

- [ ] **Step 1: Créer le credential dans n8n**

Action manuelle dans l'UI n8n : Settings → Credentials → Add Credential → Header Auth
- Name: `notionHeaderAuth`
- Parameters:
  - Name: `Authorization`
  - Value: `Bearer $NOTION_TOKEN`

- [ ] **Step 2: Action manuelle Alex — configurer automation Notion**

Dans Notion, ouvrir la base `__contenus` → Automations → New Automation :
- Trigger : Quand propriété `État` change en "Programmés"
- Condition : propriété `Publication` (date) est dans le passé
- Action : changer `État` en "Publié"

Note : si l'automation Notion ne supporte pas la condition "date dans le passé" nativement, alternative : créer un petit workflow n8n schedulé quotidien qui query les contenus "Programmés" dont la date de Publication est passée et update le statut.

- [ ] **Step 3: Commit Phase 0**

```bash
git add docs/superpowers/specs/2026-03-16-content-system-notion-migration-design.md
git add docs/superpowers/plans/2026-03-16-content-system-notion-migration.md
git commit -m "docs: design + plan migration Content System vers Notion (Phase 0 prérequis)"
```

---

## Chunk 2: Phase 1 — WF1 Content Veille Hebdo (refonte Notion)

### Task 8: Créer le workflow WF1 v2 — structure de base + validation profil

**Context:** On crée un nouveau workflow (pas de duplication MCP disponible). On construit la première partie : trigger + query profil + validation.

**Ref spec:** Section "WF1 — Content Veille Hebdo"

- [ ] **Step 1: Créer le workflow vide**

Utiliser `mcp__n8n-mcp__n8n_create_workflow` :
- Name: `Content - Veille Hebdo v2`
- Active: false

Nodes initiaux :
1. `Declencheur hebdo lundi 8h` — scheduleTrigger (lundi 8h)
2. `Requeter profil actif` — httpRequest (POST `https://api.notion.com/v1/databases/11be579edc0281d9be51f60e0d54328f/query`, filter STATUT=ACTIF)
3. `Valider profil present` — code (vérifie résultat non vide, retourne [] si absent)

Code node "Valider profil present" :
```javascript
const results = $json.results || [];
if (results.length === 0) {
  // Retourne vide pour arrêter le workflow
  return [];
}
const profil = results[0];
const props = profil.properties;

// Extraire toutes les variables du profil
const getText = (prop) => {
  if (!prop) return '';
  if (prop.type === 'rich_text') return (prop.rich_text || []).map(t => t.plain_text).join('');
  if (prop.type === 'title') return (prop.title || []).map(t => t.plain_text).join('');
  if (prop.type === 'url') return prop.url || '';
  if (prop.type === 'select') return prop.select?.name || '';
  return '';
};

return [{
  json: {
    profilId: profil.id,
    nom: getText(props['Nom Persona']),
    description: getText(props['Description']),
    metier: getText(props['Métier']),
    secteur: getText(props['Secteur']),
    typeEntreprise: getText(props["Type d'entreprise"]),
    valeurs: getText(props['Valeurs']),
    croyance: getText(props['Croyance']),
    mission: getText(props['Mission']),
    objectif: getText(props['Objectif']),
    tonalite: getText(props['Tonalité']),
    monStyle: getText(props['Mon style']),
    product: getText(props['Product']),
    features: getText(props['Features']),
    benefits: getText(props['Benefits']),
    valueProp: getText(props['Value_prop']),
    usp: getText(props['Unique selling proposition']),
    advocacy: getText(props['Advocacy']),
    theme: getText(props['Thème']),
    reve: getText(props['Rêve']),
    unpopularOpinion: getText(props['Unpopular opinion']),
    opinionForte: getText(props['Opinion forte']),
    cible: getText(props['Cible']),
    problemeCible: getText(props['Problème cible']),
    douleurNonResolu: getText(props['Douleur si problème non résolu']),
    faussecroyance: getText(props['Fausse croyance limitante']),
    douleurIntime: getText(props['Douleur intime inavouable']),
    expressionDouleur: getText(props['Expression de la douleur']),
    frustration: getText(props['Frustration de ne pas résoudre le problème']),
    peurs: getText(props['Peurs qui empêchent de résoudre le problème']),
    obstacles: getText(props['Obstacles ']),
    ennemCommun: getText(props['Ennemi commun']),
    resultatSouhaite: getText(props['Résultat souhaité']),
    valeursCible: getText(props['Valeurs cible']),
    croyanceCible: getText(props['Croyance cible']),
    triggerLora: getText(props['Trigger LoRA']),
    guideEditorialUrl: getText(props['Guide éditorial']),
    refNewsletterUrl: getText(props['Référence Newsletter']),
    promptNewsletterUrl: getText(props['Prompt Newsletter']),
    statut: getText(props['STATUT'])
  }
}];
```

- [ ] **Step 2: Tester la query profil**

Utiliser `mcp__n8n-mcp__n8n_test_workflow` pour vérifier que le profil ACTIF est bien récupéré.

- [ ] **Step 3: Ajouter le téléchargement du guide éditorial**

Nodes à ajouter après "Valider profil present" :
4. `Telecharger guide editorial` — googleDrive (download file by URL from `$json.guideEditorialUrl`). Si URL vide, skip via expression `{{ $json.guideEditorialUrl ? true : false }}`.
5. `Extraire texte guide` — extractFromFile

Note : si l'URL est vide, le node est skippé et le guide n'est pas inclus dans le prompt.

- [ ] **Step 4: Commit structure de base WF1**

```bash
git commit -m "feat: WF1 Veille v2 - structure de base + validation profil Notion"
```

---

### Task 9: WF1 v2 — anti-redondance + Perplexity + Gemini scoring

**Context:** Ajouter la query anti-redondance, l'appel Perplexity et le scoring Gemini.

- [ ] **Step 1: Ajouter query contenus récents (anti-redondance)**

Node 6 : `Requeter contenus recents` — httpRequest
- POST `https://api.notion.com/v1/databases/11be579edc0281bd9fabc403e4570b6c/query`
- Filter : status État in ["Programmés", "Publié"]
- Sort : created_time descending
- Page size : 10

Body :
```json
{
  "filter": {
    "or": [
      { "property": "État", "status": { "equals": "Programmés" } },
      { "property": "État", "status": { "equals": "Publié" } }
    ]
  },
  "sorts": [{ "timestamp": "created_time", "direction": "descending" }],
  "page_size": 10
}
```

- [ ] **Step 2: Ajouter Code node pour préparer la liste anti-redondance**

Node 7 : `Preparer sujets recents` — code
```javascript
const contenus = $('Requeter contenus recents').first().json.results || [];
const sujetsRecents = contenus.map(c => {
  const titre = (c.properties['Contenu']?.title || []).map(t => t.plain_text).join('');
  const idee = (c.properties['Idée de post']?.rich_text || []).map(t => t.plain_text).join('');
  return titre || idee;
}).filter(Boolean);

const profil = $('Valider profil present').first().json;
const guideText = $('Extraire texte guide').first()?.json?.data || '';

return [{
  json: {
    ...profil,
    guideEditorial: guideText,
    sujetsRecents
  }
}];
```

- [ ] **Step 3: Ajouter appel Perplexity**

Node 8 : `Perplexity Veille 96h` — httpRequest
- POST `https://api.perplexity.ai/chat/completions`
- Credential : perplexityHeaderAuth (existant)
- Retry on fail : 2, backoff 1s/2s
- Timeout : 30000ms
- Body : prompt de veille 96h (repris du WF1 actuel, adapté avec le profil Notion)

- [ ] **Step 4: Ajouter Code node préparation scoring**

Node 9 : `Preparer donnees scoring` — code
- Repris du WF1 actuel
- Ajout : injection de la liste `sujetsRecents` dans le prompt de scoring
- Ajout dans le prompt : "Évite de proposer des sujets similaires aux suivants, déjà publiés récemment : {sujetsRecents.join(', ')}"

- [ ] **Step 5: Ajouter appel Gemini scoring**

Node 10 : `Gemini Scorer et proposer` — httpRequest
- POST Gemini API (repris du WF1 actuel)
- Retry on fail : 2
- `responseMimeType: 'application/json'`

- [ ] **Step 6: Tester le flux jusqu'au scoring**

Exécution manuelle, vérifier que Perplexity et Gemini retournent des résultats cohérents.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: WF1 Veille v2 - anti-redondance + Perplexity + Gemini scoring"
```

---

### Task 10: WF1 v2 — parser + création pages Notion + email recap

**Context:** Dernière partie du WF1 : parser les propositions Gemini, créer les pages dans `idées`, envoyer l'email recap.

- [ ] **Step 1: Ajouter Code node parser propositions**

Node 11 : `Parser propositions` — code

```javascript
const response = $json;
let propositions;
try {
  const content = typeof response.candidates?.[0]?.content?.parts?.[0]?.text === 'string'
    ? JSON.parse(response.candidates[0].content.parts[0].text)
    : response;
  propositions = Array.isArray(content.propositions) ? content.propositions :
                 Array.isArray(content) ? content : [content];
} catch (e) {
  return [];
}

return propositions
  .filter(p => p.sujet && p.score >= 6)
  .map(p => ({
    json: {
      sujet: p.sujet,
      angle: p.angle || '',
      plateforme: p.plateforme || 'LinkedIn',
      score: p.score || 0,
      priorite: p.priorite || 'Evergreen',
      sources: Array.isArray(p.sources) ? p.sources.join('\n') : (p.sources || ''),
      url: Array.isArray(p.sources) ? p.sources[0] : ''
    }
  }));
```

- [ ] **Step 2: Ajouter les 2 Code nodes parallèles (routage propositions/aucune)**

Node 12a : `Filtrer propositions trouvees` — code (connecté à Parser propositions)
```javascript
const items = $input.all();
if (items.length > 0) return items;
return [];
```

Node 12b : `Verifier aucune proposition` — code (connecté à Parser propositions)
```javascript
const items = $input.all();
if (items.length === 0) return [{ json: { aucune: true } }];
return [];
```

- [ ] **Step 3: Ajouter création de pages Notion (idées)**

Node 13 : `Creer idee Notion` — httpRequest (connecté à 12a)
- POST `https://api.notion.com/v1/pages`
- continueOnFail: true
- Body (expression) :

```json
{
  "parent": { "database_id": "<NOTION_DATABASE_ID>" },
  "properties": {
    "Nom": { "title": [{ "text": { "content": "={{ $json.sujet }}" } }] },
    "URL": { "url": "={{ $json.url || null }}" },
    "Score": { "number": "={{ $json.score }}" },
    "Angle": { "rich_text": [{ "text": { "content": "={{ $json.angle }}" } }] },
    "Priorité": { "select": { "name": "={{ $json.priorite }}" } },
    "Catégorie": { "select": { "name": "Actualité" } },
    "État": { "status": { "name": "💡 Idées" } }
  }
}
```

- [ ] **Step 4: Ajouter email recap (propositions trouvées)**

Node 14 : `Email recap veille` — gmail (connecté à Creer idee Notion)
- Reprendre le format de l'email actuel, adapté avec les données Notion

- [ ] **Step 5: Ajouter email aucune proposition**

Node 15 : `Email aucune proposition` — gmail (connecté à 12b)
- Reprendre le format actuel

- [ ] **Step 6: Assigner Error Workflow dans les settings**

Utiliser `mcp__n8n-mcp__n8n_update_partial_workflow` pour ajouter le settings `errorWorkflow` avec l'ID du workflow Error Handler (Task 6).

- [ ] **Step 7: Test complet WF1 v2**

Exécution manuelle complète. Vérifier :
1. Pages créées dans `idées` avec Score, Angle, Priorité, URL
2. Email recap reçu
3. Pas d'erreurs dans l'exécution

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: WF1 Veille v2 - parser + création pages Notion + email recap"
```

---

## Chunk 3: Phase 2 — WF2 Content Generator (refonte Notion)

### Task 11: WF2 v2 — structure de base + query contenus + profil

**Context:** Le Generator est le workflow le plus complexe. On commence par la structure : query contenus "Confiés à l'IA", résolution du profil, téléchargement du guide.

- [ ] **Step 1: Créer le workflow vide**

Utiliser `mcp__n8n-mcp__n8n_create_workflow` :
- Name: `Content - Generator v2`
- Active: false

- [ ] **Step 2: Ajouter les nodes de base**

Nodes :
1. `Declencheur quotidien 9h` — scheduleTrigger (quotidien 9h)
2. `Requeter contenus a generer` — httpRequest (POST Notion query __contenus, filter État = "🤖 Confiés à l'IA")
3. `Filtrer contenus presents` — code (si résultats vides → return [])
4. `Resoudre profil` — code (extraire profil ID depuis relation ou fallback ACTIF)
5. `Requeter profil` — httpRequest (GET Notion page par ID)
6. `Extraire variables profil` — code (même extraction que Task 8 Step 1)
7. `Valider profil present` — code (stop si absent)
8. `Telecharger guide editorial` — googleDrive
9. `Extraire texte guide` — extractFromFile

Code node "Resoudre profil" :
```javascript
const contenus = $('Requeter contenus a generer').first().json.results || [];
if (contenus.length === 0) return [];

// Prendre le premier contenu pour résoudre le profil
const contenu = contenus[0];
const profilRelation = contenu.properties['Profil']?.relation || [];

let profilId;
if (profilRelation.length > 0) {
  profilId = profilRelation[0].id;
} else {
  // Fallback : on devra query le profil ACTIF dans le node suivant
  profilId = 'QUERY_ACTIF';
}

return contenus.map(c => {
  const props = c.properties;
  return {
    json: {
      pageId: c.id,
      contenuTitre: (props['Contenu']?.title || []).map(t => t.plain_text).join(''),
      ideeDePost: (props['Idée de post']?.rich_text || []).map(t => t.plain_text).join(''),
      canal: props['Canal']?.select?.name || 'LinkedIn',
      profilId,
      ideeSourceRelation: (props['Idée source']?.relation || [])[0]?.id || null
    }
  };
});
```

- [ ] **Step 3: Tester query contenus + résolution profil**

Créer manuellement une carte dans `__contenus` avec statut "Confiés à l'IA" et une idée de post. Exécuter, vérifier.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: WF2 Generator v2 - structure de base + query contenus + profil Notion"
```

---

### Task 12: WF2 v2 — prompt system + appel Gemini

**Context:** Construction du prompt dans le Code node avec toutes les variables du profil Notion, appel Gemini, parsing de la réponse.

- [ ] **Step 1: Ajouter query anti-redondance**

Node 10 : `Requeter contenus recents` — httpRequest (même que WF1, query 10 derniers Programmés/Publié)

- [ ] **Step 2: Ajouter Code node assemblage prompt**

Node 11 : `Assembler prompt` — code

Ce node construit le prompt complet. Le template est hardcodé dans le Code node, les variables sont injectées depuis le profil Notion. Le document de contexte éditorial correspondant n'est pas inclus dans cette version publique pour le détail du style et des règles.

Le code doit :
1. Construire la section ROLE + STYLE + TEMPLATE (hardcodé, issu du prompt V4)
2. Injecter les ~30 variables du profil dans la section PROFIL AUTEUR
3. Construire la section AUDIENCE CIBLE
4. Injecter l'idée du post
5. Injecter la liste anti-redondance
6. Si canal = LinkedIn : ajouter la demande de 3 prompts Flux LoRA
7. Retourner le prompt complet + les métadonnées du contenu

Important : le prompt doit spécifier `responseMimeType: 'application/json'` et le format de sortie JSON attendu.

- [ ] **Step 3: Ajouter appel Gemini**

Node 12 : `Gemini Generer contenu` — httpRequest
- POST Gemini API (gemini-2.5-pro ou gemini-3-pro-preview)
- Retry on fail : 2
- `responseMimeType: 'application/json'`
- responseSchema pour guider la structure JSON

- [ ] **Step 4: Ajouter Code node parser**

Node 13 : `Parser contenu genere` — code

```javascript
const response = $json;
let content;
try {
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  content = typeof text === 'string' ? JSON.parse(text) : response;
} catch (e) {
  return [{ json: { error: 'Parse error: ' + e.message, raw: JSON.stringify(response).substring(0, 500) } }];
}

const prev = $('Assembler prompt').first().json;

return [{
  json: {
    pageId: prev.pageId,
    canal: prev.canal,
    titre: content.titre || '',
    hook: content.hook || '',
    contenu: content.contenu || '',
    cta: content.cta || '',
    fluxPrompts: content.flux_prompts || [],
    promptComplet: prev.promptComplet
  }
}];
```

- [ ] **Step 5: Tester prompt + Gemini**

Exécuter, vérifier que Gemini retourne un JSON valide avec titre, hook, contenu, cta, et flux_prompts (si LinkedIn).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: WF2 Generator v2 - prompt system multi-profils + appel Gemini"
```

---

### Task 13: WF2 v2 — écriture Notion (body + statut + commentaire Flux)

**Context:** Convertir la sortie Gemini en blocs Notion, écrire dans le body de la page, update statut, ajouter commentaire Flux LoRA si LinkedIn.

- [ ] **Step 1: Ajouter Code node conversion → blocs Notion**

Node 14 : `Convertir en blocs Notion` — code

```javascript
const item = $json;
const blocks = [];
const now = new Date().toISOString().split('T')[0];

// Séparateur + en-tête
blocks.push({ object: 'block', type: 'divider', divider: {} });
blocks.push({
  object: 'block', type: 'heading_3',
  heading_3: { rich_text: [{ type: 'text', text: { content: `Contenu généré le ${now}` } }] }
});

// Titre
if (item.titre) {
  blocks.push({
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: item.titre } }] }
  });
}

// Hook (quote)
if (item.hook) {
  blocks.push({
    object: 'block', type: 'quote',
    quote: { rich_text: [{ type: 'text', text: { content: item.hook } }] }
  });
}

// Contenu (paragraphes + listes)
if (item.contenu) {
  const lines = item.contenu.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('\u2192 ') || trimmed.startsWith('\u21b3 ')) {
      const text = trimmed.replace(/^[-*\u2192\u21b3]\s*/, '');
      blocks.push({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] }
      });
    } else {
      blocks.push({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: trimmed } }] }
      });
    }
  }
}

// CTA (callout)
if (item.cta) {
  blocks.push({
    object: 'block', type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: item.cta } }],
      icon: { type: 'emoji', emoji: '\u270b' }
    }
  });
}

// Toggle "Prompt utilisé"
blocks.push({
  object: 'block', type: 'toggle',
  toggle: {
    rich_text: [{ type: 'text', text: { content: 'Prompt utilisé' } }],
    children: [{
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: item.promptComplet || 'N/A' } }] }
    }]
  }
});

return [{ json: { ...item, notionBlocks: blocks } }];
```

- [ ] **Step 2: Ajouter écriture body Notion**

Node 15 : `Ecrire body Notion` — httpRequest
- PATCH `https://api.notion.com/v1/blocks/{{ $json.pageId }}/children`
- Body : `{ "children": {{ JSON.stringify($json.notionBlocks) }} }`
- continueOnFail: true

- [ ] **Step 3: Ajouter update statut → "Générés par IA"**

Node 16 : `Mettre a jour statut Genere` — httpRequest
- PATCH `https://api.notion.com/v1/pages/{{ $json.pageId }}`
- Body : `{ "properties": { "État": { "status": { "name": "🤖 Générés par IA" } } } }`

- [ ] **Step 4: Ajouter branche LinkedIn — query few-shot + commentaire Flux**

Node 17a : `Filtrer canal LinkedIn` — code
```javascript
if ($json.canal === 'LinkedIn' && $json.fluxPrompts?.length > 0) return [$input.first()];
return [];
```

Node 17b : `Requeter prompts visuels valides` — httpRequest
- POST Notion query __contenus : filter `Prompt visuel validé` is_not_empty + Canal = LinkedIn
- Sort : created_time descending, page_size: 5

Node 17c : `Assembler commentaire Flux` — code
```javascript
const item = $json;
const profil = $('Extraire variables profil').first().json;
const triggerWord = profil.triggerLora || '[TRIGGER]';

// Few-shot : prompts validés récents
const validated = $('Requeter prompts visuels valides').first().json.results || [];
const fewShotExamples = validated
  .map(v => (v.properties['Prompt visuel validé']?.rich_text || []).map(t => t.plain_text).join(''))
  .filter(Boolean)
  .slice(0, 3);

// Remplacer [TRIGGER] par le vrai trigger word
const prompts = item.fluxPrompts.map(p => p.replace(/\[TRIGGER\]/g, triggerWord));

let comment = 'Suggestions visuels Flux LoRA :\n\n';
prompts.forEach((p, i) => { comment += `${i + 1}. ${p}\n\n`; });
comment += 'Parametres recommandes : LoRA weight 0.7-0.8, CFG 2.5-3.5, 35-50 steps';

if (fewShotExamples.length > 0) {
  comment += '\n\nExemples valides precedents :\n';
  fewShotExamples.forEach((ex, i) => { comment += `${i + 1}. ${ex}\n`; });
}

return [{ json: { ...item, fluxComment: comment } }];
```

Node 17d : `Ajouter commentaire Flux` — httpRequest
- POST `https://api.notion.com/v1/comments`
- Body : `{ "parent": { "page_id": "{{ $json.pageId }}" }, "rich_text": [{ "text": { "content": "{{ $json.fluxComment }}" } }] }`

- [ ] **Step 5: Ajouter agrégation + email recap**

Node 18 : `Agreger resultats` — code (agrège tous les résultats de génération)
Node 19 : `Email recap generation` — gmail

- [ ] **Step 6: Ajouter batching**

Si plus de 3 contenus : envelopper les nodes 4-17 dans un Split In Batches (batch size 3) avec un Wait node (2s) entre les batches.

- [ ] **Step 7: Assigner Error Workflow**

- [ ] **Step 8: Test complet WF2 v2**

1. Créer une carte "Confiés à l'IA" dans __contenus avec : Idée de post, Canal = LinkedIn, Profil relié
2. Exécuter le workflow
3. Vérifier : body de la page (titre, hook, contenu, CTA, toggle prompt), statut "Générés par IA", commentaire Flux LoRA

- [ ] **Step 9: Commit**

```bash
git commit -m "feat: WF2 Generator v2 - écriture body Notion + Flux LoRA + batching"
```

---

## Chunk 4: Phase 3 — WF3 Newsletter + Post-migration

### Task 14: WF3 v2 — Content Newsletter (adaptation Notion)

**Context:** Adaptation du workflow La Missive. Remplacer les reads Sheet par des queries Notion, le profil Google Doc par le profil Notion.

- [ ] **Step 1: Créer le workflow**

Utiliser `mcp__n8n-mcp__n8n_create_workflow` :
- Name: `Content - Newsletter v2`
- Active: false

- [ ] **Step 2: Ajouter les nodes de base**

Nodes :
1. `Declencheur mensuel 25` — scheduleTrigger (25/mois 9h)
2. `Requeter profil actif` — httpRequest (même que WF1)
3. `Valider profil present` — code (même que WF1)
4. `Telecharger reference newsletter` — googleDrive (URL depuis `$json.refNewsletterUrl`)
5. `Extraire texte reference` — extractFromFile
6. `Telecharger prompt newsletter` — googleDrive (URL depuis `$json.promptNewsletterUrl`)
7. `Extraire texte prompt` — extractFromFile

- [ ] **Step 3: Ajouter queries Notion du mois**

Node 8 : `Requeter contenus du mois` — httpRequest
- POST Notion query __contenus
- Filter : created_time >= premier du mois courant ET État in [Générés par IA, À illustrer, Validés, Programmés, Publié]

Body avec expression pour la date dynamique :
```json
{
  "filter": {
    "and": [
      {
        "timestamp": "created_time",
        "created_time": { "on_or_after": "={{ new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0] }}" }
      },
      {
        "or": [
          { "property": "État", "status": { "equals": "🤖 Générés par IA" } },
          { "property": "État", "status": { "equals": "À illustrer" } },
          { "property": "État", "status": { "equals": "Validés" } },
          { "property": "État", "status": { "equals": "Programmés" } },
          { "property": "État", "status": { "equals": "Publié" } }
        ]
      }
    ]
  }
}
```

Node 9 : `Requeter idees du mois` — httpRequest
- POST Notion query idées, filter : created_time >= premier du mois

- [ ] **Step 4: Ajouter assemblage prompt + Gemini + Google Doc**

Nodes 10-15 : reprendre la logique du WF3 actuel, en remplaçant les données Sheet par les données Notion.

- Code : `Assembler prompt Newsletter` — combine profil Notion + reference + prompt + contenus du mois + idées
- HTTP : `Gemini Generer Newsletter` — appel Gemini (retry 2x)
- Code : `Parser Newsletter`
- HTTP : `Creer Google Doc natif` — Drive API create
- Code : `Construire formatage`
- HTTP : `Appliquer formatage` — Docs API batchUpdate
- Gmail : `Notifier Alex`

- [ ] **Step 5: Assigner Error Workflow**

- [ ] **Step 6: Test complet WF3 v2**

Vérifier : Google Doc créé avec formatage, email reçu, pas d'erreurs.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: WF3 Newsletter v2 - adaptation Notion (queries + profil)"
```

---

### Task 15: Post-migration — validation + bascule

**Context:** Valider les 3 nouveaux workflows, désactiver les anciens, activer les nouveaux.

- [ ] **Step 1: Test intégration complet**

1. Exécuter WF1 v2 → vérifier pages dans `idées`
2. Créer manuellement une carte `__contenus` reliée, statut "Confiés à l'IA"
3. Exécuter WF2 v2 → vérifier body, statut, commentaire Flux
4. Exécuter WF3 v2 → vérifier Google Doc newsletter

- [ ] **Step 2: Désactiver les anciens workflows**

Via MCP : désactiver `N8N_RESOURCE_ID_07`, `N8N_RESOURCE_ID_21`, `N8N_RESOURCE_ID_02`.
Ne PAS supprimer.

- [ ] **Step 3: Activer les nouveaux workflows un par un**

1. Activer WF1 v2 (Veille) en premier — prochain lundi 8h
2. Après validation WF1 : activer WF2 v2 (Generator)
3. Après validation WF2 : activer WF3 v2 (Newsletter)

- [ ] **Step 4: Mettre à jour la mémoire projet**

Mettre à jour `MEMORY.md` avec les nouveaux IDs de workflows, les bases Notion, et les leçons apprises.

- [ ] **Step 5: Commit final**

```bash
git commit -m "feat: migration Content System vers Notion complète (3 workflows v2)"
```
