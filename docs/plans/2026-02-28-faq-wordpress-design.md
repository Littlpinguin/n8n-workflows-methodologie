# Design — FAQ WordPress Dynamique

**Date** : 2026-02-28
**Workflow** : `FAQ - Publier sur WordPress`
**Source** : Google Sheet FAQ Base (`GOOGLE_DOC_ID_10`)
**Dependance** : FAQ Builder (`N8N_RESOURCE_ID_08`) alimente le Sheet en amont

## Objectif

Publier automatiquement chaque semaine une page FAQ dynamique sur WordPress, basee sur la FAQ Base existante, avec regroupement et optimisation IA.

## Architecture

```
Schedule Trigger (lundi 7h)
  -> Google Sheets (lire FAQ, filtre Publier=OUI)
  -> Google Drive (lire prompt depuis Doc)
  -> Gemini 2.5 Flash (deduplique, regroupe par theme, optimise)
  -> Code Node (genere HTML accordeons + CSS + schema.org FAQPage)
  -> Code Node (verifie Config: page_id existe ?)
    -> WordPress Create Page (si premier run)
    -> WordPress Update Page (si page existe)
  -> Google Sheets (met a jour Config: page_id, date, nb questions)
  -> Email recap
```

5-6 nodes principaux.

## Traitement Gemini

**Modele** : `gemini-2.5-flash`
**Prompt** : stocke dans un Google Doc Drive (editable sans toucher au workflow)

### Input

Toutes les Q/R du Sheet marquees `Publier=OUI`, en JSON :
```json
[
  { "question": "...", "reponse": "...", "categorie": "Client" },
  ...
]
```

### Taches

1. Deduplique les questions quasi-identiques (garde la meilleure reponse ou combine)
2. Regroupe par theme semantique (pas Client/Prospect, mais themes metier : "Tarification", "Fonctionnement", "Delais"...)
3. Optimise la formulation pour le web (concision, clarte, vouvoiement)
4. Ordonne les questions par pertinence dans chaque groupe

### Output JSON structure

`responseMimeType: application/json`

```json
{
  "categories": [
    {
      "name": "Fonctionnement du service",
      "questions": [
        {
          "question": "Comment fonctionne votre accompagnement ?",
          "answer": "Notre accompagnement se deroule en 3 etapes..."
        }
      ]
    }
  ]
}
```

## Generation HTML

### Accordeons HTML5 natifs

Balises `<details>/<summary>` — fonctionnent nativement dans tous les navigateurs, zero dependance plugin.

```html
<style>
  .faq-category h2 { ... }
  details.faq-item { border-bottom: 1px solid #eee; padding: 12px 0; }
  details.faq-item summary { cursor: pointer; font-weight: 600; font-size: 1.1em; }
  details.faq-item .faq-answer { padding: 8px 0 4px 0; line-height: 1.6; }
</style>

<div class="faq-container">
  <div class="faq-category">
    <h2>Fonctionnement du service</h2>
    <details class="faq-item">
      <summary>Comment fonctionne votre accompagnement ?</summary>
      <div class="faq-answer">Notre accompagnement se deroule en 3 etapes...</div>
    </details>
  </div>
</div>
```

CSS minimal et overridable par le theme WordPress.

### Schema.org FAQPage

Integre en `<script type="application/ld+json">` en bas du HTML :

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "...",
      "acceptedAnswer": { "@type": "Answer", "text": "..." }
    }
  ]
}
```

Rich snippets FAQ dans les resultats Google.

## Modifications du Sheet FAQ

### Colonne ajoutee

**`Publier`** (colonne G) : `OUI` / `NON`
- Vide ou `NON` par defaut (le FAQ Builder ne touche pas cette colonne)
- Validation manuelle par l'utilisateur
- Le workflow ne lit que `Publier=OUI`

### Onglet Config

Nouvel onglet "Config" dans le meme Sheet :

| Cle | Valeur |
|---|---|
| `wordpress_page_id` | (rempli auto au premier run) |
| `dernier_update` | (date du dernier run reussi) |
| `nb_questions_publiees` | (nombre de Q/R sur le site) |

## Publication WordPress

- **Premier run** : `WordPress Create Page` — `status: publish`, `slug: faq`, `title: FAQ`
- L'ID de la page creee est sauvegarde dans l'onglet Config
- **Runs suivants** : `WordPress Update Page` avec cet ID — remplace integralement le HTML
- Credential : `wordpressApi`

## Error handling

- Error workflow assigne (notification en cas d'echec)
- Retry 2x sur Gemini et WordPress (timeouts)
- Validation : si Gemini retourne un JSON vide/mal forme, le workflow s'arrete sans ecraser la page existante
- Code Node verifie `categories.length > 0` et chaque categorie a >= 1 question

## Schedule

Lundi 7h, hebdomadaire.

## Email recap

Apres chaque run reussi :
- Nombre de Q/R publiees
- Categories creees par Gemini
- Lien vers la page FAQ

## Decisions de design

| Decision | Choix | Raison |
|---|---|---|
| Format page | Page unique accordeons | Simple, lisible, une seule URL a maintenir |
| Accordeons | HTML5 `<details>/<summary>` | Zero dependance, natif navigateur |
| IA | Gemini 2.5 Flash pour regroupement | Suffisant pour deduplique/reformule, moins cher que Pro |
| Prompt | Google Doc Drive | Editable sans toucher au workflow |
| Filtre | Colonne Publier dans Sheet | Controle editorial manuel |
| State | Onglet Config dans Sheet | Tracabilite sans complexite |
| SEO | Schema.org FAQPage | Rich snippets Google |
