# Design Spec — Automatisation Rapport Diagnostic IA Marketing

**Date** : 2026-04-09 (maj 2026-04-12)
**Statut** : Valide
**Workflow** : `Diagnostic - Generer Rapport`
**Declencheur** : Webhook POST depuis le JS du diagnostic sur `example.com/diagnostic/` (fire-and-forget)
**Brief technique de reference** : `<repo-marque>/brand/briefs/brief-technique-n8n-supabase-gemini.md`

---

## Vue d'ensemble

Quand un prospect complete le diagnostic IA marketing sur example.com (17 questions, 5 dimensions, scoring 1-4), ses donnees sont enregistrees dans Brevo (liste 6). Le site envoie ensuite un POST webhook a n8n qui :

1. Scrape l'entreprise du prospect (site web + recherche) via Jina
2. Produit une analyse personnalisee via Gemini 3 Pro Preview (2 appels)
3. Genere un mot de passe unique
4. Stocke le rapport complet dans Supabase
5. Met a jour le contact Brevo avec le mot de passe et la date

Brevo Automation prend ensuite le relais pour envoyer la sequence de 4 emails (J+0 a J+14), dont le premier contient le lien vers le rapport + les identifiants de connexion.

Le prospect accede a son rapport personnalise sur `example.com/diagnostic/rapport/` via un login email + mot de passe. La page est un template unique qui fetch les donnees depuis Supabase et les affiche dynamiquement.

---

## Architecture du flux

```
[example.com/diagnostic/] JS du formulaire
  -> POST Brevo API (cree contact, liste 6, scores en attributs)
  -> POST webhook n8n (fire-and-forget, memes donnees)

[n8n] Workflow "Diagnostic - Generer Rapport"
  Webhook
    -> Valider payload (email + entreprise + score_global requis)
    -> Extraire domaine email (exclure domaines generiques)
    -> Jina Reader (site web)  //  Jina Search (nom entreprise)  [parallele]
    -> Fusionner contexte scraping
    -> Gemini #1 : Analyse dimensions (scores + contexte entreprise)
    -> Gemini #2 : Plan d'action (s'appuie sur l'analyse #1)
    -> Code : Generer mot de passe + structurer JSON rapport
    -> Supabase : Upsert rapport dans `diagnostic_reports` (cle : email)
    -> Brevo : Update contact (RAPPORT_PASSWORD, RAPPORT_DATE) + ajout liste 7

[Brevo Automation]
  Declencheur : contact ajoute a liste 7 ("Rapport pret")
  -> Email J+0 : lien rapport + identifiants (variables dynamiques)
  -> Email J+3 : matrice de decision outils IA
  -> Email J+7 : case study Mutuelle Entrenous
  -> Email J+14 : offre Audit 360

[example.com/diagnostic/rapport/]
  -> Ecran login (email + mot de passe)
  -> POST Edge Function `diagnostic-auth` (email + password)
  -> Affichage dynamique du rapport (radar chart, analyse, actions)
```

---

## Decisions d'architecture

| Decision | Choix | Raison |
|----------|-------|--------|
| Declenchement | Webhook POST depuis le JS du diagnostic | Temps reel, en parallele de l'envoi Brevo |
| Stockage | Supabase (free tier) | Edge Function pour l'auth, RLS active, JSONB pour donnees structurees |
| Acces front | Edge Function `diagnostic-auth` | RLS active, pas d'acces direct REST depuis le front |
| Scraping | Jina Reader + Jina Search | Gratuit, double source (site + recherche), bonne couverture |
| IA | Gemini 3 Pro Preview, 2 appels | Appel 1 = analyse, Appel 2 = actions basees sur l'analyse. Meilleure qualite |
| Prompts | Hardcodes dans les nodes HTTP | Prompts stables, pas besoin d'iteration frequente |
| Emails | Tout via Brevo Automation | n8n stocke le mdp en attribut Brevo, Brevo gere toute la sequence |
| Architecture workflow | Monolithique (~12 nodes) | Flux lineaire, pas de reutilisation, simple a debug |
| Mode webhook | Fire-and-forget | Traitement 20-40s, pas d'attente cote front |
| Mot de passe | Stocke en clair dans Supabase | Acces rapport uniquement, pas un compte utilisateur sensible |

---

## Detail des nodes n8n

### Node 1 : `Recevoir diagnostic` (Webhook)
- **Type** : `n8n-nodes-base.webhook`
- **Method** : POST
- **Path** : `/diagnostic-rapport`
- **Response** : Immediately, HTTP 200
- **Payload attendu** :

```json
{
  "email": "string",
  "prenom": "string",
  "nom": "string",
  "entreprise": "string (obligatoire)",
  "taille_equipe": "string",
  "score_usages": "number (1.0-4.0)",
  "score_donnees": "number",
  "score_competences": "number",
  "score_processus": "number",
  "score_gouvernance": "number",
  "score_global": "number"
}
```

### Node 2 : `Valider payload` (IF)
- **Type** : `n8n-nodes-base.if`
- **Condition** : `email` non vide ET `entreprise` non vide ET `score_global` > 0
- **Branche TRUE** : continue le flux
- **Branche FALSE** : stop (pas de traitement)

### Node 3 : `Extraire domaine email` (Code)
- **Type** : `n8n-nodes-base.code`
- **Logique** :
  - Extrait le domaine : `email.split('@')[1]`
  - Exclut les domaines generiques : gmail.com, outlook.com, yahoo.fr, hotmail.com, live.fr, orange.fr, free.fr, sfr.fr, wanadoo.fr, laposte.net
  - Si domaine generrique : `domaine = null`
  - Calcule le `niveauGlobal` : 1.0-1.7 = Debutant, 1.8-2.5 = Explorateur, 2.6-3.3 = Structure, 3.4-4.0 = Integre
- **Output** : ajoute `domaine` et `niveauGlobal` aux donnees

### Node 4 : `Scraper site web` (HTTP Request)
- **Type** : `n8n-nodes-base.httpRequest`
- **URL** : `https://r.jina.ai/https://{{ $json.domaine }}`
- **Condition d'execution** : skip si `domaine === null`
- **Timeout** : 15 000 ms
- **Retry on fail** : 1x
- **`continueOnFail: true`** : si le site est inaccessible, on continue

### Node 5 : `Rechercher entreprise` (HTTP Request)
- **Type** : `n8n-nodes-base.httpRequest`
- **URL** : `https://s.jina.ai/{{ encodeURIComponent(entreprise + " " + domaine) }}`
- **Timeout** : 15 000 ms
- **Retry on fail** : 1x
- **`continueOnFail: true`**
- **Execution** : en parallele avec Node 4 (les deux connectes a Node 3)

### Node 6 : `Fusionner contexte` (Merge)
- **Type** : `n8n-nodes-base.merge`
- **Mode** : Combine > Merge By Position
- **Input 1** : resultat Jina Reader (Node 4)
- **Input 2** : resultat Jina Search (Node 5)
- **Output** : objet unifie avec `contenu_site` et `resultats_recherche`

### Node 7 : `Analyser dimensions` (HTTP Request — Gemini API)
- **Type** : `n8n-nodes-base.httpRequest`
- **URL** : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`
- **Auth** : Query param `key` via credential
- **Body** : prompt structure avec scores + contexte scraping + grille de maturite
- **`responseMimeType: 'application/json'`** pour forcer le JSON valide
- **Retry on fail** : 1x
- **Output attendu** :

```json
{
  "intro_personnalisee": "string (max 500 chars)",
  "synthese_globale": "string (max 300 chars)",
  "dimensions": [
    {
      "nom": "Usages IA actuels",
      "diagnostic": "string (max 400 chars)",
      "quick_win": "string (max 200 chars)"
    }
  ]
}
```

**Regles du prompt Gemini #1 :**
- **dimensions** : exactement 5, dans cet ordre : Usages IA actuels, Donnees marketing, Competences et culture, Processus et workflows, Gouvernance et vision. L'ordre est critique (la page mappe par index).
- **Ton** : direct, professionnel, pas de jargon IA. Vouvoiement obligatoire. Pas de tirets quadratins.
- **Mode degrade** : si aucun contexte entreprise disponible, analyser sur les scores seuls en l'indiquant.

### Node 8 : `Generer plan action` (HTTP Request — Gemini API)
- **Type** : `n8n-nodes-base.httpRequest`
- **URL** : identique Node 7
- **Body** : prompt avec l'analyse du Node 7 + scores + contexte entreprise
- **`responseMimeType: 'application/json'`**
- **Retry on fail** : 1x
- **Output attendu** :

```json
{
  "actions": [
    {
      "titre": "string (verbe a l'infinitif)",
      "description": "string (max 300 chars)",
      "impact": "fort|moyen|faible",
      "effort": "fort|moyen|faible",
      "timeline": "Semaine X ou Semaine X-Y"
    }
  ]
}
```

**Regles du prompt Gemini #2 :**
- **actions** : entre 3 et 5, ordonnees par priorite (impact fort + effort faible en premier).
- **impact/effort** : uniquement "fort", "moyen" ou "faible" (minuscules).
- **Memes regles de ton** que le prompt #1.

### Node 9 : `Structurer rapport` (Code)
- **Type** : `n8n-nodes-base.code`
- **Logique** :
  - Genere un mot de passe aleatoire (12 chars, a-z A-Z 0-9)
  - Assemble le JSON complet conforme au schema (voir section "Schema JSON du rapport")
  - Ajoute `date_diagnostic` en ISO 8601
  - Parse les reponses Gemini (gere le cas `Array.isArray` -> `content[0]`)
- **Output** : objet JSON complet pret pour Supabase

### Node 10 : `Stocker rapport` (HTTP Request — Supabase REST API)
- **Type** : `n8n-nodes-base.httpRequest`
- **Method** : POST
- **URL** : `https://<project-id>.supabase.co/rest/v1/diagnostic_reports`
- **Headers** :
  - `apikey: <service_role_key>` (service role pour bypass RLS)
  - `Authorization: Bearer <service_role_key>`
  - `Content-Type: application/json`
  - `Prefer: resolution=merge-duplicates` (upsert sur email unique)
- **Body** : row a plat (scores en colonnes individuelles, contexte_entreprise et analyse en JSONB)
- **Retry on fail** : 1x

Note : n8n utilise la `service_role_key` (pas la `anon_key`) car RLS est active sur la table.

### Node 11 : `Mettre a jour contact Brevo` (HTTP Request — Brevo API)
- **Type** : `n8n-nodes-base.httpRequest`
- **Method** : PUT
- **URL** : `https://api.brevo.com/v3/contacts/{{ encodeURIComponent(email) }}`
- **Auth** : Header `api-key` via credential `brevoApi`
- **Body** :

```json
{
  "attributes": {
    "RAPPORT_PASSWORD": "{{ password }}",
    "RAPPORT_DATE": "{{ date_diagnostic }}"
  },
  "listIds": [7]
}
```

Note : le `listIds: [7]` ajoute le contact a la liste "Rapport pret" dans le meme appel API, ce qui declenche l'automation Brevo.

### Node 12 : Error Workflow (separe)
- **Type** : workflow avec `n8n-nodes-base.errorTrigger`
- **Logique** : notification (Slack ou email admin) avec email du prospect, node en echec, message d'erreur
- **Assignation** : via Settings > Error Workflow du workflow principal

---

## Table Supabase : `diagnostic_reports`

```sql
CREATE TABLE diagnostic_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  entreprise TEXT NOT NULL,
  taille_equipe TEXT,
  date_diagnostic TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score_usages NUMERIC(2,1) NOT NULL,
  score_donnees NUMERIC(2,1) NOT NULL,
  score_competences NUMERIC(2,1) NOT NULL,
  score_processus NUMERIC(2,1) NOT NULL,
  score_gouvernance NUMERIC(2,1) NOT NULL,
  score_global NUMERIC(2,1) NOT NULL,
  contexte_entreprise JSONB,
  analyse JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_reports_email ON diagnostic_reports(email);
```

**Scores en colonnes individuelles** (numeric 2,1) et non en JSONB — alignement avec le brief technique.

**RLS active** : l'acces en lecture se fait uniquement via l'Edge Function `diagnostic-auth`, pas directement depuis le front.

### Edge Function `diagnostic-auth`

- **URL** : `https://<PROJECT_REF>.supabase.co/functions/v1/diagnostic-auth`
- **Method** : POST `{ "email": "...", "password": "..." }`
- **Reponse 200** : JSON complet du rapport (scores restructures en objet `scores`)
- **Reponse 401** : `{ "error": "Invalid credentials" }`
- **CORS** : `https://example.com` uniquement

La fonction reconstruit l'objet `scores` a partir des colonnes individuelles pour le front :
```json
{
  "scores": {
    "usages": 3.2,
    "donnees": 2.5,
    "competences": 2.8,
    "processus": 1.5,
    "gouvernance": 3.0,
    "global": 2.6
  }
}
```

---

## Schema JSON ecrit par n8n dans Supabase

n8n insere une row avec les colonnes a plat (pas de JSON pour les scores) :

```json
{
  "email": "string",
  "password": "string (12 chars, genere)",
  "prenom": "string",
  "nom": "string",
  "entreprise": "string",
  "taille_equipe": "string",
  "date_diagnostic": "ISO 8601",
  "score_usages": 3.2,
  "score_donnees": 2.5,
  "score_competences": 2.8,
  "score_processus": 1.5,
  "score_gouvernance": 3.0,
  "score_global": 2.6,
  "contexte_entreprise": {
    "secteur": "string",
    "description": "string (resume activite)",
    "taille_estimee": "string",
    "presence_digitale": "string (resume stack marketing / canaux visibles)"
  },
  "analyse": {
    "intro_personnalisee": "string (max 500 chars)",
    "synthese_globale": "string (max 300 chars)",
    "dimensions": [
      {
        "nom": "string",
        "diagnostic": "string (max 400 chars)",
        "quick_win": "string (max 200 chars)"
      }
    ],
    "actions": [
      {
        "titre": "string",
        "description": "string (max 300 chars)",
        "impact": "fort|moyen|faible",
        "effort": "fort|moyen|faible",
        "timeline": "Semaine X ou Semaine X-Y"
      }
    ]
  }
}
```

---

## Attributs Brevo a creer

| Attribut | Type | Role |
|----------|------|------|
| `RAPPORT_PASSWORD` | Text | Mot de passe genere, injecte dans les emails via `{{ contact.RAPPORT_PASSWORD }}` |
| `RAPPORT_DATE` | Date | Date du diagnostic, utilisable pour le timing de la sequence |

**Attributs existants** (deja crees par brevo.php) : `EMAIL`, `PRENOM`, `NOM`, `ENTREPRISE`, `TAILLE_EQUIPE`, `SCORE_USAGES`, `SCORE_DONNEES`, `SCORE_COMPETENCES`, `SCORE_PROCESSUS`, `SCORE_GOUVERNANCE`, `SCORE_GLOBAL`

**URL du rapport** : fixe (`example.com/diagnostic/rapport/`), hardcodee dans le template email Brevo. Pas besoin d'attribut.

---

## Sequence email Brevo Automation

**Declencheur** : contact ajoute a la liste 7 ("Rapport pret")

Utiliser la liste 7 (et non la liste 6) garantit que le mot de passe est deja stocke dans l'attribut Brevo avant l'envoi de l'email J+0. C'est n8n qui ajoute le contact a la liste 7 apres avoir termine tout le traitement.

| Email | Timing | Objet | Variables dynamiques |
|-------|--------|-------|---------------------|
| J+0 | Immediat | Votre rapport de maturite IA est pret | `{{ contact.PRENOM }}`, `{{ contact.RAPPORT_PASSWORD }}`, `{{ contact.ENTREPRISE }}` |
| J+3 | +3 jours | Une action concrete pour progresser | `{{ contact.PRENOM }}` |
| J+7 | +7 jours | Case study Mutuelle Entrenous | `{{ contact.PRENOM }}` |
| J+14 | +14 jours | Offre Audit 360 | `{{ contact.PRENOM }}`, `{{ contact.ENTREPRISE }}` |

**Contenu des emails** : redige dans `brand/emails/sequence-3-diagnostic/`

---

## Gestion des erreurs

| Node | Strategie | Mode degrade |
|------|-----------|-------------|
| Jina Reader (site) | `continueOnFail: true`, retry 1x | Continue avec Jina Search seul |
| Jina Search | `continueOnFail: true`, retry 1x | Gemini analyse sur les scores seuls |
| Gemini #1 (analyse) | Retry 1x avec backoff | Error Workflow -> notification admin |
| Gemini #2 (actions) | Retry 1x avec backoff | Error Workflow -> notification admin |
| Supabase (stockage) | Retry 1x | Error Workflow -> critique, rapport perdu |
| Brevo (update contact) | Retry 1x | Error Workflow -> rapport stocke mais prospect non notifie |

Le prompt Gemini inclut une instruction : "Si aucun contexte entreprise n'est disponible, produire l'analyse sur la base des scores uniquement, en indiquant que l'analyse est generique."

---

## Modifications requises cote example.com

### 1. JS du diagnostic — Ajouter l'appel webhook n8n

Dans `diagnostic/index.html`, apres l'envoi a Brevo, ajouter un POST fire-and-forget vers le webhook n8n avec les memes donnees (email, prenom, nom, entreprise, taille_equipe, 6 scores). Pas d'attente de reponse.

### 2. Creer le projet Supabase

- Creer un projet sur supabase.com (free tier)
- Executer le SQL de creation de table `diagnostic_reports` (voir section dediee)
- Creer l'Edge Function `diagnostic-auth` (POST, verifie email+password, retourne le rapport)
- Configurer RLS sur la table
- Configurer CORS de l'Edge Function pour `https://example.com`
- Noter la `project_url` et la `service_role_key` pour les credentials n8n

### 3. Page rapport (`example.com/diagnostic/rapport/`)

Page template unique, deja specifiee dans `site/docs/superpowers/specs/2026-04-10-page-rapport-diagnostic-design.md`. Fonctionnement :
- Login : email + mot de passe
- POST vers Edge Function `diagnostic-auth`
- Affichage dynamique : radar chart (Chart.js 5 axes), accordeons par dimension, timeline actions
- Protection : `noindex` + `robots.txt` + pas de lien public
- Configuration restante : remplacer `API_URL` ligne 168 par l'URL de l'Edge Function

---

## Credentials n8n necessaires

| Credential | Type | Usage |
|------------|------|-------|
| `brevoApi` | Header Auth | Deja existant — API Brevo (update contact) |
| `geminiApi` | Header Auth ou Query param | API Gemini (2 appels analyse) |
| `supabaseApi` | Header Auth (`service_role_key`) | API Supabase REST (upsert rapport, bypass RLS) |

---

## Resume des taches par responsable

### Agent n8n (repo automatisations)
- [ ] Construire le workflow "Diagnostic - Generer Rapport" (12 nodes)
- [ ] Creer le Error Workflow associe
- [ ] Configurer les credentials Supabase (`service_role_key`) et Gemini
- [ ] Tester le flux complet avec des donnees de test

### Agent example.com (site web + Supabase)
- [ ] Ajouter l'appel webhook n8n dans le JS du diagnostic
- [ ] Creer le projet Supabase + table `diagnostic_reports` + index
- [ ] Activer RLS sur la table
- [ ] Creer l'Edge Function `diagnostic-auth` (POST, CORS example.com)
- [ ] Remplacer `API_URL` dans `diagnostic/rapport/index.html` (ligne 168)
- [ ] Construire/finaliser la page `diagnostic/rapport/` (login + fetch + rendu)

### Agent Brevo (CRM/emails)
- [ ] Creer les attributs `RAPPORT_PASSWORD` et `RAPPORT_DATE`
- [ ] Creer la liste 7 "Rapport pret"
- [ ] Creer les 4 templates email avec les variables dynamiques
- [ ] Configurer l'automation (declencheur liste 7 -> sequence 4 emails)
