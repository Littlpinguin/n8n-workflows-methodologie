# Automatisations n8n — méthodologie & workflows de référence

Concevoir des workflows [n8n](https://n8n.io) de qualité production avec un agent IA
([Claude Code](https://claude.com/claude-code)), en s'appuyant sur le serveur MCP `n8n-mcp`
et une bibliothèque de 5 100+ workflows de référence.

Ce dépôt rassemble **la méthode** (`CLAUDE.md`), **12 workflows réels** exportés en JSON,
et **la documentation de conception** qui a mené à chacun d'eux — des specs de design aux
retours d'expérience post-production.

> ⚠️ **Version publique anonymisée.** Aucun secret, aucune donnée client, aucun identifiant
> d'infrastructure. Voir [Anonymisation](#anonymisation).

## Ce que contient le dépôt

| Dossier | Contenu |
|---|---|
| `CLAUDE.md` | La méthode complète : patterns d'architecture, conventions de nommage, gestion d'erreurs, checklist qualité, référence des expressions n8n |
| `workflows/` | 12 workflows n8n exportés en JSON, prêts à importer |
| `docs/plans/` | 17 plans d'implémentation détaillés, étape par étape |
| `docs/specs/` | Specs de design (architecture, choix techniques, interfaces) |
| `docs/superpowers/` | Plans et specs de migrations plus lourdes (Notion, agent WhatsApp) |
| `docs/rex-automatisations.md` | Retours d'expérience : ce qui a cassé en production et pourquoi |
| `schemas/` | Schémas visuels des workflows (HTML autonome) |
| `memory/` | Leçons apprises réutilisables |
| `discord-relay/` | Petit relais Node.js Discord → webhook n8n |

## Les 12 workflows

| Workflow | Ce qu'il fait |
|---|---|
| **Gmail - Inbox Genie** | Triage de boîte mail : classification IA, brouillons de réponse, routage |
| **Gmail - FAQ Builder** | Extrait les questions récurrentes des emails pour construire une FAQ |
| **FAQ - Publier sur WordPress** | Publie les entrées de FAQ validées sur WordPress |
| **Leads - Generation et Enrichissement** | Génération de leads B2B, enrichissement multi-sources, scoring |
| **Diagnostic - Generer Rapport** | Rapport d'analyse personnalisé (scraping + LLM + base + email) |
| **Recrutement - Screener CV Automatique** | Screening de CV : parsing, évaluation, classement des candidats |
| **Meeting - Analyser et classer** | Comptes rendus Google Meet : analyse, extraction d'actions, classement |
| **Content - Generator** | Génération de contenu éditorial multi-format |
| **Content - Veille Hebdo** | Veille hebdomadaire automatisée et synthèse |
| **Content - La Missive du Prof** | Production d'une newsletter récurrente |
| **Agent Tool - Query Brevo** | Sub-workflow outil : interrogation CRM pour un agent IA |
| **Error Handler** | Workflow d'erreur global : capture, log et notification |

## Démarrage

```bash
git clone <ce-repo> && cd automatisations-n8n

# Les bibliothèques de templates sont des projets tiers, non versionnés ici
git clone https://github.com/enescingoz/awesome-n8n-templates.git
git clone https://github.com/Danitilahun/n8n-workflow-templates.git
git clone https://github.com/oxbshw/ultimate-n8n-ai-workflows.git
```

Configurer l'accès à l'instance n8n via variables d'environnement — jamais en dur :

```bash
export N8N_API_URL="https://n8n.example.com"
export N8N_API_KEY="votre-cle-api"
```

`.mcp.json` lit ces deux variables pour le serveur MCP `n8n-mcp`.

Pour importer un workflow : dans n8n, **Workflows → Import from File**, puis reconfigurer
les credentials et remplacer les placeholders (voir ci-dessous).

## Anonymisation

Cette version publique est dérivée d'un dépôt privé. Ont été retirés ou remplacés :

| Type | Traitement |
|---|---|
| Clés d'API et tokens | Remplacés par des placeholders (`$NOTION_TOKEN`, …) et **révoqués** côté fournisseurs |
| Instance n8n, IP serveur, projet base de données | `n8n.example.com`, `<IP_DU_SERVEUR>`, `<SUPABASE_PROJECT_REF>` |
| IDs Google Sheets / Drive | `GOOGLE_DOC_ID_01` … `GOOGLE_DOC_ID_15` |
| IDs credentials et workflows n8n | `N8N_RESOURCE_ID_01` … `N8N_RESOURCE_ID_21` |
| Clients, prospects, personnes | Personas fictifs (`contact@example.com`, `AquaVert`, `Claire Martin`, …) |
| Documents commerciaux internes | Non inclus |

Les workflows ne fonctionneront donc pas tels quels : les placeholders sont à remplacer par
vos propres ressources, et les credentials à recréer dans votre instance n8n.

## Licence

MIT — voir [LICENSE](LICENSE). Les bibliothèques de templates tierces citées plus haut
restent sous leurs licences respectives.
