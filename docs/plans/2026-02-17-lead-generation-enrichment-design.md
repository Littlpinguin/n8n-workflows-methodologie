# Design : Lead Generation & Enrichment — Approche "Company-First"

**Date** : 2026-02-17
**Statut** : En cours de validation

## Contexte

Adaptation du workflow "Lead Generation and Enrichment" (source externe) vers une approche **company-first** : analyser l'entreprise cible d'abord, identifier ses personas potentiels via IA, puis lancer la recherche Apollo avec un ciblage precis.

## Architecture

### 1 workflow unique, 9 branches declenchees par Google Sheets

```
BRANCHE A — Analyse entreprise
  Trigger: Entreprises.statut = "analyser"
  -> Jina AI scrape site web
  -> Gemini analyse (fiche entreprise + offres)
  -> Update feuillet Entreprises + Insert feuillet Offres
  -> statut = "analyse"

BRANCHE B — Generation personas
  Trigger: Entreprises.statut = "generer_personas"
  -> Lire Offres liees a l'entreprise
  -> Gemini genere personas + intents Apollo suggeres
  -> Insert feuillet Personas (nb_leads = 20 par defaut)
  -> statut entreprise = "personas_generes"

BRANCHE C — Recherche Apollo
  Trigger: Personas.statut = "valide"
  -> Apollo mixed_people/search (person_titles, person_seniorities,
     person_locations, intents, per_page = nb_leads du persona)
  -> Split -> Clean -> Insert feuillet Leads

BRANCHE D — Extract LinkedIn Username
  Trigger: Leads nouvelle ligne (extract_username_status = pending)
  -> Extract username depuis linkedin_url
  -> Update lead

BRANCHE E — Email + Validation mails.so
  Trigger: Leads (contacts_scrape_status = pending)
  -> Apollo people/match (get email)
  -> Extract emails into array
  -> mails.so validation
  -> Wait -> Get results -> Update lead

BRANCHE F — Scraping LinkedIn + Scoring
  Trigger: Leads (profile_summary_scrape = pending)
  -> Apify LinkedIn Profile Scraper
  -> Apify LinkedIn Posts Scraper
  -> Merge + Stringify
  -> Gemini resume profil + posts
  -> Code node scoring (mots-cles vs offres)
  -> Update lead

BRANCHES MAINTENANCE (3x Schedule Triggers)
  -> Reset invalid_email -> pending (toutes les 4 semaines)
  -> Reset failed profile_summary -> pending
  -> Reset failed posts_scrape -> unscraped
```

### Flow utilisateur

```
1. User remplit URL dans feuillet Entreprises, passe statut = "analyser"
2. IA analyse le site, remplit la fiche + genere les offres detectees
3. User revoit fiche entreprise + offres, ajuste si besoin
4. User passe statut = "generer_personas"
5. IA genere N personas avec intents Apollo suggeres
6. User valide/modifie/supprime les personas, ajuste nb_leads
7. User passe les personas souhaites en statut = "valide"
8. Apollo recherche les leads, enrichissement automatique demarre
9. Scoring automatique par Code node apres scraping LinkedIn
```

## Structure Google Sheets

### Feuillet "Entreprises"

| Colonne | Type | Description |
|---------|------|-------------|
| `url` | string | URL du site web de l'entreprise |
| `statut` | string | vide / analyser / analyse / generer_personas / personas_generes |
| `nom` | string | Nom de l'entreprise (auto) |
| `description` | string | Description de l'activite (auto) |
| `proposition_valeur` | string | Proposition de valeur identifiee (auto) |
| `secteur` | string | Secteur d'activite (auto) |
| `taille_estimee` | string | Estimation taille entreprise (auto) |
| `date_analyse` | date | Date de l'analyse IA |

### Feuillet "Offres"

| Colonne | Type | Description |
|---------|------|-------------|
| `entreprise_id` | string | Ref vers feuillet Entreprises (nom ou row) |
| `nom_offre` | string | Nom de l'offre/produit/service |
| `description` | string | Description de l'offre |
| `cible_ideale` | string | Profil cible ideal pour cette offre |
| `mots_cles` | string | Mots-cles separes par virgule (pour scoring) |
| `problemes_resolus` | string | Problemes que l'offre resout |

### Feuillet "Personas"

| Colonne | Type | Description |
|---------|------|-------------|
| `entreprise_id` | string | Ref vers feuillet Entreprises |
| `titre_poste` | string | Titre de poste pour Apollo (person_titles) |
| `seniority` | string | Niveau hierarchique (person_seniorities) |
| `departement` | string | Departement cible |
| `localisations` | string | Localisations separees par virgule (person_locations) |
| `intents_suggeres` | string | Intent topics Apollo suggeres par l'IA |
| `statut` | string | a_valider / valide / ignore |
| `nb_leads` | number | Nombre de leads a rechercher (defaut: 20, max: 100) |

### Feuillet "Leads"

| Colonne | Type | Description |
|---------|------|-------------|
| `persona_id` | string | Ref vers le persona source |
| `entreprise_id` | string | Ref vers l'entreprise |
| `apollo_id` | string | ID Apollo du contact |
| `nom` | string | Nom complet |
| `titre` | string | Titre de poste |
| `organisation` | string | Entreprise du lead |
| `linkedin_url` | string | URL profil LinkedIn |
| `linkedin_username` | string | Username LinkedIn extrait |
| `email` | string | Adresse email |
| `email_status` | string | Statut validation mails.so |
| `extract_username_status` | string | pending / finished |
| `contacts_scrape_status` | string | pending / finished / invalid_email |
| `profile_summary_scrape` | string | pending / finished / failed |
| `posts_scrape_status` | string | unscraped / finished / failed |
| `resume_profil` | string | Resume IA du profil LinkedIn |
| `resume_posts` | string | Resume IA des posts recents |
| `score_global` | number | Score de pertinence global (0-100) |
| `score_par_offre` | string | Scores detailles par offre (JSON) |

## Choix techniques

| Composant | Technologie | Justification |
|-----------|-------------|---------------|
| Scraping site web | Jina AI Reader | Gratuit, API simple, markdown propre |
| Analyse IA | Gemini API (HTTP Request) | Preference utilisateur, HTTP direct (pas LangChain, cf. REX) |
| Recherche leads | Apollo mixed_people/search | API standard Apollo |
| Email enrichment | Apollo people/match | Comme le workflow original |
| Email validation | mails.so | Comme le workflow original |
| Scraping LinkedIn | Apify (Profile + Posts) | Comme le workflow original |
| Resume LinkedIn | Gemini API | Coherence avec le reste du workflow |
| Scoring | Code node JavaScript | Gratuit, rapide, pas de tokens |
| Hub donnees | Google Sheets (4 feuillets) | Validation humaine native, pas de BDD externe |

## Algorithme de scoring (Code node)

```
Pour chaque lead x chaque offre :
  - Titre du lead matche cible_ideale de l'offre     -> +30 pts
  - Chaque mot-cle trouve dans resume_profil          -> +10 pts
  - Chaque mot-cle trouve dans resume_posts           -> +5 pts
  - Seniority elevee (VP, C-level, Director, Owner)   -> +15 pts bonus
  - Score normalise sur 100

Score global = moyenne ponderee des scores par offre
```

L'utilisateur peut ajuster les poids directement dans le Code node.

## APIs externes requises (credentials n8n)

- Google Sheets OAuth2
- Gemini API Key (HTTP Header Auth)
- Apollo API Key (HTTP Header Auth)
- mails.so API Key
- Apify API Token

## Conventions

- Noms de nodes en francais, format `Verbe + Objet`
- Sticky notes pour documenter chaque branche
- Error workflow configure au niveau du workflow
- Retry policy sur tous les HTTP Request (1 retry, backoff)
