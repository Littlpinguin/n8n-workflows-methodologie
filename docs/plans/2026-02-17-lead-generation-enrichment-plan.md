# Lead Generation & Enrichment — Plan d'implementation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Creer un workflow n8n "company-first" qui analyse une entreprise via IA, genere des personas, recherche des leads via Apollo, et les enrichit avec LinkedIn + scoring automatique.

**Architecture:** 1 workflow unique avec 9 branches declenchees par Google Sheets (triggers sur changement de statut). 4 feuillets (Entreprises, Offres, Personas, Leads). Gemini via HTTP Request direct, Jina AI pour le scraping web, Apollo pour la recherche, Apify pour LinkedIn, mails.so pour la validation email, Code node pour le scoring.

**Tech Stack:** n8n (via n8n-mcp), Google Sheets, Gemini API, Apollo API, Jina AI, Apify, mails.so

**Design:** Voir `docs/plans/2026-02-17-lead-generation-enrichment-design.md`

---

## Pre-requis

Avant de commencer, l'utilisateur doit :
1. Creer un Google Spreadsheet avec 4 onglets : `Entreprises`, `Offres`, `Personas`, `Leads`
2. Configurer les en-tetes de colonnes sur chaque onglet (voir design)
3. S'assurer que les credentials n8n suivants existent : Google Sheets OAuth2, Gemini API Key (HTTP Header Auth), Apollo API Key (HTTP Header Auth), mails.so API Key (HTTP Header Auth), Apify API Token
4. Communiquer l'ID du Google Spreadsheet et les noms des credentials n8n

---

## Task 1 : Creer le workflow squelette + sticky notes

**Objectif :** Creer le workflow vide avec les sticky notes documentant chaque branche.

**Step 1 : Creer le workflow via MCP**

```
n8n_create_workflow:
  name: "Leads - Generation et Enrichissement"
  nodes: [] (vide pour l'instant, on utilisera partial update)
  connections: {}
  settings:
    executionOrder: "v1"
```

**Step 2 : Ajouter les sticky notes pour chaque branche**

Via `n8n_update_partial_workflow` avec `addNode` :

| Sticky Note | Contenu | Position | Couleur |
|-------------|---------|----------|---------|
| Note Branche A | `## Branche A — Analyse entreprise\nTrigger: Entreprises.statut = "analyser"\nJina AI scrape → Gemini analyse → Update fiche + Insert offres` | [200, -200] | 4 (bleu) |
| Note Branche B | `## Branche B — Generation personas\nTrigger: Entreprises.statut = "generer_personas"\nLire offres → Gemini personas + intents → Insert personas` | [200, 400] | 4 (bleu) |
| Note Branche C | `## Branche C — Recherche Apollo\nTrigger: Personas.statut = "valide"\nApollo search → Split → Clean → Insert leads` | [200, 900] | 1 (vert) |
| Note Branche D | `## Branche D — Extract LinkedIn Username\nTrigger: Leads (extract_username_status = pending)\nExtract username → Update lead` | [200, 1300] | 3 (jaune) |
| Note Branche E | `## Branche E — Email + Validation mails.so\nTrigger: Leads (contacts_scrape_status = pending)\nApollo email → mails.so → Update lead` | [200, 1700] | 5 (rouge) |
| Note Branche F | `## Branche F — Scraping LinkedIn + Scoring\nTrigger: Leads (profile_summary_scrape = pending)\nApify → Gemini resume → Code scoring → Update lead` | [200, 2200] | 6 (violet) |
| Note Maintenance | `## Branches Maintenance\n3 Schedule Triggers (toutes les 4 semaines)\nReset invalid_email, failed profile, failed posts` | [200, 3000] | 5 (rouge) |

**Step 3 : Verifier le workflow**

```
n8n_get_workflow: id=<workflow_id>, mode="structure"
```

Verifier que le workflow existe avec les 7 sticky notes.

**Step 4 : Commit**

```bash
# Pas de commit ici — le workflow vit dans n8n, pas dans git
# On committera le plan et le design a la fin
```

---

## Task 2 : Branche A — Analyse entreprise (Trigger + Jina + Gemini + Update)

**Objectif :** Quand l'utilisateur passe le statut d'une entreprise a "analyser", scraper le site web via Jina AI, analyser via Gemini, et remplir la fiche + generer les offres.

**Step 1 : Ajouter le trigger Google Sheets pour le feuillet Entreprises**

Node `Trigger Analyse Entreprise` :
- Type: `n8n-nodes-base.googleSheetsTrigger`
- typeVersion: 1
- Event: `rowAdded` (on utilisera un filtre ensuite pour detecter le statut)
- Document: ID du spreadsheet utilisateur
- Sheet: `Entreprises`
- Poll: `everyMinute`
- Position: [300, 0]

> **Note importante :** Le Google Sheets Trigger ne supporte que `rowAdded`. Pour detecter un changement de statut, on utilisera un pattern alternatif : **Schedule Trigger + Google Sheets Read avec filtre sur statut = "analyser"**. C'est le pattern utilise dans le workflow original pour les branches D/E/F.

**Correction — utiliser Schedule Trigger + Read + filtre :**

Node `Planifier Analyse Entreprise` :
- Type: `n8n-nodes-base.scheduleTrigger`, typeVersion: 1.2
- Rule: every 1 minute
- Position: [300, 0]

Node `Lire Entreprises a analyser` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: read (default)
- Document: ID spreadsheet
- Sheet: `Entreprises`
- Filter: `statut` = `analyser`
- executeOnce: true
- alwaysOutputData: false
- Position: [540, 0]

Connection: `Planifier Analyse Entreprise` → `Lire Entreprises a analyser`

**Step 2 : Ajouter le node Jina AI scraping**

Node `Scraper site web (Jina)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: GET (default)
- URL: `=https://r.jina.ai/{{ $json.url }}`
- Options: `allowUnauthorizedCerts: true`
- retryOnFail: true
- maxTries: 2
- waitBetweenTries: 5000
- Position: [780, 0]

Connection: `Lire Entreprises a analyser` → `Scraper site web (Jina)`

> **Note :** Jina AI Reader retourne le contenu en markdown dans `$json.data`. Pas besoin d'authentification pour les usages basiques.

**Step 3 : Ajouter le node Gemini — Analyser entreprise + generer offres**

Node `Analyser entreprise (Gemini)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: POST
- URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
- Authentication: genericCredentialType / httpQueryAuth (avec key=key)
- Headers: `Content-Type: application/json`
- Body (JSON):

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "Tu es un expert en strategie commerciale B2B. Analyse le contenu de ce site web et produis un JSON structure.\n\nContenu du site :\n{{ $json.data }}\n\nRetourne UNIQUEMENT un JSON valide avec cette structure :\n{\n  \"entreprise\": {\n    \"nom\": \"Nom de l'entreprise\",\n    \"description\": \"Description de l'activite en 2-3 phrases\",\n    \"proposition_valeur\": \"Proposition de valeur principale\",\n    \"secteur\": \"Secteur d'activite\",\n    \"taille_estimee\": \"startup / PME / ETI / grand_groupe\"\n  },\n  \"offres\": [\n    {\n      \"nom_offre\": \"Nom du produit ou service\",\n      \"description\": \"Description courte\",\n      \"cible_ideale\": \"Profil type du client ideal (titre, seniority, departement)\",\n      \"mots_cles\": \"mot1, mot2, mot3, mot4, mot5\",\n      \"problemes_resolus\": \"Problemes ou douleurs que cette offre adresse\"\n    }\n  ]\n}\n\nIdentifie entre 1 et 5 offres distinctes. Pour les mots-cles, inclus des termes que l'on retrouverait dans le profil LinkedIn d'un prospect interesse. Sois precis et actionnable."
        }
      ]
    }
  ],
  "generationConfig": {
    "responseMimeType": "application/json",
    "temperature": 0.3
  }
}
```

- retryOnFail: true
- maxTries: 2
- Position: [1020, 0]

Connection: `Scraper site web (Jina)` → `Analyser entreprise (Gemini)`

**Step 4 : Parser le JSON Gemini et preparer les donnees**

Node `Parser reponse Gemini` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- Mode: `runOnceForEachItem`
- jsCode:

```javascript
const geminiResponse = $json.candidates[0].content.parts[0].text;
const parsed = JSON.parse(geminiResponse);

// Conserver les donnees de la ligne source (url, row_number)
const sourceRow = $('Lire Entreprises a analyser').first().json;

return {
  json: {
    ...parsed,
    source_url: sourceRow.url,
    source_row_number: sourceRow.row_number
  }
};
```

- Position: [1260, 0]

Connection: `Analyser entreprise (Gemini)` → `Parser reponse Gemini`

**Step 5 : Mettre a jour la fiche Entreprise dans Google Sheets**

Node `Mettre a jour fiche entreprise` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `update`
- Document: ID spreadsheet
- Sheet: `Entreprises`
- Columns mapping:
  - `url` = `{{ $json.source_url }}` (matching column)
  - `nom` = `{{ $json.entreprise.nom }}`
  - `description` = `{{ $json.entreprise.description }}`
  - `proposition_valeur` = `{{ $json.entreprise.proposition_valeur }}`
  - `secteur` = `{{ $json.entreprise.secteur }}`
  - `taille_estimee` = `{{ $json.entreprise.taille_estimee }}`
  - `statut` = `analyse`
  - `date_analyse` = `{{ $now.format('yyyy-MM-dd') }}`
- Matching column: `url`
- Position: [1500, -100]

Connection: `Parser reponse Gemini` → `Mettre a jour fiche entreprise`

**Step 6 : Inserer les offres dans le feuillet Offres**

Node `Extraire offres` :
- Type: `n8n-nodes-base.splitOut`, typeVersion: 1
- fieldToSplitOut: `offres`
- Position: [1500, 100]

Node `Inserer offres` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `append`
- Document: ID spreadsheet
- Sheet: `Offres`
- Columns mapping:
  - `entreprise_id` = `{{ $('Parser reponse Gemini').item.json.entreprise.nom }}`
  - `nom_offre` = `{{ $json.nom_offre }}`
  - `description` = `{{ $json.description }}`
  - `cible_ideale` = `{{ $json.cible_ideale }}`
  - `mots_cles` = `{{ $json.mots_cles }}`
  - `problemes_resolus` = `{{ $json.problemes_resolus }}`
- Position: [1740, 100]

Connections:
- `Parser reponse Gemini` → `Extraire offres`
- `Extraire offres` → `Inserer offres`

**Step 7 : Valider la branche A**

```
n8n_validate_workflow: id=<workflow_id>
```

Verifier : pas d'erreurs sur les nodes de la branche A. Tester manuellement avec une URL d'entreprise.

---

## Task 3 : Branche B — Generation personas (Trigger + Read offres + Gemini + Insert)

**Objectif :** Quand le statut passe a "generer_personas", lire les offres liees, generer les personas via Gemini, et les ecrire dans le feuillet Personas.

**Step 1 : Trigger Schedule + filtre statut**

Node `Planifier Generation Personas` :
- Type: `n8n-nodes-base.scheduleTrigger`, typeVersion: 1.2
- Rule: every 1 minute
- Position: [300, 500]

Node `Lire Entreprises a generer` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: read
- Document: ID spreadsheet
- Sheet: `Entreprises`
- Filter: `statut` = `generer_personas`
- executeOnce: true
- Position: [540, 500]

Connection: `Planifier Generation Personas` → `Lire Entreprises a generer`

**Step 2 : Lire les offres liees a l'entreprise**

Node `Lire offres entreprise` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: read
- Document: ID spreadsheet
- Sheet: `Offres`
- Filter: `entreprise_id` = `{{ $json.nom }}`
- alwaysOutputData: true
- Position: [780, 500]

Connection: `Lire Entreprises a generer` → `Lire offres entreprise`

**Step 3 : Preparer le contexte pour Gemini**

Node `Preparer contexte personas` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- Mode: default (runOnceForAllItems)
- jsCode:

```javascript
const entreprise = $('Lire Entreprises a generer').first().json;
const offres = $('Lire offres entreprise').all().map(i => i.json);

const offresText = offres.map((o, i) =>
  `Offre ${i+1}: ${o.nom_offre}\n  Description: ${o.description}\n  Cible ideale: ${o.cible_ideale}\n  Mots-cles: ${o.mots_cles}\n  Problemes resolus: ${o.problemes_resolus}`
).join('\n\n');

return [{
  json: {
    entreprise_nom: entreprise.nom,
    entreprise_description: entreprise.description,
    entreprise_proposition_valeur: entreprise.proposition_valeur,
    entreprise_secteur: entreprise.secteur,
    offresText
  }
}];
```

- Position: [1020, 500]

Connection: `Lire offres entreprise` → `Preparer contexte personas`

**Step 4 : Appel Gemini — generer personas**

Node `Generer personas (Gemini)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: POST
- URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
- Authentication: genericCredentialType / httpQueryAuth
- Body (JSON):

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "Tu es un expert en strategie commerciale B2B et en prospection via Apollo.io.\n\nEntreprise : {{ $json.entreprise_nom }}\nDescription : {{ $json.entreprise_description }}\nProposition de valeur : {{ $json.entreprise_proposition_valeur }}\nSecteur : {{ $json.entreprise_secteur }}\n\nOffres :\n{{ $json.offresText }}\n\nGenere entre 3 et 7 personas de prospects ideaux pour cette entreprise. Chaque persona doit correspondre aux filtres de recherche de l'API Apollo.io.\n\nRetourne UNIQUEMENT un JSON valide :\n{\n  \"personas\": [\n    {\n      \"titre_poste\": \"Titre exact (ex: VP of Marketing, CTO, Head of Sales)\",\n      \"seniority\": \"Un parmi: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry\",\n      \"departement\": \"Un parmi: engineering, marketing, sales, operations, finance, hr, it, legal, product, design\",\n      \"localisations\": \"France, United States\",\n      \"intents_suggeres\": \"2-4 intent topics Apollo pertinents (ex: AI, Marketing Automation, CRM, Data Analytics)\",\n      \"nb_leads\": 20\n    }\n  ]\n}\n\nRegles :\n- Les titres doivent etre en anglais (standard Apollo)\n- Les seniority doivent correspondre exactement aux valeurs Apollo listees ci-dessus\n- Les localisations doivent etre au format Apollo (pays ou region, virgule separee)\n- Les intents doivent etre des topics de recherche realistes\n- Diversifie les profils : decision makers + influenceurs + utilisateurs finaux\n- nb_leads par defaut = 20, peut aller de 10 a 100 selon la pertinence du persona"
        }
      ]
    }
  ],
  "generationConfig": {
    "responseMimeType": "application/json",
    "temperature": 0.4
  }
}
```

- retryOnFail: true, maxTries: 2
- Position: [1260, 500]

Connection: `Preparer contexte personas` → `Generer personas (Gemini)`

**Step 5 : Parser + Split + Inserer personas**

Node `Parser personas Gemini` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- Mode: `runOnceForEachItem`
- jsCode:

```javascript
const geminiResponse = $json.candidates[0].content.parts[0].text;
const parsed = JSON.parse(geminiResponse);
const entrepriseNom = $('Preparer contexte personas').first().json.entreprise_nom;

return {
  json: {
    entreprise_id: entrepriseNom,
    personas: parsed.personas
  }
};
```

- Position: [1500, 500]

Node `Extraire personas` :
- Type: `n8n-nodes-base.splitOut`, typeVersion: 1
- fieldToSplitOut: `personas`
- Position: [1740, 500]

Node `Inserer personas` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `append`
- Document: ID spreadsheet
- Sheet: `Personas`
- Columns mapping:
  - `entreprise_id` = `{{ $('Parser personas Gemini').item.json.entreprise_id }}`
  - `titre_poste` = `{{ $json.titre_poste }}`
  - `seniority` = `{{ $json.seniority }}`
  - `departement` = `{{ $json.departement }}`
  - `localisations` = `{{ $json.localisations }}`
  - `intents_suggeres` = `{{ $json.intents_suggeres }}`
  - `statut` = `a_valider`
  - `nb_leads` = `{{ $json.nb_leads }}`
- Position: [1980, 500]

Connections:
- `Generer personas (Gemini)` → `Parser personas Gemini`
- `Parser personas Gemini` → `Extraire personas`
- `Extraire personas` → `Inserer personas`

**Step 6 : Mettre a jour le statut de l'entreprise**

Node `Statut personas generes` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `update`
- Sheet: `Entreprises`
- Columns: `nom` (match) + `statut` = `personas_generes`
- Matching column: `nom`
- Position: [2220, 500]

Connection: `Inserer personas` → `Statut personas generes`

> Note : Ce node s'execute apres le dernier persona insere. Il faut s'assurer que `executeOnce` est a `true` pour ne mettre a jour qu'une fois.

**Step 7 : Valider la branche B**

```
n8n_validate_workflow: id=<workflow_id>
```

---

## Task 4 : Branche C — Recherche Apollo (Trigger + Apollo search + Insert leads)

**Objectif :** Quand un persona est valide, lancer la recherche Apollo et inserer les leads.

**Step 1 : Trigger Schedule + filtre statut persona**

Node `Planifier Recherche Apollo` :
- Type: `n8n-nodes-base.scheduleTrigger`, typeVersion: 1.2
- Rule: every 1 minute
- Position: [300, 1000]

Node `Lire Personas valides` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: read
- Sheet: `Personas`
- Filter: `statut` = `valide`
- executeOnce: true
- Position: [540, 1000]

Connection: `Planifier Recherche Apollo` → `Lire Personas valides`

**Step 2 : Recherche Apollo**

Node `Rechercher leads (Apollo)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: POST
- URL: `https://api.apollo.io/api/v1/mixed_people/search`
- Authentication: genericCredentialType / httpHeaderAuth (Apollo)
- Headers: `Cache-Control: no-cache`, `accept: application/json`
- Body (JSON expression):

```
={
  "person_titles": ["{{ $json.titre_poste }}"],
  "person_seniorities": ["{{ $json.seniority }}"],
  "person_locations": {{ $json.localisations.split(',').map(l => '"' + l.trim() + '"').join(',').replace(/^/, '[').replace(/$/, ']') }},
  "page": 1,
  "per_page": {{ $json.nb_leads || 20 }}
}
```

- retryOnFail: true, maxTries: 2
- Position: [780, 1000]

Connection: `Lire Personas valides` → `Rechercher leads (Apollo)`

**Step 3 : Split + Clean + Insert leads**

Node `Split resultats Apollo` :
- Type: `n8n-nodes-base.splitOut`, typeVersion: 1
- fieldToSplitOut: `people`
- Position: [1020, 1000]

Node `Nettoyer donnees leads` :
- Type: `n8n-nodes-base.set`, typeVersion: 3.4
- Assignments:
  - `apollo_id` = `{{ $json.id }}`
  - `nom` = `{{ $json.name }}`
  - `titre` = `{{ $json.title }}`
  - `organisation` = `{{ $json.employment_history[0].organization_name }}`
  - `linkedin_url` = `{{ $json.linkedin_url }}`
- Position: [1260, 1000]

Node `Inserer leads` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `append`
- Sheet: `Leads`
- Columns:
  - `persona_id` = `{{ $('Lire Personas valides').item.json.titre_poste }}`
  - `entreprise_id` = `{{ $('Lire Personas valides').item.json.entreprise_id }}`
  - `apollo_id` = `{{ $json.apollo_id }}`
  - `nom` = `{{ $json.nom }}`
  - `titre` = `{{ $json.titre }}`
  - `organisation` = `{{ $json.organisation }}`
  - `linkedin_url` = `{{ $json.linkedin_url }}`
  - `extract_username_status` = `pending`
  - `contacts_scrape_status` = `pending`
  - `profile_summary_scrape` = `pending`
  - `posts_scrape_status` = `unscraped`
- Position: [1500, 1000]

Connections:
- `Rechercher leads (Apollo)` → `Split resultats Apollo`
- `Split resultats Apollo` → `Nettoyer donnees leads`
- `Nettoyer donnees leads` → `Inserer leads`

**Step 4 : Mettre a jour le statut du persona**

Node `Statut persona traite` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `update`
- Sheet: `Personas`
- Columns: `titre_poste` + `entreprise_id` (match) + `statut` = `traite`
- Position: [1740, 1000]

Connection: `Inserer leads` → `Statut persona traite`

**Step 5 : Valider la branche C**

```
n8n_validate_workflow: id=<workflow_id>
```

---

## Task 5 : Branche D — Extract LinkedIn Username

**Objectif :** Extraire le username LinkedIn depuis l'URL pour chaque nouveau lead.

**Step 1 : Trigger + filtre**

Node `Planifier Extract Username` :
- Type: `n8n-nodes-base.scheduleTrigger`, typeVersion: 1.2
- Rule: every 1 minute
- Position: [300, 1400]

Node `Lire Leads username pending` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Sheet: `Leads`
- Filter: `extract_username_status` = `pending`
- executeOnce: true
- Position: [540, 1400]

Connection: `Planifier Extract Username` → `Lire Leads username pending`

**Step 2 : Extraire le username**

Node `Extraire username LinkedIn` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- Mode: `runOnceForEachItem`
- jsCode:

```javascript
return {
  json: {
    linkedin_handle: $json.linkedin_url
      .replace(/^https?:\/\//, '')
      .replace(/^www\.linkedin\.com\/in\//, '')
      .replace(/^linkedin\.com\/in\//, '')
      .replace(/\/$/, '')
  }
};
```

- Position: [780, 1400]

Connection: `Lire Leads username pending` → `Extraire username LinkedIn`

**Step 3 : Update lead**

Node `Ajouter username LinkedIn` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `update`
- Sheet: `Leads`
- Columns:
  - `apollo_id` = `{{ $('Lire Leads username pending').item.json.apollo_id }}` (match)
  - `linkedin_username` = `{{ $json.linkedin_handle }}`
  - `extract_username_status` = `finished`
- Matching column: `apollo_id`
- Position: [1020, 1400]

Connection: `Extraire username LinkedIn` → `Ajouter username LinkedIn`

**Step 4 : Valider la branche D**

```
n8n_validate_workflow: id=<workflow_id>
```

---

## Task 6 : Branche E — Email Apollo + Validation mails.so

**Objectif :** Recuperer l'email via Apollo, valider avec mails.so, mettre a jour le lead.

**Step 1 : Trigger + filtre**

Node `Planifier Scrape Contacts` :
- Type: `n8n-nodes-base.scheduleTrigger`, typeVersion: 1.2
- Rule: every 1 minute
- Position: [300, 1800]

Node `Lire Leads contacts pending` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Sheet: `Leads`
- Filter: `contacts_scrape_status` = `pending`
- executeOnce: true
- Position: [540, 1800]

Connection: `Planifier Scrape Contacts` → `Lire Leads contacts pending`

**Step 2 : Apollo people/match pour l'email**

Node `Recuperer email (Apollo)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: POST
- URL: `https://api.apollo.io/api/v1/people/match`
- Authentication: genericCredentialType / httpHeaderAuth (Apollo)
- Query params: `reveal_personal_emails=true`, `reveal_phone_number=false`
- Headers: `Cache-Control: no-cache`, `accept: application/json`
- Body params: `id` = `{{ $json.apollo_id }}`
- Position: [780, 1800]

Connection: `Lire Leads contacts pending` → `Recuperer email (Apollo)`

**Step 3 : Extraire les emails en array**

Node `Extraire emails en array` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- jsCode:

```javascript
var emails = [];
for (const item of $input.all()) {
  if (item.json.person.email != null) emails.push(item.json.person.email);
}
return { emails };
```

- Position: [1020, 1800]

Connection: `Recuperer email (Apollo)` → `Extraire emails en array`

**Step 4 : Valider emails via mails.so**

Node `Valider emails (mails.so)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: POST
- URL: `https://api.mails.so/v1/batch`
- Authentication: genericCredentialType / httpHeaderAuth (mails.so avec header `x-mails-api-key`)
- Body params: `emails` = `{{ $json.emails }}`
- Position: [1260, 1800]

Node `Attendre validation` :
- Type: `n8n-nodes-base.wait`, typeVersion: 1.1
- Amount: 60 (secondes)
- Position: [1500, 1800]

Node `Recuperer resultats validation` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- URL: `=https://api.mails.so/v1/batch/{{ $json.id }}`
- Authentication: httpHeaderAuth (mails.so)
- Position: [1740, 1800]

Connections:
- `Extraire emails en array` → `Valider emails (mails.so)`
- `Valider emails (mails.so)` → `Attendre validation`
- `Attendre validation` → `Recuperer resultats validation`

**Step 5 : Mapper apollo_id + statut email**

Node `Mapper apollo_id et validation` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- jsCode:

```javascript
const originalItems = $('Recuperer email (Apollo)').all();
const sheetsData = $('Lire Leads contacts pending').all();
const validatedList = $input.first().json.emails;

const validationMap = {};
for (var v of validatedList) {
  validationMap[v.email] = { email: v.email, mx_record: v.mx_record };
}

const apolloMap = {};
for (const sheet of sheetsData) {
  const name = sheet.json.nom?.toLowerCase();
  const apollo_id = sheet.json.apollo_id;
  if (name && apollo_id) apolloMap[name] = apollo_id;
}

return originalItems.map(item => {
  const email = item.json.person.email?.toLowerCase();
  const name = item.json.person.name?.toLowerCase();
  const validation = validationMap[email] || {};
  const apollo_id = apolloMap[name] || null;

  return {
    json: {
      apollo_id,
      contacts_scrape_status: !validation.mx_record ? "invalid_email" : "finished",
      ...item.json
    }
  };
});
```

- Position: [1980, 1800]

Connection: `Recuperer resultats validation` → `Mapper apollo_id et validation`

**Step 6 : Update lead avec email**

Node `Ajouter email au lead` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `update`
- Sheet: `Leads`
- Columns:
  - `apollo_id` (match)
  - `email` = `{{ $json.person.email }}`
  - `contacts_scrape_status` = `{{ $json.contacts_scrape_status }}`
- Position: [2220, 1800]

Connection: `Mapper apollo_id et validation` → `Ajouter email au lead`

**Step 7 : Valider la branche E**

```
n8n_validate_workflow: id=<workflow_id>
```

---

## Task 7 : Branche F — Scraping LinkedIn + Resume IA + Scoring

**Objectif :** Scraper le profil et les posts LinkedIn via Apify, resumer via Gemini, scorer via Code node.

**Step 1 : Trigger + filtre**

Node `Planifier Scrape LinkedIn` :
- Type: `n8n-nodes-base.scheduleTrigger`, typeVersion: 1.2
- Rule: every 1 minute
- Position: [300, 2300]

Node `Lire Leads profil pending` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Sheet: `Leads`
- Filters: `profile_summary_scrape` = `pending` AND `posts_scrape_status` = `unscraped`
- executeOnce: true
- Position: [540, 2300]

Connection: `Planifier Scrape LinkedIn` → `Lire Leads profil pending`

**Step 2 : Preparer les donnees pour Apify**

Node `Preparer URLs LinkedIn` :
- Type: `n8n-nodes-base.set`, typeVersion: 3.4
- Assignments:
  - `apollo_id` = `{{ $json.apollo_id }}`
  - `row_number` = `{{ $json.row_number }}`
  - `linkedinUrl` = `{{ $json.linkedin_url }}`
- Position: [780, 2300]

Connection: `Lire Leads profil pending` → `Preparer URLs LinkedIn`

**Step 3 : Appels Apify en parallele (profil + posts)**

Node `Scraper posts LinkedIn (Apify)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: POST
- URL: `https://api.apify.com/v2/acts/apimaestro~linkedin-profile-posts/run-sync-get-dataset-items`
- Query params: `token` = `{{ credential Apify }}`
- Body (JSON): `{ "username": "{{ $json.linkedinUrl }}", "total_posts": 5, "limit": 5 }`
- onError: `continueErrorOutput`
- Batching: batchSize 10
- Position: [1020, 2200]

Node `Scraper profil LinkedIn (Apify)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: POST
- URL: `https://api.apify.com/v2/acts/dev_fusion~linkedin-profile-scraper/run-sync-get-dataset-items`
- Query params: `token` = `{{ credential Apify }}`
- Body (JSON): `{ "profileUrls": ["{{ $json.linkedinUrl }}"] }`
- onError: `continueErrorOutput`
- Batching: batchSize 10
- Position: [1020, 2500]

Connections:
- `Preparer URLs LinkedIn` → `Scraper posts LinkedIn (Apify)`
- `Preparer URLs LinkedIn` → `Scraper profil LinkedIn (Apify)`

> Note : Les 2 nodes Apify partent en parallele depuis le meme node source. Les erreurs ne bloquent pas le flow (continueErrorOutput).

**Step 4 : Merge + Clean + Stringify**

Node `Merger donnees posts` :
- Type: `n8n-nodes-base.merge`, typeVersion: 3
- Mode: `combineBySql` ou `combineByPosition`
- Position: [1260, 2200]

Node `Nettoyer et mapper posts` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- jsCode (meme logique que l'original "Clean and Map Posts Data"):

```javascript
const groups = {};
for (const item of items) {
  const j = item.json;
  const key = j.apollo_id || j.linkedinUrl;
  if (!groups[key]) {
    groups[key] = {
      apollo_id: j.apollo_id,
      row_number: j.row_number,
      linkedinUrl: j.linkedinUrl,
      postTexts: [],
    };
  }
  if (j.postText) groups[key].postTexts.push(j.postText);
}
return Object.values(groups).map(obj => ({ json: obj }));
```

- Position: [1500, 2200]

Node `Stringify posts` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- Mode: `runOnceForEachItem`
- jsCode:

```javascript
const posts = item.json.postTexts || [];
item.json.allPosts = posts.join("\n\n");
return item;
```

- Position: [1740, 2200]

Node `Merger donnees profil` :
- Type: `n8n-nodes-base.merge`, typeVersion: 3
- Position: [1260, 2500]

Node `Nettoyer et mapper profil` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- jsCode (meme logique que l'original "Clean and Map Profile Data"):

```javascript
const items = [];
const inputItems = $input.all();
if (!inputItems || inputItems.length === 0) {
  return [{ json: { message: "No profiles found" } }];
}
inputItems.forEach((profile, index) => {
  const data = profile.json;
  const apolloId = data.apollo_id || `profile_${index}`;
  const rowNumber = data.row_number || null;
  const linkedinUrl = data.linkedinUrl || "";
  if (!data || data.message) {
    items.push({ json: { apollo_id: apolloId, row_number: rowNumber, linkedin_url: linkedinUrl, message: "No profile found" } });
    return;
  }
  items.push({
    json: {
      apollo_id: apolloId,
      row_number: rowNumber,
      linkedin_url: linkedinUrl,
      fullName: data.fullName || `${data.firstName || ""} ${data.lastName || ""}`.trim(),
      headline: data.headline || "No headline",
      currentPosition: data.jobTitle || "Not specified",
      currentCompany: data.companyName || "Not specified",
      location: data.addressWithoutCountry || "Not specified",
      about: (data.about || "No about section").substring(0, 500),
      profileUrl: data.linkedinUrl || "",
      connections: data.connections || 0,
      followers: data.followers || 0
    }
  });
});
return items;
```

- Position: [1500, 2500]

Node `Stringify profil` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- Mode: `runOnceForEachItem`
- jsCode:

```javascript
const j = item.json;
const exclude = ["apollo_id", "row_number", "linkedin_url"];
const parts = [];
for (const [key, value] of Object.entries(j)) {
  if (!exclude.includes(key) && value && value !== "") {
    parts.push(`${key}: ${value}`);
  }
}
item.json.profileSummary = parts.join("\n");
return item;
```

- Position: [1740, 2500]

**Step 5 : Resume IA via Gemini (posts + profil)**

Node `Resumer posts (Gemini)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Method: POST
- URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
- Authentication: httpQueryAuth (Gemini)
- Body JSON:

```json
{
  "contents": [{ "parts": [{ "text": "Below are the most recent posts and reposts from a LinkedIn user. Summarize them collectively in no more than two short paragraphs. Focus on capturing the main themes, tone, and any recurring interests or professional concerns. Avoid listing each post separately — instead, synthesize the information into a narrative that gives a clear idea of what this person is currently focused on or passionate about. Remember, it can be a repost, so the LinkedIn user didn't actually say those things, they just support that thing or agree with it.\n\nPosts: {{ $json.allPosts }}\n\nKeep it insightful but brief — no more than 2 concise paragraphs." }] }],
  "generationConfig": { "temperature": 0.3 }
}
```

- Position: [1980, 2200]

Node `Resumer profil (Gemini)` :
- Type: `n8n-nodes-base.httpRequest`, typeVersion: 4.2
- Meme config mais prompt:

```
Please summarize the following linkedin profile data for a lead I want to cold email. I want to combine this summary with another information about them to send personalized emails, so please make sure you include relevant bits in the summary. DO NOT include disclaimers about what this is. Simply provide a summary of the profile. No other fluff about how we can target them, etc.

Linkedin Profile Data:
{{ $json.profileSummary }}
```

- Position: [1980, 2500]

Connections:
- `Stringify posts` → `Resumer posts (Gemini)`
- `Stringify profil` → `Resumer profil (Gemini)`

**Step 6 : Scoring par Code node**

Node `Scorer leads` :
- Type: `n8n-nodes-base.code`, typeVersion: 2
- Mode: default (runOnceForAllItems)
- jsCode:

```javascript
// Lire les offres de l'entreprise liee au lead
// On reference les offres depuis le node qui les a lues
// Pour simplifier, on passe les offres via un Set node en amont
// ou on les lit directement ici

const offresData = $('Lire offres pour scoring').all().map(i => i.json);
const resumePosts = $('Resumer posts (Gemini)').all();
const resumeProfil = $('Resumer profil (Gemini)').all();
const leadsData = $('Lire Leads profil pending').all();

const results = [];

for (let i = 0; i < leadsData.length; i++) {
  const lead = leadsData[i].json;
  const postsSummary = (resumePosts[i]?.json?.candidates?.[0]?.content?.parts?.[0]?.text || '').toLowerCase();
  const profilSummary = (resumeProfil[i]?.json?.candidates?.[0]?.content?.parts?.[0]?.text || '').toLowerCase();
  const leadTitle = (lead.titre || '').toLowerCase();

  const scoreParOffre = {};
  let totalScore = 0;

  for (const offre of offresData) {
    let score = 0;
    const motsCles = (offre.mots_cles || '').split(',').map(m => m.trim().toLowerCase()).filter(m => m);
    const cibleIdeale = (offre.cible_ideale || '').toLowerCase();

    // Titre matche cible ideale (+30)
    if (cibleIdeale && leadTitle) {
      const cibleWords = cibleIdeale.split(/\s+/);
      const matchCount = cibleWords.filter(w => leadTitle.includes(w)).length;
      if (matchCount >= 2 || leadTitle.includes(cibleIdeale)) {
        score += 30;
      } else if (matchCount >= 1) {
        score += 15;
      }
    }

    // Mots-cles dans resume profil (+10 chacun)
    for (const mc of motsCles) {
      if (profilSummary.includes(mc)) score += 10;
    }

    // Mots-cles dans resume posts (+5 chacun)
    for (const mc of motsCles) {
      if (postsSummary.includes(mc)) score += 5;
    }

    // Bonus seniority (+15)
    const seniorityHigh = ['vp', 'c_suite', 'owner', 'founder', 'partner', 'director', 'head'];
    if (seniorityHigh.some(s => leadTitle.includes(s.replace('_', ' ')) || leadTitle.includes(s))) {
      score += 15;
    }

    // Normaliser sur 100
    const maxPossible = 30 + (motsCles.length * 10) + (motsCles.length * 5) + 15;
    const normalized = maxPossible > 0 ? Math.round((score / maxPossible) * 100) : 0;

    scoreParOffre[offre.nom_offre] = normalized;
    totalScore += normalized;
  }

  const scoreGlobal = offresData.length > 0 ? Math.round(totalScore / offresData.length) : 0;

  results.push({
    json: {
      apollo_id: lead.apollo_id,
      resume_profil: profilSummary,
      resume_posts: postsSummary,
      score_global: scoreGlobal,
      score_par_offre: JSON.stringify(scoreParOffre)
    }
  });
}

return results;
```

- Position: [2220, 2350]

> Note : Ce node a besoin des offres de l'entreprise. Il faut ajouter un node en amont pour les lire.

Node `Lire offres pour scoring` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Sheet: `Offres`
- Filter: `entreprise_id` = `{{ $('Lire Leads profil pending').first().json.entreprise_id }}`
- executeOnce: true
- alwaysOutputData: true
- Position: [780, 2600]

Connection supplementaire : `Planifier Scrape LinkedIn` → `Lire offres pour scoring` (en parallele du read leads)

**Step 7 : Update leads avec resume + score**

Node `Mettre a jour profil et score` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `update`
- Sheet: `Leads`
- Columns:
  - `apollo_id` (match)
  - `resume_profil` = `{{ $json.resume_profil }}`
  - `resume_posts` = `{{ $json.resume_posts }}`
  - `score_global` = `{{ $json.score_global }}`
  - `score_par_offre` = `{{ $json.score_par_offre }}`
  - `profile_summary_scrape` = `finished`
  - `posts_scrape_status` = `finished`
- Position: [2460, 2350]

Connection: `Scorer leads` → `Mettre a jour profil et score`

**Step 8 : Gerer les erreurs Apify**

Node `Statut scrape failed` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `update`
- Sheet: `Leads`
- Columns: `apollo_id` (match) + `profile_summary_scrape` = `failed` + `posts_scrape_status` = `failed`
- Position: [1260, 2700]

Connections (error outputs) :
- `Scraper posts LinkedIn (Apify)` [error output] → `Statut scrape failed`
- `Scraper profil LinkedIn (Apify)` [error output] → `Statut scrape failed`

**Step 9 : Valider la branche F**

```
n8n_validate_workflow: id=<workflow_id>
```

---

## Task 8 : Branches Maintenance (3 Schedule Triggers)

**Objectif :** Reset periodique des lignes en erreur.

**Step 1 : Maintenance emails invalides**

Node `Maintenance emails invalides` :
- Type: `n8n-nodes-base.scheduleTrigger`, typeVersion: 1.2
- Rule: every 4 weeks, mardi 8h
- Position: [300, 3100]

Node `Lire leads email invalide` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Sheet: `Leads`, Filter: `contacts_scrape_status` = `invalid_email`
- executeOnce: true
- Position: [540, 3100]

Node `Reset email a pending` :
- Type: `n8n-nodes-base.googleSheets`, typeVersion: 4.5
- Operation: `update`, Sheet: `Leads`
- Columns: `apollo_id` (match) + `contacts_scrape_status` = `pending`
- Position: [780, 3100]

**Step 2 : Maintenance profil failed**

Meme pattern, position Y=3300 :
- Filter: `profile_summary_scrape` = `failed`
- Reset: `profile_summary_scrape` = `pending`

**Step 3 : Maintenance posts failed**

Meme pattern, position Y=3500 :
- Filter: `posts_scrape_status` = `failed`
- Reset: `posts_scrape_status` = `unscraped`

**Step 4 : Valider les 3 branches maintenance**

```
n8n_validate_workflow: id=<workflow_id>
```

---

## Task 9 : Validation finale + configuration error workflow

**Step 1 : Valider le workflow complet**

```
n8n_validate_workflow: id=<workflow_id>, options: { profile: "strict" }
```

Corriger toutes les erreurs et warnings.

**Step 2 : Configurer le error workflow**

Verifier qu'un error workflow existe sur l'instance n8n (cf. workflow `tVCoRFth09sKXyE8` deja en production). Configurer le `errorWorkflow` dans les settings du workflow.

**Step 3 : Test end-to-end**

1. Inserer une URL d'entreprise dans le feuillet Entreprises, statut = "analyser"
2. Attendre 1 minute → verifier que la fiche est remplie + offres generees
3. Ajuster les offres si besoin, passer statut = "generer_personas"
4. Attendre 1 minute → verifier les personas dans le feuillet Personas
5. Valider 1 persona (statut = "valide")
6. Attendre → verifier les leads dans le feuillet Leads
7. Verifier le pipeline d'enrichissement (username, email, scraping, scoring)

**Step 4 : Desactiver le workflow**

Laisser le workflow inactif jusqu'a validation finale par l'utilisateur.

**Step 5 : Commit le plan et le design**

```bash
git add docs/plans/2026-02-17-lead-generation-enrichment-design.md docs/plans/2026-02-17-lead-generation-enrichment-plan.md
git commit -m "docs: plan et design workflow lead generation company-first"
```

---

## Resume des nodes par branche

| Branche | Nb nodes | Trigger | Terminaison |
|---------|----------|---------|-------------|
| A - Analyse | 7 | Schedule 1min | Update Entreprises + Insert Offres |
| B - Personas | 7 | Schedule 1min | Insert Personas + Update Entreprises |
| C - Apollo | 6 | Schedule 1min | Insert Leads + Update Personas |
| D - Username | 4 | Schedule 1min | Update Leads |
| E - Email | 8 | Schedule 1min | Update Leads |
| F - LinkedIn | ~15 | Schedule 1min | Update Leads |
| Maintenance | 9 (3x3) | Schedule 4 semaines | Update Leads |
| Sticky notes | 7 | - | - |
| **TOTAL** | **~63** | | |

## Credentials n8n requises

| Credential | Type | Usage |
|------------|------|-------|
| Google Sheets OAuth2 | googleSheetsOAuth2Api | Tous les nodes Google Sheets |
| Gemini API Key | httpQueryAuth (key=key) | Branches A, B, F (analyse, personas, resume) |
| Apollo API Key | httpHeaderAuth | Branches C, E (search, email match) |
| mails.so API Key | httpHeaderAuth (x-mails-api-key) | Branche E (validation email) |
| Apify Token | Passe en query param | Branche F (LinkedIn scraping) |
| Jina AI | httpHeaderAuth (optionnel) | Branche A (scraping web, gratuit sans auth) |
