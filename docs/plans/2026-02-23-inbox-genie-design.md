# Design — Gmail Inbox Genie

**Date** : 2026-02-23
**Source** : Adapte de [Gmail Inbox Genie](https://n8n.io/workflows/) (Nate Herk)
**Stack** : Gemini 2.5 Flash (HTTP Request direct), Google Sheets, Google Drive, Gmail OAuth2

---

## Objectif

Workflow quotidien qui trie automatiquement les emails non lus de contact@example.com :
1. **Classifie** chaque email dans une categorie via Gemini (batch, 1 seul appel)
2. **Applique les labels** Gmail correspondants
3. **Genere des brouillons** de reponse pour les emails qui le necessitent (avec profil business + exemples de style)
4. **Logge** chaque email traite dans une Google Sheet

---

## Profil Business centralise

**Format** : Google Doc dans un dossier Drive dedie (`/Automatisations/Profil Business/`)
**Pattern** : Meme principe que la fiche de poste du Screener CV (dossier avec 1 fichier)

### Structure du document

```
## Mon entreprise
[Nom, secteur, positionnement]

## Mes services
[Liste des services proposes]

## Mes clients types
[Profil des clients, secteurs, taille]

## Mon ton de communication
[Style, registre, tutoiement/vouvoiement, langue]

## Exemples d'emails envoyes

### Exemple 1 — Reponse a un prospect
[Email reel copie-colle]

### Exemple 2 — Suivi client
[Email reel copie-colle]

### Exemple 3 — Refus poli
[Email reel copie-colle]
```

### Reutilisabilite

Tout workflow futur qui a besoin du contexte business lit ce meme document.
Modifier le doc = mettre a jour tous les workflows instantanement.

---

## Labels Gmail

| Label | Description | Genere un brouillon ? |
|-------|-------------|----------------------|
| `Client` | Emails de clients existants | Oui |
| `Prospect` | Demandes entrantes legitimes (inbound) | Oui |
| `Admin` | Factures, contrats, administratif | Selon contexte |
| `Newsletter` | Newsletters, contenus recus par abonnement | Non |
| `Cold Email` | Prospection commerciale non sollicitee | Non |
| `Notification` | Alertes systemes, confirmations, SaaS | Non |

### Detection des cold emails

Instructions dans le prompt Gemini :
- Premier contact non sollicite avec pitch commercial
- Questions ouvertes generiques ("Seriez-vous interesse par...", "Avez-vous envisage...")
- Liens calendly/booking, signatures avec titres commerciaux (SDR, BDR, Account Executive)
- Mention de "partenariat" ou "synergie" sans contexte prealable
- → Labelliser `Cold Email`, `needsReply: false`

### Creation des labels

One-shot : creer les 6 labels manuellement dans Gmail ou via une execution initiale separee.
Pas de verification a chaque execution quotidienne.

---

## Architecture

```
Gmail Trigger (8h, quotidien, non lus, exclut "Recrutement")
  |
  +-- Lire profil business (Google Doc)           <- 1 seule lecture
  |
  +-- Construire prompt batch                     <- Code node
  |     (tronque body a ~500 chars pour classifier)
  |
  +-- Gemini #1 — Classifier TOUS les emails      <- 1 seul appel API
  |     Input : array de {id, subject, from, body_tronque}
  |     Output : array de {id, labels, needsReply, reason}
  |
  +-- Parser + Appliquer labels Gmail              <- 1 appel Gmail par email
  |
  +-- Filtrer : needsReply=true
  |     |
  |     +-- Pour chaque email a repondre :
  |         +-- Gemini #2 — Generer brouillon      <- 1 appel par brouillon
  |         |     (avec profil business complet + exemples)
  |         +-- Gmail Create Draft (dans le thread)
  |
  +-- Logger dans Google Sheets                    <- 1 append par email
  |
  +-- Marquer tous les emails comme lus
```

### Bilan API (ex: 20 emails, 5 necessitent reponse)

- Gemini : 1 (classification batch) + 5 (brouillons) = **6 appels**
- Gmail : 20 (addLabels) + 5 (createDraft) + 20 (markAsRead) = **45 appels**
- Google Drive : 1 (profil business)
- Google Sheets : 20 (append log)

### Optimisation batch

- Body tronque a ~500 caracteres pour la classification (sujet + debut suffisent)
- Body complet conserve pour la generation des brouillons
- Profil business lu une seule fois, reutilise pour tous les brouillons

---

## Nodes detailles

| # | Node | Type n8n | Role |
|---|------|----------|------|
| 1 | Recevoir emails non lus | `gmailTrigger` (8h, quotidien, exclut Recrutement) | Trigger |
| 2 | Lire profil business | `googleDrive` download + `extractFromFile` text | Config |
| 3 | Construire prompt batch | `code` (prepare array emails, tronque body) | Prep |
| 4 | Classifier via Gemini | `httpRequest` (Gemini 2.5 Flash, JSON force) | IA |
| 5 | Parser + appliquer labels | `code` (parse) + `gmail` addLabels (loop) | Action |
| 6 | Filtrer needsReply | `if` (needsReply === true) | Routage |
| 7 | Generer brouillon | `code` (prompt) + `httpRequest` Gemini + `gmail` draft | IA + Action |
| 8 | Logger | `googleSheets` append (onglet log) | Stats |
| 9 | Marquer lus | `gmail` markAsRead | Cleanup |

---

## Google Sheets — Stats

### Onglet "Log" (1 ligne par email traite)

| Date | De | Sujet | Labels | Needs Reply | Brouillon cree | Reason |
|------|-----|-------|--------|-------------|----------------|--------|

### Stats agregees

Calculees via formules Google Sheets natives (`COUNTIF`, `SUMIF`) — pas de node n8n dedie.
Exemples de formules :
- `=COUNTIF(D:D, "*Client*")` pour le total d'emails Client
- `=COUNTIFS(D:D, "*Client*", A:A, ">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1))` pour ce mois

---

## Credentials reutilises

| Credential | ID | Usage |
|------------|-----|-------|
| Gmail OAuth2 | `N8N_RESOURCE_ID_10` | Trigger, labels, drafts, markAsRead |
| Gemini API | `N8N_RESOURCE_ID_06` | Classification + generation brouillons |
| Google Drive | `N8N_RESOURCE_ID_18` | Lecture profil business |
| Google Sheets | `N8N_RESOURCE_ID_03` | Logging stats |

---

## Error handling

- Error workflow existant : `N8N_RESOURCE_ID_28`
- Retry x2 sur les appels Gemini (3s entre chaque)
- `continueOnFail` sur Gmail addLabels (un label qui echoue ne bloque pas le reste)
- `markAsRead` en fin de chaine : si le workflow echoue, les emails non traites restent non lus et sont repris le lendemain

---

## Cohabitation avec le Screener CV

- Le Gmail Trigger exclut le label "Recrutement" (`-label:Recrutement` dans le filtre)
- Les emails de candidature sont traites exclusivement par le workflow Screener CV
- Pas de double traitement possible

---

## Decisions d'architecture

| Decision | Raison |
|----------|--------|
| Gemini HTTP Request direct (pas LangChain) | Controle total, pas de troncature silencieuse (REX) |
| Batch classification (1 appel pour N emails) | Economie API, coherence de classification |
| Body tronque a 500 chars pour classifier | Evite les prompts trop longs, sujet+debut suffisent |
| Profil business dans Google Doc Drive | Editable sans toucher au workflow, reutilisable |
| Stats via formules Sheet (pas de node) | Moins de nodes, toujours a jour, zero maintenance |
| Labels crees en one-shot | Pas de verification inutile a chaque execution |
| markAsRead apres tout le traitement | Reprise automatique en cas d'echec |
| Exclure label Recrutement | Cohabitation propre avec le Screener CV |
