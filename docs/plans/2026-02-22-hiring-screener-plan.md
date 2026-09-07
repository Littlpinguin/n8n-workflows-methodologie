# Recrutement - Screener CV Automatique — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Créer un workflow n8n qui screene automatiquement les CVs reçus par email en les analysant via Gemini par rapport à une fiche de poste dynamique, et enregistre les résultats dans Google Sheets.

**Architecture:** Gmail trigger → Upload CV dans Drive → Switch type fichier (Word/PDF/TXT) → Extraction texte → Lecture fiche de poste depuis dossier "Fiche Active" → Analyse Gemini (scoring + extraction infos) → Append Google Sheets. Gemini via HTTP Request direct avec `responseMimeType: 'application/json'`.

**Tech Stack:** n8n (MCP), Gemini 2.5 Flash (HTTP Request), Google Drive/Sheets/Gmail (OAuth2), MCP Google Drive (création Sheet/dossiers)

**Design doc:** `docs/plans/2026-02-22-hiring-screener-design.md`

---

### Task 1 : Créer la structure Google Drive + Google Sheet

**Objectif :** Créer les dossiers Drive et la Google Sheet de résultats via MCP Google Drive.

**Step 1 : Créer le dossier `Recrutement` dans Google Drive**

Utiliser `mcp__google-drive__createFolder` :
- `name`: `Recrutement`
- Noter le `folderId` retourné → `RECRUTEMENT_FOLDER_ID`

**Step 2 : Créer les sous-dossiers `CVs` et `Fiche Active`**

Utiliser `mcp__google-drive__createFolder` (x2) :
- `name`: `CVs`, `parentFolderId`: `RECRUTEMENT_FOLDER_ID`
- `name`: `Fiche Active`, `parentFolderId`: `RECRUTEMENT_FOLDER_ID`
- Noter les IDs → `CVS_FOLDER_ID`, `FICHE_ACTIVE_FOLDER_ID`

**Step 3 : Créer la Google Sheet "Resume Screener"**

Utiliser `mcp__google-drive__createSpreadsheet` :
- `title`: `Resume Screener`
- `parentFolderId`: `RECRUTEMENT_FOLDER_ID`
- Noter le `spreadsheetId` → `SHEET_ID`

**Step 4 : Écrire les en-têtes de colonnes**

Utiliser `mcp__google-drive__writeSpreadsheet` :
- `spreadsheetId`: `SHEET_ID`
- `range`: `Sheet1!A1:K1`
- `values`: `[["Date", "Prénom", "Nom", "Email", "Lien CV", "Forces", "Faiblesses", "Risque", "Opportunité", "Score (0-10)", "Justification"]]`

**Step 5 : Formater les en-têtes (gras + couleur)**

Utiliser `mcp__google-drive__formatCells` :
- `spreadsheetId`: `SHEET_ID`
- `range`: `Sheet1!A1:K1`
- Gras, fond coloré

**Step 6 : Figer la première ligne**

Utiliser `mcp__google-drive__freezeRowsAndColumns` :
- `spreadsheetId`: `SHEET_ID`
- `frozenRows`: `1`

**Step 7 : Commit**

```bash
# Pas de fichier local modifié — juste noter les IDs dans un commentaire du design doc
```

**Résultat attendu :** Dossier `Recrutement/` avec sous-dossiers `CVs/` et `Fiche Active/`, et une Google Sheet "Resume Screener" avec 11 colonnes formatées.

---

### Task 2 : Créer le workflow squelette avec Gmail Trigger + Upload Drive

**Objectif :** Créer le workflow n8n de base avec le trigger Gmail et l'upload vers Google Drive.

**Step 1 : Créer le workflow vide**

Utiliser `n8n_create_workflow` :
```json
{
  "name": "Recrutement - Screener CV Automatique",
  "nodes": [
    {
      "name": "Recevoir CV par email",
      "type": "n8n-nodes-base.gmailTrigger",
      "typeVersion": 1.2,
      "position": [960, 16],
      "parameters": {
        "pollTimes": { "item": [{ "mode": "everyMinute" }] },
        "simple": false,
        "filters": {},
        "options": { "downloadAttachments": true }
      },
      "credentials": {
        "gmailOAuth2": { "id": "N8N_RESOURCE_ID_10", "name": "Gmail account" }
      }
    }
  ],
  "connections": {},
  "settings": { "executionOrder": "v1", "errorWorkflow": "N8N_RESOURCE_ID_28" },
  "active": false
}
```
- Noter le `workflowId` → `WORKFLOW_ID`

**Step 2 : Ajouter le node IF "Vérifier pièce jointe"**

Utiliser `n8n_update_partial_workflow` pour ajouter :
```json
{
  "name": "Verifier piece jointe",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "position": [1140, 16],
  "parameters": {
    "conditions": {
      "options": { "version": 2, "caseSensitive": true, "typeValidation": "strict" },
      "conditions": [
        {
          "leftValue": "={{ $json.attachment_0 }}",
          "rightValue": "",
          "operator": { "type": "object", "operation": "exists" }
        }
      ],
      "combinator": "and"
    }
  }
}
```

Connexion : `Recevoir CV par email` → `Verifier piece jointe`

**Step 3 : Ajouter le node Google Drive "Uploader CV"**

```json
{
  "name": "Uploader CV dans Drive",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [1340, 16],
  "parameters": {
    "inputDataFieldName": "attachment_0",
    "name": "={{ $json.subject }} - CV",
    "driveId": { "__rl": true, "mode": "list", "value": "My Drive" },
    "folderId": { "__rl": true, "value": "CVS_FOLDER_ID", "mode": "id" },
    "options": {}
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  }
}
```

Connexion : `Verifier piece jointe` (true) → `Uploader CV dans Drive`

**Step 4 : Vérifier le workflow**

Utiliser `n8n_get_workflow` avec `WORKFLOW_ID` pour confirmer la structure.

---

### Task 3 : Ajouter le Switch type de fichier + branches d'extraction

**Objectif :** Router le fichier uploadé selon son type (Word/PDF/TXT) et extraire le texte.

**Step 1 : Ajouter le node Switch "Type de fichier"**

```json
{
  "name": "Type de fichier",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3.2,
  "position": [1540, 16],
  "parameters": {
    "rules": {
      "values": [
        {
          "conditions": {
            "options": { "caseSensitive": true, "typeValidation": "strict", "version": 2 },
            "conditions": [{ "leftValue": "={{ $json.mimeType }}", "rightValue": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "operator": { "type": "string", "operation": "equals" } }],
            "combinator": "and"
          },
          "renameOutput": true, "outputKey": "Word"
        },
        {
          "conditions": {
            "options": { "caseSensitive": true, "typeValidation": "strict", "version": 2 },
            "conditions": [{ "leftValue": "={{ $json.mimeType }}", "rightValue": "application/pdf", "operator": { "type": "string", "operation": "equals" } }],
            "combinator": "and"
          },
          "renameOutput": true, "outputKey": "PDF"
        },
        {
          "conditions": {
            "options": { "caseSensitive": true, "typeValidation": "strict", "version": 2 },
            "conditions": [{ "leftValue": "={{ $json.mimeType }}", "rightValue": "text/plain", "operator": { "type": "string", "operation": "equals" } }],
            "combinator": "and"
          },
          "renameOutput": true, "outputKey": "Texte"
        }
      ]
    },
    "options": {}
  }
}
```

Connexion : `Uploader CV dans Drive` → `Type de fichier`

**Step 2 : Branche Word — Convertir en Google Doc puis extraire**

3 nodes :

Node 1 — "Convertir Word en Google Doc" (HTTP Request) :
```json
{
  "name": "Convertir Word en Google Doc",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [1780, -224],
  "parameters": {
    "method": "POST",
    "url": "=https://www.googleapis.com/drive/v2/files/{{ $json.id }}/copy?convert=true&supportsAllDrives=true",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "googleDriveOAuth2Api",
    "options": {}
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  }
}
```

Node 2 — "Telecharger Google Doc" (Google Drive download as PDF) :
```json
{
  "name": "Telecharger Google Doc",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [1980, -224],
  "parameters": {
    "operation": "download",
    "fileId": { "__rl": true, "value": "={{ $json.id }}", "mode": "id" },
    "options": { "googleFileConversion": { "conversion": { "docsToFormat": "application/pdf" } } }
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  }
}
```

Node 3 — "Extraire texte Word" (Extract from File PDF) :
```json
{
  "name": "Extraire texte Word",
  "type": "n8n-nodes-base.extractFromFile",
  "typeVersion": 1,
  "position": [2180, -224],
  "parameters": { "operation": "pdf", "options": {} }
}
```

Connexions : `Type de fichier` (Word/0) → `Convertir Word en Google Doc` → `Telecharger Google Doc` → `Extraire texte Word`

**Step 3 : Branche PDF — Télécharger et extraire**

Node 1 — "Telecharger PDF" :
```json
{
  "name": "Telecharger PDF",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [1780, 16],
  "parameters": {
    "operation": "download",
    "fileId": { "__rl": true, "value": "={{ $json.id }}", "mode": "id" },
    "options": {}
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  }
}
```

Node 2 — "Extraire texte PDF" :
```json
{
  "name": "Extraire texte PDF",
  "type": "n8n-nodes-base.extractFromFile",
  "typeVersion": 1,
  "position": [1980, 16],
  "parameters": { "operation": "pdf", "options": {} }
}
```

Connexions : `Type de fichier` (PDF/1) → `Telecharger PDF` → `Extraire texte PDF`

**Step 4 : Branche TXT — Télécharger et extraire**

Node 1 — "Telecharger TXT" :
```json
{
  "name": "Telecharger TXT",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [1780, 256],
  "parameters": {
    "operation": "download",
    "fileId": { "__rl": true, "value": "={{ $json.id }}", "mode": "id" },
    "options": {}
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  }
}
```

Node 2 — "Extraire texte TXT" :
```json
{
  "name": "Extraire texte TXT",
  "type": "n8n-nodes-base.extractFromFile",
  "typeVersion": 1,
  "position": [1980, 256],
  "parameters": { "operation": "text", "destinationKey": "text", "options": {} }
}
```

Connexions : `Type de fichier` (Texte/2) → `Telecharger TXT` → `Extraire texte TXT`

**Step 5 : Vérifier le workflow**

`n8n_get_workflow` pour confirmer les 3 branches et leurs connexions.

---

### Task 4 : Standardiser le texte + Lire la fiche de poste

**Objectif :** Merger les 3 branches vers un Set node, puis lire la fiche de poste depuis le dossier "Fiche Active".

**Step 1 : Ajouter le node "Standardiser CV"**

```json
{
  "name": "Standardiser CV",
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4,
  "position": [2380, 16],
  "parameters": {
    "assignments": {
      "assignments": [
        { "name": "resume", "value": "={{ $json.text }}", "type": "string" }
      ]
    },
    "options": {}
  }
}
```

Connexions : `Extraire texte Word` → `Standardiser CV`, `Extraire texte PDF` → `Standardiser CV`, `Extraire texte TXT` → `Standardiser CV`

**Step 2 : Ajouter le node "Chercher fiche de poste"**

```json
{
  "name": "Chercher fiche de poste",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [2580, 16],
  "parameters": {
    "resource": "fileFolder",
    "operation": "search",
    "limit": 1,
    "queryString": "",
    "returnAll": false,
    "options": {},
    "filter": {
      "folderId": { "__rl": true, "value": "FICHE_ACTIVE_FOLDER_ID", "mode": "id" }
    }
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  },
  "alwaysOutputData": true
}
```

Connexion : `Standardiser CV` → `Chercher fiche de poste`

**Step 3 : Ajouter IF "Fiche présente"**

```json
{
  "name": "Fiche presente",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "position": [2780, 16],
  "parameters": {
    "conditions": {
      "options": { "version": 2, "caseSensitive": true, "typeValidation": "strict" },
      "conditions": [
        {
          "leftValue": "={{ $json.id }}",
          "rightValue": "",
          "operator": { "type": "string", "operation": "isNotEmpty" }
        }
      ],
      "combinator": "and"
    }
  }
}
```

Connexion : `Chercher fiche de poste` → `Fiche presente`

**Step 4 : Ajouter le node "Telecharger fiche de poste"**

```json
{
  "name": "Telecharger fiche de poste",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [2980, 16],
  "parameters": {
    "operation": "download",
    "fileId": { "__rl": true, "value": "={{ $json.id }}", "mode": "id" },
    "options": { "googleFileConversion": { "conversion": { "docsToFormat": "text/plain" } } }
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  }
}
```

Connexion : `Fiche presente` (true) → `Telecharger fiche de poste`

**Step 5 : Ajouter le node "Extraire texte fiche"**

```json
{
  "name": "Extraire texte fiche",
  "type": "n8n-nodes-base.extractFromFile",
  "typeVersion": 1,
  "position": [3180, 16],
  "parameters": { "operation": "text", "destinationKey": "text", "options": {} }
}
```

Connexion : `Telecharger fiche de poste` → `Extraire texte fiche`

**Step 6 : Vérifier le workflow**

---

### Task 5 : Ajouter les appels Gemini (analyse + extraction infos)

**Objectif :** Deux appels Gemini HTTP Request : analyse CV vs fiche de poste, puis extraction nom/prénom/email.

**Step 1 : Ajouter le node Code "Construire prompt analyse"**

```json
{
  "name": "Construire prompt analyse",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [3380, 16],
  "parameters": {
    "jsCode": "const resume = $('Standardiser CV').item.json.resume;\nconst jobDescription = $json.text;\n\nconst systemPrompt = `# Overview\nTu es un recruteur technique expert. On te donne une fiche de poste et un CV.\nAnalyse le CV par rapport à la fiche de poste et produis un rapport de screening détaillé.\n\nÉvalue l'alignement des compétences techniques ET la compréhension du contexte métier.\nBase-toi uniquement sur le contenu réel du CV et de la fiche — pas d'hypothèses.\n\n# Output JSON\nRetourne un objet JSON avec ces champs :\n- candidate_strengths: array de strings (forces spécifiques du candidat)\n- candidate_weaknesses: array de strings (faiblesses ou lacunes)\n- risk_factor: objet { score: \"Low\"|\"Medium\"|\"High\", explanation: string }\n- reward_factor: objet { score: \"Low\"|\"Medium\"|\"High\", explanation: string }\n- overall_fit_rating: integer 0-10\n- justification_for_rating: string détaillée`;\n\nconst userPrompt = `## Fiche de poste\\n\\n${jobDescription}\\n\\n## CV du candidat\\n\\n${resume}`;\n\nconst requestBody = {\n  contents: [{ role: 'user', parts: [{ text: userPrompt }] }],\n  systemInstruction: { parts: [{ text: systemPrompt }] },\n  generationConfig: {\n    temperature: 0.3,\n    responseMimeType: 'application/json'\n  }\n};\n\nreturn [{ json: { requestBody, resume } }];"
  }
}
```

Connexion : `Extraire texte fiche` → `Construire prompt analyse`

**Step 2 : Ajouter le node HTTP Request "Analyser CV via Gemini"**

```json
{
  "name": "Analyser CV via Gemini",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [3580, 16],
  "parameters": {
    "method": "POST",
    "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "googlePalmApi",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify($json.requestBody) }}",
    "options": { "timeout": 120000 }
  },
  "credentials": {
    "googlePalmApi": { "id": "N8N_RESOURCE_ID_06", "name": "Google Gemini(PaLM) Api account" }
  },
  "retryOnFail": true,
  "maxTries": 2,
  "waitBetweenTries": 3000
}
```

Connexion : `Construire prompt analyse` → `Analyser CV via Gemini`

**Step 3 : Ajouter le node Code "Parser résultat analyse"**

```json
{
  "name": "Parser resultat analyse",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [3780, 16],
  "parameters": {
    "jsCode": "const response = $json.candidates[0].content.parts[0].text;\nconst analysis = JSON.parse(response);\nconst resume = $('Construire prompt analyse').item.json.resume;\n\nreturn [{ json: { analysis, resume } }];"
  }
}
```

Connexion : `Analyser CV via Gemini` → `Parser resultat analyse`

**Step 4 : Ajouter le node Code "Construire prompt extraction"**

```json
{
  "name": "Construire prompt extraction",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [3980, 16],
  "parameters": {
    "jsCode": "const resume = $json.resume;\n\nconst systemPrompt = 'Extrais les informations de contact du candidat depuis son CV. Retourne un JSON avec: first_name (string), last_name (string), email (string). Si une info est introuvable, retourne une chaîne vide.';\n\nconst requestBody = {\n  contents: [{ role: 'user', parts: [{ text: resume }] }],\n  systemInstruction: { parts: [{ text: systemPrompt }] },\n  generationConfig: {\n    temperature: 0.1,\n    responseMimeType: 'application/json'\n  }\n};\n\nreturn [{ json: { requestBody, analysis: $json.analysis } }];"
  }
}
```

Connexion : `Parser resultat analyse` → `Construire prompt extraction`

**Step 5 : Ajouter le node HTTP Request "Extraire infos candidat via Gemini"**

```json
{
  "name": "Extraire infos candidat",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [4180, 16],
  "parameters": {
    "method": "POST",
    "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "googlePalmApi",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify($json.requestBody) }}",
    "options": { "timeout": 60000 }
  },
  "credentials": {
    "googlePalmApi": { "id": "N8N_RESOURCE_ID_06", "name": "Google Gemini(PaLM) Api account" }
  },
  "retryOnFail": true,
  "maxTries": 2,
  "waitBetweenTries": 3000
}
```

Connexion : `Construire prompt extraction` → `Extraire infos candidat`

**Step 6 : Ajouter le node Code "Parser infos candidat"**

```json
{
  "name": "Parser infos candidat",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [4380, 16],
  "parameters": {
    "jsCode": "const response = $json.candidates[0].content.parts[0].text;\nconst candidate = JSON.parse(response);\nconst analysis = $('Construire prompt extraction').item.json.analysis;\n\nreturn [{ json: { candidate, analysis } }];"
  }
}
```

Connexion : `Extraire infos candidat` → `Parser infos candidat`

**Step 7 : Vérifier le workflow**

---

### Task 6 : Ajouter le Google Sheets Append + Sticky Notes

**Objectif :** Écrire les résultats dans la Google Sheet et documenter le workflow avec des sticky notes.

**Step 1 : Ajouter le node Google Sheets "Enregistrer résultats"**

```json
{
  "name": "Enregistrer resultats",
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.6,
  "position": [4580, 16],
  "parameters": {
    "operation": "append",
    "documentId": { "__rl": true, "value": "SHEET_ID", "mode": "id" },
    "sheetName": { "__rl": true, "value": "gid=0", "mode": "list", "cachedResultName": "Sheet1" },
    "columns": {
      "mappingMode": "defineBelow",
      "value": {
        "Date": "={{ $now.format('yyyy-MM-dd HH:mm') }}",
        "Prénom": "={{ $json.candidate.first_name }}",
        "Nom": "={{ $json.candidate.last_name }}",
        "Email": "={{ $json.candidate.email }}",
        "Lien CV": "={{ $('Uploader CV dans Drive').item.json.webViewLink }}",
        "Forces": "={{ $json.analysis.candidate_strengths.join('\\n\\n') }}",
        "Faiblesses": "={{ $json.analysis.candidate_weaknesses.join('\\n\\n') }}",
        "Risque": "={{ $json.analysis.risk_factor.score }}\\n\\n{{ $json.analysis.risk_factor.explanation }}",
        "Opportunité": "={{ $json.analysis.reward_factor.score }}\\n\\n{{ $json.analysis.reward_factor.explanation }}",
        "Score (0-10)": "={{ $json.analysis.overall_fit_rating }}",
        "Justification": "={{ $json.analysis.justification_for_rating }}"
      },
      "schema": [
        { "id": "Date", "displayName": "Date", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Prénom", "displayName": "Prénom", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Nom", "displayName": "Nom", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Email", "displayName": "Email", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Lien CV", "displayName": "Lien CV", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Forces", "displayName": "Forces", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Faiblesses", "displayName": "Faiblesses", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Risque", "displayName": "Risque", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Opportunité", "displayName": "Opportunité", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Score (0-10)", "displayName": "Score (0-10)", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Justification", "displayName": "Justification", "type": "string", "display": true, "canBeUsedToMatch": true }
      ],
      "matchingColumns": [],
      "attemptToConvertTypes": false,
      "convertFieldsToString": false
    },
    "options": {}
  },
  "credentials": {
    "googleSheetsOAuth2Api": { "id": "N8N_RESOURCE_ID_03", "name": "Google Sheets account" }
  }
}
```

Connexion : `Parser infos candidat` → `Enregistrer resultats`

**Step 2 : Ajouter les sticky notes de documentation**

8 sticky notes pour documenter chaque section du workflow :
- "## Réception CV" (position [912, -48], couleur 2)
- "## Vérification" (position [1092, -48], couleur 6)
- "## Upload Drive" (position [1292, -48], couleur 2)
- "## Type de fichier" (position [1492, -48], couleur 6)
- "## Extraction texte" (position [1732, -288] pour Word, [1732, -48] pour PDF, [1732, 192] pour TXT, couleur 4)
- "## Fiche de poste" (position [2532, -48], couleur 3)
- "## Analyse Gemini" (position [3332, -48], couleur 5)
- "## Résultats" (position [4532, -48], couleur 7)

**Step 3 : Vérifier le workflow complet**

`n8n_get_workflow` puis `n8n_validate_workflow` pour confirmer la structure complète.

**Step 4 : Commit**

```bash
git add docs/plans/2026-02-22-hiring-screener-plan.md
git commit -m "docs: plan implementation screener CV automatique"
```

---

### Task 7 : Tester le workflow de bout en bout

**Objectif :** Tester avec un vrai CV pour valider le pipeline complet.

**Step 1 : Créer une fiche de poste de test**

Utiliser `mcp__google-drive__createDocument` pour créer un Google Doc dans le dossier "Fiche Active" avec une fiche de poste générique de test.

**Step 2 : Envoyer un email de test**

Demander à l'utilisateur d'envoyer un email avec un CV en pièce jointe à son adresse Gmail.

**Step 3 : Exécuter le workflow manuellement**

Utiliser `n8n_test_workflow` avec `WORKFLOW_ID` pour déclencher une exécution de test.

**Step 4 : Vérifier les résultats**

- Vérifier que le CV a été uploadé dans `Recrutement/CVs/`
- Vérifier que la Google Sheet contient une nouvelle ligne avec l'analyse
- Vérifier la qualité de l'analyse Gemini

**Step 5 : Corriger les éventuels problèmes**

Si des erreurs apparaissent, consulter `n8n_executions` pour les logs et corriger.

---

## Récapitulatif des IDs à noter en cours de route

| Élément | Variable | Valeur |
|---------|----------|--------|
| Dossier Recrutement | `RECRUTEMENT_FOLDER_ID` | À créer (Task 1) |
| Dossier CVs | `CVS_FOLDER_ID` | À créer (Task 1) |
| Dossier Fiche Active | `FICHE_ACTIVE_FOLDER_ID` | À créer (Task 1) |
| Google Sheet | `SHEET_ID` | À créer (Task 1) |
| Workflow n8n | `WORKFLOW_ID` | À créer (Task 2) |

## Credentials existants (ne pas recréer)

| Credential | ID | Type |
|-----------|-----|------|
| Gmail | `N8N_RESOURCE_ID_10` | `gmailOAuth2` |
| Google Drive | `N8N_RESOURCE_ID_18` | `googleDriveOAuth2Api` |
| Google Sheets | `N8N_RESOURCE_ID_03` | `googleSheetsOAuth2Api` |
| Gemini API | `N8N_RESOURCE_ID_06` | `googlePalmApi` |
| Error Workflow | `N8N_RESOURCE_ID_28` | — |
