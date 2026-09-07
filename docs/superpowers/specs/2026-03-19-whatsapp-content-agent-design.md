# WhatsApp Content Agent — Design Spec

## Objectif

Creer un agent IA conversationnel accessible via WhatsApp qui sert de "second cerveau" pour la creation de contenu. L'agent permet de noter des idees (texte ou vocal), rediger des posts LinkedIn et multi-canal, consulter le pipeline editorial, gerer les statuts, generer des visuels (Flux LoRA + NanoBanana 2), et rechercher dans l'historique grace a une memoire vectorielle persistante.

## Contexte

Le Content System existant comprend :
- **Notion** : 3 bases (idees, contenus, profils) avec ~30 variables par profil
- **4 workflows n8n v2** : Veille Hebdo, Generator, Newsletter, Auto Publie
- **Google Drive** : guide editorial, prompts par canal, charte graphique, reference newsletter
- **fal.ai** : generation de visuels Flux LoRA (personnages celebres) + NanoBanana 2 (infographies)
- **Gemini API** : modeles Flash (rapide/pas cher) et Pro (qualite redactionnelle)

L'agent s'appuie sur cette infrastructure existante et l'enrichit avec une couche conversationnelle WhatsApp + memoire vectorielle Qdrant.

## Phase 0 : Prerequis

### WhatsApp Business API

- Creer un compte Meta Business (business.facebook.com)
- Configurer une application WhatsApp Business dans Meta Developer Portal
- Verifier un numero de telephone dedie
- Obtenir le token d'acces permanent (System User Token)
- Configurer le webhook vers l'URL n8n du WhatsAppTrigger
- Creer un credential `whatsAppBusinessApi` dans n8n

### Qdrant Cloud

- Creer un compte sur cloud.qdrant.io (free tier 1 GB)
- Creer un cluster (region EU de preference)
- Obtenir l'URL du cluster + API key
- Creer un credential `qdrantApi` dans n8n (Header Auth ou API Key)

### fal.ai

- Creer un compte sur fal.ai
- Obtenir l'API key
- Creer un credential `httpHeaderAuth` dedie dans n8n (Authorization: Key fal_...)

### OpenAI (Whisper uniquement)

- Obtenir une API key OpenAI (pour la transcription audio Whisper)
- Creer un credential `httpHeaderAuth` dedie dans n8n (Authorization: Bearer sk-...)
- Note : seul le endpoint `/v1/audio/transcriptions` est utilise, cout negligeable

### Notion : nouvelles proprietes

- **Base profils** : propriete URL "Charte graphique" (Google Doc style guide infographies)
- **Base profils** : propriete "Telephone" (pour le mapping futur multi-utilisateur)

## Architecture

### Approche retenue : Orchestrateur + Sub-workflows specialises

Un workflow principal (routeur) recoit les messages WhatsApp, identifie l'intention via Gemini Flash, puis delegue a des sub-workflows specialises. Chaque sub-workflow est autonome et testable independamment.

### Vue d'ensemble des workflows

| # | Workflow | Role | LLM |
|---|---|---|---|
| **WF-Main** | WhatsApp Content Agent | Routeur : reception, transcription vocale, classification intention, dispatch, reponse WhatsApp | Gemini Flash |
| **WF-A** | Agent - Noter Idee | Extraire et structurer l'idee, creer dans Notion, indexer dans Qdrant | Gemini Flash |
| **WF-B** | Agent - Rediger Post | Charger profil + guide + memoire, rediger (multi-canal), affinage conversationnel, enregistrer sur validation. Recoit `intention` en parametre (rediger_post / affiner_post / valider_brouillon) et branche en interne. | Gemini Pro |
| **WF-C** | Agent - Consulter & Rechercher | Requete Notion (pipeline/statuts) + recherche semantique Qdrant | Gemini Flash |
| **WF-D** | Agent - Gerer Statuts | Valider/rejeter idees, marquer "Publies", programmer dates | Gemini Flash |
| **WF-E** | Agent - Generer Visuel | Routage Flux LoRA / NanoBanana 2, appel fal.ai, envoi image WhatsApp + Notion | Gemini Flash |
| **WF-Sync** | Agent - Sync Qdrant | Indexation initiale + sync incrementale Notion vers Qdrant + purge | Cron (pas de LLM) |

### Flux principal

```
Message WhatsApp -> WF-Main
  -> Verifier phoneNumber (allowlist)
  -> Si vocal : WhatsApp Media Download -> HTTP Request OpenAI Whisper -> texte
  -> Gemini Flash classifie l'intention
  -> Execute Sub-workflow selon l'intention
  -> Sub-WF retourne la reponse texte (+ image si visuel)
  -> Sauvegarder echange dans Qdrant (type: conversation)
  -> WF-Main envoie la reponse WhatsApp
```

## WF-Main : WhatsApp Content Agent (routeur)

### Trigger

`WhatsAppTrigger` (webhook natif n8n) — recoit tous les messages entrants (texte, audio, image).

### Securite et deduplication

- **Allowlist** : un Code node verifie que le `phoneNumber` de l'expediteur correspond au numero autorise (en dur pour le scope mono-utilisateur). Tout autre numero est ignore silencieusement.
- **Deduplication** : WhatsApp peut envoyer des doublons. Un Code node verifie le `messageId` contre les 20 derniers IDs traites (stockes dans `staticData` du workflow). Si doublon, on ignore.

### Etapes

1. **Verifier expediteur + deduplication** (Code node)

2. **Identifier le type de media**
   - Texte : passer directement au classifieur
   - Audio/vocal : HTTP Request pour telecharger le media via WhatsApp API (`GET media_url` avec token), puis HTTP Request POST vers `https://api.openai.com/v1/audio/transcriptions` (model: `whisper-1`, credential `httpHeaderAuth` OpenAI). Retourne le texte transcrit.
   - Image : stocker en binaire pour WF-E si demande de contexte visuel

3. **Charger le contexte de session** — Requete Qdrant : derniers 5 points vectoriels filtres par `phoneNumber` + `type: conversation`, tries par `timestamp` descendant. Chaque point = 1 echange (message user + reponse agent). Permet au classifieur de comprendre si on est en train d'affiner un post ou si c'est une nouvelle demande.

4. **Classifier l'intention** (Gemini Flash via HTTP Request, temperature 0) — Prompt systeme court qui recoit le message + contexte recent et retourne un JSON :
   ```json
   { "intention": "rediger_post", "parametres": { "sujet": "...", "canal": "LinkedIn" } }
   ```
   Intentions possibles :
   - `noter_idee` -> WF-A
   - `rediger_post` -> WF-B (param intention=rediger_post)
   - `affiner_post` -> WF-B (param intention=affiner_post)
   - `valider_brouillon` -> WF-B (param intention=valider_brouillon)
   - `consulter_pipeline` -> WF-C (param mode=consulter)
   - `rechercher` -> WF-C (param mode=rechercher)
   - `valider_idee` -> WF-D
   - `marquer_publie` -> WF-D
   - `generer_visuel` -> WF-E
   - `conversation_libre` -> traite inline par WF-Main (Gemini Flash repond directement avec le contexte de session, sans sub-workflow)

5. **Dispatch** — Switch node sur `intention`, Execute Sub-workflow correspondant. Donnees transmises : texte du message, `phoneNumber`, `profilId` (mapping fixe mono-utilisateur), `intention`, parametres extraits, contexte de session. L'intention `conversation_libre` est traitee inline (Gemini Flash + contexte session → reponse directe).

6. **Sauvegarder l'echange** — Generer embedding via HTTP Request Gemini Embedding API (`text-embedding-004`), puis upsert dans Qdrant (type: conversation, phoneNumber, timestamp). Chaque point = 1 echange complet (message user + reponse agent).

7. **Repondre** — WhatsApp Send Message (texte). Si le sub-WF retourne une image (visuel fal.ai), envoyer aussi via WhatsApp Send Image.

### Classification affiner vs rediger

Le classifieur utilise le contexte de session. Si un brouillon est en cours (`type: draft` present dans Qdrant pour ce `phoneNumber`), les messages comme "plus court", "change l'accroche", "ajoute un exemple" sont classes `affiner_post`. Les confirmations ("ok", "c'est bon", "enregistre", "parfait") sont classees `valider_brouillon`.

## WF-A : Noter Idee

### Flux

```
Input (message, profilId)
  -> Gemini Flash : extraire titre + angle + canal suggere + tags
  -> Creer page Notion (base idees, Etat: "Nouvelle", Profil: relation)
  -> Generer embedding (HTTP Request Gemini Embedding API) + upsert Qdrant (type: idee)
  -> Retourner "Idee notee : {titre} - Canal suggere : {canal}"
```

### Comportement

- Le Flash analyse le message brut (ou la transcription du vocal) et structure l'idee
- Si le message est vague ("j'ai vu un truc cool sur le montage video IA"), il extrait quand meme un titre exploitable et suggere un angle
- Le canal est suggere selon le sujet (post court = LinkedIn, analyse longue = Substack Article, reaction rapide = Substack Notes)

## WF-B : Rediger Post

Le sub-workflow le plus complexe. Gere le cycle one-shot, affinage, validation, enregistrement. Recoit le parametre `intention` depuis WF-Main et branche en interne via un Switch node.

### Flux

**Si `rediger_post` :**
```
-> Charger profil Notion (variables)
-> Telecharger guide editorial + prompt du canal (GDrive)
-> Recherche Qdrant : posts recents similaires (anti-redondance semantique)
-> Gemini Pro : rediger le post complet
-> Sauvegarder brouillon dans Notion (base contenus, Etat: "Brouillon Agent", Canal)
-> Stocker le pageId du brouillon dans Qdrant (type: draft, phoneNumber, pageId)
-> Retourner le post dans WhatsApp
```

**Si `affiner_post` :**
```
-> Charger le draft actif depuis Qdrant (type: draft, phoneNumber) -> recuperer pageId
-> Lire le contenu du brouillon depuis Notion (via pageId)
-> Gemini Pro : appliquer la modification demandee (contexte = brouillon + demande)
-> Mettre a jour la page Notion (remplacer les blocs de contenu)
-> Retourner la version affinee
```

**Si `valider_brouillon` :**
```
-> Charger le draft actif depuis Qdrant -> recuperer pageId
-> Update Notion : Etat -> "Generes par IA" (entre dans le pipeline editorial standard)
-> Indexer le contenu final dans Qdrant (type: contenu, pageId, canal)
-> Supprimer le point draft de Qdrant
-> Retourner "Post enregistre dans Notion - pret pour relecture"
```

### Cycle de vie du statut

Le brouillon cree via WhatsApp suit le meme pipeline editorial que les contenus generes par WF2 Generator :
- `Brouillon Agent` (nouveau statut, reserve a l'agent WhatsApp — en cours d'affinage)
- `Generes par IA` (valide par l'utilisateur via WhatsApp, entre dans le pipeline standard)
- Puis le cycle normal : `A illustrer` -> `Valides` -> `Programmes` -> `Publies`

### Multi-canal

Le prompt de redaction est adapte au canal demande. Les prompts par canal sont stockes dans Google Drive et references depuis le profil Notion. Canaux supportes : LinkedIn, Substack Article, Substack Notes, Newsletter.

Si l'utilisateur demande "fais-moi aussi une version Substack", WF-B recoit le meme sujet avec un canal different et genere une version adaptee.

## WF-C : Consulter & Rechercher

### Mode consulter_pipeline

```
-> Requete Notion : contenus du mois en cours, groupes par statut
-> Gemini Flash : resumer en message lisible
-> Retourner "Cette semaine : 3 posts programmes, 2 en attente, 1 brouillon"
```

### Mode rechercher

```
-> Generer embedding du message (HTTP Request Gemini Embedding API)
-> Recherche semantique Qdrant (query vector, filter types: idee+contenu)
-> Si resultats : Gemini Flash formule une reponse naturelle avec les resultats
-> Si rien : "Je n'ai rien trouve sur ce sujet"
```

Exemples de requetes :
- "c'etait quoi l'outil IA pour le montage video ?" -> recherche semantique dans les idees
- "est-ce que j'ai deja parle de RGPD ?" -> recherche dans les contenus publies
- "retrouve mes idees sur le management" -> recherche filtree type=idee

## WF-D : Gerer Statuts

### Mode valider_idee

```
-> Recherche Qdrant ou Notion : trouver l'idee mentionnee
-> Update Notion : Etat -> "Confiees a l'IA"
-> Retourner "Idee '{titre}' validee, prete pour generation"
```

### Mode marquer_publie

```
-> Recherche Qdrant : trouver le post mentionne
-> Update Notion : Etat -> "Publies", Publication -> date du jour
-> Mettre a jour metadata Qdrant (etat -> Publies)
-> Retourner "Post '{titre}' marque comme publie"
```

### Evolution future

A terme, l'agent pourra programmer la publication directement sur LinkedIn via l'API LinkedIn. Cette fonctionnalite n'est pas dans le scope initial mais l'architecture le permet (ajout d'un sub-WF dedie).

## WF-E : Generer Visuel

### Routage interne

Deux modes de generation determines par le message ou par Gemini Flash :

| Mode | Declencheur | Modele fal.ai | Format | Cas d'usage |
|---|---|---|---|---|
| **Visuel LoRA** | "visuel avec moi", "photo de moi", "mets-moi en scene" | Flux LoRA | 3:4 | Alex en personnage celebre |
| **Infographie** | "infographie", "illustrer ce post", "design" | NanoBanana 2 | 3:4 | Infographie style marque |

### Flux Visuel LoRA

```
-> Charger le post concerne (Qdrant ou Notion)
-> Charger trigger LoRA depuis profil Notion
-> Gemini Flash : generer prompt Flux (personnage celebre lie au sujet, format 3:4)
   - Au moins 2 prompts sur 3 en style personnage celebre (preference Alex)
   - Le 3e peut etre plus classique
-> Appel fal.ai API via HTTP Request (Flux LoRA, aspect_ratio 3:4)
-> Upload image dans Google Drive (dossier visuels)
-> Envoyer image WhatsApp (via URL publique ou media upload)
-> Ajouter bloc image dans la page Notion (external URL depuis Google Drive)
```

### Flux Infographie

```
-> Charger le post concerne (Qdrant ou Notion)
-> Telecharger charte graphique (GDrive, URL depuis profil Notion)
-> Gemini Flash : generer prompt NanoBanana (donnees cles du post + style marque, format 3:4)
-> Appel fal.ai API via HTTP Request (NanoBanana 2, aspect_ratio 3:4)
-> Upload image dans Google Drive (dossier visuels)
-> Envoyer image WhatsApp
-> Ajouter bloc image dans la page Notion (external URL depuis Google Drive)
```

### Hebergement des images

Notion API ne supporte pas l'upload direct de fichiers. Les images generees sont :
1. Uploadees dans Google Drive (dossier dedie, permission "anyone with link")
2. Referencees dans Notion via un bloc `image` avec `external.url` pointant vers le lien Drive
3. Envoyees dans WhatsApp via l'URL Drive ou upload media WhatsApp API

## WF-Sync : Synchronisation Qdrant

### Cron quotidien (2h du matin)

```
-> Requeter Notion : pages modifiees depuis derniere sync (idees + contenus)
-> Pour chaque page modifiee : generer embedding (Gemini) + upsert vecteur dans Qdrant
-> Pour chaque page supprimee/archivee : supprimer vecteur
-> Purge : supprimer conversations > 30j
-> Log resultat
```

### Sync initiale

Premiere execution : charge toutes les idees et contenus Notion dans Qdrant. Les executions suivantes ne traitent que les deltas (pages modifiees depuis `last_edited_time` > derniere sync).

### Stockage du curseur de sync

Le timestamp de la derniere sync est stocke dans les `staticData` du workflow n8n (persistant entre executions).

## Integration Qdrant dans les workflows existants

**Phase 2** (apres que l'agent WhatsApp soit fonctionnel) : l'anti-redondance actuelle (query Notion des 10 derniers titres) sera remplacee par une recherche semantique Qdrant.

| Workflow | Changement | Avant | Apres |
|---|---|---|---|
| **WF2 Generator v2** | Anti-redondance | Query Notion 10 derniers titres | Recherche Qdrant par similarite sur le sujet a rediger |
| **WF1 Veille Hebdo v2** | Anti-redondance scoring | Liste titres dans le prompt | Recherche Qdrant top 10 contenus proches des sujets de veille |

WF3 Newsletter et WF4 Auto Publie ne sont pas impactes. Les workflows existants continuent de fonctionner avec l'anti-redondance Notion jusqu'a la Phase 2.

## Modele de donnees Qdrant

### Collection unique : `content_system`

Dimension : 768 (Gemini text-embedding-004). Distance : Cosine.

| Type | Source | Texte vectorise | Metadata |
|---|---|---|---|
| `idee` | Notion base idees | `{titre} - {angle}` | `pageId`, `canal`, `score`, `priorite`, `etat`, `profilId`, `createdAt` |
| `contenu` | Notion base contenus | `{titre} - {ideeDePost} - {canal}` | `pageId`, `canal`, `etat`, `profilId`, `publicationDate`, `createdAt` |
| `conversation` | WhatsApp echanges | `{message_user} {reponse_agent}` | `phoneNumber`, `intention`, `timestamp` |
| `draft` | Brouillons en cours | `{sujet} - {canal}` | `phoneNumber`, `canal`, `notionPageId`, `version`, `timestamp` |

### Generation d'embeddings

Tous les workflows generent les embeddings via **HTTP Request** vers l'API Gemini Embedding :
```
POST https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent
```
Avec le credential `googlePalmApi` existant. Retourne un vecteur de 768 dimensions.

Ce pattern est utilise dans : WF-Main (conversation), WF-A (idee), WF-B (contenu), WF-C (requete recherche), WF-Sync (batch).

### Filtres Qdrant courants

- Rechercher un post par sujet : `type=contenu, profilId=X`
- Retrouver une idee : `type=idee, profilId=X`
- Anti-redondance WF2 : `type=contenu, etat in [Publies, Programmes]`
- Charger brouillon en cours : `type=draft, phoneNumber=X`
- Historique conversation recent : `type=conversation, phoneNumber=X, timestamp > now-24h`

### Retention des vecteurs

| Type | Retention | Raison |
|---|---|---|
| `idee` | **Illimitee** | Second cerveau — toutes les idees restent accessibles |
| `contenu` | **Illimitee** | Meme logique : le second cerveau doit connaitre tout l'historique pour l'anti-redondance et la recherche. Cout negligeable (~45 Ko/contenu). |
| `conversation` | 30 jours | Ephemere, contexte conversationnel court terme |
| `draft` | Supprime apres validation | Transitoire par nature |

### Volumetrie estimee

~900 Ko/mois avant purge. ~15 Mo/an avec retention illimitee des idees et contenus. Tres loin du 1 GB gratuit Qdrant Cloud.

## Documents de reference (non vectorises)

Ces documents sont telecharges en temps reel depuis Google Drive a chaque execution et injectes en integralite dans les prompts. Pas de vectorisation, pas de cache. Si le Google Doc est modifie, la prochaine execution utilise automatiquement la version a jour.

- Guide editorial
- Prompts par canal (LinkedIn, Substack Article, Substack Notes, Newsletter)
- Reference newsletter
- Charte graphique (nouveau)

Le profil Notion reste la source de verite : il pointe vers les bons Google Docs via les proprietes URL.

## Gestion des erreurs

### Strategie par couche

**WF-Main (routeur) :**
- Si Whisper echoue : repondre "Je n'ai pas reussi a transcrire ce vocal, peux-tu reessayer ou l'ecrire en texte ?"
- Si le classifieur ne retourne pas un JSON valide : traiter comme `conversation_libre`
- Si un sub-workflow echoue : intercepter l'erreur, repondre "Une erreur est survenue, reessaie dans quelques instants"
- Si WhatsApp Send echoue : log dans l'Error Workflow, pas de retry (le message est perdu cote utilisateur)

**Sub-workflows (WF-A a WF-E) :**
- `onError: continueRegularOutput` + `alwaysOutputData: true` sur les nodes critiques (Notion API, Qdrant, fal.ai)
- Retry x2 avec backoff sur les HTTP Request (Gemini, Qdrant, fal.ai)
- En cas d'echec Qdrant (indexation) : le workflow continue et retourne le resultat a l'utilisateur. L'indexation sera rattrapee par WF-Sync lors de la prochaine sync.
- En cas d'echec Notion : retourner un message d'erreur explicite ("Impossible d'enregistrer dans Notion")

**WF-Sync :**
- `onError: continueRegularOutput` pour ne pas bloquer la sync sur une page en erreur
- Log des pages en erreur, retry lors de la prochaine sync
- Error Workflow global pour notification email si la sync echoue completement

### Error Workflow global

Tous les workflows utilisent le meme Error Workflow existant (`N8N_RESOURCE_ID_26`) pour notification par email en cas d'echec critique.

## Stack technique

| Composant | Technologie | Credential n8n |
|---|---|---|
| Orchestration | n8n (self-hosted) | — |
| Messaging | WhatsApp Business API (trigger natif n8n) | `whatsAppBusinessApi` (a creer) |
| LLM rapide | Gemini 2.5 Flash | `googlePalmApi` (existant) |
| LLM redaction | Gemini 2.5 Pro | `googlePalmApi` (existant) |
| Transcription | OpenAI Whisper (HTTP Request) | `httpHeaderAuth` OpenAI (a creer) |
| Base vectorielle | Qdrant Cloud (free tier 1 GB) | `qdrantApi` (a creer) |
| Embeddings | Gemini text-embedding-004 (HTTP Request) | `googlePalmApi` (existant) |
| Visuels LoRA | fal.ai + Flux LoRA (HTTP Request) | `httpHeaderAuth` fal.ai (a creer) |
| Infographies | fal.ai + NanoBanana 2 (HTTP Request) | `httpHeaderAuth` fal.ai (a creer) |
| Stockage contenu | Notion (HTTP Request) | Headers en dur (a migrer vers credential) |
| Stockage docs | Google Drive | `googleDriveOAuth2Api` (existant) |
| Email notifications | Gmail | `gmailOAuth2` (existant) |

## Utilisateur

Mono-utilisateur (Alex) pour le scope initial. Le mapping `phoneNumber -> profilId` est en dur dans WF-Main (Code node allowlist). L'architecture multi-profil est deja presente dans Notion (base profils), donc l'extension a d'autres utilisateurs est possible en rendant ce mapping dynamique (propriete "Telephone" sur le profil).

## Hors scope (evolutions futures)

- Publication automatique sur LinkedIn via API
- Support Signal (pas d'integration native n8n, necessiterait un bridge)
- Multi-utilisateur (mapping dynamique phoneNumber -> profilId)
- Analyse de performance des posts (engagement, impressions)
- Integration Qdrant dans WF1/WF2 existants (Phase 2, apres validation de l'agent)
