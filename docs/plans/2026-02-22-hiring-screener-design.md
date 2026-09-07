# Design : Recrutement - Screener CV Automatique

**Date** : 2026-02-22
**Source** : [Nate Herk - Hiring Screener](https://www.youtube.com/watch?v=ig_Ie4MDXFo)
**Statut** : Implémenté
**Workflow ID** : `neQNKFNjSjaQNb72`

## Contexte

Automatiser le screening de CVs reçus par email. Un agent IA analyse chaque CV par rapport à une fiche de poste active et produit un rapport structuré dans Google Sheets.

Inspiré du workflow de Nate Herk, adapté au contexte :
- **Gemini** au lieu d'OpenAI (seul credential IA actif)
- **Fiche de poste dynamique** via dossier Google Drive (au lieu de hardcodée)
- **Label Gmail "Recrutement"** pour filtrer en amont (pas d'IF sur les PJ)
- **Conventions françaises** du projet respectées

## Architecture (finale)

```
Gmail Trigger (label "Recrutement", emails non lus, poll quotidien 8h)
  → Upload CV dans Drive (Recrutement/CVs/)
  → Switch par type de fichier (Word / PDF / TXT)
    → [Word] : HTTP Request Convert to Google Doc → Download as PDF → Extract text
    → [PDF] : Download → Extract text
    → [TXT] : Download → Extract text
  → Set Resume (standardiser le texte extrait)
  → Chercher fiche dans "Recrutement/Fiche Active/" → Télécharger → Extraire texte
  → Code (construire prompt) → Gemini API (analyse) → Code (parser)
  → Code (construire prompt) → Gemini API (extraction infos) → Code (parser)
  → Append résultats dans Google Sheet "Resume Screener"
  → Gmail markAsRead (marquer l'email comme lu)
  → Error Handler (workflow-level)
```

**Note** : Pas d'IF nodes dans le workflow final — le label Gmail filtre en amont, et la fiche de poste doit toujours être présente.

## Structure Google Drive

```
Recrutement/
  ├── CVs/                    ← CVs uploadés automatiquement (nommés "{sujet email} Resume")
  ├── Fiche Active/           ← 1 seul fichier = poste courant (Google Doc, PDF ou TXT)
```

## Google Sheet "Resume Screener"

Colonnes :
| Date | Prénom | Nom | Email | Lien CV | Forces | Faiblesses | Risque | Opportunité | Score (0-10) | Justification |

## Modèle IA : Gemini via HTTP Request

### Appel 1 : Analyse CV

Prompt système :
```
Tu es un recruteur technique expert. On te donne une fiche de poste et un CV.
Analyse le CV par rapport à la fiche de poste et produis un rapport de screening.

Évalue l'alignement des compétences techniques ET la compréhension du contexte métier.
Base-toi uniquement sur le contenu réel du CV et de la fiche — pas d'hypothèses.
```

Output JSON forcé (`responseMimeType: 'application/json'`) :
```json
{
  "candidate_strengths": ["force 1", "force 2"],
  "candidate_weaknesses": ["faiblesse 1"],
  "risk_factor": {
    "score": "Low|Medium|High",
    "explanation": "Pire scénario si ce candidat est recruté"
  },
  "reward_factor": {
    "score": "Low|Medium|High",
    "explanation": "Meilleur scénario, fit court/long terme"
  },
  "overall_fit_rating": 7,
  "justification_for_rating": "Explication détaillée..."
}
```

### Appel 2 : Extraction infos candidat

```json
{ "first_name": "...", "last_name": "...", "email": "..." }
```

## Error Handling

- Error workflow existant (`Error Handler - Notification erreurs workflows`) rattaché
- Retry policy sur appels Gemini (1 retry, backoff)
- Retry sur nodes Google Drive/Sheets

### Edge cases

| Cas | Traitement |
|-----|-----------|
| Email sans pièce jointe | Filtré en amont par label Gmail (ne déclenche pas le workflow) |
| Format non supporté (ni Word/PDF/TXT) | Switch fallback → skip silencieusement |
| Dossier Fiche Active vide | Error handler capture l'erreur et notifie |
| CV illisible (texte vide après extraction) | Gemini analysera un texte vide — score bas attendu |

## Credentials utilisés

- `gmailOAuth2` : Gmail account (`N8N_RESOURCE_ID_10`)
- `googleDriveOAuth2Api` : Google Drive account (`N8N_RESOURCE_ID_18`)
- `googleSheetsOAuth2Api` : Google Sheets account (`N8N_RESOURCE_ID_03`)
- `googlePalmApi` : Gemini API (`N8N_RESOURCE_ID_06`)

## Templates de référence

- `awesome-n8n-templates/HR_and_Recruitment/CV Screening with OpenAI.json` — pattern HTTP Request direct vers API IA + JSON schema
- `awesome-n8n-templates/Google_Drive_and_Google_Sheets/Screen Applicants With AI, notify HR and save them in a Google Sheet.json` — pipeline complet screening → Sheets

## Conventions

- Nom workflow : `Recrutement - Screener CV Automatique`
- Noms de nodes : verbe + objet en français
- Tags : `recrutement`
- Workflow désactivé par défaut jusqu'à validation finale
