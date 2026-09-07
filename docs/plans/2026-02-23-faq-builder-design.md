# Design — FAQ Builder + Enrichissement Inbox Genie

**Date** : 2026-02-23
**Source** : Adapte de [Support Autopilot & FAQ Builder](https://n8n.io/workflows/) (Nate Herk)
**Stack** : Gemini 2.5 Flash (HTTP Request direct), Google Sheets, Google Drive, Gmail OAuth2

---

## Objectif

Deux volets complementaires :

1. **FAQ Builder** : Workflow quotidien qui transforme les threads email (Client/Prospect) ou Alex a repondu en entrees FAQ dans une Google Sheet
2. **Enrichissement Inbox Genie** : Modifier le workflow existant pour que les brouillons de reponse s'appuient sur la FAQ existante

---

## Volet 1 — FAQ Builder (nouveau workflow)

### Declencheur

Schedule Trigger quotidien a 10h (apres Inbox Genie a 8h + temps de reponse).

### Filtre Gmail

- Labels : `Client` OU `Prospect`
- Avec reponse envoyee : `from:me`
- Pas encore traite : `-label:FAQ`

### Architecture

```
Schedule Trigger (10h, quotidien)
  |
  +-- Gmail getAll : threads Client/Prospect, from:me, -label:FAQ
  |
  +-- Lire profil business (Google Doc, executeOnce)
  |
  +-- Pour chaque thread :
  |     +-- Gmail Get Thread (messages complets)
  |     +-- Code : extraire question client + reponse envoyee
  |     +-- Gemini : reecrire en FAQ (question claire + reponse concise)
  |     +-- Google Sheets append (sheet "FAQ Base")
  |     +-- Gmail addLabel "FAQ" (marquer comme traite)
```

### Google Sheets "FAQ Base"

| Date | Categorie | Question | Reponse | Email original (De) | Sujet original |
|------|-----------|----------|---------|---------------------|----------------|

- Categorie = label Inbox Genie (Client ou Prospect)
- Question = question reformulee par Gemini
- Reponse = reponse reformulee par Gemini
- Email original et Sujet = pour tracabilite

### Prompt Gemini

Contexte : profil business + email complet (question + reponse).
Objectif : reformuler en FAQ professionnelle.
Output JSON : `{ "question": "...", "answer": "..." }`
Regles :
- Reformuler la question pour qu'elle soit generique (pas de nom de personne)
- Reformuler la reponse de maniere concise et professionnelle
- Conserver les informations factuelles (prix, delais, conditions)
- Ton coherent avec le profil business
- `responseMimeType: 'application/json'`

### Label "FAQ"

Cree en one-shot dans Gmail. Sert de marqueur pour eviter le retraitement.
Un thread avec le label "FAQ" ne sera plus repris par le FAQ Builder.

### Cohabitation

- Inbox Genie : 8h, labels Client/Prospect/etc., brouillons
- FAQ Builder : 10h, lit les threads Client/Prospect avec reponse, ecrit FAQ
- Pas de conflit : le FAQ Builder ajoute le label "FAQ" mais ne modifie pas les labels Inbox Genie

---

## Volet 2 — Enrichissement Inbox Genie

### Modification

Ajouter la lecture de la FAQ dans le flux de generation des brouillons :

**Avant :**
```
Reponse necessaire (IF true)
  → Construire prompt brouillon (profil business + email)
  → Gemini brouillon
  → Creer brouillon Gmail
```

**Apres :**
```
Reponse necessaire (IF true)
  → Lire FAQ Base (Google Sheets getAll, executeOnce)
  → Construire prompt brouillon (profil business + FAQ complete + email)
  → Gemini brouillon
  → Creer brouillon Gmail
```

### Prompt Gemini modifie

Le prompt du brouillon recevra en plus la FAQ complete. Instructions :
- Si une question similaire existe dans la FAQ, s'en inspirer pour la reponse
- Ne pas copier-coller mot pour mot, adapter au contexte de l'email
- Si aucune FAQ pertinente, repondre normalement avec le profil business

### Dimensionnement

- FAQ < 200 entrees : toute la FAQ dans le prompt (~50-100 tokens par entree = 10-20K tokens max)
- Au-dela : envisager un pre-filtrage (evolution future, pas pour la v1)

---

## Credentials reutilises

| Credential | ID | Usage |
|------------|-----|-------|
| Gmail OAuth2 | `N8N_RESOURCE_ID_10` | Search threads, Get thread, addLabel |
| Gemini API | `N8N_RESOURCE_ID_06` | Reecriture FAQ |
| Google Drive | `N8N_RESOURCE_ID_18` | Lecture profil business |
| Google Sheets | `N8N_RESOURCE_ID_03` | FAQ Base (ecriture + lecture) |

---

## Error handling

- Error workflow existant : `N8N_RESOURCE_ID_28`
- Retry x2 sur appels Gemini (3s entre chaque)
- `continueOnFail` sur Gmail addLabel "FAQ"
- Si le workflow echoue, les threads sans label "FAQ" seront repris le lendemain

---

## Decisions d'architecture

| Decision | Raison |
|----------|--------|
| Workflow separe (pas integre dans Inbox Genie) | Separation des responsabilites, pas de dependance temporelle |
| Schedule 10h (pas trigger) | Laisse le temps de repondre aux emails apres Inbox Genie (8h) |
| Google Sheets (pas Notion) | Meme ecosysteme, pas de nouveau service |
| Toute la FAQ dans le prompt Gemini | Simple, Gemini fait le matching, suffisant < 200 entrees |
| Label "FAQ" comme marqueur | Evite le retraitement, visible dans Gmail |
| Gemini HTTP Request direct | Pattern eprouve, pas de LangChain (REX) |
| Profil business depuis Google Doc | Meme source que Inbox Genie, centralise |
