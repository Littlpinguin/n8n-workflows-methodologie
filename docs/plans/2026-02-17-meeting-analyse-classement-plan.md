# Meeting - Analyser et classer - Comptes rendus Google Meet — Plan d'implémentation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Workflow n8n qui analyse automatiquement les transcriptions Google Meet, envoie des emails personnalisés aux participants, crée des tâches Google Tasks, et classe les fichiers dans les dossiers clients.

**Architecture:** Pipeline linéaire déclenché par Google Drive Trigger. Un appel Gemini avec Structured Output Parser produit un JSON structuré. Les sorties sont parallélisées : emails participants, email récap, Google Tasks, classement Drive.

**Tech Stack:** n8n, Google Drive Trigger, Google Drive, Google Sheets, Basic LLM Chain + Google Gemini Chat Model + Structured Output Parser, Gmail, Google Tasks, Code nodes pour la logique de classement.

**Design doc:** `docs/plans/2026-02-17-meeting-analyse-classement-design.md`

---

### Task 1 : Créer le workflow avec le trigger et l'extraction de la transcription

**Nodes à créer :**
- `Détecter nouvelle transcription` — Google Drive Trigger (typeVersion 1)
- `Télécharger transcription` — Google Drive (typeVersion 3, operation: download)
- `Extraire texte` — Extract From File (typeVersion 1)

**Step 1 : Créer le workflow vide avec le trigger**

Créer via `n8n_create_workflow` :
- Nom : `Meeting - Analyser et classer - CR Google Meet`
- Node `Détecter nouvelle transcription` :
  - type: `n8n-nodes-base.googleDriveTrigger`, typeVersion: 1
  - triggerOn: `specificFolder`
  - event: `fileCreated`
  - folderToWatch: ID du dossier Meet Recordings (à configurer par l'utilisateur)
  - credentials: `googleDriveOAuth2Api` (contact@example.com)

**Step 2 : Ajouter le téléchargement du fichier**

Via `n8n_update_partial_workflow` (addNode) :
- Node `Télécharger transcription` :
  - type: `n8n-nodes-base.googleDrive`, typeVersion: 3
  - resource: `file`, operation: `download`
  - fileId: `={{ $json.id }}` (ID du fichier détecté par le trigger)
- Connexion : `Détecter nouvelle transcription` → `Télécharger transcription`

**Step 3 : Ajouter l'extraction de texte**

Via `n8n_update_partial_workflow` (addNode) :
- Node `Extraire texte` :
  - type: `n8n-nodes-base.extractFromFile`, typeVersion: 1
  - operation: `text` (ou `pdf` selon le format Gemini transcript)
- Connexion : `Télécharger transcription` → `Extraire texte`

**Step 4 : Vérifier**

Valider le workflow via `n8n_validate_workflow`. Corriger les erreurs éventuelles.

---

### Task 2 : Ajouter le lookup Google Sheet clients

**Nodes à créer :**
- `Récupérer liste clients` — Google Sheets (typeVersion 4.7, operation: read)

**Prérequis utilisateur :** Créer un Google Sheet avec les colonnes :
| Nom client | Domaine email | Dossier Drive ID |
|------------|---------------|-------------------|
| Acme Corp  | acme.com      | 1xYz...           |

**Step 1 : Ajouter le node Google Sheets**

Via `n8n_update_partial_workflow` (addNode) :
- Node `Récupérer liste clients` :
  - type: `n8n-nodes-base.googleSheets`, typeVersion: 4.7
  - operation: `read`
  - documentId: (ID du Google Sheet — à configurer par l'utilisateur)
  - sheetName: (nom de l'onglet — à configurer)
  - range: `A:C`
  - credentials: `googleSheetsOAuth2Api`
- Connexion : `Extraire texte` → `Récupérer liste clients`

**Step 2 : Ajouter un node Merge pour combiner transcription + clients**

Via `n8n_update_partial_workflow` (addNode) :
- Node `Combiner données` :
  - type: `n8n-nodes-base.code`, typeVersion: 2
  - Langue: JavaScript
  - Code :
```javascript
const transcription = $('Extraire texte').first().json.data;
const clients = $('Récupérer liste clients').all().map(item => ({
  nom: item.json['Nom client'],
  domaine: item.json['Domaine email'],
  dossierId: item.json['Dossier Drive ID']
}));
const fichierOriginalId = $('Détecter nouvelle transcription').first().json.id;
const fichierOriginalNom = $('Détecter nouvelle transcription').first().json.name;

return [{
  json: {
    transcription,
    clients: JSON.stringify(clients),
    fichierOriginalId,
    fichierOriginalNom
  }
}];
```
- Connexion : `Récupérer liste clients` → `Combiner données`

Note : le node Code reçoit en entrée les données de `Récupérer liste clients` et accède aux données des nodes précédents via `$('nodeName')`.

**Step 3 : Vérifier**

Valider le workflow via `n8n_validate_workflow`.

---

### Task 3 : Ajouter l'analyse Gemini avec Structured Output Parser

**Nodes à créer :**
- `Analyser transcription` — Basic LLM Chain (typeVersion 1.9)
- `Modèle Gemini` — Google Gemini Chat Model (typeVersion 1)
- `Format JSON` — Structured Output Parser (typeVersion 1.3)

**Step 1 : Ajouter le Basic LLM Chain**

Via `n8n_update_partial_workflow` (addNode) :
- Node `Analyser transcription` :
  - type: `@n8n/n8n-nodes-langchain.chainLlm`, typeVersion: 1.9
  - promptType: `define`
  - text (prompt) :
```
Tu es un assistant spécialisé dans l'analyse de comptes rendus de réunion.

Voici la transcription d'une réunion Google Meet :
---
{{ $json.transcription }}
---

Voici la liste des clients connus avec leurs domaines email :
{{ $json.clients }}

INSTRUCTIONS :
1. Identifie le client concerné par cette réunion en matchant les domaines email des participants avec la liste ci-dessus.
2. Pour chaque participant, déduis son rôle probable à partir de ce qu'il dit dans la réunion.
3. Extrais un résumé concis des points principaux.
4. Pour chaque participant, liste ses points clés et les actions qui lui sont assignées.
5. Liste séparément les actions assignées à Alex (contact@example.com) et les points qu'il doit creuser.
6. Si le client n'est pas identifiable, mets "INCONNU" dans le champ client.

Réponds UNIQUEMENT avec le JSON structuré demandé.
```
  - messages.messageValues : système message = "Tu analyses des transcriptions de réunion et produis un JSON structuré. Sois précis et factuel."
- Connexion : `Combiner données` → `Analyser transcription`

**Step 2 : Ajouter le modèle Gemini (sub-node)**

- Node `Modèle Gemini` :
  - type: `@n8n/n8n-nodes-langchain.lmChatGoogleGemini`, typeVersion: 1
  - modelName: `models/gemini-2.5-flash`
  - credentials: `googleGeminiApi`
- Connexion AI : `Modèle Gemini` → `Analyser transcription` (ai_languageModel)

**Step 3 : Ajouter le Structured Output Parser (sub-node)**

- Node `Format JSON` :
  - type: `@n8n/n8n-nodes-langchain.outputParserStructured`, typeVersion: 1.3
  - schemaType: `fromJson`
  - jsonSchemaExample :
```json
{
  "client": "Acme Corp",
  "resume": "Discussion sur le projet X, avancement des livrables, points bloquants identifiés.",
  "participants": [
    {
      "nom": "Jean Dupont",
      "email": "jean@acme.com",
      "role_deduit": "Chef de projet",
      "points_cles": ["A présenté l'avancement du sprint", "A soulevé un point bloquant sur l'API"],
      "actions": ["Envoyer le rapport de sprint d'ici vendredi", "Planifier une réunion technique"]
    }
  ],
  "actions_alex": [
    {"titre": "Préparer la proposition commerciale", "details": "Inclure les nouveaux tarifs et le planning révisé"},
    {"titre": "Relancer le partenaire technique", "details": "Vérifier la disponibilité pour la semaine prochaine"}
  ],
  "points_a_creuser": ["Faisabilité technique de l'intégration API", "Budget prévisionnel Q2"]
}
```
  - autoFix: true
- Connexion AI : `Format JSON` → `Analyser transcription` (ai_outputParser)

**Step 4 : Vérifier**

Valider le workflow via `n8n_validate_workflow`.

---

### Task 4 : Ajouter l'envoi des emails participants

**Nodes à créer :**
- `Préparer emails participants` — Code (typeVersion 2)
- `Split par participant` — Split Out (typeVersion 1)
- `Envoyer email participant` — Gmail (typeVersion 2.2, operation: send)

**Step 1 : Ajouter le node Code pour préparer les emails**

- Node `Préparer emails participants` :
  - type: `n8n-nodes-base.code`, typeVersion: 2
  - Code :
```javascript
const analyse = $json.output;
const participants = analyse.participants.filter(p =>
  p.email && p.email.toLowerCase() !== 'contact@example.com'
);

return participants.map(p => ({
  json: {
    email: p.email,
    nom: p.nom,
    sujet: `Compte rendu réunion ${analyse.client} - ${new Date().toLocaleDateString('fr-FR')}`,
    corps: `Bonjour ${p.nom},

Voici le compte rendu de notre réunion concernant ${analyse.client}.

RÉSUMÉ
${analyse.resume}

VOS POINTS CLÉS
${p.points_cles.map(pt => `- ${pt}`).join('\n')}

VOS ACTIONS À RÉALISER
${p.actions.map(a => `- ${a}`).join('\n')}

Cordialement,
Alex`
  }
}));
```
- Connexion : `Analyser transcription` → `Préparer emails participants`

**Step 2 : Ajouter le node Gmail pour envoyer**

- Node `Envoyer email participant` :
  - type: `n8n-nodes-base.gmail`, typeVersion: 2.2
  - resource: `message`, operation: `send`
  - sendTo: `={{ $json.email }}`
  - subject: `={{ $json.sujet }}`
  - message: `={{ $json.corps }}`
  - emailType: `text`
  - credentials: `gmailOAuth2` (contact@example.com)
- Connexion : `Préparer emails participants` → `Envoyer email participant`

**Step 3 : Vérifier**

Valider via `n8n_validate_workflow`.

---

### Task 5 : Ajouter l'email récap perso et les Google Tasks

**Nodes à créer :**
- `Préparer email récap` — Code (typeVersion 2)
- `Envoyer récap Alex` — Gmail (typeVersion 2.2)
- `Préparer tâches` — Code (typeVersion 2)
- `Créer tâche Google` — Google Tasks (typeVersion 1, operation: create)

**Step 1 : Ajouter l'email récap perso**

- Node `Préparer email récap` :
  - type: `n8n-nodes-base.code`, typeVersion: 2
  - Code :
```javascript
const analyse = $('Analyser transcription').first().json.output;

const corps = `COMPTE RENDU - ${analyse.client} - ${new Date().toLocaleDateString('fr-FR')}

RÉSUMÉ
${analyse.resume}

MES ACTIONS
${analyse.actions_alex.map(a => `- ${a.titre} : ${a.details}`).join('\n')}

POINTS À CREUSER
${analyse.points_a_creuser.map(p => `- ${p}`).join('\n')}

PARTICIPANTS ET LEURS ACTIONS
${analyse.participants.map(p => `${p.nom} (${p.role_deduit}) :\n${p.actions.map(a => `  - ${a}`).join('\n')}`).join('\n\n')}`;

return [{
  json: {
    sujet: `[Récap] Réunion ${analyse.client} - ${new Date().toLocaleDateString('fr-FR')}`,
    corps
  }
}];
```
- Connexion : `Analyser transcription` → `Préparer email récap`

- Node `Envoyer récap Alex` :
  - type: `n8n-nodes-base.gmail`, typeVersion: 2.2
  - resource: `message`, operation: `send`
  - sendTo: `contact@example.com`
  - subject: `={{ $json.sujet }}`
  - message: `={{ $json.corps }}`
  - emailType: `text`
  - credentials: `gmailOAuth2`
- Connexion : `Préparer email récap` → `Envoyer récap Alex`

**Step 2 : Ajouter les Google Tasks**

- Node `Préparer tâches` :
  - type: `n8n-nodes-base.code`, typeVersion: 2
  - Code :
```javascript
const analyse = $('Analyser transcription').first().json.output;

return analyse.actions_alex.map(a => ({
  json: {
    titre: `[${analyse.client}] ${a.titre}`,
    details: a.details
  }
}));
```
- Connexion : `Analyser transcription` → `Préparer tâches`

- Node `Créer tâche Google` :
  - type: `n8n-nodes-base.googleTasks`, typeVersion: 1
  - resource: `task`, operation: `create`
  - task: (TaskList ID — à configurer par l'utilisateur)
  - additionalFields.title: `={{ $json.titre }}`
  - additionalFields.notes: `={{ $json.details }}`
  - credentials: `googleTasksOAuth2Api`
- Connexion : `Préparer tâches` → `Créer tâche Google`

**Step 3 : Vérifier**

Valider via `n8n_validate_workflow`.

---

### Task 6 : Ajouter le classement Drive (déplacer + renommer)

**Nodes à créer :**
- `Identifier dossier client` — Code (typeVersion 2)
- `Vérifier dossier meetings` — Google Drive (typeVersion 3, operation: search)
- `Créer dossier meetings` — Google Drive (typeVersion 3, resource: folder, operation: create)
- `Déplacer transcription` — Google Drive (typeVersion 3, operation: move)
- `Renommer fichier` — Google Drive (typeVersion 3, operation: rename)

**Step 1 : Identifier le dossier client**

- Node `Identifier dossier client` :
  - type: `n8n-nodes-base.code`, typeVersion: 2
  - Code :
```javascript
const analyse = $('Analyser transcription').first().json.output;
const clients = JSON.parse($('Combiner données').first().json.clients);
const fichierOriginalId = $('Combiner données').first().json.fichierOriginalId;

const clientNom = analyse.client;
const clientData = clients.find(c => c.nom.toLowerCase() === clientNom.toLowerCase());

if (!clientData || clientNom === 'INCONNU') {
  throw new Error(`Client "${clientNom}" non trouvé dans le Google Sheet. Le fichier reste en place.`);
}

const now = new Date();
const jour = String(now.getDate()).padStart(2, '0');
const mois = String(now.getMonth() + 1).padStart(2, '0');
const annee = now.getFullYear();
const nouveauNom = `${jour}-${mois}-${annee}-${clientNom.toLowerCase().replace(/\s+/g, '-')}`;

return [{
  json: {
    clientNom,
    dossierId: clientData.dossierId,
    fichierOriginalId,
    nouveauNom
  }
}];
```
- Connexion : `Analyser transcription` → `Identifier dossier client`

**Step 2 : Chercher le sous-dossier meetings, le créer si absent**

- Node `Chercher dossier meetings` :
  - type: `n8n-nodes-base.googleDrive`, typeVersion: 3
  - resource: `fileFolder`, operation: `search`
  - queryString: `={{ "'" + $json.dossierId + "' in parents and name = 'meetings' and mimeType = 'application/vnd.google-apps.folder'" }}`
  - credentials: `googleDriveOAuth2Api`
- Connexion : `Identifier dossier client` → `Chercher dossier meetings`

- Node `Dossier meetings existe ?` :
  - type: `n8n-nodes-base.if`, typeVersion: 2
  - Condition : `{{ $json.id }}` is not empty
- Connexion : `Chercher dossier meetings` → `Dossier meetings existe ?`

- Node `Créer dossier meetings` :
  - type: `n8n-nodes-base.googleDrive`, typeVersion: 3
  - resource: `folder`, operation: `create`
  - name: `meetings`
  - folderId: `={{ $('Identifier dossier client').first().json.dossierId }}`
  - credentials: `googleDriveOAuth2Api`
- Connexion : `Dossier meetings existe ?` (false) → `Créer dossier meetings`

**Step 3 : Déplacer et renommer le fichier**

- Node `Fusionner chemin dossier` :
  - type: `n8n-nodes-base.code`, typeVersion: 2
  - Code :
```javascript
// Si le dossier existait, prendre son ID, sinon prendre celui du dossier créé
const dossierExistant = $('Dossier meetings existe ?').first();
const dossierCree = $('Créer dossier meetings').first();
const meetingsDossierId = dossierExistant?.json?.id || dossierCree?.json?.id;
const fichierOriginalId = $('Identifier dossier client').first().json.fichierOriginalId;
const nouveauNom = $('Identifier dossier client').first().json.nouveauNom;

return [{
  json: { meetingsDossierId, fichierOriginalId, nouveauNom }
}];
```
- Connexions : `Dossier meetings existe ?` (true) → `Fusionner chemin dossier` ET `Créer dossier meetings` → `Fusionner chemin dossier`

- Node `Déplacer et renommer` :
  - type: `n8n-nodes-base.googleDrive`, typeVersion: 3
  - resource: `file`, operation: `move`
  - fileId: `={{ $json.fichierOriginalId }}`
  - driveId: `My Drive`
  - folderId: `={{ $json.meetingsDossierId }}`
  - options.name: `={{ $json.nouveauNom }}`
  - credentials: `googleDriveOAuth2Api`
- Connexion : `Fusionner chemin dossier` → `Déplacer et renommer`

**Step 4 : Vérifier**

Valider via `n8n_validate_workflow`.

---

### Task 7 : Error handling et sticky notes

**Step 1 : Ajouter les sticky notes de documentation**

Via `n8n_update_partial_workflow` (addNode), ajouter des Sticky Notes :
- Note 1 (près du trigger) : "TRIGGER : Surveille le dossier Meet Recordings pour les nouvelles transcriptions Gemini"
- Note 2 (près de Gemini) : "IA : Gemini analyse la transcription, identifie le client, déduit les rôles, extrait résumé + actions"
- Note 3 (près des emails) : "SORTIES : Email perso participant + récap Alex + Google Tasks"
- Note 4 (près du classement) : "CLASSEMENT : Déplace dans /clients/{nom}/meetings/ et renomme JJ-MM-AAAA-nom-client"

**Step 2 : Configurer le retry sur les nodes API**

Via `n8n_update_partial_workflow` (updateNode), ajouter sur les nodes Gmail, Google Tasks, Google Drive :
- retryOnFail: true
- maxTries: 2
- waitBetweenTries: 1000

**Step 3 : Vérification finale**

Valider le workflow complet via `n8n_validate_workflow`. Vérifier que le workflow est bien inactif (désactivé par défaut).

---

### Task 8 : Test avec données réelles

**Step 1 : Préparer les prérequis**

Vérifier avec l'utilisateur :
- [ ] Credentials Google configurées dans n8n (Drive, Sheets, Gmail, Tasks, Gemini)
- [ ] Google Sheet clients créé avec au moins 1 client
- [ ] ID du dossier Meet Recordings renseigné dans le trigger
- [ ] TaskList Google Tasks identifiée

**Step 2 : Test manuel**

Exécuter le workflow manuellement avec un fichier de transcription test. Vérifier :
- [ ] Transcription bien extraite
- [ ] Client identifié correctement
- [ ] JSON Gemini conforme au schéma
- [ ] Emails reçus par les participants (vérifier contenu)
- [ ] Email récap reçu par contact@example.com
- [ ] Tâches créées dans Google Tasks
- [ ] Fichier déplacé et renommé dans le bon dossier client

**Step 3 : Activer le workflow**

Après validation, activer le workflow.
