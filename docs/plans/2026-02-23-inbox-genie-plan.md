# Gmail - Inbox Genie — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Creer un workflow n8n quotidien qui classifie automatiquement les emails non lus via Gemini (batch), applique les labels Gmail, genere des brouillons de reponse intelligents bases sur un profil business centralise, et logge les resultats dans Google Sheets.

**Architecture:** Gmail Trigger (quotidien 8h, exclut Recrutement) → Lire profil business (Google Doc Drive) → Batch classification Gemini (1 appel pour N emails) → Appliquer labels → Pour les emails needsReply: Gemini brouillon + Gmail Draft → Logger Google Sheets → markAsRead. Gemini via HTTP Request direct avec `responseMimeType: 'application/json'`.

**Tech Stack:** n8n (MCP), Gemini 2.5 Flash (HTTP Request), Google Drive/Sheets/Gmail (OAuth2), MCP Google Drive (creation Sheet/dossiers)

**Design doc:** `docs/plans/2026-02-23-inbox-genie-design.md`

---

### Task 1 : Creer la structure Google Drive + Google Sheet

**Objectif :** Creer le dossier Profil Business sur Drive, le Google Doc template, et la Google Sheet de stats.

**Step 1 : Creer le dossier `Automatisations` dans Google Drive (si inexistant)**

Verifier d'abord si le dossier existe via `mcp__google-drive__searchDocuments` avec query `Automatisations`.
Si inexistant, utiliser `mcp__google-drive__createFolder` :
- `name`: `Automatisations`
- Noter le `folderId` → `AUTOMATISATIONS_FOLDER_ID`

**Step 2 : Creer le sous-dossier `Profil Business`**

Utiliser `mcp__google-drive__createFolder` :
- `name`: `Profil Business`
- `parentFolderId`: `AUTOMATISATIONS_FOLDER_ID`
- Noter le `folderId` → `PROFIL_BUSINESS_FOLDER_ID`

**Step 3 : Creer le Google Doc "Mon Profil Business"**

Utiliser `mcp__google-drive__createDocument` :
- `title`: `Mon Profil Business`
- `parentFolderId`: `PROFIL_BUSINESS_FOLDER_ID`

Puis `mcp__google-drive__appendMarkdown` pour ajouter le template :

```markdown
## Mon entreprise
[A completer — nom, secteur, positionnement]

## Mes services
[A completer — liste des services proposes]

## Mes clients types
[A completer — profil des clients, secteurs, taille]

## Mon ton de communication
[A completer — style, registre, tutoiement/vouvoiement, langue preferee]

## Exemples d'emails envoyes

### Exemple 1 — Reponse a un prospect
[Copier-coller un email reel envoye a un prospect]

### Exemple 2 — Suivi client
[Copier-coller un email reel de suivi client]

### Exemple 3 — Refus poli
[Copier-coller un email de refus ou declinaison polie]
```

- Noter le `documentId` → `PROFIL_DOC_ID`

**Step 4 : Creer la Google Sheet "Inbox Genie Stats"**

Utiliser `mcp__google-drive__createSpreadsheet` :
- `title`: `Inbox Genie Stats`
- `parentFolderId`: `AUTOMATISATIONS_FOLDER_ID`
- Noter le `spreadsheetId` → `STATS_SHEET_ID`

**Step 5 : Ecrire les en-tetes de colonnes (onglet Log)**

Utiliser `mcp__google-drive__writeSpreadsheet` :
- `spreadsheetId`: `STATS_SHEET_ID`
- `range`: `Sheet1!A1:G1`
- `values`: `[["Date", "De", "Sujet", "Labels", "Needs Reply", "Brouillon cree", "Reason"]]`

Renommer l'onglet en "Log" si possible.

**Step 6 : Formater les en-tetes**

Utiliser `mcp__google-drive__formatCells` :
- `spreadsheetId`: `STATS_SHEET_ID`
- `range`: `Sheet1!A1:G1`
- Gras, fond colore

**Step 7 : Figer la premiere ligne**

Utiliser `mcp__google-drive__freezeRowsAndColumns` :
- `spreadsheetId`: `STATS_SHEET_ID`
- `frozenRows`: `1`

**Resultat attendu :** Dossier `Automatisations/Profil Business/` avec Google Doc template, et Google Sheet "Inbox Genie Stats" avec 7 colonnes formatees.

---

### Task 2 : Creer les labels Gmail

**Objectif :** Creer les 6 labels dans Gmail via n8n.

**Step 1 : Creer un workflow temporaire de creation de labels**

Utiliser `n8n_create_workflow` :
```json
{
  "name": "[TEMP] Creer labels Inbox Genie",
  "nodes": [
    {
      "name": "Trigger manuel",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [400, 300]
    },
    {
      "name": "Definir labels",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [600, 300],
      "parameters": {
        "mode": "raw",
        "jsonOutput": "{ \"labels\": [\"Client\", \"Prospect\", \"Admin\", \"Newsletter\", \"Cold Email\", \"Notification\"] }",
        "options": {}
      }
    },
    {
      "name": "Separer labels",
      "type": "n8n-nodes-base.splitOut",
      "typeVersion": 1,
      "position": [800, 300],
      "parameters": {
        "fieldToSplitOut": "labels",
        "options": {}
      }
    },
    {
      "name": "Creer label",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [1000, 300],
      "parameters": {
        "resource": "label",
        "operation": "create",
        "name": "={{ $json.labels }}",
        "options": {}
      },
      "credentials": {
        "gmailOAuth2": { "id": "N8N_RESOURCE_ID_10", "name": "Gmail account" }
      },
      "onError": "continueRegularOutput"
    }
  ],
  "connections": {
    "Trigger manuel": { "main": [[{ "node": "Definir labels", "type": "main", "index": 0 }]] },
    "Definir labels": { "main": [[{ "node": "Separer labels", "type": "main", "index": 0 }]] },
    "Separer labels": { "main": [[{ "node": "Creer label", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1" },
  "active": false
}
```

**Step 2 : Executer le workflow**

Utiliser `n8n_test_workflow` pour creer les labels.

**Step 3 : Verifier les labels crees**

Utiliser `n8n_get_workflow` avec `mode: "details"` pour voir les resultats d'execution.
Alternativement, le workflow Inbox Genie principal fera un `getAll` labels pour recuperer les IDs.

**Step 4 : Supprimer le workflow temporaire**

Utiliser `n8n_delete_workflow` pour nettoyer.

---

### Task 3 : Creer le workflow principal — Trigger + Lecture profil business

**Objectif :** Creer le workflow Inbox Genie avec le Gmail Trigger et la lecture du profil business.

**Step 1 : Creer le workflow**

Utiliser `n8n_create_workflow` :
```json
{
  "name": "Gmail - Inbox Genie",
  "nodes": [
    {
      "name": "Recevoir emails non lus",
      "type": "n8n-nodes-base.gmailTrigger",
      "typeVersion": 1.2,
      "position": [400, 300],
      "parameters": {
        "pollTimes": { "item": [{ "hour": 8 }] },
        "simple": false,
        "filters": {
          "readStatus": "unread",
          "q": "-label:Recrutement -from:me"
        },
        "options": {}
      },
      "credentials": {
        "gmailOAuth2": { "id": "N8N_RESOURCE_ID_10", "name": "Gmail account" }
      }
    }
  ],
  "connections": {},
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "bAurtiK8UqF7Mlw6"
  },
  "active": false
}
```
- Noter le `workflowId` → `WORKFLOW_ID`

**Step 2 : Ajouter la lecture du profil business**

Utiliser `n8n_update_partial_workflow` pour ajouter 3 nodes :

Node 1 — "Chercher profil business" (Google Drive search) :
```json
{
  "name": "Chercher profil business",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [700, 300],
  "parameters": {
    "resource": "fileFolder",
    "limit": 1,
    "filter": {
      "folderId": { "__rl": true, "value": "PROFIL_BUSINESS_FOLDER_ID", "mode": "id" }
    },
    "options": {}
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  },
  "alwaysOutputData": true
}
```

Node 2 — "Telecharger profil business" (Google Drive download) :
```json
{
  "name": "Telecharger profil business",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [940, 300],
  "parameters": {
    "operation": "download",
    "fileId": { "__rl": true, "value": "={{ $json.id }}", "mode": "id" },
    "options": {
      "googleFileConversion": {
        "conversion": { "docsToFormat": "text/plain" }
      }
    }
  },
  "credentials": {
    "googleDriveOAuth2Api": { "id": "N8N_RESOURCE_ID_18", "name": "Google Drive account" }
  }
}
```

Node 3 — "Extraire texte profil" (Extract from File) :
```json
{
  "name": "Extraire texte profil",
  "type": "n8n-nodes-base.extractFromFile",
  "typeVersion": 1,
  "position": [1180, 300],
  "parameters": {
    "operation": "text",
    "destinationKey": "profilBusiness",
    "options": {}
  }
}
```

Connexions :
- `Recevoir emails non lus` → `Chercher profil business`
- `Chercher profil business` → `Telecharger profil business`
- `Telecharger profil business` → `Extraire texte profil`

**Step 3 : Verifier le workflow**

`n8n_get_workflow` avec `WORKFLOW_ID`, `mode: "structure"` pour confirmer.

---

### Task 4 : Ajouter la classification batch Gemini

**Objectif :** Construire le prompt batch, appeler Gemini, parser les resultats.

**Step 1 : Ajouter le Code node "Construire prompt classification"**

```json
{
  "name": "Construire prompt classification",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1420, 300],
  "parameters": {
    "jsCode": "const allEmails = $('Recevoir emails non lus').all();\nconst profilBusiness = $json.profilBusiness || '';\n\nconst emailSummaries = allEmails.map((item, idx) => {\n  const e = item.json;\n  const body = (e.text || e.textAsHtml || '').substring(0, 500);\n  return `### Email ${idx + 1}\\nID: ${e.id}\\nFrom: ${e.headers?.from || e.from || 'inconnu'}\\nSubject: ${e.headers?.subject || e.subject || '(sans sujet)'}\\nBody: ${body}`;\n}).join('\\n\\n');\n\nconst systemPrompt = `Tu es un assistant de tri d'emails pour un professionnel. Voici son profil :\\n\\n${profilBusiness}\\n\\n# Labels disponibles\\n- Client : email d'un client existant (relation etablie, projet en cours)\\n- Prospect : demande entrante legitime, inbound, premier contact sincere\\n- Admin : factures, contrats, comptabilite, administratif\\n- Newsletter : newsletters, contenus par abonnement\\n- Cold Email : prospection commerciale non sollicitee. Indices : premier contact avec pitch commercial, questions ouvertes generiques (\\\"Seriez-vous interesse par...\\\"), liens calendly/booking, signatures SDR/BDR/Account Executive, mention de \\\"partenariat\\\" ou \\\"synergie\\\" sans contexte prealable\\n- Notification : alertes systemes, confirmations automatiques, SaaS\\n\\n# Regles\\n- Chaque email recoit exactement 1 label\\n- needsReply = true UNIQUEMENT pour Client, Prospect, et Admin quand une reponse est clairement attendue\\n- needsReply = false pour Newsletter, Cold Email, Notification, et Admin sans question directe\\n- Cold Email : meme si l'email pose une question, c'est du commercial non sollicite → needsReply: false\\n\\n# Output\\nRetourne un array JSON. Pour chaque email :\\n{ \\\"id\\\": \\\"gmail_message_id\\\", \\\"label\\\": \\\"un_seul_label\\\", \\\"needsReply\\\": true/false, \\\"reason\\\": \\\"explication courte\\\" }`;\n\nconst userPrompt = `Voici les emails a classifier :\\n\\n${emailSummaries}`;\n\nconst requestBody = {\n  contents: [{ role: 'user', parts: [{ text: userPrompt }] }],\n  systemInstruction: { parts: [{ text: systemPrompt }] },\n  generationConfig: {\n    temperature: 0.2,\n    responseMimeType: 'application/json'\n  }\n};\n\nreturn [{ json: { requestBody, profilBusiness, emailCount: allEmails.length } }];"
  }
}
```

Connexion : `Extraire texte profil` → `Construire prompt classification`

**Step 2 : Ajouter le HTTP Request "Classifier via Gemini"**

```json
{
  "name": "Classifier via Gemini",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [1660, 300],
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

Connexion : `Construire prompt classification` → `Classifier via Gemini`

**Step 3 : Ajouter le Code node "Parser classifications"**

Ce node parse le JSON Gemini et produit 1 item par email avec ses donnees originales + classification :

```json
{
  "name": "Parser classifications",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1900, 300],
  "parameters": {
    "jsCode": "const response = $json.candidates[0].content.parts[0].text;\nconst classifications = JSON.parse(response);\nconst allEmails = $('Recevoir emails non lus').all();\nconst profilBusiness = $('Construire prompt classification').first().json.profilBusiness;\n\nconst toArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);\nconst classArray = toArray(classifications);\n\nreturn allEmails.map((emailItem, idx) => {\n  const email = emailItem.json;\n  const classification = classArray.find(c => c.id === email.id) || classArray[idx] || { label: 'Notification', needsReply: false, reason: 'Non classifie' };\n  return {\n    json: {\n      emailId: email.id,\n      threadId: email.threadId,\n      from: email.headers?.from || email.from || '',\n      subject: email.headers?.subject || email.subject || '',\n      body: email.text || email.textAsHtml || '',\n      label: classification.label,\n      needsReply: classification.needsReply === true,\n      reason: classification.reason || '',\n      profilBusiness\n    }\n  };\n});"
  }
}
```

Connexion : `Classifier via Gemini` → `Parser classifications`

**Step 4 : Verifier le workflow**

---

### Task 5 : Ajouter l'application des labels Gmail

**Objectif :** Recuperer les IDs des labels Gmail et les appliquer a chaque email.

**Step 1 : Ajouter le Code node "Recuperer label IDs"**

Ce node fait un appel Gmail pour lister les labels et mappe les noms aux IDs :

```json
{
  "name": "Appliquer labels Gmail",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2140, 300],
  "parameters": {
    "jsCode": "// Ce node utilise $input pour traiter chaque email\n// Les labels Gmail doivent etre crees au prealable (Task 2)\n// On passe les donnees telles quelles — le labeling sera fait via un node Gmail addLabels\nconst item = $input.item.json;\nreturn [{ json: item }];"
  }
}
```

En realite, le labeling necessite de connaitre les IDs des labels Gmail. On va ajouter un node Gmail `getAll` labels en parallele puis merger.

**Approche revisee :**

Ajouter un node Gmail "Recuperer labels Gmail" apres le parser :
```json
{
  "name": "Recuperer labels Gmail",
  "type": "n8n-nodes-base.gmail",
  "typeVersion": 2.1,
  "position": [2140, 100],
  "parameters": {
    "resource": "label",
    "returnAll": true
  },
  "credentials": {
    "gmailOAuth2": { "id": "N8N_RESOURCE_ID_10", "name": "Gmail account" }
  },
  "executeOnce": true
}
```

Puis un Code node "Appliquer labels" qui associe chaque email a son label ID :
```json
{
  "name": "Mapper et appliquer labels",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2380, 300],
  "parameters": {
    "jsCode": "const labels = $('Recuperer labels Gmail').all().map(i => i.json);\nconst items = $('Parser classifications').all();\n\nreturn items.map(item => {\n  const email = item.json;\n  const gmailLabel = labels.find(l => l.name === email.label);\n  return {\n    json: {\n      ...email,\n      labelId: gmailLabel ? gmailLabel.id : null\n    }\n  };\n});"
  }
}
```

Connexions :
- `Parser classifications` → `Recuperer labels Gmail`
- `Parser classifications` → `Mapper et appliquer labels` (attend aussi `Recuperer labels Gmail`)

Note : dans n8n, le Code node peut acceder aux deux nodes amont via `$('NodeName')`.

Connexion reelle : `Recuperer labels Gmail` → `Mapper et appliquer labels`

**Step 2 : Ajouter le node Gmail "Labelliser email"**

```json
{
  "name": "Labelliser email",
  "type": "n8n-nodes-base.gmail",
  "typeVersion": 2.1,
  "position": [2620, 300],
  "parameters": {
    "operation": "addLabels",
    "messageId": "={{ $json.emailId }}",
    "labelIds": "={{ [$json.labelId] }}"
  },
  "credentials": {
    "gmailOAuth2": { "id": "N8N_RESOURCE_ID_10", "name": "Gmail account" }
  },
  "onError": "continueRegularOutput"
}
```

Connexion : `Mapper et appliquer labels` → `Labelliser email`

**Step 3 : Verifier le workflow**

---

### Task 6 : Ajouter la generation de brouillons de reponse

**Objectif :** Pour les emails avec needsReply=true, generer un brouillon de reponse via Gemini et le creer dans Gmail.

**Step 1 : Ajouter le IF node "Reponse necessaire"**

```json
{
  "name": "Reponse necessaire",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "position": [2860, 300],
  "parameters": {
    "conditions": {
      "options": { "version": 2, "caseSensitive": true, "typeValidation": "loose", "looseTypeValidation": true },
      "conditions": [
        {
          "leftValue": "={{ $json.needsReply }}",
          "rightValue": true,
          "operator": { "type": "boolean", "operation": "true", "singleValue": true }
        }
      ],
      "combinator": "and"
    }
  }
}
```

Connexion : `Labelliser email` → `Reponse necessaire`

**Step 2 : Ajouter le Code node "Construire prompt brouillon"**

```json
{
  "name": "Construire prompt brouillon",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [3100, 200],
  "parameters": {
    "jsCode": "const email = $json;\n\nconst systemPrompt = `Tu es l'assistant personnel de l'utilisateur. Tu rediges des brouillons de reponses a ses emails.\n\nVoici son profil business et ses exemples de style :\n${email.profilBusiness}\n\n# Regles\n- Reproduis le ton et le style des exemples d'emails fournis dans le profil\n- Sois concis et professionnel\n- Commence par \"Bonjour,\" ou \"Hello,\" selon la langue de l'email recu\n- Termine par \"Cordialement,\" ou \"Best,\" selon la langue\n- Pour les questions oui/non, redige 2 versions separees par \"------- OU -------\"\n- Si tu ne connais pas la reponse, utilise des placeholders [A COMPLETER]\n- Ne fabrique jamais d'informations\n- Reponds dans la meme langue que l'email recu\n- Format texte brut uniquement, pas de HTML ni markdown`;\n\nconst userPrompt = `Email recu :\\nDe: ${email.from}\\nSujet: ${email.subject}\\nContenu:\\n${email.body}`;\n\nconst requestBody = {\n  contents: [{ role: 'user', parts: [{ text: userPrompt }] }],\n  systemInstruction: { parts: [{ text: systemPrompt }] },\n  generationConfig: {\n    temperature: 0.4\n  }\n};\n\nreturn [{ json: { requestBody, emailId: email.emailId, threadId: email.threadId, from: email.from, subject: email.subject } }];"
  }
}
```

Connexion : `Reponse necessaire` (true) → `Construire prompt brouillon`

**Step 3 : Ajouter le HTTP Request "Generer brouillon via Gemini"**

```json
{
  "name": "Generer brouillon via Gemini",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [3340, 200],
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

Connexion : `Construire prompt brouillon` → `Generer brouillon via Gemini`

**Step 4 : Ajouter le node Gmail "Creer brouillon"**

```json
{
  "name": "Creer brouillon Gmail",
  "type": "n8n-nodes-base.gmail",
  "typeVersion": 2.1,
  "position": [3580, 200],
  "parameters": {
    "resource": "draft",
    "subject": "=Re: {{ $('Construire prompt brouillon').item.json.subject }}",
    "emailType": "html",
    "message": "={{ $json.candidates[0].content.parts[0].text.replace(/\\n/g, '<br />\\n') }}",
    "options": {
      "threadId": "={{ $('Construire prompt brouillon').item.json.threadId }}",
      "sendTo": "={{ $('Construire prompt brouillon').item.json.from }}"
    }
  },
  "credentials": {
    "gmailOAuth2": { "id": "N8N_RESOURCE_ID_10", "name": "Gmail account" }
  }
}
```

Connexion : `Generer brouillon via Gemini` → `Creer brouillon Gmail`

**Step 5 : Verifier le workflow**

---

### Task 7 : Ajouter le logging Google Sheets + markAsRead

**Objectif :** Logger chaque email traite dans la Google Sheet et marquer tous les emails comme lus.

**Step 1 : Ajouter le node Google Sheets "Logger email"**

Ce node doit recevoir TOUS les emails (ceux avec et sans brouillon). Il se connecte apres le `Labelliser email` (pas apres le IF).

```json
{
  "name": "Logger dans Stats",
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.6,
  "position": [2860, 500],
  "parameters": {
    "operation": "append",
    "documentId": { "__rl": true, "value": "STATS_SHEET_ID", "mode": "id" },
    "sheetName": { "__rl": true, "value": "gid=0", "mode": "list", "cachedResultName": "Log" },
    "columns": {
      "mappingMode": "defineBelow",
      "value": {
        "Date": "={{ $now.format('yyyy-MM-dd HH:mm') }}",
        "De": "={{ $json.from }}",
        "Sujet": "={{ $json.subject }}",
        "Labels": "={{ $json.label }}",
        "Needs Reply": "={{ $json.needsReply }}",
        "Brouillon cree": "={{ $json.needsReply ? 'Oui' : 'Non' }}",
        "Reason": "={{ $json.reason }}"
      },
      "schema": [
        { "id": "Date", "displayName": "Date", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "De", "displayName": "De", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Sujet", "displayName": "Sujet", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Labels", "displayName": "Labels", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Needs Reply", "displayName": "Needs Reply", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Brouillon cree", "displayName": "Brouillon cree", "type": "string", "display": true, "canBeUsedToMatch": true },
        { "id": "Reason", "displayName": "Reason", "type": "string", "display": true, "canBeUsedToMatch": true }
      ]
    },
    "options": {}
  },
  "credentials": {
    "googleSheetsOAuth2Api": { "id": "N8N_RESOURCE_ID_03", "name": "Google Sheets account" }
  }
}
```

Connexion : `Labelliser email` → `Logger dans Stats`

**Step 2 : Ajouter le node Gmail "Marquer email lu"**

```json
{
  "name": "Marquer email lu",
  "type": "n8n-nodes-base.gmail",
  "typeVersion": 2.1,
  "position": [3100, 500],
  "parameters": {
    "operation": "markAsRead",
    "messageId": "={{ $json.emailId }}"
  },
  "credentials": {
    "gmailOAuth2": { "id": "N8N_RESOURCE_ID_10", "name": "Gmail account" }
  }
}
```

Connexion : `Logger dans Stats` → `Marquer email lu`

Note : Le `markAsRead` utilise `emailId` qui est passe depuis le parser — verifier que le champ est bien propage a travers le logging.

**Step 3 : Verifier le workflow**

---

### Task 8 : Ajouter les sticky notes de documentation

**Objectif :** Documenter chaque section du workflow avec des sticky notes.

**Notes a ajouter :**

1. "## 1. Reception emails\nGmail Trigger quotidien 8h\nEmails non lus seulement\nExclut label Recrutement et emails envoyes par moi" (position [320, 100], couleur 2)

2. "## 2. Profil Business\nLit le Google Doc depuis Drive\nDossier /Automatisations/Profil Business/\nContient : entreprise, services, ton, exemples d'emails" (position [620, 100], couleur 3)

3. "## 3. Classification batch Gemini\n1 seul appel pour tous les emails\nBody tronque a 500 chars\n6 labels : Client, Prospect, Admin, Newsletter, Cold Email, Notification" (position [1340, 100], couleur 5)

4. "## 4. Application labels Gmail\nRecupere les IDs des labels\nApplique 1 label par email\ncontinueOnFail si un label echoue" (position [2060, 100], couleur 4)

5. "## 5. Brouillons de reponse\nUniquement pour needsReply=true\nUtilise le profil business + exemples\nCree un brouillon Gmail dans le thread" (position [3020, 0], couleur 6)

6. "## 6. Logging + Cleanup\nLog dans Google Sheets (1 ligne/email)\nMarque les emails comme lus\nStats agregees via formules Sheet" (position [2780, 400], couleur 7)

**Step 1 : Ajouter les 6 sticky notes via `n8n_update_partial_workflow`**

**Step 2 : Verifier le workflow final**

---

### Task 9 : Tester le workflow de bout en bout

**Objectif :** Tester avec de vrais emails pour valider le pipeline complet.

**Step 1 : Verifier que le profil business est rempli**

Demander a l'utilisateur de completer le Google Doc "Mon Profil Business" avec ses informations reelles et au moins 2-3 exemples d'emails.

**Step 2 : S'assurer qu'il y a des emails non lus dans Gmail**

L'utilisateur doit avoir au moins 3-5 emails non lus de types differents (client, newsletter, cold email idealement).

**Step 3 : Executer le workflow manuellement**

Utiliser `n8n_test_workflow` avec `WORKFLOW_ID`.

**Step 4 : Verifier les resultats**

- Les labels Gmail sont appliques correctement
- Les cold emails sont bien detectes (pas de brouillon genere)
- Les brouillons sont crees dans Gmail avec le bon style
- La Google Sheet contient les logs
- Les emails sont marques comme lus

**Step 5 : Corriger les eventuels problemes**

Consulter `n8n_executions` pour les logs et corriger si necessaire.

**Step 6 : Commit et documentation**

```bash
git add workflows/gmail-inbox-genie.json docs/plans/2026-02-23-inbox-genie-plan.md
git commit -m "feat: Gmail Inbox Genie — labeling IA + brouillons automatiques"
```

Mettre a jour `docs/rex-automatisations.md` avec les lecons apprises.

---

## Recapitulatif des IDs a noter en cours de route

| Element | Variable | Valeur |
|---------|----------|--------|
| Dossier Automatisations | `AUTOMATISATIONS_FOLDER_ID` | A creer (Task 1) |
| Dossier Profil Business | `PROFIL_BUSINESS_FOLDER_ID` | A creer (Task 1) |
| Google Doc Profil | `PROFIL_DOC_ID` | A creer (Task 1) |
| Google Sheet Stats | `STATS_SHEET_ID` | A creer (Task 1) |
| Workflow n8n | `WORKFLOW_ID` | A creer (Task 3) |

## Credentials existants (ne pas recreer)

| Credential | ID | Type |
|-----------|-----|------|
| Gmail | `N8N_RESOURCE_ID_10` | `gmailOAuth2` |
| Google Drive | `N8N_RESOURCE_ID_18` | `googleDriveOAuth2Api` |
| Google Sheets | `N8N_RESOURCE_ID_03` | `googleSheetsOAuth2Api` |
| Gemini API | `N8N_RESOURCE_ID_06` | `googlePalmApi` |
| Error Workflow | `bAurtiK8UqF7Mlw6` | — |
