# Diagnostic - Generer Rapport : Plan d'implementation n8n

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le workflow n8n "Diagnostic - Generer Rapport" qui recoit les scores du diagnostic IA marketing, scrape l'entreprise du prospect, genere une analyse personnalisee via Gemini, stocke le rapport dans Supabase et met a jour le contact Brevo.

**Architecture:** Workflow monolithique lineaire (~12 nodes). Webhook fire-and-forget → validation → extraction domaine → scraping parallele (Jina Reader + Jina Search) → merge → 2x Gemini → assemblage JSON + password → Supabase upsert → Brevo update contact + liste 7.

**Tech Stack:** n8n (webhook, HTTP Request, Code, IF, Merge), Jina AI (Reader + Search), Gemini 3 Pro Preview API, Supabase REST API, Brevo API v3.

**Spec de reference:** `docs/specs/2026-04-09-diagnostic-rapport-automation-design.md`
**Brief technique:** `<repo-marque>/brand/briefs/brief-technique-n8n-supabase-gemini.md`

**Instance n8n:** `https://n8n.example.com/`
**Error Workflow existant:** `bAurtiK8UqF7Mlw6`

---

## Pre-requis (a confirmer avant execution)

- [ ] Supabase : `PROJECT_REF`, `service_role_key` communiques par l'agent site web
- [ ] Brevo : ID de la liste 7 "Rapport pret" communique par l'agent Brevo
- [ ] Brevo : attributs `RAPPORT_PASSWORD` et `RAPPORT_DATE` crees
- [ ] Cle API Gemini disponible (meme cle que le credential `googlePalmApi` existant `N8N_RESOURCE_ID_06`)

Si les credentials Supabase/Brevo ne sont pas encore disponibles, commencer par les Tasks 1-6 (workflow + nodes) et ajouter les credentials et les tests ensuite.

---

## Task 1 : Creer les credentials manquantes

**Credentials a creer dans n8n :**

- [ ] **Step 1 : Creer credential `geminiApiKey`** (type `httpQueryAuth`)

```
name: "geminiApiKey"
type: "httpQueryAuth"
data: { name: "key", value: "<GEMINI_API_KEY>" }
```

Utiliser `mcp__n8n-mcp__n8n_manage_credentials` action `create`.
La cle API est la meme que celle du credential PaLM existant. Demander a l'utilisateur si besoin.

- [ ] **Step 2 : Creer credential `brevoApi`** (type `httpHeaderAuth`)

```
name: "brevoApi"
type: "httpHeaderAuth"
data: { name: "api-key", value: "<BREVO_API_KEY>" }
```

Note : cette credential n'apparait plus dans la liste actuelle (12 credentials). Le workflow "Agent Tool - Query Brevo" (`QqKYt8MNNEujc4ib`) l'utilise — verifier si elle existe encore en inspectant ce workflow. Si elle existe, passer cette etape.

- [ ] **Step 3 : Creer credential `supabaseServiceRole`** (type `httpHeaderAuth`)

```
name: "supabaseServiceRole"
type: "httpHeaderAuth"
data: { name: "apikey", value: "<SUPABASE_SERVICE_ROLE_KEY>" }
```

Attendre que l'agent site web communique la `service_role_key`.

---

## Task 2 : Creer le workflow avec le Webhook + Validation

- [ ] **Step 1 : Creer le workflow initial avec 2 nodes**

Utiliser `mcp__n8n-mcp__n8n_create_workflow` avec :

```json
{
  "name": "Diagnostic - Generer Rapport",
  "nodes": [
    {
      "id": "webhook-1",
      "name": "Recevoir diagnostic",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0],
      "parameters": {
        "path": "diagnostic-rapport",
        "httpMethod": "POST",
        "responseMode": "immediately",
        "responseCode": 200,
        "options": {}
      }
    },
    {
      "id": "if-1",
      "name": "Valider payload",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [220, 0],
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "loose",
            "looseTypeValidation": true
          },
          "conditions": [
            {
              "id": "cond-email",
              "leftValue": "={{ $json.body.email }}",
              "rightValue": "",
              "operator": {
                "type": "string",
                "operation": "isNotEmpty"
              }
            },
            {
              "id": "cond-entreprise",
              "leftValue": "={{ $json.body.entreprise }}",
              "rightValue": "",
              "operator": {
                "type": "string",
                "operation": "isNotEmpty"
              }
            },
            {
              "id": "cond-score",
              "leftValue": "={{ $json.body.score_global }}",
              "rightValue": "0",
              "operator": {
                "type": "number",
                "operation": "gt"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {
          "looseTypeValidation": true
        }
      }
    }
  ],
  "connections": {
    "Recevoir diagnostic": {
      "main": [[
        { "node": "Valider payload", "type": "main", "index": 0 }
      ]]
    }
  },
  "settings": {
    "executionOrder": "v1",
    "saveDataErrorExecution": "all",
    "saveDataSuccessExecution": "all",
    "saveManualExecutions": true,
    "errorWorkflow": "bAurtiK8UqF7Mlw6",
    "timezone": "Europe/Paris"
  }
}
```

- [ ] **Step 2 : Noter l'ID du workflow retourne**

L'ID sera utilise dans toutes les etapes suivantes pour les `n8n_update_partial_workflow`.

- [ ] **Step 3 : Valider le workflow**

Utiliser `mcp__n8n-mcp__n8n_validate_workflow` avec l'ID.

---

## Task 3 : Ajouter le node Code "Extraire domaine email"

- [ ] **Step 1 : Ajouter le node Code**

Utiliser `mcp__n8n-mcp__n8n_update_partial_workflow` :

```json
{
  "id": "<WORKFLOW_ID>",
  "intent": "Ajouter node Code pour extraire le domaine email et calculer le niveau de maturite",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "code-domaine",
        "name": "Extraire domaine email",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [440, 0],
        "parameters": {
          "jsCode": "const item = $input.first().json;\nconst body = item.body || item;\n\nconst email = body.email || '';\nconst domaine = email.split('@')[1] || '';\n\nconst domainesGeneriques = [\n  'gmail.com', 'outlook.com', 'outlook.fr', 'yahoo.fr', 'yahoo.com',\n  'hotmail.com', 'hotmail.fr', 'live.fr', 'live.com',\n  'orange.fr', 'free.fr', 'sfr.fr', 'wanadoo.fr', 'laposte.net',\n  'icloud.com', 'protonmail.com', 'pm.me'\n];\n\nconst domaineEntreprise = domainesGeneriques.includes(domaine.toLowerCase()) ? null : domaine;\n\nconst scoreGlobal = parseFloat(body.score_global) || 0;\nlet niveauGlobal = 'Debutant';\nif (scoreGlobal >= 3.4) niveauGlobal = 'Integre';\nelse if (scoreGlobal >= 2.6) niveauGlobal = 'Structure';\nelse if (scoreGlobal >= 1.8) niveauGlobal = 'Explorateur';\n\nreturn [{\n  json: {\n    ...body,\n    domaine: domaineEntreprise,\n    niveauGlobal: niveauGlobal,\n    score_usages: parseFloat(body.score_usages) || 0,\n    score_donnees: parseFloat(body.score_donnees) || 0,\n    score_competences: parseFloat(body.score_competences) || 0,\n    score_processus: parseFloat(body.score_processus) || 0,\n    score_gouvernance: parseFloat(body.score_gouvernance) || 0,\n    score_global: scoreGlobal\n  }\n}];"
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Valider payload",
      "target": "Extraire domaine email",
      "branch": "true"
    }
  ]
}
```

- [ ] **Step 2 : Valider**

---

## Task 4 : Ajouter les 2 nodes Jina en parallele + Merge

- [ ] **Step 1 : Ajouter les 3 nodes (Jina Reader, Jina Search, Merge)**

```json
{
  "id": "<WORKFLOW_ID>",
  "intent": "Ajouter scraping parallele Jina Reader + Jina Search + Merge",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "http-jina-reader",
        "name": "Scraper site web",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [660, -100],
        "continueOnFail": true,
        "retryOnFail": true,
        "maxTries": 2,
        "waitBetweenTries": 3000,
        "parameters": {
          "url": "=https://r.jina.ai/https://{{ $json.domaine }}",
          "method": "GET",
          "options": {
            "timeout": 15000,
            "response": {
              "response": {
                "fullResponse": false
              }
            }
          },
          "sendHeaders": true,
          "headerParameters": {
            "parameters": [
              {
                "name": "Accept",
                "value": "text/plain"
              }
            ]
          }
        }
      }
    },
    {
      "type": "addNode",
      "node": {
        "id": "http-jina-search",
        "name": "Rechercher entreprise",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [660, 100],
        "continueOnFail": true,
        "retryOnFail": true,
        "maxTries": 2,
        "waitBetweenTries": 3000,
        "parameters": {
          "url": "=https://s.jina.ai/{{ encodeURIComponent($json.entreprise + ' ' + ($json.domaine || '')) }}",
          "method": "GET",
          "options": {
            "timeout": 15000,
            "response": {
              "response": {
                "fullResponse": false
              }
            }
          },
          "sendHeaders": true,
          "headerParameters": {
            "parameters": [
              {
                "name": "Accept",
                "value": "application/json"
              }
            ]
          }
        }
      }
    },
    {
      "type": "addNode",
      "node": {
        "id": "merge-1",
        "name": "Fusionner contexte",
        "type": "n8n-nodes-base.merge",
        "typeVersion": 3,
        "position": [880, 0],
        "parameters": {
          "mode": "combine",
          "combinationMode": "mergeByPosition",
          "options": {}
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Extraire domaine email",
      "target": "Scraper site web"
    },
    {
      "type": "addConnection",
      "source": "Extraire domaine email",
      "target": "Rechercher entreprise"
    },
    {
      "type": "addConnection",
      "source": "Scraper site web",
      "target": "Fusionner contexte"
    },
    {
      "type": "addConnection",
      "source": "Rechercher entreprise",
      "target": "Fusionner contexte"
    }
  ]
}
```

- [ ] **Step 2 : Valider**

Note : le Merge recoit les 2 inputs sur input 0 et input 1 (premier connecte = input 0, deuxieme = input 1). L'ordre des `addConnection` compte.

---

## Task 5 : Ajouter le Code node "Preparer prompt Gemini"

Ce node intermediaire restructure les donnees du Merge pour preparer le prompt Gemini. Il recupere les donnees originales du prospect (depuis le node Code amont) et les combine avec le contexte scrape.

- [ ] **Step 1 : Ajouter le node Code**

```json
{
  "id": "<WORKFLOW_ID>",
  "intent": "Ajouter node Code pour preparer les donnees avant Gemini",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "code-prep",
        "name": "Preparer prompt Gemini",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [1100, 0],
        "parameters": {
          "jsCode": "const merged = $input.first().json;\n\n// Recuperer les donnees originales du prospect\nconst prospect = $('Extraire domaine email').first().json;\n\n// Extraire le contenu scrape\nlet contenuSite = '';\nlet resultatsRecherche = '';\n\ntry {\n  // Jina Reader retourne du texte brut\n  const jinaReader = $('Scraper site web').first().json;\n  contenuSite = typeof jinaReader.data === 'string' ? jinaReader.data : (jinaReader.data || jinaReader.body || JSON.stringify(jinaReader)).substring(0, 3000);\n} catch(e) {\n  contenuSite = '';\n}\n\ntry {\n  // Jina Search retourne du JSON\n  const jinaSearch = $('Rechercher entreprise').first().json;\n  if (jinaSearch.data && Array.isArray(jinaSearch.data)) {\n    resultatsRecherche = jinaSearch.data.map(r => r.title + ': ' + (r.description || r.content || '')).join('\\n').substring(0, 3000);\n  } else {\n    resultatsRecherche = JSON.stringify(jinaSearch).substring(0, 3000);\n  }\n} catch(e) {\n  resultatsRecherche = '';\n}\n\nreturn [{\n  json: {\n    ...prospect,\n    contenuSite: contenuSite,\n    resultatsRecherche: resultatsRecherche,\n    contexteDisponible: !!(contenuSite || resultatsRecherche)\n  }\n}];"
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Fusionner contexte",
      "target": "Preparer prompt Gemini"
    }
  ]
}
```

- [ ] **Step 2 : Valider**

---

## Task 6 : Ajouter Gemini #1 — Analyse dimensions

- [ ] **Step 1 : Ajouter le node HTTP Request Gemini #1**

```json
{
  "id": "<WORKFLOW_ID>",
  "intent": "Ajouter appel Gemini #1 pour analyse des dimensions",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "http-gemini-1",
        "name": "Analyser dimensions",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [1320, 0],
        "retryOnFail": true,
        "maxTries": 2,
        "waitBetweenTries": 5000,
        "parameters": {
          "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent",
          "method": "POST",
          "authentication": "predefinedCredentialType",
          "nodeCredentialType": "httpQueryAuth",
          "sendBody": true,
          "specifyBody": "json",
          "jsonBody": "={\n  \"contents\": [{\n    \"parts\": [{\n      \"text\": \"Tu es un consultant expert en strategie IA pour les PME et ETI. Tu analyses les resultats d'un diagnostic de maturite IA marketing.\\n\\nPROSPECT :\\n- Prenom : {{ $json.prenom }}\\n- Nom : {{ $json.nom }}\\n- Entreprise : {{ $json.entreprise }}\\n- Taille equipe : {{ $json.taille_equipe }}\\n\\nSCORES (echelle 1.0 a 4.0) :\\n- Usages IA actuels : {{ $json.score_usages }}\\n- Donnees marketing : {{ $json.score_donnees }}\\n- Competences et culture : {{ $json.score_competences }}\\n- Processus et workflows : {{ $json.score_processus }}\\n- Gouvernance et vision : {{ $json.score_gouvernance }}\\n- Score global : {{ $json.score_global }} (niveau : {{ $json.niveauGlobal }})\\n\\nNIVEAUX DE MATURITE :\\n- 1.0-1.7 : Debutant\\n- 1.8-2.5 : Explorateur\\n- 2.6-3.3 : Structure\\n- 3.4-4.0 : Integre\\n\\nCONTEXTE ENTREPRISE (scraping web) :\\n{{ $json.contenuSite ? 'Site web : ' + $json.contenuSite : 'Site web non disponible' }}\\n{{ $json.resultatsRecherche ? 'Recherche : ' + $json.resultatsRecherche : 'Recherche non disponible' }}\\n\\nINSTRUCTIONS :\\n1. Produis une intro personnalisee (max 500 caracteres) qui contextualise le diagnostic par rapport au secteur, a la taille et aux enjeux specifiques de l'entreprise. Mentionne le secteur, la taille de l'equipe, les enjeux concrets, et situe le score global.\\n2. Produis une synthese globale (max 300 caracteres) resumant forces et axes d'amelioration. Ton direct, pas de jargon.\\n3. Pour chaque dimension (exactement 5, dans CET ORDRE : Usages IA actuels, Donnees marketing, Competences et culture, Processus et workflows, Gouvernance et vision), produis :\\n   - diagnostic : 3-5 phrases d'analyse personnalisee tenant compte du contexte entreprise (max 400 caracteres)\\n   - quick_win : 1-2 phrases decrivant une action concrete et rapide (max 200 caracteres)\\n\\nREGLES :\\n- Vouvoiement obligatoire. Jamais de tutoiement.\\n- Pas de tirets longs dans les textes. Utiliser des virgules ou des points.\\n- Ton direct et professionnel, pas de jargon IA inutile.\\n- Si aucun contexte entreprise n'est disponible, analyser sur la base des scores uniquement en l'indiquant.\\n- Les noms de dimensions doivent etre EXACTEMENT comme indique (la page mappe par index).\"\n    }]\n  }],\n  \"generationConfig\": {\n    \"responseMimeType\": \"application/json\",\n    \"responseSchema\": {\n      \"type\": \"OBJECT\",\n      \"properties\": {\n        \"intro_personnalisee\": { \"type\": \"STRING\" },\n        \"synthese_globale\": { \"type\": \"STRING\" },\n        \"dimensions\": {\n          \"type\": \"ARRAY\",\n          \"items\": {\n            \"type\": \"OBJECT\",\n            \"properties\": {\n              \"nom\": { \"type\": \"STRING\" },\n              \"diagnostic\": { \"type\": \"STRING\" },\n              \"quick_win\": { \"type\": \"STRING\" }\n            },\n            \"required\": [\"nom\", \"diagnostic\", \"quick_win\"]\n          }\n        }\n      },\n      \"required\": [\"intro_personnalisee\", \"synthese_globale\", \"dimensions\"]\n    }\n  }\n}",
          "options": {
            "timeout": 60000
          }
        },
        "credentials": {
          "httpQueryAuth": {
            "id": "<GEMINI_CREDENTIAL_ID>",
            "name": "geminiApiKey"
          }
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Preparer prompt Gemini",
      "target": "Analyser dimensions"
    }
  ]
}
```

- [ ] **Step 2 : Valider**

---

## Task 7 : Ajouter Gemini #2 — Plan d'action

- [ ] **Step 1 : Ajouter le node HTTP Request Gemini #2**

```json
{
  "id": "<WORKFLOW_ID>",
  "intent": "Ajouter appel Gemini #2 pour generer le plan d'action",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "http-gemini-2",
        "name": "Generer plan action",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [1540, 0],
        "retryOnFail": true,
        "maxTries": 2,
        "waitBetweenTries": 5000,
        "parameters": {
          "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent",
          "method": "POST",
          "authentication": "predefinedCredentialType",
          "nodeCredentialType": "httpQueryAuth",
          "sendBody": true,
          "specifyBody": "json",
          "jsonBody": "={\n  \"contents\": [{\n    \"parts\": [{\n      \"text\": \"Tu es un consultant expert en strategie IA pour les PME. Tu dois generer un plan d'action prioritaire base sur l'analyse suivante d'un diagnostic de maturite IA marketing.\\n\\nENTREPRISE : {{ $('Preparer prompt Gemini').first().json.entreprise }}\\nTAILLE EQUIPE : {{ $('Preparer prompt Gemini').first().json.taille_equipe }}\\nSCORE GLOBAL : {{ $('Preparer prompt Gemini').first().json.score_global }} ({{ $('Preparer prompt Gemini').first().json.niveauGlobal }})\\n\\nSCORES PAR DIMENSION :\\n- Usages IA : {{ $('Preparer prompt Gemini').first().json.score_usages }}\\n- Donnees marketing : {{ $('Preparer prompt Gemini').first().json.score_donnees }}\\n- Competences : {{ $('Preparer prompt Gemini').first().json.score_competences }}\\n- Processus : {{ $('Preparer prompt Gemini').first().json.score_processus }}\\n- Gouvernance : {{ $('Preparer prompt Gemini').first().json.score_gouvernance }}\\n\\nANALYSE PRECEDENTE :\\n{{ JSON.stringify($json.candidates[0].content.parts[0].text) }}\\n\\nCONTEXTE ENTREPRISE :\\n{{ $('Preparer prompt Gemini').first().json.contenuSite ? 'Site : ' + $('Preparer prompt Gemini').first().json.contenuSite.substring(0, 1500) : 'Non disponible' }}\\n\\nINSTRUCTIONS :\\nGenere entre 3 et 5 actions prioritaires, ordonnees par priorite (impact fort + effort faible en premier).\\n\\nPour chaque action :\\n- titre : court et actionnable (verbe a l'infinitif)\\n- description : 2-3 phrases, pourquoi c'est prioritaire, resultat attendu (max 300 caracteres)\\n- impact : uniquement 'fort', 'moyen' ou 'faible' (minuscules)\\n- effort : uniquement 'fort', 'moyen' ou 'faible' (minuscules)\\n- timeline : format 'Semaine X' ou 'Semaine X-Y'\\n\\nREGLES :\\n- Vouvoiement obligatoire\\n- Pas de tirets longs\\n- Actions concretes et specifiques au contexte de l'entreprise\\n- Prioriser les dimensions avec les scores les plus bas\"\n    }]\n  }],\n  \"generationConfig\": {\n    \"responseMimeType\": \"application/json\",\n    \"responseSchema\": {\n      \"type\": \"OBJECT\",\n      \"properties\": {\n        \"actions\": {\n          \"type\": \"ARRAY\",\n          \"items\": {\n            \"type\": \"OBJECT\",\n            \"properties\": {\n              \"titre\": { \"type\": \"STRING\" },\n              \"description\": { \"type\": \"STRING\" },\n              \"impact\": { \"type\": \"STRING\" },\n              \"effort\": { \"type\": \"STRING\" },\n              \"timeline\": { \"type\": \"STRING\" }\n            },\n            \"required\": [\"titre\", \"description\", \"impact\", \"effort\", \"timeline\"]\n          }\n        }\n      },\n      \"required\": [\"actions\"]\n    }\n  }\n}",
          "options": {
            "timeout": 60000
          }
        },
        "credentials": {
          "httpQueryAuth": {
            "id": "<GEMINI_CREDENTIAL_ID>",
            "name": "geminiApiKey"
          }
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Analyser dimensions",
      "target": "Generer plan action"
    }
  ]
}
```

- [ ] **Step 2 : Valider**

---

## Task 8 : Ajouter le Code node "Structurer rapport"

Ce node assemble le JSON final, genere le mot de passe, et parse les reponses Gemini.

- [ ] **Step 1 : Ajouter le node Code**

```json
{
  "id": "<WORKFLOW_ID>",
  "intent": "Ajouter node Code pour generer le mot de passe et assembler le JSON final",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "code-structurer",
        "name": "Structurer rapport",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [1760, 0],
        "parameters": {
          "jsCode": "const prospect = $('Preparer prompt Gemini').first().json;\n\n// Parser reponse Gemini #1 (analyse dimensions)\nconst gemini1Raw = $('Analyser dimensions').first().json;\nlet analyse1 = {};\ntry {\n  const text1 = gemini1Raw.candidates[0].content.parts[0].text;\n  analyse1 = typeof text1 === 'string' ? JSON.parse(text1) : text1;\n  if (Array.isArray(analyse1)) analyse1 = analyse1[0];\n} catch(e) {\n  throw new Error('Erreur parsing Gemini #1 : ' + e.message);\n}\n\n// Parser reponse Gemini #2 (plan action)\nconst gemini2Raw = $('Generer plan action').first().json;\nlet analyse2 = {};\ntry {\n  const text2 = gemini2Raw.candidates[0].content.parts[0].text;\n  analyse2 = typeof text2 === 'string' ? JSON.parse(text2) : text2;\n  if (Array.isArray(analyse2)) analyse2 = analyse2[0];\n} catch(e) {\n  throw new Error('Erreur parsing Gemini #2 : ' + e.message);\n}\n\n// Generer mot de passe aleatoire (12 chars alphanumeriques)\nconst chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';\nlet password = '';\nfor (let i = 0; i < 12; i++) {\n  password += chars.charAt(Math.floor(Math.random() * chars.length));\n}\n\n// Construire le contexte entreprise depuis le scraping\nlet contexteEntreprise = null;\nif (prospect.contexteDisponible) {\n  // Gemini a deja analyse le contexte, on extrait des infos basiques\n  contexteEntreprise = {\n    secteur: 'A determiner',\n    description: (prospect.contenuSite || '').substring(0, 300),\n    taille_estimee: prospect.taille_equipe || 'Non renseigne',\n    presence_digitale: (prospect.resultatsRecherche || '').substring(0, 300)\n  };\n}\n\n// Assembler le JSON final pour Supabase\nconst rapport = {\n  email: prospect.email,\n  password: password,\n  prenom: prospect.prenom,\n  nom: prospect.nom,\n  entreprise: prospect.entreprise,\n  taille_equipe: prospect.taille_equipe || null,\n  date_diagnostic: new Date().toISOString(),\n  score_usages: prospect.score_usages,\n  score_donnees: prospect.score_donnees,\n  score_competences: prospect.score_competences,\n  score_processus: prospect.score_processus,\n  score_gouvernance: prospect.score_gouvernance,\n  score_global: prospect.score_global,\n  contexte_entreprise: contexteEntreprise,\n  analyse: {\n    intro_personnalisee: analyse1.intro_personnalisee || '',\n    synthese_globale: analyse1.synthese_globale || '',\n    dimensions: analyse1.dimensions || [],\n    actions: analyse2.actions || []\n  }\n};\n\nreturn [{ json: rapport }];"
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Generer plan action",
      "target": "Structurer rapport"
    }
  ]
}
```

- [ ] **Step 2 : Valider**

---

## Task 9 : Ajouter le node Supabase (upsert)

- [ ] **Step 1 : Ajouter le node HTTP Request Supabase**

```json
{
  "id": "<WORKFLOW_ID>",
  "intent": "Ajouter node HTTP Request pour upsert dans Supabase",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "http-supabase",
        "name": "Stocker rapport",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [1980, 0],
        "retryOnFail": true,
        "maxTries": 2,
        "waitBetweenTries": 3000,
        "parameters": {
          "url": "=https://<PROJECT_REF>.supabase.co/rest/v1/diagnostic_reports",
          "method": "POST",
          "authentication": "predefinedCredentialType",
          "nodeCredentialType": "httpHeaderAuth",
          "sendHeaders": true,
          "headerParameters": {
            "parameters": [
              {
                "name": "Content-Type",
                "value": "application/json"
              },
              {
                "name": "Prefer",
                "value": "resolution=merge-duplicates"
              },
              {
                "name": "Authorization",
                "value": "=Bearer {{ $credentials.httpHeaderAuth.value }}"
              }
            ]
          },
          "sendBody": true,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify($json) }}",
          "options": {
            "timeout": 15000
          }
        },
        "credentials": {
          "httpHeaderAuth": {
            "id": "<SUPABASE_CREDENTIAL_ID>",
            "name": "supabaseServiceRole"
          }
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Structurer rapport",
      "target": "Stocker rapport"
    }
  ]
}
```

Note : l'URL Supabase et le credential ID seront remplaces une fois les infos recues de l'agent site web.

- [ ] **Step 2 : Valider**

---

## Task 10 : Ajouter le node Brevo (update contact + liste 7)

- [ ] **Step 1 : Ajouter le node HTTP Request Brevo**

```json
{
  "id": "<WORKFLOW_ID>",
  "intent": "Ajouter node HTTP Request pour mettre a jour le contact Brevo avec le mot de passe et l'ajouter a la liste 7",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "http-brevo",
        "name": "Mettre a jour contact Brevo",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [2200, 0],
        "retryOnFail": true,
        "maxTries": 2,
        "waitBetweenTries": 3000,
        "parameters": {
          "url": "=https://api.brevo.com/v3/contacts/{{ encodeURIComponent($('Structurer rapport').first().json.email) }}",
          "method": "PUT",
          "authentication": "predefinedCredentialType",
          "nodeCredentialType": "httpHeaderAuth",
          "sendBody": true,
          "specifyBody": "json",
          "jsonBody": "={\n  \"attributes\": {\n    \"RAPPORT_PASSWORD\": \"{{ $('Structurer rapport').first().json.password }}\",\n    \"RAPPORT_DATE\": \"{{ $('Structurer rapport').first().json.date_diagnostic }}\"\n  },\n  \"listIds\": [<LIST_7_ID>]\n}",
          "options": {
            "timeout": 15000
          }
        },
        "credentials": {
          "httpHeaderAuth": {
            "id": "<BREVO_CREDENTIAL_ID>",
            "name": "brevoApi"
          }
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Stocker rapport",
      "target": "Mettre a jour contact Brevo"
    }
  ]
}
```

Note : `<LIST_7_ID>` sera remplace par l'ID reel de la liste 7 communique par l'agent Brevo.

- [ ] **Step 2 : Valider le workflow complet**

Utiliser `mcp__n8n-mcp__n8n_validate_workflow` avec le profil `runtime`.

---

## Task 11 : Test de bout en bout

- [ ] **Step 1 : Tester avec le webhook en mode test**

Utiliser `mcp__n8n-mcp__n8n_test_workflow` avec des donnees de test :

```json
{
  "body": {
    "email": "test@acme-demo.fr",
    "prenom": "Jean",
    "nom": "Dupont",
    "entreprise": "Acme Demo SAS",
    "taille_equipe": "4-10",
    "score_usages": 2.3,
    "score_donnees": 1.8,
    "score_competences": 3.0,
    "score_processus": 1.5,
    "score_gouvernance": 2.7,
    "score_global": 2.3
  }
}
```

- [ ] **Step 2 : Verifier l'execution**

Utiliser `mcp__n8n-mcp__n8n_executions` pour inspecter le resultat de chaque node.

- [ ] **Step 3 : Verifier les donnees dans Supabase**

Confirmer que la row a ete inseree avec tous les champs corrects.

- [ ] **Step 4 : Verifier le contact Brevo**

Confirmer que `RAPPORT_PASSWORD` et `RAPPORT_DATE` sont remplis et que le contact est dans la liste 7.

- [ ] **Step 5 : Corriger les erreurs si necessaire**

Utiliser `mcp__n8n-mcp__n8n_update_partial_workflow` pour ajuster les nodes en erreur.

---

## Task 12 : Finalisation et activation

- [ ] **Step 1 : Ajouter des Sticky Notes de documentation**

```json
{
  "id": "<WORKFLOW_ID>",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "id": "note-1",
        "name": "Documentation",
        "type": "n8n-nodes-base.stickyNote",
        "typeVersion": 1,
        "position": [-200, -200],
        "parameters": {
          "content": "## Diagnostic - Generer Rapport\n\nWebhook fire-and-forget declenche par le JS du diagnostic example.com.\n\n**Flux :** Webhook -> Validation -> Scraping Jina (parallele) -> 2x Gemini -> Supabase -> Brevo\n\n**Credentials :** geminiApiKey, supabaseServiceRole, brevoApi\n**Error Workflow :** bAurtiK8UqF7Mlw6",
          "width": 400,
          "height": 200
        }
      }
    }
  ]
}
```

- [ ] **Step 2 : Exporter le workflow en JSON (backup)**

Utiliser `mcp__n8n-mcp__n8n_get_workflow` pour recuperer le JSON complet et le sauvegarder dans `workflows/diagnostic-generer-rapport.json`.

- [ ] **Step 3 : Activer le workflow**

```json
{
  "id": "<WORKFLOW_ID>",
  "operations": [
    { "type": "activateWorkflow" }
  ]
}
```

Ne pas activer tant que les tests ne sont pas valides et les credentials reelles en place.

- [ ] **Step 4 : Communiquer l'URL du webhook**

L'URL production sera : `https://n8n.example.com/webhook/diagnostic-rapport`

A transmettre a l'agent site web pour l'integrer dans le JS du diagnostic.

---

## Resume des placeholders a remplacer

| Placeholder | Source | Quand |
|-------------|--------|-------|
| `<WORKFLOW_ID>` | Retour de Task 2 Step 1 | Des Task 3 |
| `<GEMINI_CREDENTIAL_ID>` | Retour de Task 1 Step 1 | Task 6, 7 |
| `<SUPABASE_CREDENTIAL_ID>` | Retour de Task 1 Step 3 | Task 9 |
| `<PROJECT_REF>` | Agent site web | Task 9 |
| `<BREVO_CREDENTIAL_ID>` | Retour de Task 1 Step 2 (ou existant) | Task 10 |
| `<LIST_7_ID>` | Agent Brevo | Task 10 |
