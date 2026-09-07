# REX Automatisations n8n

Retours d'experience sur chaque automatisation. Objectif : capitaliser sur les erreurs et leurs corrections pour ameliorer les prochaines implementations.

---

## 1. Meeting - Analyser et classer - CR Google Meet

**Workflow ID** : `N8N_RESOURCE_ID_32`
**Date** : 2026-02-17
**Statut** : En production

### Description

Automatisation complete du traitement des transcriptions Google Meet (Gemini transcript) :
- Detection nouveau fichier dans Google Drive (Meet Recordings)
- Extraction texte + analyse IA via Gemini API
- Brouillons Gmail personnalises par participant (strategiques, actionnables)
- Email recap a contact@example.com avec analyse approfondie et conseils contextuels
- Creation de taches Google Tasks
- Classement du fichier dans `/clients/{nom-client}/meetings/` avec renommage

### Erreurs rencontrees et corrections

#### 1. Extraction texte : fichiers Google Doc natifs != .docx

**Probleme** : Le node `extractFromFile` recevait du binaire brut (`PK\u0003\u0004` = header ZIP) au lieu du texte. Les fichiers Google Doc natifs ne sont pas de vrais .docx.

**Symptome** : Gemini recevait du garbage et hallucinait des reunions completement fictives (clients inventes, participants fictifs).

**Correction** : Ajouter `googleFileConversion` avec `docsToFormat: "text/plain"` sur le node de telechargement Google Drive.

**Lecon** : Toujours verifier le format reel des fichiers Google Drive. Les Google Docs natifs necessitent une conversion explicite a l'export.

#### 2. LangChain Basic LLM Chain perd les longs textes

**Probleme** : Meme apres correction de l'extraction (45K chars de texte correct confirme en input), le node Basic LLM Chain (LangChain) ne passait pas le contenu complet a Gemini. Gemini continuait a halluciner.

**Symptome** : Donnees correctes dans le node precedent, mais Gemini retournait des analyses completement fictives ("Societea", "GigaCorp").

**Correction** : Remplacement total du LLM Chain + Gemini Model par 3 nodes : Code (build prompt) -> HTTP Request (appel direct API Gemini) -> Code (parse response). Avec `responseMimeType: 'application/json'` pour forcer le JSON valide.

**Lecon** : Pour les prompts longs ou les cas critiques, preferer l'appel HTTP direct a l'API plutot que les nodes LangChain de n8n. Le controle est total sur ce qui est envoye.

#### 3. Gemini retourne des strings au lieu d'arrays

**Probleme** : `points_cles.map is not a function` — Gemini retournait parfois des strings au lieu d'arrays pour certains champs.

**Correction** : Helper `toArray()` dans tous les nodes Code qui consomment le JSON Gemini :
```javascript
const toArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);
```

**Lecon** : Ne jamais faire confiance au typage des outputs IA. Toujours normaliser avec un helper defensif.

#### 4. Connexions IF node corrompues (type "0"/"1" vs "main")

**Probleme** : Les connexions du node IF "Dossier meetings existe ?" avaient des types mixtes (`"0"`, `"1"`, `"main"`) qui empechaient le routage correct vers les branches true/false.

**Symptome** : Le fichier n'etait ni deplace ni renomme — les nodes en aval du IF ne s'executaient pas.

**Correction** :
1. `removeConnection` avec `ignoreErrors: true` pour nettoyer
2. `cleanStaleConnections` pour supprimer les references cassees
3. `addConnection` avec `branch: "true"` et `branch: "false"` (smart parameters)
4. `replaceConnections` pour remplacer l'integralite des connexions et eliminer les residus

**Lecon** : Toujours utiliser les smart parameters (`branch="true"/"false"`) pour les nodes IF via l'API n8n. En cas de corruption, `replaceConnections` est le moyen le plus fiable de repartir proprement.

#### 5. L'operation "move" de Google Drive ne renomme pas

**Probleme** : `options.name` sur l'operation `move` du node Google Drive v3 ne fait rien — ce parametre n'existe que pour les shared drives.

**Symptome** : Le fichier etait deplace dans le bon dossier mais gardait son nom original.

**Correction** : Ajout d'un node separe "Renommer fichier" avec `operation: "update"` et `newUpdatedFileName`. Le renommage se fait via l'operation `update`, pas `move`.

**Lecon** : Dans Google Drive node v3, le deplacement et le renommage sont deux operations distinctes. Verifier les proprietes disponibles par operation avec `get_node` + `search_properties` avant de configurer.

#### 6. Google Tasks sans titre

**Probleme** : Les taches creees n'avaient pas de titre visible — seul `additionalFields.notes` etait configure.

**Correction** : Ajout du champ `title: "={{ $json.titre }}"` + `additionalFields.dueDate` pour la date.

**Lecon** : Toujours verifier les champs requis des nodes de sortie, pas seulement les champs optionnels.

#### 7. Chercher dossier meetings : 0 resultats bloque le flux

**Probleme** : Quand le dossier `meetings/` n'existait pas, le node de recherche retournait 0 items et le node IF en aval ne s'executait pas.

**Correction** : `alwaysOutputData: true` sur le node de recherche Google Drive.

**Lecon** : Sur les nodes de recherche qui alimentent un IF, toujours activer `alwaysOutputData` pour que le flux continue meme avec 0 resultats.

#### 8. Client non identifie malgre texte correct

**Probleme** : La transcription contenait "durand.cnsl" alors que le Google Sheet avait "Durand Conseil". Le matching exact echouait.

**Correction** : Implementation d'un matching fuzzy avec normalisation (accents, casse, caracteres speciaux) et score de similarite (seuil 0.5).

**Lecon** : Les transcriptions vocales contiennent des erreurs phonetiques. Toujours prevoir un matching fuzzy pour les identifications basees sur du texte transcrit.

### Decisions d'architecture

| Decision | Raison |
|----------|--------|
| HTTP Request direct vs LangChain | Controle total sur le prompt, pas de troncature silencieuse |
| `responseMimeType: 'application/json'` | Force Gemini a retourner du JSON valide |
| Brouillons Gmail vs envoi direct | Permet a Alex de relire/modifier avant envoi |
| Deux niveaux d'email | Participants = strategique/actionnable, Alex = analyse approfondie + conseil |
| Langue adaptative | Detection auto fr/en, emails participants dans la langue de la reunion |
| Analyse contextuelle | Type de reunion detecte, conseils adaptes (commercial, suivi, kick-off...) |

### Points de vigilance pour la maintenance

- Le credential Gemini API (`N8N_RESOURCE_ID_06`) doit rester actif
- Le Google Sheet clients (`GOOGLE_DOC_ID_07`) doit contenir les colonnes : `Nom client`, `Domaine email`, `Dossier Drive ID`
- Les emails des participants ne sont pas toujours dans la transcription — les brouillons ne seront generes que si Gemini trouve un email
- Le dossier Meet Recordings (`GOOGLE_DOC_ID_15`) doit etre le bon dossier surveille

---

## 2. Error Handler - Notification erreurs workflows

**Workflow ID** : `N8N_RESOURCE_ID_28`
**Date** : 2026-02-17
**Statut** : En production

### Description

Workflow global de gestion d'erreurs : recoit les erreurs de tous les workflows configures et envoie une notification email HTML a contact@example.com avec les details (workflow, node en erreur, message, date, lien vers l'execution).

### Architecture

```
Error Trigger → Code (formater email HTML) → Gmail (envoyer alerte)
```

### Configuration

- Activer `errorWorkflow: "N8N_RESOURCE_ID_28"` dans les settings de chaque workflow a surveiller
- Le workflow doit rester actif en permanence
- Credential Gmail OAuth2 (`N8N_RESOURCE_ID_10`) partage avec les autres workflows

### Decisions d'architecture

| Decision | Raison |
|----------|--------|
| Email HTML avec tableau | Lisibilite rapide des infos cles |
| Lien direct vers l'execution | Permet de debugger immediatement dans n8n |
| Format sujet `[ERREUR] workflow — node` | Filtrable dans Gmail, identifiable d'un coup d'oeil |

---

---

## 3. Recrutement - Screener CV Automatique

**Workflow ID** : `N8N_RESOURCE_ID_30`
**Date** : 2026-02-22
**Statut** : En production
**Source** : [Nate Herk - Hiring Screener](https://www.youtube.com/watch?v=ig_Ie4MDXFo)

### Description

Screening automatique des CVs recus par email. Pipeline complet :
- Gmail Trigger filtre par label "Recrutement" (emails non lus)
- Upload du CV dans Google Drive (Recrutement/CVs/)
- Extraction texte (Word/PDF/TXT)
- Lecture dynamique de la fiche de poste depuis le dossier "Fiche Active"
- Analyse CV vs fiche de poste via Gemini 2.5 Flash (scoring structure JSON)
- Extraction nom/prenom/email du candidat via Gemini
- Enregistrement des resultats dans Google Sheet "Resume Screener"

### Erreurs rencontrees et corrections

#### 1. IF node "Verifier piece jointe" : $binary inaccessible

**Probleme** : Le node IF tentait de verifier la presence d'une piece jointe via `$json.attachment_0` (absent du JSON) puis `$binary.attachment_0` (inaccessible dans les conditions IF).

**Symptome** : Erreur `"Wrong type: '' is a string but was expecting an object"` — l'expression resolvait en chaine vide.

**Correction** : Suppression du node IF. Filtrage en amont via label Gmail "Recrutement" — seuls les emails pertinents declenchent le workflow.

**Lecon** : `$binary` n'est PAS accessible dans les conditions IF de n8n. Pour filtrer les emails avec PJ, utiliser un label Gmail en amont plutot qu'un IF dans le workflow.

#### 2. IF node "Fiche presente" : typeValidation strict casse silencieusement

**Probleme** : Le node IF avec `typeValidation: "strict"` routait vers FALSE meme quand `$json.id` contenait une valeur non vide.

**Symptome** : Le workflow s'arretait apres la recherche de fiche de poste — le IF routait toujours vers FALSE.

**Correction** : Suppression du node IF. Connexion directe Chercher fiche → Telecharger fiche. Si le dossier est vide, l'error handler captera.

**Lecon** : Toujours utiliser `typeValidation: "loose"` + `looseTypeValidation: true` sur les IF nodes. Le mode `strict` echoue silencieusement sur les valeurs venant d'expressions dynamiques.

#### 3. Gmail Trigger labelIds : nom vs ID interne

**Probleme** : `labelIds: ["Recrutement"]` retournait `"Invalid label: Recrutement"` car l'API Gmail exige l'ID interne du label (ex: `Label_123456`), pas le nom affiche.

**Symptome** : `400 Bad Request - Invalid label: Recrutement`

**Correction** : Configuration du label via l'UI n8n qui propose une liste deroulante avec resolution automatique des IDs.

**Lecon** : Le champ `labelIds` du Gmail Trigger exige l'ID interne Gmail. Toujours configurer via l'UI n8n, pas via l'API MCP.

#### 4. Connexions IF node : tableau main incomplet

**Probleme** : Le IF node "Fiche presente" avait une seule entree dans le tableau `main` des connexions (TRUE). Sans le tableau vide pour FALSE, n8n ne routait pas correctement.

**Symptome** : Le workflow s'arretait au IF malgre un output valide.

**Correction** : Ajout du tableau vide `[]` pour la branche FALSE : `"main": [[{to: next}], []]`.

**Lecon** : Les IF nodes doivent TOUJOURS avoir 2 entrees dans le tableau `main` des connexions — meme si la branche FALSE ne va nulle part, elle doit etre declaree comme tableau vide.

#### 5. Gmail node getAll ne telecharge pas les pieces jointes en binaire

**Probleme** : Apres remplacement du Gmail Trigger par un Schedule Trigger + Gmail `getAll` (message, downloadAttachments: true), le node suivant (Upload Drive) echouait : `"binary file 'attachment_0' not found"`.

**Symptome** : L'email etait bien recupere (JSON complet avec id, subject, etc.) mais aucune donnee binaire n'etait presente dans l'output.

**Correction** : Retour au Gmail Trigger qui gere correctement le telechargement des PJ en binaire. Poll configure a "Every Day" a 8h pour un declenchement quotidien. Ajout d'un node Gmail `markAsRead` en fin de chaine pour eviter les doublons.

**Lecon** : Le Gmail node `getAll` ne telecharge PAS les pieces jointes en binaire de maniere fiable. Pour les workflows qui necessitent les PJ, toujours utiliser le **Gmail Trigger** (qui gere correctement les binaires). Le Gmail Trigger supporte `pollTimes` avec mode "Every Day" + heure specifique.

### Decisions d'architecture

| Decision | Raison |
|----------|--------|
| Label Gmail "Recrutement" vs IF attachment | Filtrage propre en amont, pas d'erreurs sur emails sans PJ |
| Dossier "Fiche Active" (1 fichier) | Flexibilite : changer de poste = remplacer le fichier |
| Gemini HTTP Request direct | Meme pattern que le workflow Meeting, controle total |
| Pas d'IF "Fiche presente" | Simplicite — un fichier doit toujours etre present |
| Google Sheets append | Historique complet des screenings, pas de remplacement |
| Gmail Trigger vs Schedule + getAll | Le Gmail Trigger gere les PJ en binaire, pas le getAll |
| markAsRead en fin de chaine | Evite le retraitement des emails deja analyses |
| Poll "Every Day" a 8h | Un seul screening par jour, pas de surcharge |

### Points de vigilance pour la maintenance

- Le dossier "Fiche Active" (`GOOGLE_DOC_ID_12`) doit toujours contenir exactement 1 fichier
- Le label Gmail "Recrutement" doit exister et etre applique aux emails de candidature
- La Google Sheet "Resume Screener" (`GOOGLE_DOC_ID_11`) doit avoir les 11 colonnes attendues
- Le workflow est desactive par defaut — activer une fois valide
- Les emails traites sont marques comme lus — ne pas les remettre en non lu manuellement

---

## 4. Gmail - Inbox Genie

**Workflow ID** : `N8N_RESOURCE_ID_01`
**Date** : 2026-02-23
**Statut** : En production
**Source** : Adapte de [Gmail Inbox Genie](https://n8n.io/workflows/) (Nate Herk)

### Description

Tri automatique quotidien des emails non lus de contact@example.com :
- Classification batch de tous les emails via Gemini 2.5 Flash (1 seul appel API)
- Application des labels Gmail (Client, Prospect, Admin, Newsletter, Cold Email, Notification)
- Generation de brouillons de reponse pour les emails necessitant une reponse (avec profil business + exemples de style)
- Logging dans Google Sheets (1 ligne par email)
- Marquage des emails comme lus

### Architecture

```
Schedule Trigger (8h, quotidien)
  → Gmail getAll (max 50 non lus, exclut Recrutement + from:me)
  → Lire profil business (Google Doc, executeOnce)
  → Construire prompt batch (body tronque a 500 chars)
  → Gemini classification batch (1 appel pour N emails)
  → Parser + Recuperer labels Gmail → Mapper
  → 4 branches paralleles :
      ├── Labelliser email (addLabels)
      ├── IF needsReply → Gemini brouillon → Gmail draft
      ├── Logger dans Stats (Google Sheets append)
      └── Marquer email lu (markAsRead)
```

### Erreurs rencontrees et corrections

#### 1. gmailTrigger ne retourne qu'1 email par execution manuelle

**Probleme** : Le node `gmailTrigger` utilise l'API History de Gmail et ne retournait qu'1 email par execution, meme avec plusieurs emails non lus.

**Symptome** : A chaque test, seul le dernier email recu etait traite, les autres etaient ignores.

**Correction** : Remplacement du `gmailTrigger` par un `scheduleTrigger` + `Gmail getAll` (operation getAll, limit 50, filtre unread + exclut Recrutement + from:me).

**Lecon** : Le `gmailTrigger` est concu pour le temps reel (polling incremental via historyId). Pour un traitement batch quotidien de TOUS les non-lus, preferer `scheduleTrigger` + `Gmail getAll`. Exception : si on a besoin des PJ en binaire, le gmailTrigger reste necessaire.

#### 2. Gmail addLabels ecrase les donnees custom en sortie

**Probleme** : Le node Gmail `addLabels` retourne la reponse API Gmail (`id`, `threadId`, `labelIds`), pas les donnees d'entree. Tous les nodes en aval perdaient les champs custom (emailId, label, needsReply, etc.).

**Symptome** : markAsRead echouait ("Invalid id value"), Logger dans Stats avait des colonnes vides, IF needsReply routait tout en FALSE.

**Correction** : Restructuration des connexions — les 4 branches (Labelliser, IF, Logger, markAsRead) partent toutes en parallele depuis "Mapper et appliquer labels" au lieu de se chainer apres "Labelliser email".

**Lecon** : Les nodes Gmail action (addLabels, markAsRead, send) remplacent `$json` par leur propre reponse API. Ne jamais chainer de nodes dependant de donnees custom apres un node Gmail action. Utiliser des branches paralleles depuis le dernier node qui contient toutes les donnees.

#### 3. Gmail Trigger simple:false — from est un objet, pas une string

**Probleme** : Avec `simple: false`, `email.from` est un objet `{value: [{address, name}], text: "..."}` et non une string. `email.headers?.from` contient le header MIME brut avec prefix "From: " et encodage =?utf-8?B?...?=.

**Symptome** : Le champ "De" dans la Sheet affichait `[object Object]` ou du MIME encode. Les sujets avec accents affichaient `=?utf-8?B?...?=`.

**Correction** : Utiliser `email.subject` (string decodee) et `email.from?.text` (format "Nom <email>") au lieu des headers bruts.

**Lecon** : Avec `simple: false` sur Gmail Trigger/getAll, toujours utiliser les champs racine (`subject`, `from.text`, `to.text`) et non `headers.*` qui contiennent du MIME brut encode.

#### 4. Profil business charge N fois pour N emails

**Probleme** : Le node "Chercher profil business" s'executait pour chaque item (50 emails = 50 recherches Drive identiques).

**Symptome** : Temps d'execution excessif (le workflow mettait trop longtemps sur la phase profil business).

**Correction** : Ajout de `executeOnce: true` sur le node "Chercher profil business".

**Lecon** : Les donnees de configuration globales (profil, templates, parametres) doivent toujours avoir `executeOnce: true` pour eviter les appels redondants. Penser "config vs donnees" : ce qui est identique pour tous les items = executeOnce.

### Decisions d'architecture

| Decision | Raison |
|----------|--------|
| Schedule + Gmail getAll (pas gmailTrigger) | Batch fiable de tous les non-lus, pas de dependance a historyId |
| Gemini HTTP Request direct (pas LangChain) | Controle total, pas de troncature silencieuse |
| Batch classification (1 appel pour N emails) | Economie API, coherence de classification |
| Body tronque a 500 chars pour classifier | Evite les prompts trop longs, sujet+debut suffisent |
| Profil business dans Google Doc Drive | Editable sans toucher au workflow, reutilisable |
| executeOnce sur profil business | Config globale, pas besoin de relire pour chaque email |
| 4 branches paralleles depuis Mapper | Evite la perte de donnees par les nodes Gmail action |
| Stats via formules Sheet (pas de node) | Moins de nodes, toujours a jour, zero maintenance |
| markAsRead apres tout le traitement | Reprise automatique en cas d'echec |
| Exclure label Recrutement + from:me | Cohabitation propre avec Screener CV, pas d'auto-emails |

### Ressources

| Ressource | ID |
|-----------|-----|
| Workflow | `N8N_RESOURCE_ID_01` |
| Google Sheet Stats | `GOOGLE_DOC_ID_09` |
| Google Doc Profil Business | `GOOGLE_DOC_ID_02` |
| Dossier Drive Profil Business | `GOOGLE_DOC_ID_13` |
| Error Workflow | `N8N_RESOURCE_ID_28` |
| Gmail OAuth2 | `N8N_RESOURCE_ID_10` |
| Gemini API | `N8N_RESOURCE_ID_06` |

### Points de vigilance pour la maintenance

- Le Google Doc "Mon Profil Business" doit etre maintenu a jour (services, ton, exemples d'emails)
- Les 6 labels Gmail doivent exister (Client, Prospect, Admin, Newsletter, Cold Email, Notification)
- Le label "Recrutement" doit exister pour la cohabitation avec le Screener CV
- La Google Sheet doit avoir les 7 colonnes : Date, De, Sujet, Labels, Needs Reply, Brouillon cree, Reason
- Limite a 50 emails par execution — suffisant pour un traitement quotidien
- Depuis le 2026-02-23, Inbox Genie lit la FAQ Base (Google Sheets) et l'injecte dans le prompt de generation des brouillons (node "Lire FAQ Base" avec `executeOnce: true`)

---

## 5. Gmail - FAQ Builder

**Workflow ID** : `N8N_RESOURCE_ID_08`
**Date** : 2026-02-23
**Statut** : En production
**Source** : Adapte de [Support Autopilot & FAQ Builder](https://n8n.io/workflows/) (Nate Herk)

### Description

Construction automatique d'une base FAQ a partir des threads email ou Alex a repondu :
- Schedule Trigger quotidien a 10h (apres Inbox Genie a 8h)
- Gmail getAll des messages labels Client/Prospect sans label FAQ
- Deduplication par threadId (Gmail retourne des messages, pas des threads)
- Lecture profil business (Google Doc Drive)
- Get thread complet Gmail + extraction question client / reponse Alex
- Reecriture FAQ par Gemini 2.5 Flash (question generique + reponse concise)
- Sauvegarde dans Google Sheets "FAQ Base" + label Gmail "FAQ"

**Enrichissement Inbox Genie** : Inbox Genie lit maintenant la FAQ Base et l'injecte dans le prompt de generation des brouillons de reponse.

### Architecture

```
Schedule Trigger (10h, quotidien)
  → Gmail getAll : (label:Client OR label:Prospect) -label:FAQ
  → Dedupliquer par thread (Code node)
  → Lire profil business (Google Doc Drive)
  → Pour chaque thread :
      → Gmail Get Thread (messages complets)
      → Extraire question client + reponse Alex (Code)
      → Gemini reformuler en FAQ (HTTP Request, JSON)
      → Parser reponse Gemini
      → 2 branches paralleles :
          ├── Google Sheets append (FAQ Base)
          └── Gmail addLabel "FAQ" (marqueur)
```

### Erreurs rencontrees et corrections

#### 1. Gmail search `from:me` + `label:X` ne matche rien ensemble

**Probleme** : La recherche `(label:Client OR label:Prospect) from:me -label:FAQ` retournait 0 resultats. Les labels sont au niveau thread, mais `from:me` filtre au niveau message — aucun message individuel ne satisfait les deux criteres simultanement.

**Symptome** : Le workflow s'executait avec succes mais n'avait aucun thread a traiter.

**Correction** : Retrait de `from:me` de la requete. Le workflow recupere tous les messages des threads Client/Prospect sans FAQ, puis identifie la question et la reponse dans le code d'extraction.

**Lecon** : Gmail search melange criteres thread-level (labels) et message-level (from:). Ne jamais combiner `from:me` avec des labels dans une seule requete — filtrer dans le code apres recuperation.

#### 2. Gmail `messages.list` retourne des messages, pas des threads

**Probleme** : `Gmail getAll` (resource: message) retourne des messages individuels. Un thread avec 3 messages genere 3 items, dont 2-3 peuvent matcher la requete.

**Symptome** : Le meme thread etait traite plusieurs fois, generant des doublons dans la FAQ.

**Correction** : Ajout d'un node Code "Dedupliquer par thread" qui filtre par `threadId` (Set + premier vu).

**Lecon** : Toujours dedupliquer par `threadId` quand on utilise `Gmail getAll` avec `resource: message` pour un traitement au niveau thread.

#### 3. Gmail Thread GET : champs `From`/`Subject` capitalises

**Probleme** : L'API Gmail Thread GET retourne `From` (majuscule) comme string, alors que `Gmail getAll` retourne `from` (minuscule) comme objet `{value: [{address, name}], text: "..."}`.

**Symptome** : Le code cherchait `msg.from` qui etait `undefined`, l'extraction question/reponse echouait.

**Correction** : Double fallback dans le code : `msg.From || msg.from || ''` avec detection du type (string vs objet).

**Lecon** : Les deux APIs Gmail (messages vs threads) ont des formats de sortie differents pour les memes champs. Toujours prevoir un double fallback avec detection de type.

#### 4. Thread GET retourne des snippets tronques (~200 chars)

**Probleme** : `msg.snippet` du thread GET est tronque a ~200 caracteres. Le corps complet de la question n'etait pas passe a Gemini.

**Symptome** : Gemini generait des FAQ vagues car la question etait incomplete.

**Correction** : Utilisation de `emailSource.text` (corps complet depuis la recherche Gmail `simple: false`) pour le corps de la question, fallback sur `msg.snippet`.

**Lecon** : Les messages dans un thread GET n'ont que des `snippet` tronques. Pour le corps complet, utiliser le message original depuis `Gmail getAll` avec `simple: false`.

#### 5. `executeOnce: true` bloque les items dans une chaine lineaire

**Probleme** : Le node "Chercher profil business" avait `executeOnce: true` et etait dans la chaine lineaire (Search → Dedup → Drive → ... → Thread GET). Seul le premier item passait.

**Symptome** : Sur 4 threads uniques, seul le premier etait traite. Les 3 autres etaient silencieusement ignores.

**Correction** : Retrait de `executeOnce` sur ce node. Le Drive search s'execute pour chaque item (idempotent, meme fichier retourne).

**Lecon** : `executeOnce: true` est adapte pour les branches paralleles ou les nodes de config (ex: Recuperer labels Gmail). Dans une chaine lineaire, il bloque le passage des items suivants. Utiliser `executeOnce` uniquement quand le node n'est PAS dans le chemin de donnees principal.

#### 6. Categorie extraite de `originalSubject` au lieu des labels

**Probleme** : Le Parser FAQ utilisait `data.originalSubject` pour la categorie au lieu d'extraire Client/Prospect des labels du message.

**Symptome** : La colonne "Categorie" dans la FAQ Base contenait le sujet de l'email au lieu de "Client" ou "Prospect".

**Correction** : Extraction de la categorie depuis `msg.labels` dans le code d'extraction, passage via `data.categorie` au Parser.

**Lecon** : Toujours verifier que chaque champ est mappe correctement dans toute la chaine. Un `data.field` incorrect se propage silencieusement.

### Decisions d'architecture

| Decision | Raison |
|----------|--------|
| Workflow separe (pas integre dans Inbox Genie) | Separation des responsabilites, horaires differents |
| Schedule 10h (pas trigger) | Laisse le temps de repondre aux emails apres Inbox Genie (8h) |
| Google Sheets (pas Notion) | Meme ecosysteme, pas de nouveau service |
| Toute la FAQ dans le prompt Gemini | Simple, suffisant < 200 entrees |
| Label "FAQ" comme marqueur | Evite le retraitement, visible dans Gmail |
| Gemini HTTP Request direct | Pattern eprouve, pas de LangChain |
| Deduplication par threadId | Gmail retourne des messages, pas des threads |
| Profil business sans executeOnce | Chaine lineaire, doit laisser passer tous les items |

### Ressources

| Ressource | ID |
|-----------|-----|
| Workflow | `N8N_RESOURCE_ID_08` |
| Google Sheet FAQ Base | `GOOGLE_DOC_ID_10` |
| Label Gmail "FAQ" | `<GMAIL_LABEL_ID>` |
| Google Doc Profil Business | `GOOGLE_DOC_ID_02` |
| Dossier Drive Profil Business | `GOOGLE_DOC_ID_13` |
| Error Workflow | `N8N_RESOURCE_ID_28` |
| Gmail OAuth2 | `N8N_RESOURCE_ID_10` |
| Gemini API | `N8N_RESOURCE_ID_06` |
| Google Sheets | `N8N_RESOURCE_ID_03` |
| Google Drive | `N8N_RESOURCE_ID_18` |

### Points de vigilance pour la maintenance

- Le label Gmail "FAQ" (`<GMAIL_LABEL_ID>`) doit exister — cree en one-shot
- Les labels "Client" et "Prospect" doivent etre appliques par Inbox Genie en amont
- La FAQ Base ne doit pas depasser ~200 entrees pour rester injectee en entier dans le prompt Inbox Genie
- Le workflow est desactive par defaut — activer une fois valide
- Les threads sans label "FAQ" seront automatiquement repris le lendemain en cas d'echec

---

## 7. Diagnostic - Generer Rapport

**Workflow ID** : `N8N_RESOURCE_ID_04`
**Date** : 2026-04-12
**Statut** : En production

### Description

Generation automatique de rapports de diagnostic IA marketing personnalises. Quand un prospect complete le questionnaire sur example.com (17 questions, 5 dimensions), le workflow :
- Recoit les scores via webhook (fire-and-forget depuis le JS du diagnostic)
- Scrape l'entreprise via Perplexity sonar-pro (secteur, services, clients, enjeux)
- Genere une analyse personnalisee via 2 appels Gemini 3 Pro Preview (analyse dimensions + plan d'action)
- Genere un mot de passe unique pour l'acces au rapport
- Stocke le rapport dans Supabase (table `diagnostic_reports`)
- Met a jour le contact Brevo (6 attributs : password, date, niveau, forces, faiblesses, synthese)
- Ajoute le contact a la liste 9 ("Rapport pret") qui declenche l'automation email Brevo (4 emails J+0 a J+14)

### Architecture

```
Webhook → Valider payload (IF) → Extraire domaine email (Code)
  → Rechercher entreprise Perplexity (HTTP Request)
  → Preparer prompt Gemini (Code)
  → Analyser dimensions (Gemini #1)
  → Generer plan action (Gemini #2)
  → Structurer rapport (Code : password + JSON final)
  → Stocker rapport Supabase (HTTP Request upsert)
  → Mettre a jour contact Brevo (HTTP Request PUT)
  → Ajouter a liste Rapport pret (HTTP Request POST liste 9)
```

11 nodes actifs + 1 sticky note. Temps d'execution moyen : 60-80s (Perplexity ~5s + Gemini #1 ~25-35s + Gemini #2 ~25-35s).

### Lecons apprises

#### Perplexity > Jina pour le scraping entreprise
- Jina Reader (site web) + Jina Search donnaient des resultats pauvres et peu structures
- Perplexity sonar-pro retourne un JSON structure avec citations verifiables en un seul appel
- Perplexity wrappe souvent sa reponse dans des backticks markdown (` ```json ... ``` `) : nettoyer avant `JSON.parse()`
- Toujours demander a Perplexity de deduire les enjeux sectoriels meme s'il n'a pas d'info directe

#### Prompting Gemini 3 Pro Preview — bonnes pratiques
- Utiliser `systemInstruction` (role + regles) separe de `contents` (donnees) : meilleur suivi des consignes
- Temperature a 1.0 (recommande par Google pour Gemini 3, pas de benefice a baisser)
- Structure avec balises XML (`<prospect>`, `<contexte_entreprise>`, `<scores>`, `<questionnaire>`)
- Donnees d'abord, instructions a la fin ("Based on all the information above...")
- Descriptions detaillees dans le `responseSchema` pour guider chaque champ
- Instructions positives ("utilise systematiquement le contexte") au lieu de negatives ("ne dis jamais que le secteur est inconnu")
- Anti-repetition : "Varie les elements du contexte. Si tu as mentionne un element dans une section, utilises-en un different dans la suivante."
- Fournir les questions du questionnaire a Gemini, pas juste les scores — sinon l'analyse est generique

#### Merge node v3 incompatible avec mergeByPosition
- Le Merge node v3.2 en mode `combine` exige des champs de correspondance — plus de merge by position
- Solution : supprimer le Merge et connecter les 2 inputs directement au Code node suivant (n8n attend que les 2 inputs arrivent)

#### Supabase — colonnes vs JSONB
- La table utilise des colonnes individuelles pour les scores (numeric 2,1) et non un JSONB scores
- La colonne `analyse` est un mot reserve PostgreSQL : toujours l'utiliser entre guillemets dans le SQL
- RLS active : n8n utilise `service_role_key` pour bypass, le front passe par une Edge Function
- Ne pas envoyer de champs supplementaires (ex: `brevoExtra`) dans le body Supabase — erreur "column not found"

#### Brevo — ajout liste = appel separe
- Le PUT `/v3/contacts/{email}` met a jour les attributs mais n'ajoute PAS a une liste
- L'ajout a la liste 9 necessite un appel POST separe `/v3/contacts/lists/9/contacts/add`
- L'ordre est critique : Supabase → Brevo PUT (password) → Brevo POST (liste 9)
- Le contact doit exister dans Brevo avant que n8n le mette a jour (cree par le formulaire du site)

#### Credential `googlePalmApi` utilisable pour HTTP Request
- Le credential type `googlePalmApi` fonctionne directement avec les nodes HTTP Request (pas seulement les nodes LangChain)
- Pas besoin de creer un `httpQueryAuth` separe pour Gemini

### Infrastructure associee

- **Supabase** : projet `<SUPABASE_PROJECT_REF>`, table `diagnostic_reports`, Edge Function `diagnostic-auth`
- **Brevo** : liste 6 (diagnostic), liste 9 (rapport pret), automation 4 emails, 6 attributs custom
- **example.com** : page rapport `diagnostic/rapport/`, webhook dans le JS du diagnostic
- **Credentials n8n** : `brevoApi` (`N8N_RESOURCE_ID_20`), `supabaseServiceRole` (`N8N_RESOURCE_ID_12`), `googlePalmApi` (`N8N_RESOURCE_ID_06`), `Perplexity API` (`N8N_RESOURCE_ID_17`)

### Points de vigilance pour la maintenance

- L'URL du webhook est hardcodee dans le JS du diagnostic example.com — si elle change, mettre a jour le JS
- Le free tier Supabase suffit largement pour le volume de diagnostics
- Les prompts Gemini sont hardcodes dans les nodes — si le questionnaire change, mettre a jour les prompts
- Perplexity sonar-pro a un cout par appel (~0.01$ par requete) — surveiller la consommation
- Si un prospect refait le diagnostic avec le meme email, le rapport est ecrase (upsert) et un nouveau mot de passe est genere

### Correctif anti-hallucination (2026-07-14)

**Incident** : un prospect avec une adresse pro mais sans site web (`contact@durand-conseil.fr`) a recu un rapport ou l'IA a hallucine l'activite de son entreprise (secteur, produits, clients inventes).

**Cause racine (chaine)** :
1. `Extraire domaine email` traitait le domaine de l'email (`durand-conseil.fr`) comme le site web de l'entreprise, sans jamais verifier qu'un site existe.
2. `Rechercher entreprise Perplexity` recevait un prompt qui *forcait* un profil complet meme sans source reelle. Perplexity inventait un profil plausible a partir du seul domaine.
3. `Analyser dimensions` (Gemini) avait pour regle d'utiliser SYSTEMATIQUEMENT le contexte entreprise dans chaque section. Les faits inventes etaient donc marteles dans tout le rapport (amplificateur d'hallucination).

**Correctif (4 nodes, garde-fous en couches, tout dans n8n)** :
- `Extraire domaine email` : test de vie reel du domaine via `this.helpers.httpRequest` (GET https puis http, statut 200-399 + corps > 500 octets) qui produit `siteActif` / `siteUrlVerifiee`. Objectif, pas declaratif : attrape aussi domaine parke, mort, homonyme.
- `Rechercher entreprise Perplexity` : prompt honnete, autorise a renvoyer `{"found": false}` sans inventer ; ne cherche vraiment que si `siteActif`. Temperature passee a 0.
- `Preparer prompt Gemini` (le verrou) : contexte entreprise utilise UNIQUEMENT si `siteActif === true && found !== false`. Sinon `contexteDisponible=false`, `contexte_entreprise=null` stocke en base, et `contexteTexte` porte une consigne explicite de ne rien supposer.
- `Analyser dimensions` + `Generer plan action` : suppression de l'injection forcee, remplacee par une regle anti-hallucination (jamais affirmer un fait entreprise absent du contexte ; sans contexte verifie, analyse fondee uniquement sur les scores, qui restent toujours fiables car issus du questionnaire).

**Teste sur copie isolee** (chemin webhook distinct, queue Supabase/Brevo coupee) : `durand-conseil.fr` -> rapport 100% base sur les scores, zero invention ; `n8n.io` -> enrichissement reel et prudent.

**Deploiement** : backup du live avant modif (`workflows/backups/diagnostic-generer-rapport_backup_2026-07-14.json`), puis `PUT` sur le live `N8N_RESOURCE_ID_04` via API publique n8n (le MCP n8n n'est pas charge dans une session rootee sur `<repo-marque>/`). Rollback = re-`PUT` du backup.

**Reste a faire (hors correctif)** : renvoyer un rapport corrige a `contact@durand-conseil.fr` (a deja recu un faux) ; auditer les rapports Supabase passes generes sans site reel pour reperer les autres hallucinations.

---

*Derniere mise a jour : 2026-07-14*
