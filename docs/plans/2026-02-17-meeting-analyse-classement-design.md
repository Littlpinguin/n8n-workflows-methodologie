# Design : Meeting - Analyser et classer - Comptes rendus Google Meet

**Date** : 2026-02-17
**Statut** : Validé

## Contexte

Automatiser l'analyse des transcriptions Google Meet (Gemini transcript) depuis Google Drive. Pour chaque réunion :
- Email personnalisé à chaque participant avec récap + actions
- Email récap perso à contact@example.com avec actions et points à creuser
- Création des tâches dans Google Tasks
- Classement du fichier transcription dans le dossier client Drive

## Décisions

- **Trigger** : Google Drive Trigger (détection nouveau fichier transcription)
- **IA** : Google Gemini (écosystème Google, fenêtre contexte 1M tokens)
- **Rôles participants** : Déduits par l'IA depuis la transcription
- **Identification client** : Google Sheet de référence (nom, domaine email, dossier Drive ID)
- **Format emails** : Texte simple
- **Approche** : Pipeline linéaire, un seul appel Gemini avec output JSON structuré

## Architecture

```
Google Drive Trigger (nouveau fichier transcription)
    │
    ├── 1. Télécharger la transcription
    ├── 2. Extraire le texte
    ├── 3. Lookup Google Sheet (liste clients)
    │
    ▼
    4. Gemini (analyse structurée → JSON)
    │
    ├── 5a. Split par participant → Gmail (email personnalisé)
    ├── 5b. Gmail récap perso → contact@example.com
    ├── 5c. Split actions → Google Tasks
    │
    └── 6. Classement Drive
           ├── Vérifier/créer /clients/{nom-client}/meetings/
           ├── Déplacer le fichier
           └── Renommer → JJ-MM-AAAA-nom-du-client
```

## Output Gemini (JSON structuré)

```json
{
  "client": "Acme Corp",
  "resume": "Points principaux évoqués...",
  "participants": [
    {
      "nom": "Jean Dupont",
      "email": "jean@acme.com",
      "role_deduit": "Chef de projet",
      "points_cles": ["..."],
      "actions": ["..."]
    }
  ],
  "actions_alex": [
    { "titre": "...", "details": "..." }
  ],
  "points_a_creuser": ["..."]
}
```

## Classement Drive

- Google Sheet clients : colonnes `Nom client | Domaine email | Dossier Drive ID`
- Arborescence : `/clients/{nom-client}/meetings/`
- Sous-dossier `meetings/` créé automatiquement s'il n'existe pas
- Nomenclature fichier : `JJ-MM-AAAA-nom-du-client`

## Error handling

- Error workflow global : notification email à contact@example.com
- Retry sur appels API Google (1 retry, backoff)
- Client non identifié → fichier reste en place + email d'alerte

## Templates de référence

- `awesome-n8n-templates/OpenAI_and_LLMs/Actioning Your Meeting Next Steps using Transcripts and AI.json` — architecture Google Calendar → Meet API → Drive → extraction → IA
