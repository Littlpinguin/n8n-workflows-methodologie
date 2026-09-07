# Content System — Design

**Date** : 2026-02-24
**Statut** : Validé
**LLM rédaction** : Gemini 3 Pro
**LLM veille** : Perplexity sonar-pro

## Contexte

Système de création de contenu multi-plateforme pour Alex Martin ("Le Prof"). Remplace un workflow existant basé sur Notion/OpenAI par une architecture Google Drive/Sheets + Gemini adaptée à l'écosystème en place.

### Plateformes cibles

- LinkedIn (posts thought leadership)
- Substack Articles (articles de fond)
- Substack Notes (micro-blogging)
- La Missive du Prof (newsletter mensuelle)

### Documents de référence (Google Drive)

| Document | ID Drive | Rôle |
|----------|----------|------|
| Profil Business | `GOOGLE_DOC_ID_02` | Source de vérité positionnement |
| Guide Editorial | `GOOGLE_DOC_ID_08` | Style, ton, contraintes |
| Reference Missive | `GOOGLE_DOC_ID_06` | Structure annotée sept. 2024 |
| Dossier Content System | `1GjXAwmt8DuVbPJjsWI1ARsZPfSQIpsKv` | Contient prompts + docs |
| Content Calendar (Sheet) | `GOOGLE_DOC_ID_04` | Hub central 2 onglets |
| Prompt LinkedIn | `1RM2kqd95nAuQGsDrQph7nfmbUvpcLivLs_7tyrdWXnA` | Prompt enrichi (23 templates) |
| Prompt Substack Article | `1WNavkoaIQRhLx7MOXW1CkVPcLyOKmR5m0gTmbo_bBOQ` | Prompt articles de fond |
| Prompt Substack Notes | `12CHvW9QoNmsNqbEU84spbXJF8kNC4CzndBuAwP4krGg` | Prompt micro-blogging |
| Prompt La Missive du Prof | `GOOGLE_DOC_ID_03` | Prompt newsletter mensuelle |
| Ref Ancien Prompt LinkedIn | `1svyJ6MWmdNp5iLtjV9QQfbWFRJhesc2mYOwqH-ONb7w` | Posts exemples + templates |

### Workflows n8n

| Workflow | ID n8n | Nodes | Statut |
|----------|--------|-------|--------|
| Content - Veille Hebdo | `N8N_RESOURCE_ID_07` | 15+4 sticky | Inactif |
| Content - Generator | `N8N_RESOURCE_ID_21` | 25+5 sticky | Inactif |
| Content - La Missive du Prof | `N8N_RESOURCE_ID_02` | 16+4 sticky | Inactif |

## Architecture

3 workflows indépendants + 1 error handler, reliés par un Google Sheet central.

```
WF1 Veille Hebdo (lundi 8h)
  Perplexity ×3 → Gemini 3 Pro scoring → Google Sheet [PROPOSITION]

        Alex valide manuellement : PROPOSITION → VALIDÉ

WF2 Content Generator (quotidien 9h)
  Sheet [VALIDÉ] → Prompt Google Doc → Gemini 3 Pro → Sheet [BROUILLON]

        Alex relit, ajuste, publie : BROUILLON → PUBLIÉ

WF3 La Missive du Prof (25/mois 9h)
  Contenus PUBLIÉ du mois + Perplexity → Gemini 3 Pro → Google Doc brouillon
```

## Google Sheet — Content Calendar

### Onglet "Propositions"

| Colonne | Type | Description |
|---------|------|-------------|
| Date | Date | Date de proposition |
| Sujet | Texte | Titre/thème proposé |
| Angle | Texte | Angle éditorial suggéré par Gemini |
| Plateforme | Select | LinkedIn / Substack Article / Substack Notes / Missive |
| Score | Nombre | Pertinence 1-10 (Gemini) |
| Priorité | Select | Urgent / Tendance / Evergreen |
| Sources | Texte | URLs Perplexity de référence |
| Statut | Select | PROPOSITION / VALIDÉ / EN COURS / REJETÉ |
| Notes | Texte | Commentaires Alex |

### Onglet "Brouillons"

| Colonne | Type | Description |
|---------|------|-------------|
| Date | Date | Date de génération |
| Sujet (ref) | Texte | Lien vers la proposition source |
| Plateforme | Select | LinkedIn / Substack Article / Substack Notes |
| Titre | Texte | Titre généré |
| Hook | Texte | Accroche |
| Contenu | Texte | Corps du contenu |
| CTA | Texte | Call-to-action |
| Hashtags | Texte | Hashtags (LinkedIn) |
| Statut | Select | BROUILLON / RELU / PUBLIÉ |
| Date publication | Date | Rempli manuellement |
| Logs | Texte | Workflow source + timestamp |

## WF1 — Veille Hebdo

**Trigger** : Schedule, lundi 8h

### Nodes

1. **Schedule Trigger** — lundi 8h
2. **Charger Profil Business** — Google Docs read, `executeOnce: true`
3. **Charger Guide Editorial** — Google Docs read, `executeOnce: true`
4. **Perplexity — Gouvernance IA** — HTTP Request, API Perplexity `sonar-pro`, 7 derniers jours
5. **Perplexity — Intégration IA équipes** — HTTP Request, parallèle au précédent
6. **Perplexity — Innovations PME** — HTTP Request, parallèle au précédent
7. **Merge résultats** — Merge node, combine les 3 flux
8. **Gemini 3 Pro — Scoring** — HTTP Request direct, score pertinence 1-10, angle, plateformes suggérées
9. **Filtrer score >= 7** — IF node
10. **Écrire Propositions** — Google Sheets append, onglet Propositions, statut PROPOSITION
11. **Email récap** — Gmail send, résumé des propositions à Alex

### Requêtes Perplexity

3 domaines de veille, chacun avec un prompt contextualisé :

1. **Gouvernance IA** : régulations, AI Act, RGPD IA, frameworks, politiques internes
2. **Intégration IA en équipe** : adoption, change management, cas PME/ETI, ROI terrain
3. **Innovations d'usage PME** : outils émergents, automatisations, cas d'usage concrets

Volume attendu : ~8-12 propositions/semaine, Alex en valide 3-5.

## WF2 — Content Generator

**Trigger** : Schedule, quotidien 9h

### Nodes

1. **Schedule Trigger** — quotidien 9h
2. **Lire sujets VALIDÉ** — Google Sheets getAll, filtre statut = VALIDÉ
3. **IF aucun sujet** — Stop si vide
4. **Charger Profil Business** — Google Docs read, `executeOnce: true`
5. **Charger Guide Editorial** — Google Docs read, `executeOnce: true`
6. **Switch Plateforme** — Route vers le bon prompt
7. **Charger Prompt LinkedIn** — Google Docs read (si LinkedIn)
8. **Charger Prompt Substack Article** — Google Docs read (si Article)
9. **Charger Prompt Substack Notes** — Google Docs read (si Notes)
10. **Gemini 3 Pro — Générer** — HTTP Request direct, `responseMimeType: 'application/json'`, temperature 0.7
11. **Écrire brouillon** — Google Sheets append, onglet Brouillons, statut BROUILLON
12. **Mettre à jour Proposition** — Google Sheets update, statut → EN COURS
13. **Email récap** — Gmail send, résumé des brouillons générés

### Chargement dynamique des prompts

Chaque prompt est un Google Doc dans `Content System/`. Structure XML-tagged :

```xml
<role>Persona spécialisée plateforme</role>
<context>{{Profil Business}}{{Guide Editorial}}</context>
<subject>{{Sujet + Angle depuis Sheet}}</subject>
<sources>{{Résultats Perplexity associés}}</sources>
<instructions>Étapes de rédaction</instructions>
<format>Structure du contenu final</format>
<constraints>Interdits + règles dures</constraints>
<output>JSON : titre, contenu, hook, cta, hashtags, notes_internes</output>
```

`<context>`, `<subject>`, `<sources>` sont remplacés dynamiquement par le workflow. Alex édite les autres sections directement dans le Google Doc.

Traitement séquentiel des sujets (pas en parallèle) pour respecter les rate limits Gemini.

## WF3 — La Missive du Prof

**Trigger** : Schedule, 25 du mois à 9h

### Nodes

1. **Schedule Trigger** — 25/mois 9h
2. **Charger Profil Business + Guide Editorial + Reference Missive** — Google Docs read ×3
3. **Lire contenus PUBLIÉ du mois** — Google Sheets getAll, filtre statut = PUBLIÉ + mois courant
4. **Lire propositions du mois** — Google Sheets getAll, onglet Propositions, mois courant
5. **Charger Prompt La Missive** — Google Docs read
6. **Gemini 3 Pro — Générer Missive** — HTTP Request direct
7. **Créer Google Doc brouillon** — Google Docs create dans Content System/
8. **Email notification** — Gmail send, lien vers le brouillon

### Structure de la Missive

| Section | Poids | Contenu |
|---------|-------|---------|
| Analyse éditoriale | ~60% | Sujet principal du mois, décryptage, opinion tranchée |
| Outil coup de coeur | ~15% | Outil testé personnellement, retour terrain |
| Contenu de marque | ~10% | Actualité Alex (formations, projets, témoignages) |
| Défi du mois | ~10% | Action concrète pour le lecteur |
| Note perso | ~5% | Touche humaine, anecdote |

Volume : 1500-2500 mots. Brouillon dans un Google Doc, relu et copié dans Substack par Alex.

## Prompts — Spécifications par plateforme

### Prompt LinkedIn

- **Rôle** : Stratège LinkedIn thought leadership B2B
- **Format** : Hook (1 ligne, pattern Information Gap / Prediction Error) → Contexte (2-3 lignes) → Développement (3-5 paragraphes courts) → Takeaway → CTA
- **Contraintes** : ~1300 caractères max, 3-5 hashtags, pas de bullet points excessifs, pas de ton corporate, jamais de promesse miracle

### Prompt Substack Article

- **Rôle** : Rédacteur éditorial articles de fond tech/IA pour managers
- **Format** : Titre → Chapô (2-3 phrases) → 3-5 sections titrées → Conclusion → CTA abonnement
- **Contraintes** : 800-1500 mots, pas de jargon non expliqué, toujours ramener à l'impact business, ton "prof qui explique", vouvoiement obligatoire

### Prompt Substack Notes

- **Rôle** : Micro-blogueur tech/IA, voix directe
- **Format** : 1-3 phrases percutantes, ~280 caractères
- **Contraintes** : Autonome (compréhensible seul), pas de hashtags, ton conversationnel, vouvoiement obligatoire

### Prompt La Missive du Prof

- **Rôle** : Éditorialiste mensuel IA, voix "Prof"
- **Format** : Titre → Sommaire → 5 sections (cf. Structure ci-dessus) → CTA
- **Contraintes** : 1500-2500 mots, pas de listes comme structure principale, rythme "oral écrit", vouvoiement obligatoire, chaque section lisible indépendamment

## Gestion des erreurs

### Error Handler

Workflow dédié `Content System - Error Handler` assigné aux 3 workflows :

```
Error Trigger → Formater erreur (node, workflow, message) → Email à Alex
```

### Stratégies par node

| Workflow | Node | Retry | Fallback |
|----------|------|-------|----------|
| WF1 | Perplexity API (×3) | 2×, backoff 5s | continueOnFail, les 2 autres continuent |
| WF1 | Gemini Scoring | 1× | Écrire résultats bruts sans scoring |
| WF2 | Gemini 3 Pro | 2×, backoff 10s | Marquer sujet "ERREUR" dans Sheet |
| WF2 | Google Sheet write | 1× | Envoyer contenu par email |
| WF3 | Gemini 3 Pro | 2× | Créer Doc avec inputs bruts |

### Observabilité

- Sticky Notes dans chaque workflow
- Colonne "Logs" dans le Sheet (date + workflow source)
- Email récap après chaque exécution (succès ou échec)

## Composants — Vue d'ensemble

| Composant | Type | Détail |
|-----------|------|--------|
| WF1 — Veille Hebdo | Workflow n8n | Lundi 8h, Perplexity ×3 → Gemini scoring → Sheet |
| WF2 — Content Generator | Workflow n8n | Quotidien 9h, Sheet VALIDÉ → Gemini 3 Pro → brouillon |
| WF3 — La Missive du Prof | Workflow n8n | 25/mois, contenus du mois → Gemini 3 Pro → Google Doc |
| Content Calendar | Google Sheet | 2 onglets, statuts PROPOSITION→VALIDÉ→BROUILLON→PUBLIÉ |
| 4 Prompts | Google Docs | LinkedIn, Substack Article, Substack Notes, La Missive |
| Profil Business | Google Doc existant | Unifié, lu par tous les workflows |
| Guide Editorial | Google Doc existant | Style + contraintes Alex |
| Reference Missive | Google Doc existant | Structure annotée sept. 2024 |
| Error Handler | Workflow n8n | Error Trigger → email |
| Gemini 3 Pro | LLM | Rédaction + scoring |
| Perplexity sonar-pro | API | Veille hebdo |

## Templates de référence

Inspiré des templates suivants (bibliothèques locales) :

- **Publishing Factory** (ultimate-n8n-ai-workflows) : pattern prompts dans Google Docs XML-tagged, sub-workflow auto-appelant
- **Blog Posts From Google Sheets** (awesome-n8n-templates) : Google Sheet comme hub central avec suivi de statut
- **AI Social Media Amplifier** (awesome-n8n-templates) : scraping actualités → génération multi-plateforme → preview
- **Multi-Platform Content Creation** (ultimate-n8n-ai-workflows) : form intake → agent IA → publication parallèle
