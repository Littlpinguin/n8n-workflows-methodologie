# Design — Migration Content System vers Notion

**Date** : 2026-03-16
**Statut** : Validé
**Auteur** : Claude Code + Alex Martin

---

## Contexte

Le Content System actuel repose sur un Google Sheet "Content Calendar" (2 onglets : Propositions + Brouillons) et 3 workflows n8n interconnectés. La migration vers Notion centralise la gestion de contenu dans un espace plus adapté (vues, filtres, statuts natifs, multi-profils, relations entre bases).

### Workflows actuels

| Workflow | ID | Rôle | Schedule |
|---|---|---|---|
| Content - Veille Hebdo | `N8N_RESOURCE_ID_07` | Veille Perplexity + scoring Gemini → propositions | Lundi 8h |
| Content - Generator | `N8N_RESOURCE_ID_21` | Lit sujets validés → génère contenu via Gemini | Quotidien 9h |
| Content - La Missive du Prof | `N8N_RESOURCE_ID_02` | Compile contenus du mois → newsletter Google Doc | 25/mois 9h |

### Bases Notion existantes

| Base | ID | Rôle |
|---|---|---|
| `idées` | `NOTION_ID_02` | Capture d'idées et veille |
| `__contenus` | `NOTION_ID_03` | Pipeline de publications |
| `profils` | `NOTION_ID_04` | Profils auteurs multi-variables |

Page parent : `NOTION_ID_01`

---

## Décisions de design

| Décision | Choix | Alternatives rejetées |
|---|---|---|
| Lien idée ↔ contenu | Relation Notion bidirectionnelle | Copie simple (pas de traçabilité) |
| Canaux | LinkedIn, Substack Article, Substack Notes, Newsletter | — |
| Stockage contenu généré | Body de la page Notion | Propriétés (trop limité en formatage) |
| Prompts | Template dans n8n + variables profil Notion, copie dans page Notion pour historique | Prompts dans Google Docs (ancien système), prompts dans base Notion dédiée |
| Interaction Notion | HTTP Request direct (Notion API) | Node Notion natif n8n (trop limité : pas de commentaires, pas de body, pas de relations), Sub-workflow gateway (over-engineered) |
| Guide éditorial | Reste dans Google Drive, URL dans fiche profil Notion | Migration complète dans Notion |
| Anti-redondance veille | Query contenus récents, passés à Gemini dans le prompt de scoring | Déduplication par titre (fragile) |
| Visuels LinkedIn | 3 prompts Flux LoRA en commentaire Notion, few-shot depuis prompts validés | Génération automatique (phase future) |
| Programmation auto canaux | Hors scope (phase future), bases prêtes | — |
| Plugin Chrome | Hors scope (phase future), base idées prête | — |

---

## Modifications Notion

### Base `idées` — 4 propriétés à ajouter

| Propriété | Type | Détail |
|---|---|---|
| `Score` | number | Score Gemini 1-10 |
| `Angle` | rich_text | Angle éditorial proposé |
| `Priorité` | select | Options : Evergreen, Tendance, Urgente |
| `Contenus` | relation → `__contenus` | Lien vers les posts créés depuis cette idée |

Note : les sources de veille utilisent la propriété `URL` existante.

### Base `__contenus` — 4 propriétés à ajouter + 2 modifications

**Ajouts :**

| Propriété | Type | Détail |
|---|---|---|
| `Idée source` | relation → `idées` | Lien inverse (bidirectionnel avec `Contenus`) |
| `Profil` | relation → `profils` | Auteur du contenu |
| `Logs` | rich_text | Traces d'exécution workflow |
| `Prompt visuel validé` | rich_text | Prompt Flux LoRA qui a produit un bon résultat (few-shot dynamique) |

**Modifications :**

| Propriété | Modification |
|---|---|
| `Canal` (select) | Ajouter options : Substack Article, Substack Notes, Newsletter |
| `État` (status) | Ajouter : Publié (groupe Complete) |

### Base `profils` — 4 propriétés à ajouter

| Propriété | Type | Détail |
|---|---|---|
| `Trigger LoRA` | rich_text | Trigger word Flux pour génération d'images |
| `Guide éditorial` | url | Lien Google Doc du guide éditorial |
| `Référence Newsletter` | url | Lien Google Doc de la référence newsletter |
| `Prompt Newsletter` | url | Lien Google Doc du prompt newsletter |

### Base `profils` — propriété inverse (relation)

La relation `__contenus` → `profils` est **unidirectionnelle**. Pas de reverse relation sur `profils` (un profil peut être lié à des centaines de contenus, la reverse property serait du bruit).

### Flux de statuts `__contenus`

```
Idées → À faire → Confiés à l'IA → Générés par IA → À illustrer → Validés → Programmés → Publié
           ↑            ↑                  ↑              ↑            ↑           ↑           ↑
        Manuel       Manuel           WF2 Generator    Manuel       Manuel      Manuel    Automation
                  (user valide)        (écrit ici)   (user fait   (user OK)  (user prog)    Notion
                                                     le visuel)                           (date passée)
```

**Transitions manuelles** : Idées → À faire, À faire → Confiés à l'IA, Générés par IA → À illustrer, À illustrer → Validés, Validés → Programmés. Toutes faites par Alex dans Notion.
**Transitions automatiques** : Confiés à l'IA → Générés par IA (WF2), Programmés → Publié (automation Notion).

### Automation Notion native

- **Trigger** : propriété `Publication` (date) passée ET statut = "Programmés"
- **Action** : changer statut en "Publié"

### Lifecycle des relations idées ↔ contenus

1. **WF1 Veille** crée des pages dans `idées` (pas de lien vers `__contenus` à ce stade)
2. L'utilisateur crée manuellement une carte dans `__contenus` depuis l'idée (bouton "Créer un post" existant ou manuellement). Il renseigne : Idée source (relation), Canal, Profil (relation), Idée de post (brief)
3. L'utilisateur passe le statut en "Confiés à l'IA"
4. **WF2 Generator** lit cette carte, génère, écrit dans le body, passe en "Générés par IA"

Alternative : WF1 pourrait aussi créer automatiquement une carte `__contenus` reliée pour les propositions à score élevé (>= 8). À valider en phase 1.

---

## Architecture des workflows

### Gestion des erreurs (commune aux 3 workflows)

Chaque workflow suit le pattern : `Trigger → Validation → Traitement → Sortie → Error Handler`

- **Error Workflow dédié** : créer un workflow `Content - Error Handler` avec Error Trigger → notification Gmail. Assigné via Settings sur les 3 workflows.
- **Retry policy** : activée sur tous les HTTP Request nodes (Notion API, Perplexity, Gemini, Google Drive). Config : 2 retries, backoff 1s/2s.
- **`continueOnFail: true`** : activé sur les nodes Notion d'écriture (create page, update status, add comment). Suivi d'un Code node qui vérifie `$json.error` et route vers le log d'erreur.
- **Validation inputs** : après chaque query Notion critique, un Code node vérifie que le résultat n'est pas vide avant de continuer.

### Validation : profil ACTIF absent

Si la query profil ACTIF retourne 0 résultat :
- Le workflow **s'arrête** (le Code node retourne `[]`)
- L'Error Workflow envoie un email : "Aucun profil ACTIF trouvé dans Notion - workflow interrompu"

### Validation : URL Guide éditorial manquante

Si la propriété `Guide éditorial` du profil est vide :
- Le workflow continue **sans** le guide (le prompt est assemblé sans cette section)
- Un warning est ajouté dans les Logs de la carte et dans l'email recap

### WF1 — Content Veille Hebdo (refonte)

```
Schedule (lundi 8h)
  → Notion: Query profil ACTIF
  → Code: Valider profil (stop si absent)
  → Google Drive: Télécharger guide éditorial (URL depuis profil, skip si absent)
  → Extract: Extraire texte guide (si présent)
  → Notion: Query __contenus récents (10 derniers en statut Programmés/Publié)
  → Code: Préparer liste sujets récents (anti-redondance)
  → Perplexity: Veille 96h (3 domaines, 1 requête) [retry 2x, timeout 30s]
  → Code: Préparer données scoring (inclut sujets récents à éviter)
  → Gemini: Scorer et proposer (avec consigne anti-redondance) [retry 2x]
  → Code: Parser propositions
  ┌─ [propositions trouvées]
  │   → Notion: Créer pages dans "idées" (Score, Angle, Priorité, Catégorie, URL)
  │   → Gmail: Email recap veille
  └─ [aucune proposition]
      → Gmail: Email aucune proposition
```

**Anti-redondance** : query les 10 derniers contenus en statut Programmés/Publié (par `created_time` décroissant, pas par date de publication qui peut être absente). Cette même logique est utilisée dans WF2 pour le contexte du prompt.

**Changements vs actuel :**
- Google Sheets → Notion API (base `idées`)
- Profil business Google Doc → profil Notion ACTIF + guide éditorial lié
- Nouveau : anti-redondance via query contenus récents
- Nouveau : validation profil + gestion erreurs

### WF2 — Content Generator (refonte majeure)

```
Schedule (quotidien 9h)
  → Notion: Query __contenus statut "Confiés à l'IA"
  ┌─ [contenus à générer]
  │   → Code: Extraire profil ID depuis relation, ou fallback query ACTIF
  │         (si la propriété "Profil" relation est renseignée → fetch ce profil par ID,
  │          sinon → query profils avec filtre STATUT = "ACTIF")
  │   → Code: Valider profil (stop si absent)
  │   → Google Drive: Télécharger guide éditorial (URL depuis profil, skip si absent)
  │   → Extract: Extraire texte guide (si présent)
  │   → Notion: Query 10 derniers contenus Programmés/Publié (anti-redondance)
  │   → Code: Assembler prompt (template n8n + ~30 variables profil + idée de post + anti-redondance)
  │   → Gemini: Générer contenu (+ 3 prompts Flux LoRA si LinkedIn) [retry 2x]
  │   → Code: Parser contenu + convertir en blocs Notion
  │   → Notion: Écrire contenu dans le body de la page (blocs Notion) [continueOnFail]
  │   → Notion: Update statut → "Générés par IA"
  │   ┌─ [canal = LinkedIn]
  │   │   → Notion: Query 5 derniers prompts visuels validés (few-shot)
  │   │   → Code: Remplacer [TRIGGER] par valeur profil + assembler commentaire
  │   │         (fallback si aucun prompt validé : exemples seed hardcodés)
  │   │   → Notion: Ajouter commentaire avec 3 prompts Flux LoRA
  │   └─ [autre canal]
  │       → (pas de commentaire)
  │   → Notion: Append toggle "Prompt utilisé" dans body
  │   → Code: Agréger résultats
  │   → Gmail: Email recap génération
  └─ [rien à générer]
      → (fin silencieuse)
```

**Batching** : si plus de 3 contenus "Confiés à l'IA", traiter avec Split In Batches (batch size 3) + delay 2s entre batches pour respecter le rate limit Notion (3 req/s). Chaque contenu génère ~8 appels Notion.

**Changements majeurs vs actuel :**
- Plus de Google Sheets
- Prompts construits dans n8n avec variables Notion (pas de Google Doc prompt par plateforme)
- Multi-profils natif via relation ou fallback profil ACTIF
- Contenu écrit dans le body Notion (blocs : paragraphes, headings, listes)
- Commentaires Flux LoRA pour LinkedIn avec few-shot dynamique (fallback seed examples)
- Prompt complet sauvegardé dans la page pour historique

### WF3 — Content Newsletter (ex-La Missive du Prof) (adaptation)

```
Schedule (25/mois 9h)
  → Notion: Query profil ACTIF
  → Code: Valider profil (stop si absent)
  → Google Drive: Télécharger référence newsletter (URL depuis profil)
  → Extract: Extraire texte référence
  → Google Drive: Télécharger prompt newsletter (URL depuis profil)
  → Extract: Extraire texte prompt
  → Notion: Query __contenus du mois (created_time >= 1er du mois, statuts Générés/À illustrer/Validés/Programmés/Publié)
  → Notion: Query idées du mois (created_time >= 1er du mois)
  → Code: Assembler prompt Newsletter (contenus + profil + docs)
  → Gemini: Générer Newsletter [retry 2x]
  → Code: Parser Newsletter
  → HTTP: Créer Google Doc natif (Drive API)
  → Code: Construire formatage
  → HTTP: Appliquer formatage (Docs API batchUpdate)
  → Gmail: Notifier Alex
```

**Filtre "du mois"** : utilise `created_time` (pas `Publication` qui peut être absente sur les contenus pas encore programmés). Filtre : `created_time >= premier jour du mois courant`.

**Changements vs actuel :**
- 2 reads Sheet → 2 queries Notion
- Profil Google Doc → profil Notion ACTIF
- URLs des docs Drive depuis la fiche profil
- Plus de formatage vert Sheet
- Sortie Google Doc natif : inchangée

---

## Prompt system

### Architecture

Le prompt de génération est construit dans un Code node n8n avec la structure :

```
1. ROLE + INSTRUCTIONS DE MISE EN FORME + STYLE + TEMPLATE RHÉTORIQUE
   (hardcodés dans n8n, issus du prompt V4 + instructions du projet Claude)

2. PROFIL AUTEUR
   (injecté dynamiquement depuis les ~30 champs du profil Notion)
   Variables : Description, Métier, Secteur, Type d'entreprise, Valeurs,
   Croyance, Mission, Objectif, Tonalité, Mon style, Product, Features,
   Benefits, Value_prop, USP, Advocacy, Rêve, Unpopular opinion, etc.

3. AUDIENCE CIBLE
   (injecté depuis : Cible, Problème cible, Douleur si problème non résolu,
   Fausse croyance limitante, Opinion forte, Douleur intime inavouable,
   Expression de la douleur, Peurs, Frustration, Obstacles)

4. IDÉE DU POST
   (depuis la propriété "Idée de post" de la carte __contenus)

5. CONTEXTE ANTI-REDONDANCE
   (titres des 10 derniers contenus Programmés/Publié, par created_time décroissant)

6. [LinkedIn uniquement] DEMANDE PROMPTS FLUX LORA
   (+ few-shot des prompts visuels validés récents)
```

### Prompts Flux LoRA

Instruction ajoutée dans l'appel Gemini pour les posts LinkedIn :

```
En plus du contenu du post, propose 3 prompts pour générer une image
de l'auteur avec un modèle Flux LoRA.

L'auteur apprécie particulièrement les mises en scène où il incarne
un personnage historique, fictif célèbre ou issu de la pop culture.
Privilégie ce type de scénarios décalés et humoristiques tout en
restant cohérent avec le sujet du post. Propose au moins 2 prompts
sur 3 dans ce style.

Chaque prompt doit :
- Commencer par [TRIGGER]
- Suivre la structure : [trigger] [description] [vêtements] [pose/action]
  [décor] [éclairage] [cadrage] [style]
- Utiliser du langage naturel descriptif
- Rester professionnel et adapté à LinkedIn

Exemples validés par l'auteur :
{few_shot_prompts}

Format de sortie JSON :
"flux_prompts": ["prompt1", "prompt2", "prompt3"]
```

Le Code node remplace `[TRIGGER]` par la valeur de `Trigger LoRA` du profil avant écriture du commentaire Notion.

Paramètres recommandés (inclus dans le commentaire) : LoRA weight 0.7-0.8, CFG 2.5-3.5, 35-50 steps.

### Sauvegarde prompt

Le prompt complet (avec variables résolues) est sauvegardé dans un toggle "Prompt utilisé" dans le body de la page Notion, pour traçabilité et debugging.

---

## Conversion contenu Gemini → blocs Notion

### Format de sortie Gemini

Gemini retourne le contenu en JSON structuré :

```json
{
  "titre": "Le titre du post",
  "hook": "La phrase d'accroche",
  "contenu": "Le corps du texte avec des \\n pour les sauts de ligne",
  "cta": "L'appel à l'action",
  "flux_prompts": ["prompt1", "prompt2", "prompt3"]
}
```

### Mapping vers blocs Notion

Le Code node convertit cette sortie en array de blocs Notion API :

| Élément | Type de bloc Notion | Détail |
|---|---|---|
| Titre | `heading_2` | Titre du post |
| Hook | `quote` | Phrase d'accroche mise en valeur |
| Contenu (paragraphes) | `paragraph` | Chaque double saut de ligne = nouveau bloc paragraph |
| Contenu (listes à puces) | `bulleted_list_item` | Lignes commençant par `- `, `* `, `→ `, `↳ ` |
| CTA | `callout` | Appel à l'action visuellement distinct |
| Séparateur | `divider` | Entre les sections |
| Toggle "Prompt utilisé" | `toggle` + `paragraph` enfant | Prompt complet résolu |

### Écriture via Notion API

Endpoint : `PATCH /v1/blocks/{page_id}/children` avec le body `{ "children": [...blocs] }`.

Si le body de la page contient déjà du contenu (ex: notes manuelles), les nouveaux blocs sont **ajoutés après** (append), pas écrasés. Le Code node ajoute un `divider` + `heading_3` "Contenu généré le {date}" avant les blocs pour séparer visuellement.

### Nommage des nodes

Les nodes suivront la convention `Verbe + Objet` du CLAUDE.md. Les labels dans les diagrammes ci-dessus sont des descriptions de design, pas les noms finaux des nodes. L'implémentation nommera chaque node explicitement (ex: "Requêter profil actif", "Valider profil présent", "Assembler prompt LinkedIn", etc.).

---

## Authentification

### Notion API dans n8n

- **Credential** : Header Auth (`notionApiAuth`)
- **Header** : `Authorization: Bearer ntn_...`
- **Header additionnel** par requête : `Notion-Version: 2022-06-28`
- Un seul credential partagé par les 3 workflows

### Credentials existants conservés

- `googleDriveOAuth2Api` : téléchargement guide éditorial, référence/prompt newsletter, création Google Doc
- `gmailOAuth2` : emails recap
- Perplexity : HTTP Header Auth (Bearer)
- Gemini : HTTP Header Auth (API key)

---

## Plan d'implémentation

### Ordre

```
Phase 0 : Prérequis Notion (bloque tout)
Phase 1 : WF1 - Veille Hebdo
Phase 2 : WF2 - Generator
Phase 3 : WF3 - Newsletter
```

### Phase 0 — Prérequis Notion

1. Ajouter propriétés dans les 3 bases
2. Ajouter options Canal (Substack Article, Substack Notes, Newsletter)
3. Ajouter statut "Publié" dans `__contenus`
4. Créer relations : bidirectionnelle idées ↔ __contenus, unidirectionnelle __contenus → profils
5. Remplir URLs (Guide éditorial, Référence Newsletter, Prompt Newsletter) sur profil actif
6. Remplir Trigger LoRA sur profil actif
7. Créer credential `notionApiAuth` dans n8n
8. Configurer automation Notion native Programmés → Publié

### Phase 1 — WF1 Veille Hebdo

- Dupliquer workflow actuel (suffixe `_v2`)
- Remplacer nodes Google Sheets/Drive par Notion API + Drive download dynamique
- Ajouter anti-redondance
- Tester avec exécution manuelle
- Valider pages créées dans `idées`

### Phase 2 — WF2 Generator

- Dupliquer workflow actuel (suffixe `_v2`)
- Refonte majeure : Notion queries, prompt system multi-profils, body Notion, commentaires Flux
- Tester avec carte "Confiés à l'IA" manuelle
- Valider body + commentaire + statut

### Phase 3 — WF3 Newsletter

- Dupliquer workflow actuel (suffixe `_v2`)
- Adapter reads Sheet → queries Notion
- Profil depuis Notion
- Tester avec contenus du mois existants

### Post-migration

- Désactiver les 3 anciens workflows (ne pas supprimer)
- Google Sheet Content Calendar reste en lecture seule (archive)
- Activer les nouveaux workflows un par un

---

## Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Notion API rate limit (3 req/s) | Échecs en batch | Split In Batches (size 3) + delay 2s entre batches dans WF2 |
| Body Notion = blocs, pas texte brut | Complexité parsing | Code node dédié conversion Gemini JSON → blocs Notion (voir section dédiée) |
| Relations Notion via API = IDs | Erreurs de mapping | Code node centralisant le mapping, accès par property ID |
| Perte de données migration | Perte contenus | Anciens workflows actifs jusqu'à validation complète |
| Accents dans propriétés Notion via API | Persistence incertaine | Accès par property ID (pas par nom), noms ASCII-safe dans le code |
| Profil ACTIF absent | Cascade d'erreurs | Validation en tête de workflow, arrêt + notification si absent |
| Guide éditorial URL manquante | Prompt incomplet | Warning dans logs, workflow continue sans cette section du prompt |
| Aucun prompt visuel validé (first run) | Few-shot vide | 3 exemples seed hardcodés en fallback dans le Code node |
| Notion API version | Drift futur | Version `2022-06-28` intentionnellement pinnée, à réévaluer si besoin |

---

## Phases futures (hors scope, bases prêtes)

| Phase | Prérequis en place |
|---|---|
| Plugin Chrome → idées | Base `idées` avec URL, Catégorie, État |
| Programmation auto canaux | Statut Validés, propriété Publication, Canal, body de page |
| Génération visuels auto | Media, commentaires Flux LoRA, Prompt visuel validé |
