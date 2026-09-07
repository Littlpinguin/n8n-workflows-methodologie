# Content System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 3 n8n workflows (Veille Hebdo, Content Generator, La Missive du Prof) reliés par un Google Sheet central et des prompts éditables dans Google Docs, utilisant Perplexity pour la veille et Gemini 3 Pro pour la rédaction.

**Architecture:** 3 workflows indépendants connectés via un Google Sheet "Content Calendar" (2 onglets). Les prompts sont stockés dans Google Docs éditables. Le profil business et le guide éditorial existants sont lus par tous les workflows. L'Error Handler existant (`N8N_RESOURCE_ID_28`) est assigné aux 3 workflows.

**Tech Stack:** n8n 2.35.5, Gemini 3 Pro (HTTP Request direct), Perplexity sonar-pro (HTTP Request), Google Sheets, Google Drive/Docs, Gmail

**Références:**
- Design : `docs/plans/2026-02-24-content-system-design.md`
- Workflow de référence : `Gmail - Inbox Genie` (`N8N_RESOURCE_ID_01`) — pattern chargement profil + Gemini HTTP Request

**IDs Google Drive existants:**
- Profil Business : `GOOGLE_DOC_ID_02`
- Guide Editorial : `GOOGLE_DOC_ID_08`
- Reference Missive : `GOOGLE_DOC_ID_06`
- Dossier Content System : `GOOGLE_DOC_ID_17`
- Error Handler workflow : `N8N_RESOURCE_ID_28`

---

## Task 1 : Créer le Google Sheet "Content Calendar"

**Objectif :** Créer le Google Sheet central avec 2 onglets (Propositions + Brouillons) et les en-têtes définis dans le design.

**Outils :** MCP Google Drive (createSpreadsheet, addSheet, writeSpreadsheet)

**Step 1 : Créer le spreadsheet**

Utiliser `mcp__google-drive__createSpreadsheet` :
- Nom : `Content Calendar`
- Créer dans le dossier Content System (`GOOGLE_DOC_ID_17`)

**Step 2 : Renommer Sheet1 en "Propositions" et écrire les en-têtes**

Utiliser `mcp__google-drive__writeSpreadsheet` sur la première feuille (renommer via l'UI ou API) :

En-têtes ligne 1 :
```
Date | Sujet | Angle | Plateforme | Score | Priorité | Sources | Statut | Notes
```

**Step 3 : Ajouter l'onglet "Brouillons"**

Utiliser `mcp__google-drive__addSheet` pour créer le second onglet.

En-têtes ligne 1 :
```
Date | Sujet (ref) | Plateforme | Titre | Hook | Contenu | CTA | Hashtags | Statut | Date publication | Logs
```

**Step 4 : Formater les colonnes**

Utiliser `mcp__google-drive__formatCells` :
- Mettre en gras la ligne 1 des deux onglets
- Figer la ligne 1 sur les deux onglets (`mcp__google-drive__freezeRowsAndColumns`)

**Step 5 : Vérifier**

Lire le spreadsheet pour confirmer les 2 onglets et les en-têtes.

**Step 6 : Commit**

```bash
# Pas de fichier local — noter l'ID du Sheet dans le design doc
git commit -m "docs: noter ID Content Calendar Google Sheet"
```

---

## Task 2 : Créer les 4 Google Docs prompts

**Objectif :** Créer les 4 prompts éditables dans le dossier Content System sur Google Drive. Chaque prompt utilise la structure XML-tagged définie dans le design.

**Outils :** MCP Google Drive (createDocument, appendText)

### Step 1 : Créer le Google Doc "Prompt LinkedIn"

Utiliser `mcp__google-drive__createDocument` dans le dossier `GOOGLE_DOC_ID_17`.

Contenu à écrire via `mcp__google-drive__appendText` :

```xml
<role>
Tu es un stratège LinkedIn spécialisé en thought leadership B2B dans le domaine de l'IA appliquée aux PME/ETI. Tu écris pour Alex Martin, "Le Prof", formateur et consultant IA.
</role>

<context>
{{PROFIL_BUSINESS}}
{{GUIDE_EDITORIAL}}
</context>

<subject>
{{SUJET}}
Angle : {{ANGLE}}
</subject>

<sources>
{{SOURCES_PERPLEXITY}}
</sources>

<instructions>
1. Rédige un hook percutant en 1 ligne max. Utilise un pattern "Information Gap" (créer la curiosité par un paradoxe ou une stat surprenante) ou "Prediction Error" (contredire une croyance commune).
2. Développe en paragraphes courts (2-3 lignes max chacun). Chaque paragraphe = une idée.
3. Inclus au moins un exemple concret terrain (cas client anonymisé, retour d'expérience, anecdote de formation).
4. Assume une opinion claire — pas de "ça dépend". Le Prof a un avis.
5. Termine par un CTA conversationnel (question ouverte qui invite au débat, pas "contactez-moi").
6. Le ton est celui d'un prof passionné qui explique à des collègues intelligents, pas d'un consultant qui vend.
</instructions>

<format>
Hook (1 ligne)

Contexte (2-3 lignes qui posent le problème)

Développement (3-5 paragraphes courts, chacun 2-3 lignes)

Takeaway (1 phrase synthèse)

CTA (question ouverte)

3-5 hashtags
</format>

<constraints>
- Max ~1300 caractères (optimal engagement LinkedIn)
- JAMAIS de bullet points comme structure principale
- JAMAIS de ton corporate ou institutionnel
- JAMAIS de "il faut", "il est important de", "il convient de"
- JAMAIS de promesse miracle ("révolutionner", "transformer radicalement")
- JAMAIS d'émojis en début de ligne comme structure
- Pas de jargon non expliqué — si un terme technique est nécessaire, l'expliquer en une parenthèse
- Tutoiement interdit sur LinkedIn (vouvoiement professionnel)
</constraints>

<output>
Réponds UNIQUEMENT en JSON valide :
{
  "titre": "Titre interne (pas affiché sur LinkedIn)",
  "hook": "La première ligne du post",
  "contenu": "Le corps complet du post LinkedIn, avec sauts de ligne",
  "cta": "La question/CTA de fin",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
  "notes_internes": "Explications sur les choix éditoriaux"
}
</output>
```

### Step 2 : Créer le Google Doc "Prompt Substack Article"

Contenu :

```xml
<role>
Tu es un rédacteur éditorial spécialisé en articles de fond tech/IA pour une audience de managers et chefs de projet en PME/ETI. Tu écris pour Alex Martin, "Le Prof", sur son Substack.
</role>

<context>
{{PROFIL_BUSINESS}}
{{GUIDE_EDITORIAL}}
</context>

<subject>
{{SUJET}}
Angle : {{ANGLE}}
</subject>

<sources>
{{SOURCES_PERPLEXITY}}
</sources>

<instructions>
1. Rédige un titre accrocheur mais pas clickbait. Le titre doit promettre une valeur concrète.
2. Écris un chapô de 2-3 phrases qui pose le problème business et annonce la promesse de l'article.
3. Structure en 3-5 sections avec sous-titres clairs. Chaque section = un angle ou argument distinct.
4. Chaque section doit contenir au moins un élément concret : chiffre, cas d'usage, retour terrain, exemple client (anonymisé).
5. Ramène TOUJOURS à l'impact business — pas la tech pour la tech.
6. Conclus avec une prise de position claire et un CTA vers l'abonnement Substack.
7. Le ton est celui du "prof qui décrypte" : pédagogue, direct, avec des analogies accessibles.
</instructions>

<format>
# Titre

Chapô (2-3 phrases)

## Section 1 : [sous-titre]
[contenu 150-300 mots]

## Section 2 : [sous-titre]
[contenu 150-300 mots]

## Section 3 : [sous-titre]
[contenu 150-300 mots]

[Sections 4-5 optionnelles si le sujet le justifie]

## En résumé
[Prise de position en 2-3 phrases]

---
CTA abonnement
</format>

<constraints>
- 800-1500 mots (ni trop court ni indigeste)
- JAMAIS de jargon technique non expliqué
- JAMAIS de "il faut", "il est important de"
- JAMAIS de listes à puces comme structure principale d'une section
- Toujours ramener à l'impact business, pas à la techno
- Ton "prof qui explique", pas "consultant qui vend"
- Tutoiement autorisé sur Substack (audience plus proche)
- Pas de promesse miracle, pas de hype
</constraints>

<output>
Réponds UNIQUEMENT en JSON valide :
{
  "titre": "Le titre de l'article",
  "contenu": "Le corps complet en markdown",
  "hook": "Le chapô / 2-3 premières phrases",
  "cta": "Le call-to-action de fin",
  "hashtags": [],
  "notes_internes": "Explications sur les choix éditoriaux et la structure"
}
</output>
```

### Step 3 : Créer le Google Doc "Prompt Substack Notes"

Contenu :

```xml
<role>
Tu es un micro-blogueur tech/IA avec une voix directe et percutante. Tu écris pour Alex Martin, "Le Prof", sur Substack Notes (micro-blogging).
</role>

<context>
{{PROFIL_BUSINESS}}
{{GUIDE_EDITORIAL}}
</context>

<subject>
{{SUJET}}
Angle : {{ANGLE}}
Contenu source (si dérivé) : {{CONTENU_SOURCE}}
</subject>

<sources>
{{SOURCES_PERPLEXITY}}
</sources>

<instructions>
1. Extrais l'insight le plus percutant du sujet ou du contenu source.
2. Reformule en 1-3 phrases maximum. Chaque mot doit compter.
3. Termine par une question ou une provocation qui invite à la réaction.
4. Le ton est conversationnel, comme un message à un ami intelligent.
5. La note doit être 100% autonome — compréhensible sans avoir lu l'article source.
</instructions>

<format>
[1-3 phrases percutantes]
[Question ou provocation finale]
</format>

<constraints>
- Max ~280 caractères idéalement (format micro)
- JAMAIS de hashtags
- JAMAIS de structure "liste à puces"
- JAMAIS de lien (le contenu se suffit)
- Ton conversationnel, tutoiement OK
- Autonome : compréhensible sans contexte supplémentaire
</constraints>

<output>
Réponds UNIQUEMENT en JSON valide :
{
  "titre": "Titre interne (pas affiché)",
  "contenu": "La note complète",
  "hook": "La première phrase",
  "cta": "",
  "hashtags": [],
  "notes_internes": "Insight clé extrait et choix de formulation"
}
</output>
```

### Step 4 : Créer le Google Doc "Prompt La Missive du Prof"

Contenu :

```xml
<role>
Tu es l'éditorialiste mensuel "Le Prof" — Alex Martin. Tu rédiges "La Missive du Prof", une newsletter mensuelle pour des managers et chefs de projet qui veulent devenir référents IA dans leur entreprise.
</role>

<context>
{{PROFIL_BUSINESS}}
{{GUIDE_EDITORIAL}}
{{REFERENCE_MISSIVE}}
</context>

<subject>
Mois : {{MOIS_ANNEE}}
Contenus publiés ce mois : {{CONTENUS_PUBLIES}}
Propositions du mois (contexte) : {{PROPOSITIONS_MOIS}}
</subject>

<sources>
{{SOURCES_PERPLEXITY_MOIS}}
</sources>

<instructions>
1. ANALYSE ÉDITORIALE (~60% de la missive) : Choisis le sujet le plus marquant du mois. Décrypte en profondeur avec ton opinion tranchée. Appuie-toi sur les contenus déjà publiés ce mois comme matière première. Écris comme si tu parlais à un collègue intelligent autour d'un café.

2. OUTIL COUP DE COEUR (~15%) : Identifie un outil pertinent parmi les sources Perplexity ou les contenus du mois. Présente-le avec un retour terrain concret (pas juste "c'est bien"). Dis ce que ça change concrètement pour un manager/chef de projet.

3. CONTENU DE MARQUE (~10%) : Actualité d'Alex — formations à venir, projets en cours, témoignages clients. Si aucune info spécifique n'est fournie, propose un placeholder à compléter.

4. DÉFI DU MOIS (~10%) : Propose une action concrète, réalisable en 30 min, que le lecteur peut faire cette semaine. Lié au sujet principal.

5. NOTE PERSO (~5%) : Touche humaine — anecdote, réflexion personnelle, clin d'œil. Donne envie de connaître l'humain derrière le prof.

6. Structure avec un sommaire cliquable en haut. Chaque section doit pouvoir se lire indépendamment.
</instructions>

<format>
# [Titre accrocheur de la Missive]

## Sommaire
- Analyse : [titre section]
- Outil coup de coeur : [nom outil]
- Chez Le Prof : [accroche]
- Défi du mois : [accroche]
- En coulisses : [accroche]

---

## [Titre analyse éditoriale]
[800-1200 mots — développement en paragraphes, pas en listes]

---

## Outil coup de coeur : [Nom]
[200-300 mots — description + retour terrain + verdict]

---

## Chez Le Prof
[150-200 mots — actualité Alex ou placeholder]

---

## Le défi du mois
[100-150 mots — action concrète + pourquoi]

---

## En coulisses
[80-120 mots — note perso]

---

[CTA : abonnement / partage / réponse]
</format>

<constraints>
- 1500-2500 mots au total
- JAMAIS de listes à puces comme structure principale
- Rythme "oral écrit" — comme une conversation, pas un rapport
- Tutoiement obligatoire (audience proche, newsletter intime)
- Chaque section lisible indépendamment
- Opinion tranchée obligatoire dans l'analyse
- JAMAIS de "il faut", "il est important de"
- JAMAIS de hype ou promesse miracle
- Signature "Le Prof" en fin
</constraints>

<output>
Réponds UNIQUEMENT en JSON valide :
{
  "titre": "Le titre de la Missive",
  "contenu": "Le corps complet en markdown",
  "hook": "Le sommaire",
  "cta": "Le CTA final",
  "hashtags": [],
  "notes_internes": "Choix du sujet principal, logique de structure, éléments à compléter manuellement"
}
</output>
```

### Step 5 : Vérifier les 4 documents

Lire chaque document créé pour confirmer le contenu. Noter les 4 IDs.

### Step 6 : Commit

```bash
# Mettre à jour le design doc avec les IDs des prompts
git add docs/plans/2026-02-24-content-system-design.md
git commit -m "docs: noter IDs Google Docs prompts Content System"
```

---

## Task 3 : Construire WF1 — Veille Hebdo

**Objectif :** Workflow n8n : Schedule Trigger (lundi 8h) → chargement profil/guide → 3 requêtes Perplexity parallèles → Merge → Gemini scoring → IF score >= 7 → Google Sheet → email récap.

**Outils :** n8n-mcp (create_workflow, update_partial_workflow, validate_workflow)
**Credential requise :** Perplexity API key (à configurer dans n8n UI si pas déjà fait)

**Pattern de référence :** `Gmail - Inbox Genie` (`N8N_RESOURCE_ID_01`) pour le chargement profil + appel Gemini HTTP Request.

### Step 1 : Créer le workflow squelette

Utiliser `mcp__n8n-mcp__n8n_create_workflow` avec le nom `Content - Veille Hebdo`.

Nodes initiaux :
1. **Schedule Trigger** (`scheduleTrigger`) — lundi 8h, `rule.type: "weeks"`, `triggerAtHour: 8`
2. **Sticky Note** — "WF1 Veille Hebdo — Perplexity ×3 + Gemini scoring → Google Sheet Propositions"

Connexions : aucune pour l'instant.

Vérifier la création via `n8n_get_workflow`.

### Step 2 : Ajouter le chargement du Profil Business

Ajouter les nodes (pattern copié de Inbox Genie) :
- **Chercher profil business** (`googleDrive`, operation: search, query: fileId `GOOGLE_DOC_ID_02`)
- **Telecharger profil business** (`googleDrive`, operation: download, `googleFileConversion` avec `docsToFormat: "text/plain"`)
- **Extraire texte profil** (`extractFromFile`)

`executeOnce: true` sur le premier node de cette chaîne.

Connexion : Schedule Trigger → Chercher profil → Telecharger → Extraire texte.

### Step 3 : Ajouter le chargement du Guide Editorial

Même pattern que Step 2 mais avec l'ID `GOOGLE_DOC_ID_08`.

Nodes :
- **Chercher guide editorial** (`googleDrive`)
- **Telecharger guide editorial** (`googleDrive`)
- **Extraire texte guide** (`extractFromFile`)

Branche parallèle depuis le Schedule Trigger.

### Step 4 : Ajouter les 3 requêtes Perplexity parallèles

3 nodes HTTP Request en parallèle, connectés après Extraire texte profil (pour avoir le profil en contexte) :

**Node "Perplexity — Gouvernance IA"** (`httpRequest`) :
```json
{
  "method": "POST",
  "url": "https://api.perplexity.ai/chat/completions",
  "authentication": "genericCredentialType",
  "genericAuthType": "httpHeaderAuth",
  "sendHeaders": true,
  "headerParameters": {
    "parameters": [{"name": "Content-Type", "value": "application/json"}]
  },
  "sendBody": true,
  "bodyParameters": {
    "model": "sonar-pro",
    "messages": [
      {"role": "system", "content": "Tu es un analyste veille IA spécialisé gouvernance. Recherche les actualités des 7 derniers jours sur : régulations IA (AI Act, RGPD), frameworks de gouvernance IA, politiques internes IA en entreprise. Retourne 3-5 sujets avec titre, résumé (3 phrases), sources, et pertinence pour des managers PME/ETI."},
      {"role": "user", "content": "Actualités gouvernance IA de la semaine pour un consultant IA qui forme des managers en PME/ETI"}
    ]
  },
  "options": {
    "response": {"response": {"fullResponse": true}},
    "timeout": 30000
  }
}
```
- `continueOnFail: true`
- `retryOnFail: true`, `maxTries: 2`, `waitBetweenTries: 5000`

**Node "Perplexity — Integration IA equipes"** : même structure, prompt adapté à l'adoption IA, change management, cas PME.

**Node "Perplexity — Innovations PME"** : même structure, prompt adapté aux outils émergents, automatisations, cas d'usage terrain.

Les 3 sont connectés en parallèle depuis le même node source.

### Step 5 : Ajouter le Merge + Code Node de préparation

**Merge node** : type "Append", combine les 3 flux Perplexity.

**Code Node "Preparer donnees scoring"** : normalise les résultats Perplexity en items exploitables.

```javascript
const items = $input.all();
const profilText = $('Extraire texte profil').first().json.data;
const guideText = $('Extraire texte guide').first().json.data;

const sujets = [];
for (const item of items) {
  const content = item.json.choices?.[0]?.message?.content || '';
  const citations = item.json.citations || [];
  sujets.push({
    contenu: content,
    sources: citations.join(', ')
  });
}

return [{
  json: {
    sujets,
    profil: profilText,
    guide: guideText
  }
}];
```

### Step 6 : Ajouter l'appel Gemini 3 Pro pour le scoring

**Node "Gemini — Scorer et proposer"** (`httpRequest`) :

```json
{
  "method": "POST",
  "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
  "authentication": "genericCredentialType",
  "genericAuthType": "httpQueryAuth",
  "sendBody": true,
  "contentType": "raw",
  "rawContentType": "application/json",
  "body": "={{ JSON.stringify({ contents: [{ parts: [{ text: `Tu es un stratège contenu IA. Analyse ces résultats de veille et propose des sujets de contenu.\n\nPROFIL BUSINESS :\n${$json.profil}\n\nGUIDE EDITORIAL :\n${$json.guide}\n\nRESULTATS VEILLE :\n${JSON.stringify($json.sujets)}\n\nPour chaque sujet pertinent, retourne un JSON array avec :\n- sujet: titre du sujet\n- angle: comment Alex \"Le Prof\" l'aborderait\n- plateforme: \"LinkedIn\" ou \"Substack Article\" ou \"Substack Notes\" (choisis la plus adaptée)\n- score: pertinence 1-10 par rapport au positionnement\n- priorite: \"Urgent\" ou \"Tendance\" ou \"Evergreen\"\n- sources: URLs de référence` }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }) }}",
  "options": { "timeout": 60000 }
}
```

- `retryOnFail: true`, `maxTries: 1`

### Step 7 : Ajouter le parsing + IF score >= 7

**Code Node "Parser propositions"** :

```javascript
const response = $input.first().json;
const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
let propositions;
try {
  propositions = JSON.parse(text);
  if (!Array.isArray(propositions)) propositions = [propositions];
} catch(e) {
  propositions = [];
}

return propositions
  .filter(p => (p.score || 0) >= 7)
  .map(p => ({
    json: {
      date: new Date().toISOString().split('T')[0],
      sujet: p.sujet || '',
      angle: p.angle || '',
      plateforme: p.plateforme || 'LinkedIn',
      score: p.score || 0,
      priorite: p.priorite || 'Tendance',
      sources: p.sources || '',
      statut: 'PROPOSITION',
      notes: ''
    }
  }));
```

**IF Node "Propositions trouvees"** : vérifie que des items existent (branche true continue, false → email "aucune proposition cette semaine").

### Step 8 : Ajouter l'écriture Google Sheet

**Node "Ecrire propositions"** (`googleSheets`, operation: `appendOrUpdate`) :
- SpreadsheetId : `{{ID du Content Calendar créé en Task 1}}`
- Sheet : "Propositions"
- Mapping : colonnes Date, Sujet, Angle, Plateforme, Score, Priorité, Sources, Statut, Notes

### Step 9 : Ajouter l'email récap

**Node "Email recap veille"** (`gmail`, operation: `send`) :
- To : contact@example.com
- Subject : `Content Watch — {{$now.toFormat('dd/MM/yyyy')}} — {{$input.all().length}} propositions`
- Body : résumé des propositions (sujets + scores + plateformes)

### Step 10 : Configurer l'Error Workflow

Assigner `N8N_RESOURCE_ID_28` comme Error Workflow dans les settings du workflow.

### Step 11 : Ajouter les Sticky Notes

4 sticky notes :
1. "1. Trigger + Config" (près du Schedule Trigger)
2. "2. Veille Perplexity ×3" (près des 3 HTTP Request)
3. "3. Scoring Gemini" (près du Gemini node)
4. "4. Écriture Sheet + Notification" (près du Google Sheet)

### Step 12 : Valider le workflow

```
mcp__n8n-mcp__n8n_validate_workflow(workflowId)
```

Corriger les erreurs éventuelles.

### Step 13 : Tester avec exécution manuelle

```
mcp__n8n-mcp__n8n_test_workflow(workflowId)
```

Vérifier que :
- Les 3 requêtes Perplexity retournent des résultats
- Gemini score les sujets correctement
- Les propositions arrivent dans le Google Sheet
- L'email récap est envoyé

### Step 14 : Commit

```bash
git add docs/plans/2026-02-24-content-system-design.md
git commit -m "feat: WF1 Veille Hebdo — Perplexity + Gemini scoring + Google Sheet"
```

---

## Task 4 : Construire WF2 — Content Generator

**Objectif :** Workflow n8n : Schedule Trigger (quotidien 9h) → lire sujets VALIDÉ → charger profil + guide + prompt plateforme → Gemini 3 Pro → écrire brouillon Sheet → email récap.

**Outils :** n8n-mcp

### Step 1 : Créer le workflow squelette

`mcp__n8n-mcp__n8n_create_workflow` : nom `Content - Generator`.

Nodes :
1. **Schedule Trigger** — quotidien 9h
2. **Sticky Note** — "WF2 Content Generator — Sheet VALIDÉ → Gemini 3 Pro → brouillons"

### Step 2 : Ajouter la lecture des sujets VALIDÉ

**Node "Lire sujets valides"** (`googleSheets`, operation: `getRows`) :
- SpreadsheetId : Content Calendar
- Sheet : "Propositions"
- Filters : colonne Statut = "VALIDÉ"

**IF Node "Sujets a traiter"** : vérifie items > 0. Si false → Stop (No Operation).

### Step 3 : Ajouter le chargement Profil + Guide (branche parallèle)

Même pattern que WF1 Task 3 Steps 2-3 :
- Chercher/Telecharger/Extraire Profil Business (`executeOnce: true`)
- Chercher/Telecharger/Extraire Guide Editorial (`executeOnce: true`)

### Step 4 : Ajouter le Switch Plateforme + chargement prompt

**Switch Node "Router plateforme"** :
- Rules basées sur `{{ $json.plateforme }}`
- Output 0 : "LinkedIn"
- Output 1 : "Substack Article"
- Output 2 : "Substack Notes"

Pour chaque sortie, un node Google Drive qui lit le Google Doc prompt correspondant :
- **Charger Prompt LinkedIn** → Google Drive read (ID du prompt LinkedIn créé en Task 2)
- **Charger Prompt Substack Article** → Google Drive read
- **Charger Prompt Substack Notes** → Google Drive read

Chaque branche converge vers un **Merge node** avant l'appel Gemini.

### Step 5 : Ajouter le Code Node d'assemblage du prompt

**Code Node "Assembler prompt final"** :

```javascript
const sujet = $('Lire sujets valides').item.json;
const profil = $('Extraire texte profil').first().json.data;
const guide = $('Extraire texte guide').first().json.data;

// Le prompt vient de la branche Switch — le dernier node exécuté
const promptTemplate = $input.first().json.data || $input.first().json.text || '';

// Remplacer les placeholders
let prompt = promptTemplate
  .replace('{{PROFIL_BUSINESS}}', profil)
  .replace('{{GUIDE_EDITORIAL}}', guide)
  .replace('{{SUJET}}', sujet.sujet || '')
  .replace('{{ANGLE}}', sujet.angle || '')
  .replace('{{SOURCES_PERPLEXITY}}', sujet.sources || '')
  .replace('{{CONTENU_SOURCE}}', '');

return [{
  json: {
    prompt,
    sujet: sujet.sujet,
    plateforme: sujet.plateforme,
    rowIndex: sujet.row_number || 0
  }
}];
```

### Step 6 : Ajouter l'appel Gemini 3 Pro

**Node "Gemini — Generer contenu"** (`httpRequest`) :
- Même pattern que WF1 mais avec le prompt assemblé
- `responseMimeType: 'application/json'`
- `temperature: 0.7`
- `retryOnFail: true`, `maxTries: 2`, `waitBetweenTries: 10000`

### Step 7 : Ajouter le parsing + écriture brouillon

**Code Node "Parser contenu genere"** :

```javascript
const response = $input.first().json;
const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
let contenu;
try {
  contenu = JSON.parse(text);
} catch(e) {
  return [{ json: { error: true, raw: text } }];
}

const meta = $('Assembler prompt final').first().json;

return [{
  json: {
    date: new Date().toISOString().split('T')[0],
    sujet_ref: meta.sujet,
    plateforme: meta.plateforme,
    titre: contenu.titre || '',
    hook: contenu.hook || '',
    contenu: contenu.contenu || '',
    cta: contenu.cta || '',
    hashtags: (contenu.hashtags || []).join(', '),
    statut: 'BROUILLON',
    date_publication: '',
    logs: `WF2 Generator — ${new Date().toISOString()}`
  }
}];
```

**IF "Contenu genere OK"** : vérifie `$json.error !== true`. True → écriture Sheet. False → marquer ERREUR.

**Node "Ecrire brouillon"** (`googleSheets`, operation: `appendOrUpdate`) :
- Sheet : "Brouillons"
- Mapping des colonnes

### Step 8 : Ajouter la mise à jour du statut Proposition

**Node "Mettre a jour statut"** (`googleSheets`, operation: `update`) :
- Sheet : "Propositions"
- Lookup column : row_number ou Sujet
- Update : Statut → "EN COURS"

### Step 9 : Ajouter l'email récap

**Node "Email recap generation"** (`gmail`) :
- Subject : `Content Generator — {{$now.toFormat('dd/MM/yyyy')}} — brouillons générés`
- Body : liste des brouillons (titre + plateforme)

### Step 10 : Error Workflow + Sticky Notes

- Assigner Error Workflow `N8N_RESOURCE_ID_28`
- 5 sticky notes : Trigger, Lecture Sheet, Chargement docs, Génération Gemini, Écriture + Notif

### Step 11 : Valider + tester

1. `mcp__n8n-mcp__n8n_validate_workflow`
2. Ajouter manuellement une ligne VALIDÉ dans le Sheet Propositions (test data)
3. `mcp__n8n-mcp__n8n_test_workflow`
4. Vérifier le brouillon dans l'onglet Brouillons

### Step 12 : Commit

```bash
git commit -m "feat: WF2 Content Generator — Sheet VALIDÉ → Gemini 3 Pro → brouillons"
```

---

## Task 5 : Construire WF3 — La Missive du Prof

**Objectif :** Workflow n8n : Schedule Trigger (25/mois 9h) → charger profil + guide + reference missive + prompt missive → lire contenus PUBLIÉ du mois → Gemini 3 Pro → créer Google Doc brouillon → email notification.

**Outils :** n8n-mcp

### Step 1 : Créer le workflow squelette

`mcp__n8n-mcp__n8n_create_workflow` : nom `Content - La Missive du Prof`.

### Step 2 : Schedule Trigger

**Schedule Trigger** : `rule.type: "months"`, jour 25, heure 9h.

### Step 3 : Chargement documents (4 Google Docs en parallèle)

Branches parallèles depuis le trigger :
1. Profil Business (même pattern que WF1/WF2)
2. Guide Editorial (même pattern)
3. Reference Missive (ID: `GOOGLE_DOC_ID_06`)
4. Prompt La Missive (ID créé en Task 2)

### Step 4 : Lecture Google Sheet — contenus du mois

**Node "Lire contenus publies"** (`googleSheets`, operation: `getRows`) :
- Sheet : "Brouillons"
- Filtre : Statut = "PUBLIÉ" + Date du mois courant

**Node "Lire propositions mois"** (`googleSheets`, operation: `getRows`) :
- Sheet : "Propositions"
- Filtre : Date du mois courant

### Step 5 : Code Node d'assemblage

**Code Node "Assembler prompt Missive"** :

```javascript
const profil = $('Extraire texte profil').first().json.data;
const guide = $('Extraire texte guide').first().json.data;
const refMissive = $('Extraire texte reference missive').first().json.data;
const promptTemplate = $('Extraire texte prompt missive').first().json.data;

const contenus = $('Lire contenus publies').all().map(i => i.json);
const propositions = $('Lire propositions mois').all().map(i => i.json);

const moisAnnee = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

let prompt = promptTemplate
  .replace('{{PROFIL_BUSINESS}}', profil)
  .replace('{{GUIDE_EDITORIAL}}', guide)
  .replace('{{REFERENCE_MISSIVE}}', refMissive)
  .replace('{{MOIS_ANNEE}}', moisAnnee)
  .replace('{{CONTENUS_PUBLIES}}', JSON.stringify(contenus, null, 2))
  .replace('{{PROPOSITIONS_MOIS}}', JSON.stringify(propositions, null, 2))
  .replace('{{SOURCES_PERPLEXITY_MOIS}}', propositions.map(p => p.sources).filter(Boolean).join('\n'));

return [{ json: { prompt, moisAnnee } }];
```

### Step 6 : Appel Gemini 3 Pro

Même pattern HTTP Request que WF2 mais avec le prompt Missive assemblé. Temperature 0.7.

### Step 7 : Parsing + création Google Doc

**Code Node "Parser Missive"** : extrait le JSON, récupère le contenu markdown.

**Node "Creer brouillon Missive"** (`googleDrive` ou `googleDocs`) :
- Créer un Google Doc dans le dossier Content System
- Nom : `Missive du Prof — {{moisAnnee}}`
- Contenu : le markdown de la Missive

### Step 8 : Email notification

**Node "Notifier Alex"** (`gmail`) :
- Subject : `La Missive du Prof — {{moisAnnee}} — brouillon prêt`
- Body : lien vers le Google Doc + sommaire de la Missive

### Step 9 : Error Workflow + Sticky Notes

- Assigner Error Workflow
- 4 sticky notes

### Step 10 : Valider + tester

1. `mcp__n8n-mcp__n8n_validate_workflow`
2. Ajouter des données test (contenus PUBLIÉ) dans le Sheet
3. `mcp__n8n-mcp__n8n_test_workflow`
4. Vérifier le Google Doc créé

### Step 11 : Commit

```bash
git commit -m "feat: WF3 La Missive du Prof — newsletter mensuelle Gemini 3 Pro"
```

---

## Task 6 : Tests end-to-end + mise à jour documentation

**Objectif :** Tester les 3 workflows ensemble, mettre à jour la mémoire et le design doc avec les IDs finaux.

### Step 1 : Test WF1 → WF2 chain

1. Exécuter WF1 manuellement
2. Vérifier les propositions dans le Sheet
3. Passer manuellement 1-2 propositions à VALIDÉ
4. Exécuter WF2 manuellement
5. Vérifier les brouillons dans le Sheet

### Step 2 : Test WF3

1. Passer manuellement quelques brouillons à PUBLIÉ
2. Exécuter WF3 manuellement
3. Vérifier le Google Doc de la Missive

### Step 3 : Vérifier l'Error Handler

Provoquer une erreur (URL invalide temporaire) et vérifier que l'email d'erreur arrive.

### Step 4 : Mettre à jour le design doc

Ajouter les IDs finaux :
- IDs des 3 workflows n8n
- ID du Google Sheet Content Calendar
- IDs des 4 Google Docs prompts

### Step 5 : Mettre à jour MEMORY.md

Ajouter les 3 workflows + Google Sheet + leçons apprises.

### Step 6 : Commit final

```bash
git add docs/plans/2026-02-24-content-system-design.md
git commit -m "docs: IDs finaux + REX Content System"
```

### Step 7 : Configurer les credentials Perplexity (si nécessaire)

Si la credential Perplexity n'existe pas encore dans n8n :
1. Prévenir Alex qu'il doit ajouter sa clé API Perplexity dans n8n UI
2. Type : HTTP Header Auth, Header Name: `Authorization`, Value: `Bearer sk-...`

---

## Ordre d'exécution recommandé

```
Task 1 (Google Sheet) ──────────────────────────────────────┐
Task 2 (4 Prompts Google Docs) ─────────────────────────────┤
                                                             ▼
Task 3 (WF1 Veille Hebdo) ─── dépend des IDs Task 1 + 2
                                                             │
Task 4 (WF2 Content Generator) ─── dépend des IDs Task 1 + 2
                                                             │
Task 5 (WF3 La Missive du Prof) ─── dépend des IDs Task 1 + 2
                                                             │
Task 6 (Tests e2e + docs) ─── dépend de Tasks 3-4-5
```

**Tasks 1 et 2 sont indépendantes** et peuvent être exécutées en parallèle.
**Tasks 3, 4, 5 sont indépendantes** entre elles mais dépendent des IDs de Tasks 1-2.
**Task 6 dépend de toutes les tasks précédentes.**

---

## Credential check-list (n8n UI)

| Credential | Type | Existe déjà ? | Utilisée par |
|------------|------|---------------|--------------|
| Google OAuth2 | OAuth2 | Oui (Inbox Genie) | WF1, WF2, WF3 |
| Gemini API Key | HTTP Query Auth | Oui (Inbox Genie) | WF1, WF2, WF3 |
| Perplexity API Key | HTTP Header Auth | A vérifier/créer | WF1 |
| Gmail OAuth2 | OAuth2 | Oui (Inbox Genie) | WF1, WF2, WF3 |
