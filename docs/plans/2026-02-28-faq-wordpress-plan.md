# FAQ WordPress Dynamique — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publier automatiquement chaque lundi une page FAQ dynamique sur WordPress, alimentee par la FAQ Base Google Sheet, avec regroupement et optimisation IA via Gemini.

**Architecture:** Schedule Trigger (lundi 7h) → Google Sheets read (filtre Publier=OUI) → Google Drive read prompt → Gemini 2.5 Flash (deduplique, regroupe, optimise) → Code Node (HTML accordeons + schema.org) → WordPress create/update page → Sheets update Config → Email recap.

**Tech Stack:** n8n, Google Sheets API, Google Drive API, Gemini 2.5 Flash API, WordPress REST API, Gmail

**Credentials existantes (reutiliser):**
| Credential | Type | ID |
|---|---|---|
| Google Sheets | `googleSheetsOAuth2Api` | `N8N_RESOURCE_ID_03` |
| Google Drive | `googleDriveOAuth2Api` | `N8N_RESOURCE_ID_18` |
| Gemini | `googlePalmApi` | `N8N_RESOURCE_ID_06` |
| Gmail | `gmailOAuth2` | `N8N_RESOURCE_ID_10` |
| WordPress | `wordpressApi` | a configurer (Task 1) |

**IDs existants:**
- FAQ Base Sheet : `GOOGLE_DOC_ID_10`
- Onglet FAQ : `FAQ`
- Onglet Config : `Config` (a creer — Task 2)

**Design doc:** `docs/plans/2026-02-28-faq-wordpress-design.md`

---

## Task 1 : Preparation — Credential WordPress + Prompt Google Doc

### Contexte
Avant de creer le workflow, il faut : (1) verifier/creer la credential WordPress dans n8n, (2) creer le Google Doc contenant le prompt Gemini, (3) preparer le Sheet.

### Step 1 : Verifier la credential WordPress

Verifier dans n8n si une credential `wordpressApi` existe deja.

```
MCP: n8n_list_workflows — chercher un workflow existant qui utilise WordPress
```

Si la credential n'existe pas, demander a l'utilisateur de la creer manuellement dans n8n :
- Type : `WordPress API`
- URL : URL du site WordPress
- Username + Application Password (generer dans WordPress > Users > Application Passwords)

**Noter l'ID de la credential pour la suite.**

### Step 2 : Creer le Google Doc prompt Gemini

Creer un Google Doc dans Drive avec le prompt suivant. Utiliser le MCP Google Drive.

**Nom du doc :** `FAQ WordPress - Prompt Regroupement`
**Dossier :** a definir avec l'utilisateur (ou racine Drive)

**Contenu du prompt :**

```
<role>
Tu es un expert en communication web. Tu restructures une base de FAQ brute en une FAQ optimisee pour un site professionnel.
</role>

<rules>
- Vouvoiement obligatoire dans toutes les reponses
- Pas de tirets quadratins (--), utiliser des tirets simples (-)
- Reponses concises : 2-4 phrases maximum par reponse
- Ton professionnel, accessible, direct
</rules>

<task>
A partir de la liste de questions/reponses fournie en JSON :

1. DEDUPLIQUE : fusionne les questions qui posent la meme chose differemment. Garde la formulation la plus claire. Combine les reponses si necessaire.

2. REGROUPE PAR THEME : cree des categories semantiques basees sur le contenu (ex: "Accompagnement", "Tarification", "Delais", "Methode de travail"). Ne pas reprendre les categories Client/Prospect/Autre du Sheet.

3. OPTIMISE : reformule chaque question pour qu'elle soit naturelle et recherchable (pensee SEO). Clarifie chaque reponse pour un visiteur web qui decouvre le service.

4. ORDONNE : dans chaque categorie, place les questions les plus frequentes ou fondamentales en premier.
</task>

<input_format>
JSON array : [{"question": "...", "reponse": "...", "categorie": "..."}]
</input_format>

<output_format>
JSON strict :
{
  "categories": [
    {
      "name": "Nom de la categorie",
      "questions": [
        {
          "question": "Question reformulee ?",
          "answer": "Reponse optimisee."
        }
      ]
    }
  ]
}
</output_format>

<data>
{{FAQ_DATA}}
</data>
```

**Noter l'ID du document cree.**

### Step 3 : Preparer le Sheet FAQ — Colonne Publier + Onglet Config

**3a. Ajouter la colonne `Publier` (colonne G) dans l'onglet FAQ :**

Utiliser MCP Google Drive pour ajouter un header `Publier` en G1 de l'onglet FAQ du Sheet `GOOGLE_DOC_ID_10`.

**3b. Creer l'onglet Config :**

Utiliser MCP Google Drive pour ajouter un onglet `Config` au Sheet avec :
- A1: `Cle`, B1: `Valeur`
- A2: `wordpress_page_id`, B2: (vide)
- A3: `dernier_update`, B3: (vide)
- A4: `nb_questions_publiees`, B4: (vide)

### Step 4 : Commit

```bash
# Rien a commiter cote code — les changements sont dans Google Drive/Sheets
# Mais noter les IDs dans un commentaire du workflow ou dans ce plan
```

---

## Task 2 : Creer le workflow — Trigger + Lecture Sheet + Filtre

### Contexte
Creer le workflow n8n avec les premiers nodes : schedule trigger, lecture du Sheet, et filtrage des lignes Publier=OUI.

### Step 1 : Creer le workflow vide

```
MCP: n8n_create_workflow
name: "FAQ - Publier sur WordPress"
nodes: [] (vide pour l'instant)
connections: {}
settings: { executionOrder: "v1" }
```

**Noter le workflow ID.**

### Step 2 : Ajouter le Schedule Trigger

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Declencheur lundi 7h"
  type: "n8n-nodes-base.scheduleTrigger"
  typeVersion: 1.2
  position: [250, 300]
  parameters:
    rule:
      interval:
        - field: "weeks"
          triggerAtDay: [1]  # Lundi
          triggerAtHour: 7
          triggerAtMinute: 0
```

### Step 3 : Ajouter le node Google Sheets read

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Lire FAQ Base"
  type: "n8n-nodes-base.googleSheets"
  typeVersion: 4.5
  position: [470, 300]
  parameters:
    operation: "read"  # defaut, pas besoin de le specifier explicitement
    documentId:
      __rl: true
      mode: "id"
      value: "GOOGLE_DOC_ID_10"
    sheetName:
      __rl: true
      mode: "name"
      value: "FAQ"
    options: {}
  credentials:
    googleSheetsOAuth2Api:
      id: "N8N_RESOURCE_ID_03"
      name: "Google Sheets account"
  alwaysOutputData: true
```

### Step 4 : Ajouter le Code Node filtre

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Filtrer Publier OUI"
  type: "n8n-nodes-base.code"
  typeVersion: 2
  position: [690, 300]
  parameters:
    jsCode: |
      const faqItems = items.filter(item => {
        const publier = (item.json.Publier || '').trim().toUpperCase();
        return publier === 'OUI';
      });

      if (faqItems.length === 0) {
        throw new Error('Aucune FAQ marquee Publier=OUI. Workflow arrete.');
      }

      return faqItems;
```

### Step 5 : Connecter les nodes

```
MCP: n8n_update_partial_workflow (workflowId)
replaceConnections:
  "Declencheur lundi 7h":
    main: [[{ node: "Lire FAQ Base", type: "main", index: 0 }]]
  "Lire FAQ Base":
    main: [[{ node: "Filtrer Publier OUI", type: "main", index: 0 }]]
```

### Step 6 : Verifier le workflow

```
MCP: n8n_get_workflow (workflowId)
```

Verifier : 3 nodes, 2 connexions, pas d'erreur.

### Step 7 : Commit

```bash
git add -A && git commit -m "feat(faq-wp): create workflow - trigger + sheet read + filter"
```

---

## Task 3 : Lecture du prompt Google Doc + Appel Gemini

### Contexte
Ajouter la branche de lecture du prompt depuis Google Drive, puis l'appel Gemini pour le regroupement.

### Step 1 : Ajouter le node Google Drive download (prompt)

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Telecharger prompt regroupement"
  type: "n8n-nodes-base.googleDrive"
  typeVersion: 3
  position: [690, 520]
  parameters:
    operation: "download"
    fileId:
      __rl: true
      mode: "id"
      value: "<PROMPT_DOC_ID>"  # ID du Google Doc cree en Task 1
    options:
      googleFileConversion:
        conversion:
          docsToFormat: "text/plain"
  credentials:
    googleDriveOAuth2Api:
      id: "N8N_RESOURCE_ID_18"
      name: "Google Drive account"
  executeOnce: true
```

### Step 2 : Ajouter le node Extract From File

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Extraire texte prompt"
  type: "n8n-nodes-base.extractFromFile"
  typeVersion: 1
  position: [910, 520]
  parameters:
    operation: "text"
    options: {}
```

### Step 3 : Ajouter le Code Node qui construit le body Gemini

Ce node recoit les items FAQ filtres ET le prompt. Il construit le requestBody Gemini.

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Construire requete Gemini"
  type: "n8n-nodes-base.code"
  typeVersion: 2
  position: [910, 300]
  executeOnce: true
  parameters:
    jsCode: |
      // Recuperer le prompt depuis le Google Doc
      const promptTemplate = $('Extraire texte prompt').first().json.data;

      // Recuperer toutes les FAQ filtrees
      const allFaq = $('Filtrer Publier OUI').all().map(item => ({
        question: item.json.Question,
        reponse: item.json.Reponse,
        categorie: item.json.Categorie
      }));

      // Injecter les donnees FAQ dans le prompt
      const prompt = promptTemplate.replace(
        '\u007b\u007bFAQ_DATA\u007d\u007d',
        JSON.stringify(allFaq, null, 2)
      );

      // Construire le body Gemini
      const requestBody = {
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4
        }
      };

      return [{ json: { requestBody, faqCount: allFaq.length } }];
```

### Step 4 : Ajouter le node HTTP Request Gemini

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Gemini regrouper FAQ"
  type: "n8n-nodes-base.httpRequest"
  typeVersion: 4.2
  position: [1130, 300]
  parameters:
    method: "POST"
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    authentication: "predefinedCredentialType"
    nodeCredentialType: "googlePalmApi"
    sendBody: true
    specifyBody: "json"
    jsonBody: "={{ JSON.stringify($json.requestBody) }}"
    options:
      timeout: 60000
  credentials:
    googlePalmApi:
      id: "N8N_RESOURCE_ID_06"
      name: "Google Gemini(PaLM) Api account"
  retryOnFail: true
  maxTries: 2
  waitBetweenTries: 5000
```

### Step 5 : Ajouter le Code Node parse response Gemini

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Parser reponse Gemini"
  type: "n8n-nodes-base.code"
  typeVersion: 2
  position: [1350, 300]
  parameters:
    jsCode: |
      const raw = $json.candidates[0].content.parts[0].text;
      const parsed = JSON.parse(raw);

      // Validation : au moins 1 categorie avec au moins 1 question
      if (!parsed.categories || parsed.categories.length === 0) {
        throw new Error('Gemini a retourne 0 categories. Abandon pour ne pas ecraser la FAQ existante.');
      }

      const totalQuestions = parsed.categories.reduce((sum, cat) => sum + cat.questions.length, 0);
      if (totalQuestions === 0) {
        throw new Error('Gemini a retourne 0 questions. Abandon.');
      }

      return [{
        json: {
          categories: parsed.categories,
          totalQuestions,
          totalCategories: parsed.categories.length,
          faqInputCount: $('Construire requete Gemini').first().json.faqCount
        }
      }];
```

### Step 6 : Connecter tous les nodes

```
MCP: n8n_update_partial_workflow (workflowId)
replaceConnections:
  "Declencheur lundi 7h":
    main: [[{ node: "Lire FAQ Base", type: "main", index: 0 }]]
  "Lire FAQ Base":
    main: [[{ node: "Filtrer Publier OUI", type: "main", index: 0 }]]
  "Filtrer Publier OUI":
    main: [[
      { node: "Construire requete Gemini", type: "main", index: 0 },
      { node: "Telecharger prompt regroupement", type: "main", index: 0 }
    ]]
  "Telecharger prompt regroupement":
    main: [[{ node: "Extraire texte prompt", type: "main", index: 0 }]]
  "Extraire texte prompt":
    main: [[{ node: "Construire requete Gemini", type: "main", index: 0 }]]
  "Construire requete Gemini":
    main: [[{ node: "Gemini regrouper FAQ", type: "main", index: 0 }]]
  "Gemini regrouper FAQ":
    main: [[{ node: "Parser reponse Gemini", type: "main", index: 0 }]]
```

**Note importante sur le flux :** Le node "Construire requete Gemini" a `executeOnce: true` et depend de deux entrees :
- Les items FAQ viennent de "Filtrer Publier OUI" (via `$('Filtrer Publier OUI').all()`)
- Le prompt vient de "Extraire texte prompt" (via `$('Extraire texte prompt').first().json.data`)

Les deux branches convergent vers "Construire requete Gemini". L'`executeOnce` garantit qu'il s'execute une seule fois une fois les deux branches terminees.

### Step 7 : Verifier

```
MCP: n8n_get_workflow (workflowId)
```

Verifier : 8 nodes, connexions correctes.

### Step 8 : Commit

```bash
git add -A && git commit -m "feat(faq-wp): add prompt reading + Gemini grouping"
```

---

## Task 4 : Generation HTML + Publication WordPress

### Contexte
Ajouter le Code Node qui genere le HTML (accordeons + CSS + schema.org), puis la logique create/update WordPress.

### Step 1 : Ajouter le node Lire Config (page ID)

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Lire Config"
  type: "n8n-nodes-base.googleSheets"
  typeVersion: 4.5
  position: [470, 520]
  parameters:
    documentId:
      __rl: true
      mode: "id"
      value: "GOOGLE_DOC_ID_10"
    sheetName:
      __rl: true
      mode: "name"
      value: "Config"
    options: {}
  credentials:
    googleSheetsOAuth2Api:
      id: "N8N_RESOURCE_ID_03"
      name: "Google Sheets account"
  executeOnce: true
  alwaysOutputData: true
```

### Step 2 : Ajouter le Code Node generation HTML

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Generer HTML FAQ"
  type: "n8n-nodes-base.code"
  typeVersion: 2
  position: [1570, 300]
  parameters:
    jsCode: |
      const { categories, totalQuestions, totalCategories, faqInputCount } = $json;

      // Recuperer le page ID depuis Config
      const configItems = $('Lire Config').all();
      const pageIdRow = configItems.find(item => item.json.Cle === 'wordpress_page_id');
      const existingPageId = pageIdRow ? (pageIdRow.json.Valeur || '').trim() : '';

      // --- CSS ---
      const css = `<style>
      .faq-container { max-width: 800px; margin: 0 auto; }
      .faq-category { margin-bottom: 2em; }
      .faq-category h2 { font-size: 1.4em; margin-bottom: 0.8em; padding-bottom: 0.4em; border-bottom: 2px solid #333; }
      details.faq-item { border-bottom: 1px solid #eee; padding: 12px 0; }
      details.faq-item summary { cursor: pointer; font-weight: 600; font-size: 1.1em; list-style: none; display: flex; justify-content: space-between; align-items: center; }
      details.faq-item summary::after { content: '+'; font-size: 1.4em; font-weight: 300; transition: transform 0.2s; }
      details[open].faq-item summary::after { content: '-'; }
      details.faq-item .faq-answer { padding: 8px 0 4px 0; line-height: 1.6; color: #444; }
      </style>`;

      // --- HTML accordeons ---
      let html = css + '\n<div class="faq-container">\n';

      for (const cat of categories) {
        html += `  <div class="faq-category">\n`;
        html += `    <h2>${cat.name}</h2>\n`;
        for (const q of cat.questions) {
          const safeQ = q.question.replace(/"/g, '&quot;');
          const safeA = q.answer.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += `    <details class="faq-item">\n`;
          html += `      <summary>${q.question}</summary>\n`;
          html += `      <div class="faq-answer">${q.answer}</div>\n`;
          html += `    </details>\n`;
        }
        html += `  </div>\n`;
      }
      html += '</div>\n';

      // --- Schema.org FAQPage ---
      const schemaEntities = [];
      for (const cat of categories) {
        for (const q of cat.questions) {
          schemaEntities.push({
            '@type': 'Question',
            name: q.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: q.answer
            }
          });
        }
      }

      const schema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: schemaEntities
      };

      html += `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;

      return [{
        json: {
          htmlContent: html,
          existingPageId,
          isUpdate: existingPageId !== '',
          totalQuestions,
          totalCategories,
          faqInputCount
        }
      }];
```

### Step 3 : Ajouter le node WordPress Create Page

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Creer page FAQ"
  type: "n8n-nodes-base.wordpress"
  typeVersion: 1
  position: [1790, 200]
  parameters:
    resource: "page"
    title: "FAQ"
    additionalFields:
      content: "={{ $json.htmlContent }}"
      status: "publish"
      slug: "faq"
      commentStatus: "closed"
  credentials:
    wordpressApi:
      id: "<WORDPRESS_CREDENTIAL_ID>"
      name: "<WORDPRESS_CREDENTIAL_NAME>"
```

### Step 4 : Ajouter le node WordPress Update Page

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Mettre a jour page FAQ"
  type: "n8n-nodes-base.wordpress"
  typeVersion: 1
  position: [1790, 400]
  parameters:
    resource: "page"
    operation: "update"
    postId: "={{ $json.existingPageId }}"
    updateFields:
      content: "={{ $json.htmlContent }}"
  credentials:
    wordpressApi:
      id: "<WORDPRESS_CREDENTIAL_ID>"
      name: "<WORDPRESS_CREDENTIAL_NAME>"
```

### Step 5 : Ajouter le Code Node routage create/update

Comme les IF nodes sont peu fiables via API (cf REX), utiliser 2 Code nodes en parallele.

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Route si nouvelle page"
  type: "n8n-nodes-base.code"
  typeVersion: 2
  position: [1790, 200]
  parameters:
    jsCode: |
      // Ne passer l'item que si PAS de page existante
      if ($json.isUpdate) return [];
      return items;
```

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Route si page existante"
  type: "n8n-nodes-base.code"
  typeVersion: 2
  position: [1790, 400]
  parameters:
    jsCode: |
      // Ne passer l'item que si page existante
      if (!$json.isUpdate) return [];
      return items;
```

Deplacer les WordPress nodes apres les routeurs :

- "Creer page FAQ" position: [2010, 200]
- "Mettre a jour page FAQ" position: [2010, 400]

### Step 6 : Connecter les nodes

```
MCP: n8n_update_partial_workflow (workflowId)
```

Connexions a ajouter (en plus des existantes) :
- "Parser reponse Gemini" → "Generer HTML FAQ"
- "Generer HTML FAQ" → "Route si nouvelle page" ET "Route si page existante" (parallele)
- "Route si nouvelle page" → "Creer page FAQ"
- "Route si page existante" → "Mettre a jour page FAQ"

**replaceConnections complet** (reprend toutes les connexions) — voir Task 3 Step 6 + :

```
"Parser reponse Gemini":
  main: [[{ node: "Generer HTML FAQ", type: "main", index: 0 }]]
"Generer HTML FAQ":
  main: [[
    { node: "Route si nouvelle page", type: "main", index: 0 },
    { node: "Route si page existante", type: "main", index: 0 }
  ]]
"Route si nouvelle page":
  main: [[{ node: "Creer page FAQ", type: "main", index: 0 }]]
"Route si page existante":
  main: [[{ node: "Mettre a jour page FAQ", type: "main", index: 0 }]]
```

### Step 7 : Verifier

```
MCP: n8n_get_workflow (workflowId)
```

### Step 8 : Commit

```bash
git add -A && git commit -m "feat(faq-wp): add HTML generation + WordPress create/update"
```

---

## Task 5 : Config update + Email recap + Error workflow

### Contexte
Ajouter la sauvegarde du page ID dans Config, l'email recapitulatif, et l'error workflow.

### Step 1 : Ajouter le Code Node aggregation resultats

Ce node recoit les items des deux branches (create OU update) et prepare le recap.

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Agreger resultats"
  type: "n8n-nodes-base.code"
  typeVersion: 2
  position: [2230, 300]
  parameters:
    jsCode: |
      // L'item vient soit de "Creer page FAQ" soit de "Mettre a jour page FAQ"
      const wpResponse = $json;

      // Recuperer les stats depuis le node HTML
      const htmlData = $('Generer HTML FAQ').first().json;

      // Determiner l'ID de la page (nouveau ou existant)
      const pageId = wpResponse.id ? String(wpResponse.id) : htmlData.existingPageId;
      const isNew = !htmlData.isUpdate;

      return [{
        json: {
          pageId,
          isNew,
          totalQuestions: htmlData.totalQuestions,
          totalCategories: htmlData.totalCategories,
          faqInputCount: htmlData.faqInputCount,
          pageUrl: wpResponse.link || ''
        }
      }];
```

### Step 2 : Ajouter le node Google Sheets update Config

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Sauver Config"
  type: "n8n-nodes-base.googleSheets"
  typeVersion: 4.5
  position: [2450, 200]
  parameters:
    operation: "appendOrUpdate"
    documentId:
      __rl: true
      mode: "id"
      value: "GOOGLE_DOC_ID_10"
    sheetName:
      __rl: true
      mode: "name"
      value: "Config"
    columns:
      mappingMode: "defineBelow"
      value:
        Cle: "wordpress_page_id"
        Valeur: "={{ $json.pageId }}"
      matchingColumns: ["Cle"]
    options: {}
  credentials:
    googleSheetsOAuth2Api:
      id: "N8N_RESOURCE_ID_03"
      name: "Google Sheets account"
```

Ajouter un 2e Sheets update pour `dernier_update` et `nb_questions_publiees` :

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Sauver stats Config"
  type: "n8n-nodes-base.googleSheets"
  typeVersion: 4.5
  position: [2450, 400]
  parameters:
    operation: "appendOrUpdate"
    documentId:
      __rl: true
      mode: "id"
      value: "GOOGLE_DOC_ID_10"
    sheetName:
      __rl: true
      mode: "name"
      value: "Config"
    columns:
      mappingMode: "defineBelow"
      value:
        Cle: "dernier_update"
        Valeur: "={{ $now.toFormat('yyyy-MM-dd HH:mm') }}"
      matchingColumns: ["Cle"]
    options: {}
  credentials:
    googleSheetsOAuth2Api:
      id: "N8N_RESOURCE_ID_03"
      name: "Google Sheets account"
```

Note : pour `nb_questions_publiees`, un 3e appendOrUpdate identique avec `Cle: "nb_questions_publiees"` et `Valeur: "={{ $json.totalQuestions }}"`.

### Step 3 : Ajouter le node Gmail recap

```
MCP: n8n_update_partial_workflow (workflowId)
updateNode:
  name: "Email recap FAQ"
  type: "n8n-nodes-base.gmail"
  typeVersion: 2.1
  position: [2670, 300]
  parameters:
    sendTo: "contact@example.com"
    subject: "=FAQ WordPress - {{ $now.toFormat('dd/MM/yyyy') }} - {{ $json.totalQuestions }} questions publiees"
    emailType: "text"
    message: "=FAQ WordPress mise a jour avec succes.\n\n- Questions publiees : {{ $json.totalQuestions }} (depuis {{ $json.faqInputCount }} entrees FAQ Base)\n- Categories creees : {{ $json.totalCategories }}\n- Page : {{ $json.isNew ? 'NOUVELLE page creee' : 'Page existante mise a jour' }}\n{{ $json.pageUrl ? '- URL : ' + $json.pageUrl : '' }}\n\n---\nFAQ WordPress - {{ $now.toFormat('dd/MM/yyyy HH:mm') }}"
  credentials:
    gmailOAuth2:
      id: "N8N_RESOURCE_ID_10"
      name: "Gmail account"
```

### Step 4 : Connecter les derniers nodes

Connexions a ajouter :
- "Creer page FAQ" → "Agreger resultats"
- "Mettre a jour page FAQ" → "Agreger resultats"
- "Agreger resultats" → "Sauver Config" ET "Sauver stats Config" ET "Sauver nb questions Config" (parallele)
- "Agreger resultats" → "Email recap FAQ"

L'email recap part en parallele des saves Config (pas de dependance).

### Step 5 : Configurer l'error workflow

Assigner l'error workflow du projet (si existant) dans les settings du workflow :

```
MCP: n8n_update_partial_workflow (workflowId)
settings:
  errorWorkflow: "<ERROR_WORKFLOW_ID>"
```

Si pas d'error workflow existant, en noter la creation comme tache future.

### Step 6 : Connexion complete — replaceConnections final

Ecrire le `replaceConnections` complet avec TOUTES les connexions du workflow (trigger → ... → recap).

### Step 7 : Verifier

```
MCP: n8n_get_workflow (workflowId)
```

Verifier tous les nodes et connexions.

### Step 8 : Commit

```bash
git add -A && git commit -m "feat(faq-wp): add config save + email recap + error workflow"
```

---

## Task 6 : Test end-to-end + Activation

### Contexte
Tester le workflow complet avec des donnees reelles, valider le rendu HTML, puis activer.

### Step 1 : Preparer les donnees de test

Dans le Sheet FAQ, marquer 5-10 lignes avec `Publier=OUI` (un mix de categories Client, Prospect, Autre).

### Step 2 : Executer le workflow manuellement

```
MCP: n8n_test_workflow (workflowId)
```

### Step 3 : Verifier les resultats

1. Verifier l'execution : `n8n_executions(workflowId)` — statut success
2. Verifier le Sheet Config : `wordpress_page_id` rempli, `dernier_update` et `nb_questions_publiees` a jour
3. Verifier la page WordPress : ouvrir l'URL `/faq` du site, verifier :
   - Les accordeons fonctionnent (clic pour deplier)
   - Les categories sont coherentes (themes metier, pas Client/Prospect)
   - Le vouvoiement est respecte
   - Pas de tirets quadratins
   - Schema.org present (view-source ou Google Rich Results Test)
4. Verifier l'email recap recu

### Step 4 : Executer une 2e fois (test update)

```
MCP: n8n_test_workflow (workflowId)
```

Verifier que la page est MISE A JOUR (pas de nouvelle page creee). Le `wordpress_page_id` dans Config doit etre le meme.

### Step 5 : Activer le workflow

```
MCP: n8n_update_partial_workflow (workflowId)
active: true
```

### Step 6 : Exporter le JSON du workflow

```
MCP: n8n_get_workflow (workflowId)
```

Sauver le JSON dans `workflows/faq-publier-wordpress.json`.

### Step 7 : Commit final

```bash
git add workflows/faq-publier-wordpress.json
git commit -m "feat(faq-wp): workflow validated and activated - export JSON"
```

### Step 8 : Mettre a jour MEMORY.md

Ajouter dans la section "Workflows en production" :
```
- **FAQ - Publier sur WordPress** : `<workflowId>` - Publie FAQ dynamique hebdo sur WordPress. Source: FAQ Base Sheet, Gemini regroupement, HTML5 accordeons + schema.org FAQPage.
```
