# Projet : Automatisations n8n

Repo dédié à la création de workflows n8n de haute qualité via Claude Code, assisté par le serveur MCP n8n (`n8n-mcp`), le skillset n8n (`n8n-skills`) et une bibliothèque de **5 100+ templates** de référence répartis sur 3 repos locaux.

## Outils disponibles

- **n8n-mcp** : serveur MCP pour interagir directement avec l'instance n8n (CRUD workflows, exécutions, credentials)
- **n8n-skills** : skillset contenant les patterns, bonnes pratiques et templates n8n
- **awesome-n8n-templates** : 288 templates n8n réels, organisés en 19 catégories (`./awesome-n8n-templates/`)
- **n8n-workflow-templates** : 2 053 workflows couvrant 365 intégrations (`./n8n-workflow-templates/workflows/`)
- **ultimate-n8n-ai-workflows** : 2 772 workflows focus AI/RAG/agents (`./ultimate-n8n-ai-workflows/`)

**Quand les utiliser :**
- Toujours invoquer `n8n-skills` avant de concevoir un workflow (patterns, validation)
- Utiliser `n8n-mcp` pour créer, lire, modifier et tester les workflows sur l'instance
- Après modification, vérifier l'état du workflow via `n8n-mcp` avant de considérer la tâche terminée
- Consulter les bibliothèques de templates en phase de conseil et de conception (voir section dédiée ci-dessous)

## Méthode de travail

1. **Conseil** : comprendre le besoin, chercher des templates similaires dans les 3 bibliothèques, challenger l'approche avec des alternatives concrètes
2. **Plan mode** : explorer le besoin, identifier le pattern adapté, produire un plan enrichi par les templates de référence
3. **Validation** : faire valider le plan par l'utilisateur avant toute exécution
4. **Exécution** : implémenter via `n8n-mcp`, tester, vérifier

Ne jamais implémenter directement sans plan validé pour les workflows non triviaux.

## Bibliothèques de templates (5 100+ workflows)

Trois bibliothèques locales de workflows n8n réels, organisées pour la recherche et l'inspiration.

### Vue d'ensemble

| Bibliothèque | Workflows | Focus | Chemin local |
|---|---|---|---|
| **awesome-n8n-templates** | 288 | Templates curatés, 19 catégories | `./awesome-n8n-templates/` |
| **n8n-workflow-templates** | 2 053 | Couverture large, 365 intégrations | `./n8n-workflow-templates/workflows/` |
| **ultimate-n8n-ai-workflows** | 2 772 | AI/RAG/agents, multi-LLM | `./ultimate-n8n-ai-workflows/` |

Sources :
- [enescingoz/awesome-n8n-templates](https://github.com/enescingoz/awesome-n8n-templates)
- [Danitilahun/n8n-workflow-templates](https://github.com/Danitilahun/n8n-workflow-templates)
- [oxbshw/ultimate-n8n-ai-workflows](https://github.com/oxbshw/ultimate-n8n-ai-workflows)

**Les trois bibliothèques ne sont pas versionnées dans ce repo** — ce sont des projets
tiers avec leurs propres licences. Les cloner à la racine avant de commencer :

```bash
git clone https://github.com/enescingoz/awesome-n8n-templates.git
git clone https://github.com/Danitilahun/n8n-workflow-templates.git
git clone https://github.com/oxbshw/ultimate-n8n-ai-workflows.git
```

Elles sont listées dans le `.gitignore`.

### awesome-n8n-templates — Catégories

| Catégorie | Contenu typique |
|-----------|-----------------|
| `AI_Research_RAG_and_Data_Analysis` | RAG, deep research, scraping + IA |
| `OpenAI_and_LLMs` | Agents IA, chatbots, voice AI, assistants |
| `Gmail_and_Email_Automation` | Automatisation email, triage, réponses IA |
| `Google_Drive_and_Google_Sheets` | Sync, reporting, data pipelines Google |
| `Slack` / `Discord` / `Telegram` / `WhatsApp` | Bots, notifications, messaging |
| `Notion` / `Airtable` | CRM, project management, bases de données |
| `PDF_and_Document_Processing` | Extraction, OCR, transformation documents |
| `HR_and_Recruitment` | Screening CV, onboarding, évaluation candidats |
| `Instagram_Twitter_Social_Media` | Social media, content creation |
| `WordPress` | Publication, SEO, content management |
| `Database_and_Storage` | Postgres, Supabase, MongoDB, sync data |
| `Forms_and_Surveys` | Typeform, Tally, formulaires |
| `devops` | CI/CD, monitoring, infrastructure |
| `Other_Integrations_and_Use_Cases` | Intégrations diverses |

### n8n-workflow-templates — Structure

Fichiers JSON plats dans `workflows/`, nommés par convention : `{id}_{Nodes}_{Action}_{TriggerType}.json`. Couvre 365 intégrations (Telegram, Stripe, HubSpot, Slack, Google Sheets, etc.).

### ultimate-n8n-ai-workflows — Structure

- `workflows/` : 309 workflows généraux
- `automation/` : 948 workflows dans des sous-dossiers thématiques (SEO, scraping, agents, etc.)
- Dossiers projet : `gsc-ai-seo-writer/`, `keyword-rank-tracker/`, `serp-analysis/` avec workflows + docs architecture
- `docs/` : documentation architecturale (utile pour comprendre les patterns AI avancés)

### Quand et comment utiliser les templates

**Phase conseil (avant plan) :**
- Chercher des templates similaires avec `Glob` et `Grep` dans les 3 bibliothèques
- Lire les templates pertinents pour en extraire : architecture (nodes + connexions), patterns, bonnes pratiques
- Présenter 2-3 approches alternatives inspirées des templates existants
- Challenger le besoin : "Ce template fait X de cette façon, as-tu envisagé Y ?"

**Phase plan :**
- Référencer les templates qui ont inspiré l'architecture retenue
- S'inspirer des configurations de nodes éprouvées (paramètres, expressions, error handling)
- Identifier les patterns récurrents dans les templates similaires

**Recherche dans les templates :**
```
# Chercher par nom de fichier (cas d'usage) — dans les 3 repos
Glob: awesome-n8n-templates/**/*slack*.json
Glob: n8n-workflow-templates/workflows/*Slack*.json
Glob: ultimate-n8n-ai-workflows/**/*agent*.json

# Chercher par contenu (node types, patterns) — recherche globale
Grep: "scheduleTrigger" dans awesome-n8n-templates/
Grep: "lmChatOpenAi" dans ultimate-n8n-ai-workflows/
Grep: "httpRequest" dans n8n-workflow-templates/workflows/
```

**Stratégie de recherche par besoin :**
- **Intégration spécifique** (Slack, Gmail, Sheets) → `n8n-workflow-templates` (365 intégrations) puis `awesome-n8n-templates`
- **AI / RAG / agents** → `ultimate-n8n-ai-workflows` (focus AI) puis `awesome-n8n-templates` (catégorie AI)
- **Pattern métier complet** (onboarding, CRM, reporting) → `awesome-n8n-templates` (curatés par catégorie)

**Lecture d'un template :**
- Les templates sont des fichiers JSON contenant la définition complète du workflow n8n
- Se concentrer sur : la liste des nodes, les connexions, les paramètres clés, les prompts IA
- Ne pas copier les templates tels quels — s'en inspirer pour concevoir un workflow adapté au besoin spécifique

## Architecture & Design de Workflows

### Pattern par défaut

```
Trigger → Validation (input) → Traitement → Sortie → Error Handler
```

- **Trigger** : webhook, cron, event — toujours nommé explicitement
- **Validation** : vérifier la structure et les champs requis de l'input
- **Traitement** : logique métier, appels API, transformations
- **Sortie** : réponse, stockage, notification
- **Error Handler** : workflow-level error trigger, log + notification en cas d'échec

### Principes de modularité

- **Sub-workflows** : découper les workflows complexes via `Execute Sub-workflow`. Chaque workflow = une seule responsabilité.
- **Max 4-6 nodes dans le workflow principal** : abstraire le reste en sub-workflows réutilisables.
- **Interfaces claires** : définir des inputs/outputs explicites pour chaque sub-workflow.

### Versioning

- Dupliquer le workflow avant chaque modification significative
- Convention : `Customer-Onboarding_v2`, `Daily-Report_v2.1`
- Exporter les workflows en JSON pour backup et contrôle de version Git

### Discipline Git (branches + tags)

- **Ne JAMAIS commiter directement sur `main`** — toujours créer une branche dédiée
- **Convention de branches** : `feat/nom-du-workflow`, `fix/nom-du-correctif`, `docs/sujet`
- **Workflow Git** :
  1. `git checkout -b feat/nouveau-workflow` avant de commencer
  2. Commiter à chaque étape clé (design, plan, implémentation, REX)
  3. Quand validé : `git checkout main && git merge feat/... && git branch -d feat/...`
- **Tags de version** : créer un tag annoté après chaque mise en production
  - Format : `vX.Y` — ex: `v1.3`, `v2.0`
  - Commande : `git tag -a vX.Y -m "Description de la version"`
  - Pousser : `git push origin --tags`
- **Retour arrière** : `git checkout vX.Y` pour revenir à une version stable

## Conventions de nommage

### Workflows
- Format : `[domaine] - [action] - [cible]`
- Exemples : `CRM - Sync - Contacts HubSpot`, `Finance - Alert - Factures impayées`
- Toujours en minuscules pour les tags, majuscules sur les mots du nom

### Nodes
- Nommer chaque node de manière descriptive (jamais le nom par défaut)
- Format : `Verbe + Objet` — ex: `Valider payload`, `Récupérer commandes`, `Envoyer notification Slack`
- Préfixer les nodes d'erreur : `[Erreur] Notifier admin`

### Variables et expressions
- Noms de variables en `camelCase`
- Documenter les expressions complexes avec une sticky note

## Gestion des erreurs

### Principes

- **Design for Failure** : toujours supposer que les services externes vont échouer
- **Error Workflow dédié** : créer un workflow avec `Error Trigger` → notification (Slack, Email). L'assigner via `Options > Settings > Error workflow`
- **Retry on Fail** : activer sur tous les nodes HTTP/API susceptibles de timeout

### Pattern Try/Catch avec IF node

1. Activer `continueOnFail: true` sur le node risqué
2. Ajouter un node IF après pour vérifier `$json.error`
3. Router les échecs séparément (log, alerte, retry avec paramètres différents)

### Validation des données en amont

- Nodes `IF` pour vérifier les données entrantes AVANT traitement
- Vérifier : format email, dates valides, champs requis non vides
- Rejeter les événements trop anciens (ex : > 5 minutes)
- Détecter les doublons via un mécanisme d'event ID

### Split valid/error streams (Code Node)

```javascript
return [
  validRecords.map(r => ({json: r})),
  errors.map(e => ({json: e}))
];
```

## Performance & Scalabilité

- **Batch processing** : utiliser `Split In Batches` pour traiter par groupes de 50-100 (éviter l'épuisement mémoire)
- **Exécution parallèle** : connecter plusieurs nodes à une même sortie pour les tâches indépendantes
- **Filtres tôt** : placer les conditions et filtres le plus tôt possible dans le flux
- **Webhooks > Polling** : préférer les webhooks aux triggers polling quand possible
- **Ne pas sur-trigger** : aligner la fréquence sur les besoins métier réels

## Expressions & Données — Référence rapide

### Syntaxe de base

| Expression | Description |
|---|---|
| `{{ $json.fieldName }}` | Champ spécifique de l'item courant |
| `{{ $('Node Name').first().json.property }}` | Premier item d'un autre node |
| `{{ $('Node Name').last().json.output }}` | Dernier item d'un autre node |
| `{{ $('Node Name').item.json.value }}` | Item courant dans une boucle |
| `{{ $itemIndex }}` | Index de l'item courant (0-based) |
| `{{ $now.toFormat("yyyy-MM-dd") }}` | Date formatée |
| `{{ $workflow.id }}` / `{{ $execution.id }}` | IDs workflow/exécution |

### Expression vs Code Node

- Si la transformation tient en **une ligne sans boucle** → expression
- Si multi-étapes, variables, logique complexe → Code Node
- Erreurs courantes : oublier `.json`, ne pas vérifier null, confondre `===` et `==`

## Structure JSON des Workflows n8n

### Workflow

```json
{
  "nodes": [],          // Array des définitions de nodes
  "connections": {},    // Liens entre les nodes (source → target)
  "active": false,      // Actif ou non
  "settings": {},       // Mode d'exécution, timezone
  "name": "My Workflow"
}
```

### Node

```json
{
  "parameters": { "url": "https://api.example.com", "method": "GET" },
  "name": "GET Users",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4,
  "position": [250, 300],
  "id": "unique-node-id"
}
```

### Connections

```json
"connections": {
  "Source Node": {
    "main": [[
      { "node": "Target Node", "type": "main", "index": 0 }
    ]]
  }
}
```

### Data entre nodes

Toute donnée entre nodes = array d'items : `[{ "json": { ... }, "binary": {} }]`

## AI Workflows & LangChain

### Patterns principaux

- **Agent AI** : node `@n8n/n8n-nodes-langchain.agent` + LLM + tools via sub-nodes
- **RAG** : Document → Chunking → Embedding → Vector Store → Query → LLM → Réponse. Top K = 4 par défaut. Batch de 50 pour l'indexation.
- **Multi-Agent** : plusieurs agents qui collaborent, branching/looping selon les outputs AI
- **Human-in-the-Loop** : étapes d'approbation pour actions sensibles, fallback humain si confiance faible

### Bonnes pratiques AI

- Commencer simple, ajouter la complexité itérativement
- Préférer HTTP Request direct à LangChain pour les prompts longs (LLM Chain tronque silencieusement)
- `responseMimeType: 'application/json'` pour forcer le JSON valide
- Documenter les prompts et configurations avec des Sticky Notes

## Nodes les plus utilisés — Référence rapide

| Node | Type | Usage |
|---|---|---|
| `n8n-nodes-base.webhook` | Trigger | Réception d'événements HTTP |
| `n8n-nodes-base.scheduleTrigger` | Trigger | Exécution planifiée (cron) |
| `n8n-nodes-base.httpRequest` | Action | Appels API HTTP |
| `n8n-nodes-base.code` | Action | JavaScript/Python custom |
| `n8n-nodes-base.set` | Transform | Transformation de données |
| `n8n-nodes-base.if` | Logic | Routage conditionnel |
| `n8n-nodes-base.switch` | Logic | Routage multi-branches |
| `n8n-nodes-base.merge` | Transform | Fusion de données |
| `n8n-nodes-base.splitInBatches` | Transform | Traitement par lots |
| `n8n-nodes-base.executeWorkflowTrigger` | Trigger | Sub-workflows |
| `@n8n/n8n-nodes-langchain.agent` | AI | Agents AI LangChain |

**Convention** : core = `n8n-nodes-base.*`, LangChain = `@n8n/n8n-nodes-langchain.*`

## Checklist qualité (avant publish)

### Design
- [ ] Chaque node est nommé explicitement
- [ ] Sticky notes pour documenter la logique non évidente
- [ ] Workflow découpé en sub-workflows si > 6 nodes principaux
- [ ] Description du workflow documentée (surtout si exposé en MCP)

### Fiabilité
- [ ] Error workflow configuré au niveau du workflow
- [ ] Retry policy définie sur les nodes HTTP/API (au moins 1 retry, backoff)
- [ ] `continueOnFail` activé sur les nodes risqués avec routage IF
- [ ] Validation des inputs en entrée du workflow
- [ ] Idempotence vérifiée si le workflow peut être rejoué (déduplication, upsert)
- [ ] Timeout configuré sur les nodes HTTP si pertinent

### Performance
- [ ] Batch processing pour les gros volumes (`Split In Batches`)
- [ ] Filtres placés le plus tôt possible dans le flux
- [ ] Pas de transformations de données inutiles

### Sécurité
- [ ] Pas de secrets en dur — uniquement des credentials n8n ou variables d'environnement
- [ ] Audit logging en place si données sensibles

### Déploiement
- [ ] Testé avec des données réelles ou réalistes
- [ ] Workflow versionné (copie de backup avant modification)
- [ ] Workflow désactivé par défaut jusqu'à validation finale

## Sécurité

- **Jamais de secrets en clair** : API keys, tokens, mots de passe → toujours via credentials n8n ou variables d'environnement
- **Ne pas logger de données sensibles** : masquer les champs sensibles dans les logs
- **Webhooks** : utiliser le mode production avec authentification quand exposé
- **Credentials** : ne jamais exporter ou afficher les credentials via MCP
- **Principe du moindre privilège** : n'accorder que les scopes/permissions nécessaires aux intégrations
- **Contrôle d'accès** : RBAC sur les plans Enterprise (owner, editor, viewer). Séparer dev/staging/production.

## Règles critiques MCP & Construction

- **Ne JAMAIS modifier les workflows de production directement** : copier → tester → valider → déployer
- **Ne jamais faire confiance aux valeurs par défaut** : toujours configurer explicitement TOUS les paramètres (cause #1 d'échecs runtime)
- **Validation multi-niveaux** : `validate_node(mode='minimal')` → `validate_node(mode='full')` → `validate_workflow`
- **Templates d'abord** : toujours chercher dans les templates avant de construire from scratch
- **Préférer les nodes standard au Code Node** quand un node natif existe pour l'opération
- **Exporter des backups** avant toute modification de workflow existant
