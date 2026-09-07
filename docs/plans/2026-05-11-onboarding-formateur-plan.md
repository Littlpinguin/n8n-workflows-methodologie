# Onboarding Formateur — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatiser l'onboarding des formateurs/intervenants d'un organisme de formation : formulaire custom hébergé (avec pré-remplissage par analyse IA du CV) → création d'un espace Drive + fiche Google Sheet → email d'accueil → gate de validation humaine → contrat de sous-traitance en signature Yousign → suivi signature → relances automatiques.

**Architecture:** 5 workflows n8n (WF0 Parse CV, WF1 Réception, WF2 Validation, WF3 Callback signature Yousign, WF4 Relances) + 4 sub-workflows réutilisables + 1 page HTML statique (hébergée par l'utilisateur) + 1 Google Sheet « Formateurs » + 2 Google Docs templates (contrat, charte) + ressources Brevo (liste + templates email). Pattern de référence : Diagnostic IA (`N8N_RESOURCE_ID_04`) — formulaire custom + webhook + Gemini + Brevo. Error workflow existant réutilisé (`error-handler-notification-erreurs`).

**Tech Stack:** n8n (instance `n8n.example.com`, gérée via MCP `n8n-mcp`), Google Drive/Docs/Sheets (credential `googleDriveOAuth2Api` + Google Sheets), Gemini (credential `googlePalmApi`, modèle `gemini-2.5-flash` pour le parse CV), Brevo (credential `brevoApi` = `N8N_RESOURCE_ID_20`), Yousign API v3 (nouveau credential HTTP Header Auth), HTML/CSS/JS vanilla pour la page.

**Spec de référence :** `docs/specs/2026-05-11-onboarding-formateur-design.md`

**Conventions de ce repo :**
- Ne jamais commiter sur `main`. Travailler sur la branche `feat/onboarding-formateur` (déjà créée).
- Après création/modif d'un workflow via MCP : `n8n_validate_workflow` (profil `runtime`) DOIT passer, puis exporter le JSON via `n8n_get_workflow` dans `workflows/<kebab-case>.json` et commiter.
- Tous les paramètres de node configurés explicitement (jamais de valeur par défaut implicite). Valider chaque node via `validate_node(mode='full')` avant assemblage si le node est non trivial.
- IF nodes via API peu fiables → pour le routage conditionnel, utiliser 2+ Code nodes en parallèle depuis le même node amont (cf. REX).
- Pas d'accents dans les noms de colonnes Google Sheets ni dans les mappings de node.
- Workflows créés `active: false` jusqu'à validation finale.
- Convention de nommage workflows : `Formateurs - <Action> - <Cible>` ; nodes : `Verbe + Objet`.

---

## Vue d'ensemble des tâches

| # | Tâche | Phase | Produit |
|---|---|---|---|
| 0 | Pré-requis : credentials, IDs, Google Sheet, Brevo | — | Ressources prêtes |
| 1 | Sub-workflow `Sub - Formateur - Creer espace Drive` | 1 | Sub-WF |
| 2 | Sub-workflow `Sub - Formateur - Enregistrer fiche` | 1 | Sub-WF |
| 3 | Sub-workflow `Sub - Formateur - Email accueil` | 1 | Sub-WF |
| 4 | WF1 `Formateurs - Onboarding - Reception` (orchestrateur) | 1 | WF principal |
| 5 | WF0 `Formateurs - Onboarding - Parse CV` | 1 | WF |
| 6 | Page HTML `formulaire-formateur.html` | 1 | Fichier statique |
| 7 | Test bout-en-bout Phase 1 | 1 | Validation |
| 8 | Google Docs templates (contrat, charte) + placeholders | 2 | 2 Docs |
| 9 | Credential Yousign + helper d'appel API | 2 | Credential |
| 10 | Sub-workflow `Sub - Formateur - Contrat Yousign` | 2 | Sub-WF |
| 11 | WF2 `Formateurs - Validation` (gate humaine) | 2 | WF |
| 12 | WF3 `Formateurs - Callback Signature` | 2 | WF |
| 13 | Test bout-en-bout Phase 2 | 2 | Validation |
| 14 | WF4 `Formateurs - Relances et validation differee` | 3 | WF |
| 15 | Assignation Error workflow + activation + REX | 3 | Mise en prod |

---

## TASK 0 : Pré-requis (credentials, IDs, Google Sheet, Brevo)

**Files:**
- Modify: `docs/plans/2026-05-11-onboarding-formateur-plan.md` (consigner les IDs récoltés dans un bloc « IDs résolus » en fin de fichier)
- Create (manuel, hors repo) : Google Sheet « Formateurs », liste Brevo « Formateurs », credential Yousign dans n8n

- [ ] **Step 1 : Vérifier la santé de l'instance n8n**

Run (MCP) : `n8n_health_check`
Expected : instance up, API accessible.

- [ ] **Step 2 : Récupérer l'ID du workflow Error Handler existant**

Run (MCP) : `n8n_list_workflows` puis repérer `error-handler-notification-erreurs` (ou nom équivalent).
Noter son `id` → variable `ERROR_WF_ID`. Si introuvable, lire `workflows/error-handler-notification-erreurs.json` pour le récupérer / le recréer via `n8n_create_workflow`.

- [ ] **Step 3 : Lister les credentials disponibles côté n8n**

Run (MCP) : `n8n_manage_credentials` (action list) — confirmer la présence de : un credential Google Drive OAuth2, un credential Google Sheets, `brevoApi` (`N8N_RESOURCE_ID_20`), `googlePalmApi` (`N8N_RESOURCE_ID_06`). Noter leurs IDs exacts → `GDRIVE_CRED_ID`, `GSHEETS_CRED_ID`, `BREVO_CRED_ID`, `GEMINI_CRED_ID`.

- [ ] **Step 4 : Créer le Google Sheet « Formateurs »**

Run (MCP `mcp__google-drive__createSpreadsheet`) : titre `Formateurs - Onboarding`. Puis `mcp__google-drive__writeSpreadsheet` pour écrire la ligne d'en-tête (onglet `Formateurs`), colonnes **exactement** (ASCII, sans accents) :

```
Horodatage | Nom | Prenom | Email | Telephone | Statut juridique | SIRET | Domaines | Annees experience | Disponibilites | Lien dossier | CV | Diplomes | Piece identite | RC pro | RIB | Attestation INSEE | Attestation vigilance | Justificatifs complets | Statut progression | Valide | Yousign request ID | Date contrat envoye | Date contrat signe | Nb relances | Date dernier contact | Notes
```

Noter le `spreadsheetId` → `SHEET_ID`. Vérifier les headers réels via `mcp__google-drive__readSpreadsheet` (cf. REX : n8n compare schema node ↔ headers réels).

- [ ] **Step 5 : Créer le dossier Drive racine `Formateurs`**

Run (MCP `mcp__google-drive__createFolder`) : nom `Formateurs`, à la racine du Drive (ou dans un dossier parent au choix de l'utilisateur). Noter le `folderId` → `DRIVE_ROOT_FORMATEURS_ID`.

- [ ] **Step 6 : Créer la liste Brevo « Formateurs » (manuel, dashboard Brevo)**

Dans Brevo : Contacts → Listes → créer `Formateurs - Onboarding`. Noter l'ID numérique de la liste → `BREVO_LIST_ID`.
Créer (ou prévoir) les templates email transactionnels Brevo :
- `Formateur - Bienvenue et kit` → `BREVO_TPL_BIENVENUE`
- (Phase 2) `Formateur - Contrat envoye` (info au formateur) → `BREVO_TPL_CONTRAT_ENVOYE`
- (Phase 2) `Formateur - Contrat signe` → `BREVO_TPL_CONTRAT_SIGNE`
- (Phase 3) `Formateur - Relance justificatifs` → `BREVO_TPL_RELANCE_JUSTIF`
- (Phase 3) `Formateur - Relance signature` → `BREVO_TPL_RELANCE_SIGN`

Note : à ce stade seul `BREVO_TPL_BIENVENUE` est requis. Les autres peuvent être créés en Phase 2/3. Si l'utilisateur n'a pas encore le contenu, créer des templates minimalistes (objet + corps placeholder, `{{ params.prenom }}`, `{{ params.lienDossier }}`) — ils seront enrichis ensuite.

- [ ] **Step 7 : Générer un secret de webhook partagé**

Générer deux chaînes aléatoires (32+ caractères chacune), p. ex. `openssl rand -hex 24` :
- `FORMATEUR_WEBHOOK_SECRET` — attendu par WF0 et WF1 dans le header `X-Formateur-Secret` ; intégré dans le JS de la page HTML (injecté côté serveur, jamais commité en clair).
- `FORMATEUR_VALIDATION_SECRET` — clé HMAC pour signer les liens de validation (WF2).
Les définir comme **variables d'environnement n8n** (`FORMATEUR_WEBHOOK_SECRET`, `FORMATEUR_VALIDATION_SECRET`) — c'est ainsi que les Code nodes y accèdent (`$env.FORMATEUR_WEBHOOK_SECRET`). De même `YOUSIGN_BASE_URL` (sandbox au début) et, en Phase 2, `YOUSIGN_WEBHOOK_SECRET`. Ne rien commiter en clair.

- [ ] **Step 8 : Consigner les IDs résolus**

Ajouter à la fin de ce fichier un bloc :

```markdown
## IDs résolus (rempli pendant l'exécution)
- ERROR_WF_ID = ...
- GDRIVE_CRED_ID = ...
- GSHEETS_CRED_ID = ...
- BREVO_CRED_ID = N8N_RESOURCE_ID_20
- GEMINI_CRED_ID = N8N_RESOURCE_ID_06
- SHEET_ID = ...
- DRIVE_ROOT_FORMATEURS_ID = ...
- BREVO_LIST_ID = ...
- BREVO_TPL_BIENVENUE = ...
- WEBHOOK_SECRET = (dans credential n8n, pas ici)
```

- [ ] **Step 9 : Commit**

```bash
git add docs/plans/2026-05-11-onboarding-formateur-plan.md
git commit -m "chore(onboarding-formateur): prerequis - IDs ressources Google/Brevo"
```

---

## TASK 1 : Sub-workflow `Sub - Formateur - Creer espace Drive`

**Rôle / interface :** Input `{ nom, prenom, email }` + items binaires (les fichiers uploadés, propriétés binaires nommées `cv`, `diplomes`, `piece_identite`, `rc_pro`, `rib`, `attestation_insee`, `attestation_vigilance`). Crée l'arborescence Drive du formateur, range les fichiers, retourne `{ dossierUrl, dossierId, liens: { cv, diplomes, pieceIdentite, rcPro, rib, attestInsee, attestVigilance } }` (les liens absents → `null`).

**Files:**
- n8n workflow (créé via MCP) : `Sub - Formateur - Creer espace Drive`
- Export : `workflows/sub-formateur-creer-espace-drive.json`

- [ ] **Step 1 : Créer le workflow squelette**

Run (MCP `n8n_create_workflow`) : name `Sub - Formateur - Creer espace Drive`, `active: false`, settings `{ executionOrder: "v1", timezone: "Europe/Paris" }`. Nodes :
1. `Execute Workflow Trigger` (type `n8n-nodes-base.executeWorkflowTrigger`, name `Recevoir input`) — `inputSource: "workflowInputs"`, définir les workflowInputs : `nom` (string), `prenom` (string), `email` (string). (Les fichiers binaires passent via les items, pas via workflowInputs.)

- [ ] **Step 2 : Node — créer le dossier formateur**

Ajouter `n8n-nodes-base.googleDrive` (name `Creer dossier formateur`) :
- `resource: folder`, `operation: create`
- `name`: `={{ $json.nom }} {{ $json.prenom }}`
- `driveId`: My Drive ; `folderId`: `DRIVE_ROOT_FORMATEURS_ID` (depuis Task 0)
- credential : `GDRIVE_CRED_ID`
- `options`: aucun. `alwaysOutputData: true`.

- [ ] **Step 3 : Node — créer les 3 sous-dossiers (parallèle)**

Ajouter 3 nodes `googleDrive` (folder/create) connectés à la sortie de `Creer dossier formateur` :
- `Creer sous-dossier Administratif` — name `Administratif`, parent `={{ $('Creer dossier formateur').first().json.id }}`
- `Creer sous-dossier Contrats` — name `Contrats`, même parent
- `Creer sous-dossier Pedagogie` — name `Pedagogie`, même parent
credential `GDRIVE_CRED_ID` sur les 3.

- [ ] **Step 4 : Node Merge — regrouper les sous-dossiers**

Ajouter `n8n-nodes-base.merge` v3 (name `Regrouper sous-dossiers`), mode `combine` → `combineAll` (ou simplement 3 inputs → connecter les 3 sous-dossiers). But : avoir l'ID du sous-dossier `Administratif` disponible en aval. (Alternative robuste : ne pas merger, et en aval référencer `$('Creer sous-dossier Administratif').first().json.id` directement — les 3 nodes étant dans le chemin d'exécution amont.)

- [ ] **Step 5 : Code node — préparer les uploads**

Ajouter `n8n-nodes-base.code` (name `Preparer uploads`, mode `runOnceForAllItems`) connecté en aval du merge. Code :

```javascript
// Renomme chaque fichier binaire présent et prepare un item par fichier.
const trigger = $('Recevoir input').first().json;
const baseName = `${trigger.nom}-${trigger.prenom}`.replace(/[^A-Za-z0-9-]/g, '-');
const dossierAdminId = $('Creer sous-dossier Administratif').first().json.id;

// Mapping propriete binaire -> prefixe de fichier
const map = {
  cv: 'CV',
  diplomes: 'Diplomes',
  piece_identite: 'Piece-identite',
  rc_pro: 'RC-pro',
  rib: 'RIB',
  attestation_insee: 'Attestation-INSEE',
  attestation_vigilance: 'Attestation-vigilance',
};

const item = $input.first();
const out = [];
for (const [prop, prefix] of Object.entries(map)) {
  if (item.binary && item.binary[prop]) {
    const bin = item.binary[prop];
    const ext = (bin.fileName && bin.fileName.includes('.')) ? bin.fileName.split('.').pop() : (bin.mimeType === 'application/pdf' ? 'pdf' : 'bin');
    out.push({
      json: { prop, fileName: `${prefix}-${baseName}.${ext}`, dossierAdminId },
      binary: { data: bin },
    });
  }
}
return out;
```

- [ ] **Step 6 : Node — uploader chaque fichier vers Drive**

Ajouter `n8n-nodes-base.googleDrive` (name `Uploader fichier`) connecté à `Preparer uploads` :
- `resource: file`, `operation: upload`
- `name`: `={{ $json.fileName }}`
- `inputDataFieldName`: `data`
- `driveId`: My Drive ; `folderId`: `={{ $json.dossierAdminId }}`
- credential `GDRIVE_CRED_ID`
- `Settings` → `Retry On Fail`: true, `Max Tries`: 3 ; `Continue On Fail`: true (un fichier raté n'arrête pas le sub).

- [ ] **Step 7 : Code node — assembler l'output**

Ajouter `n8n-nodes-base.code` (name `Assembler output`, mode `runOnceForAllItems`) connecté à `Uploader fichier` :

```javascript
const dossier = $('Creer dossier formateur').first().json;
const uploads = $input.all(); // un item par fichier uploadé (ou erreur si continueOnFail)

const propToKey = {
  cv: 'cv', diplomes: 'diplomes', piece_identite: 'pieceIdentite',
  rc_pro: 'rcPro', rib: 'rib', attestation_insee: 'attestInsee', attestation_vigilance: 'attestVigilance',
};
const liens = { cv: null, diplomes: null, pieceIdentite: null, rcPro: null, rib: null, attestInsee: null, attestVigilance: null };

for (const u of uploads) {
  const prop = u.json && u.json.prop; // attention: apres upload Drive, $json = reponse API -> on a perdu .prop
  // -> on recupere prop via le node amont par index n'est pas fiable. Strategie: nommer via le fileName.
  const fileName = u.json && (u.json.name || u.json.fileName) || '';
  const link = u.json && (u.json.webViewLink || (u.json.id ? `https://drive.google.com/file/d/${u.json.id}/view` : null));
  if (!link) continue;
  if (fileName.startsWith('CV-')) liens.cv = link;
  else if (fileName.startsWith('Diplomes-')) liens.diplomes = link;
  else if (fileName.startsWith('Piece-identite-')) liens.pieceIdentite = link;
  else if (fileName.startsWith('RC-pro-')) liens.rcPro = link;
  else if (fileName.startsWith('RIB-')) liens.rib = link;
  else if (fileName.startsWith('Attestation-INSEE-')) liens.attestInsee = link;
  else if (fileName.startsWith('Attestation-vigilance-')) liens.attestVigilance = link;
}

return [{ json: {
  dossierId: dossier.id,
  dossierUrl: dossier.webViewLink || `https://drive.google.com/drive/folders/${dossier.id}`,
  liens,
}}];
```

> Note d'implémentation : le node Google Drive `upload` doit retourner `webViewLink` — activer dans `options` → `Fields` la propriété `webViewLink` (ou utiliser `webContentLink`). Si indisponible, fallback `https://drive.google.com/file/d/{id}/view` (déjà géré ci-dessus).

- [ ] **Step 8 : Connexions**

`Recevoir input` → `Creer dossier formateur` → (3×) `Creer sous-dossier *` → `Regrouper sous-dossiers` → `Preparer uploads` → `Uploader fichier` → `Assembler output`.

- [ ] **Step 9 : Valider le workflow**

Run (MCP) : `n8n_validate_workflow` (profil `runtime`). Expected : `valid: true`, aucune erreur. Corriger jusqu'à validation propre.

- [ ] **Step 10 : Test d'exécution**

Run (MCP) : `n8n_test_workflow` sur ce sub-workflow avec un input simulé `{ nom: "Dupont", prenom: "Marie", email: "test@example.com" }` (sans binaires → l'output doit avoir tous les `liens` à `null` mais `dossierUrl` valide). Vérifier dans Drive qu'un dossier `Dupont Marie/` avec 3 sous-dossiers a été créé. Le supprimer ensuite.

- [ ] **Step 11 : Exporter + commit**

```bash
# via MCP n8n_get_workflow -> ecrire le JSON dans workflows/sub-formateur-creer-espace-drive.json
git add workflows/sub-formateur-creer-espace-drive.json
git commit -m "feat(onboarding-formateur): sub-workflow creer espace Drive"
```

---

## TASK 2 : Sub-workflow `Sub - Formateur - Enregistrer fiche`

**Rôle / interface :** Input `{ nom, prenom, email, telephone, statutJuridique, siret, domaines, anneesExperience, disponibilites, dossierUrl, liens{...}, justificatifsComplets }`. Append (ou update si l'email existe déjà) une ligne au Google Sheet `Formateurs`. Retourne `{ rowNumber, mode: "append"|"update" }`.

**Files:**
- n8n workflow : `Sub - Formateur - Enregistrer fiche`
- Export : `workflows/sub-formateur-enregistrer-fiche.json`

- [ ] **Step 1 : Créer le workflow squelette**

`n8n_create_workflow` : name `Sub - Formateur - Enregistrer fiche`, `active: false`. Node 1 : `Execute Workflow Trigger` (name `Recevoir input`), `inputSource: workflowInputs`, workflowInputs : `nom, prenom, email, telephone, statutJuridique, siret, domaines, anneesExperience, disponibilites, dossierUrl, justificatifsComplets` (tous string ; `domaines` = string CSV ; les liens fichiers passés en string aussi via `lien_cv`, `lien_diplomes`, `lien_piece_identite`, `lien_rc_pro`, `lien_rib`, `lien_attest_insee`, `lien_attest_vigilance`).

- [ ] **Step 2 : Node — chercher si l'email existe déjà**

Ajouter `n8n-nodes-base.googleSheets` (name `Chercher email existant`) :
- `resource: sheet`, `operation: lookup` (Get rows matching value)
- `documentId`: `SHEET_ID` ; `sheetName`: `Formateurs`
- `lookupColumn`: `Email` ; `lookupValue`: `={{ $json.email }}`
- `options.returnAllMatches`: false ; `alwaysOutputData: true`
- credential `GSHEETS_CRED_ID`

- [ ] **Step 3 : Code node — décider append vs update et construire la ligne**

Ajouter `n8n-nodes-base.code` (name `Construire ligne`, `runOnceForAllItems`) connecté à `Chercher email existant` :

```javascript
const input = $('Recevoir input').first().json;
const existing = $input.first().json; // {} si pas trouve
const found = existing && existing.Email; // ligne existante ?
const now = new Date().toISOString();

const row = {
  Horodatage: now,
  Nom: input.nom || '',
  Prenom: input.prenom || '',
  Email: input.email || '',
  Telephone: input.telephone || '',
  'Statut juridique': input.statutJuridique || '',
  SIRET: input.siret || '',
  Domaines: input.domaines || '',
  'Annees experience': input.anneesExperience || '',
  Disponibilites: input.disponibilites || '',
  'Lien dossier': input.dossierUrl || '',
  CV: input.lien_cv || '',
  Diplomes: input.lien_diplomes || '',
  'Piece identite': input.lien_piece_identite || '',
  'RC pro': input.lien_rc_pro || '',
  RIB: input.lien_rib || '',
  'Attestation INSEE': input.lien_attest_insee || '',
  'Attestation vigilance': input.lien_attest_vigilance || '',
  'Justificatifs complets': input.justificatifsComplets || 'non',
  'Statut progression': 'Dossier recu',
  Valide: found ? (existing.Valide || 'non') : 'non',
  'Yousign request ID': found ? (existing['Yousign request ID'] || '') : '',
  'Date contrat envoye': found ? (existing['Date contrat envoye'] || '') : '',
  'Date contrat signe': found ? (existing['Date contrat signe'] || '') : '',
  'Nb relances': found ? (existing['Nb relances'] || '0') : '0',
  'Date dernier contact': now,
  Notes: found ? (existing.Notes || '') : '',
};
return [{ json: { mode: found ? 'update' : 'append', rowNumber: found ? existing.row_number : null, row } }];
```

> `row_number` : le node Google Sheets `lookup` renvoie `row_number` quand on l'active dans les options (`includeRowNumber`). L'activer dans `Chercher email existant` (option `Include Spreadsheet Row Number`).

- [ ] **Step 4 : 2 Code nodes en parallèle pour router append/update**

(Pas d'IF via API — cf. REX.) Depuis `Construire ligne`, brancher 2 Code nodes :
- `Filtrer si append` : `return $input.all().filter(i => i.json.mode === 'append');`
- `Filtrer si update` : `return $input.all().filter(i => i.json.mode === 'update');`

- [ ] **Step 5 : Node append**

`n8n-nodes-base.googleSheets` (name `Ajouter ligne`) connecté à `Filtrer si append` :
- `operation: append` ; `documentId: SHEET_ID` ; `sheetName: Formateurs`
- `mapping mode: defineBelow` → mapper chaque colonne depuis `={{ $json.row['<NomColonne>'] }}` (attention aux noms avec espaces — utiliser la notation crochet ; éviter les accents : nos colonnes sont ASCII).
- credential `GSHEETS_CRED_ID` ; `Retry On Fail: true`.

- [ ] **Step 6 : Node update**

`n8n-nodes-base.googleSheets` (name `Mettre a jour ligne`) connecté à `Filtrer si update` :
- `operation: update` ; `documentId: SHEET_ID` ; `sheetName: Formateurs`
- `columnToMatchOn: Email` (ou par row number si supporté) ; mêmes mappings que Step 5.
- credential `GSHEETS_CRED_ID` ; `Retry On Fail: true`.

- [ ] **Step 7 : Merge + Code node final pour l'output**

`n8n-nodes-base.merge` (name `Fusionner resultats`, 2 inputs : `Ajouter ligne` + `Mettre a jour ligne`, mode `combine`/append). Puis `n8n-nodes-base.code` (name `Output rowNumber`) :

```javascript
const r = $input.first().json;
// reponse Google Sheets append/update : contient updates.updatedRange ou les valeurs ecrites
let rowNumber = null;
const range = r && (r.updates && r.updates.updatedRange);
if (range) { const m = range.match(/!A?(\d+)/); if (m) rowNumber = parseInt(m[1], 10); }
return [{ json: { rowNumber, email: $('Recevoir input').first().json.email } }];
```

- [ ] **Step 8 : Connexions, validation, test, export, commit**

Connexions : `Recevoir input` → `Chercher email existant` → `Construire ligne` → (`Filtrer si append` → `Ajouter ligne`) + (`Filtrer si update` → `Mettre a jour ligne`) → `Fusionner resultats` → `Output rowNumber`.
Run : `n8n_validate_workflow` (runtime) → valid. `n8n_test_workflow` avec un input simulé → vérifier qu'une ligne apparaît dans le Sheet, puis la supprimer. Exporter `workflows/sub-formateur-enregistrer-fiche.json`.

```bash
git add workflows/sub-formateur-enregistrer-fiche.json
git commit -m "feat(onboarding-formateur): sub-workflow enregistrer fiche Google Sheet"
```

---

## TASK 3 : Sub-workflow `Sub - Formateur - Email accueil`

**Rôle / interface :** Input `{ email, prenom, nom, domaines, dossierUrl }`. Crée/maj le contact Brevo, l'ajoute à la liste `Formateurs`, envoie l'email transactionnel `Formateur - Bienvenue et kit`. Retourne `{ sent: true }`.

**Files:**
- n8n workflow : `Sub - Formateur - Email accueil`
- Export : `workflows/sub-formateur-email-accueil.json`

- [ ] **Step 1 : Squelette**

`n8n_create_workflow` : name `Sub - Formateur - Email accueil`, `active: false`. Node `Execute Workflow Trigger` (name `Recevoir input`), workflowInputs : `email, prenom, nom, domaines, dossierUrl` (string).

- [ ] **Step 2 : Node — créer/maj le contact Brevo**

`n8n-nodes-base.httpRequest` (name `Upsert contact Brevo`) :
- `method: POST`, `url: https://api.brevo.com/v3/contacts`
- Auth : credential `BREVO_CRED_ID` (HTTP Header Auth `api-key`) — ou header explicite `api-key`.
- Body (JSON) :
```json
{
  "email": "={{ $json.email }}",
  "attributes": { "PRENOM": "={{ $json.prenom }}", "NOM": "={{ $json.nom }}", "DOMAINES": "={{ $json.domaines }}", "STATUT_FORMATEUR": "Dossier recu" },
  "listIds": [ /* BREVO_LIST_ID */ ],
  "updateEnabled": true
}
```
- `Continue On Fail: true` (si le contact existe déjà avec une erreur 400 « already exists », on continue — gérer en aval). Mieux : `updateEnabled: true` évite l'erreur.

- [ ] **Step 3 : Node — envoyer l'email transactionnel Brevo**

`n8n-nodes-base.httpRequest` (name `Envoyer email bienvenue`) :
- `method: POST`, `url: https://api.brevo.com/v3/smtp/email`
- Auth : `BREVO_CRED_ID`
- Body :
```json
{
  "to": [ { "email": "={{ $('Recevoir input').first().json.email }}", "name": "={{ $('Recevoir input').first().json.prenom }}" } ],
  "templateId": /* BREVO_TPL_BIENVENUE */,
  "params": { "prenom": "={{ $('Recevoir input').first().json.prenom }}", "lienDossier": "={{ $('Recevoir input').first().json.dossierUrl }}" }
}
```
- `Retry On Fail: true`, `Max Tries: 3`.

- [ ] **Step 4 : Code node output**

`n8n-nodes-base.code` (name `Output`) : `return [{ json: { sent: true } }];`

- [ ] **Step 5 : Connexions, validation, test, export, commit**

`Recevoir input` → `Upsert contact Brevo` → `Envoyer email bienvenue` → `Output`.
`n8n_validate_workflow` → valid. `n8n_test_workflow` avec `{ email: "<votre email de test>", prenom: "Test", nom: "Formateur", domaines: "IA, marketing", dossierUrl: "https://drive.google.com/..." }` → vérifier réception de l'email. Exporter `workflows/sub-formateur-email-accueil.json`.

```bash
git add workflows/sub-formateur-email-accueil.json
git commit -m "feat(onboarding-formateur): sub-workflow email accueil Brevo"
```

---

## TASK 4 : WF1 `Formateurs - Onboarding - Reception` (orchestrateur, Webhook)

**Rôle :** point d'entrée du formulaire. Reçoit `multipart/form-data`, valide, répond immédiatement à la page, puis orchestre les 3 sub-workflows + notifie l'admin avec un lien de validation.

**Files:**
- n8n workflow : `Formateurs - Onboarding - Reception`
- Export : `workflows/formateurs-onboarding-reception.json`

- [ ] **Step 1 : Squelette + Webhook**

`n8n_create_workflow` : name `Formateurs - Onboarding - Reception`, `active: false`, settings timezone `Europe/Paris`. Node 1 : `n8n-nodes-base.webhook` (name `Webhook formulaire`) :
- `httpMethod: POST` ; `path: formateur-onboarding`
- `responseMode: responseNode` (on répond via un node `Respond to Webhook`)
- `options.binaryPropertyName: data` — n8n parse le multipart : les fichiers atterrissent en propriétés binaires nommées d'après les `name` du `<input type=file>` (on imposera côté HTML : `cv`, `diplomes`, `piece_identite`, `rc_pro`, `rib`, `attestation_insee`, `attestation_vigilance`). Les champs texte atterrissent dans `$json.body.<champ>`.
- `options.rawBody: false`.
- Activer la validation du header secret : option `Authentication` du webhook OU vérifier dans le node de validation que `$headers['x-formateur-secret']` == secret (cf. Step 3).

- [ ] **Step 2 : Code node — normaliser le payload**

`n8n-nodes-base.code` (name `Normaliser payload`, `runOnceForAllItems`) :

```javascript
const item = $input.first();
const b = (item.json && item.json.body) || item.json || {};
const headers = (item.json && item.json.headers) || {};

// champs attendus depuis le formulaire (noms HTML <input name=...>)
const data = {
  nom: (b.nom || '').trim(),
  prenom: (b.prenom || '').trim(),
  email: (b.email || '').trim().toLowerCase(),
  telephone: (b.telephone || '').trim(),
  statutJuridique: (b.statut_juridique || '').trim(),
  siret: (b.siret || '').trim(),
  domaines: Array.isArray(b.domaines) ? b.domaines.join(', ') : (b.domaines || '').trim(),
  anneesExperience: (b.annees_experience || '').toString().trim(),
  disponibilites: (b.disponibilites || '').trim(),
  consentRgpd: b.consent_rgpd === 'on' || b.consent_rgpd === 'true' || b.consent_rgpd === true,
  secret: headers['x-formateur-secret'] || '',
};
// les binaires sont deja sur item.binary -> on les laisse passer tels quels
return [{ json: data, binary: item.binary || {} }];
```

- [ ] **Step 3 : Code node — valider**

`n8n-nodes-base.code` (name `Valider`, `runOnceForAllItems`) :

```javascript
const SECRET = $env.FORMATEUR_WEBHOOK_SECRET || ''; // defini en variable d'env n8n
const d = $input.first().json;
const errors = [];
if (SECRET && d.secret !== SECRET) errors.push('secret invalide');
if (!d.nom) errors.push('nom manquant');
if (!d.prenom) errors.push('prenom manquant');
if (!d.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) errors.push('email invalide');
if (!d.consentRgpd) errors.push('consentement RGPD requis');
const bin = $input.first().binary || {};
if (!bin.cv) errors.push('CV manquant');

// justificatifs attendus pour "complet"
const requis = ['cv','diplomes','piece_identite','rc_pro','rib','attestation_insee'];
const justificatifsComplets = requis.every(k => bin[k]) ? 'oui' : 'non';

if (errors.length) {
  // on renvoie un item d'erreur — la branche "invalide" repondra 400
  return [{ json: { _valid: false, errors } }];
}
return [{ json: { ...d, justificatifsComplets, _valid: true }, binary: bin }];
```

- [ ] **Step 4 : Router valide / invalide (2 Code nodes parallèles)**

Depuis `Valider` : `Branche valide` (`return $input.all().filter(i => i.json._valid);`) et `Branche invalide` (`return $input.all().filter(i => !i.json._valid);`).

- [ ] **Step 5 : Réponse webhook (2 nodes Respond to Webhook)**

- `Repondre OK` (`n8n-nodes-base.respondToWebhook`) connecté à `Branche valide` : `responseCode: 200`, body JSON `{ "status": "ok", "message": "Candidature recue. Vous allez recevoir un email." }`. (La page peut afficher un écran de confirmation ou rediriger.)
- `Repondre erreur` connecté à `Branche invalide` : `responseCode: 400`, body `={{ { status: 'error', errors: $json.errors } }}`.

> Important : `Respond to Webhook` doit être atteint tôt. Brancher les Execute Workflow APRÈS `Repondre OK` (même branche, en série après le respond) pour que le traitement continue sans faire attendre la page. n8n continue l'exécution après un `respondToWebhook`.

- [ ] **Step 6 : Sub — Creer espace Drive**

`n8n-nodes-base.executeWorkflow` (name `Sub Creer espace Drive`) connecté après `Repondre OK` :
- `source: database`, `workflowId`: ID du sub-workflow Task 1
- `mode: once` ; passer les inputs `nom, prenom, email` (les binaires passent automatiquement via les items).
- `Continue On Fail: true` (si échec, on note dans le Sheet via le node suivant — mais ici on continue avec un output minimal). Plutôt : laisser planter ET déclencher l'error workflow → simpler. Choix : `Continue On Fail: false` et compter sur l'Error workflow + le fait que le formateur a déjà eu sa réponse OK.

- [ ] **Step 7 : Sub — Enregistrer fiche**

`executeWorkflow` (name `Sub Enregistrer fiche`) connecté à `Sub Creer espace Drive` :
- workflowId : sub Task 2
- inputs mappés : `nom, prenom, email, telephone, statutJuridique, siret, domaines, anneesExperience, disponibilites` depuis `$('Valider').first().json` (ou `$('Branche valide')`...), `dossierUrl` depuis `$('Sub Creer espace Drive').first().json.dossierUrl`, `justificatifsComplets` depuis `$('Valider')...`, et les `lien_*` depuis `$('Sub Creer espace Drive').first().json.liens.*`.

- [ ] **Step 8 : Sub — Email accueil**

`executeWorkflow` (name `Sub Email accueil`) connecté à `Sub Enregistrer fiche` :
- workflowId : sub Task 3
- inputs : `email, prenom, nom, domaines` depuis `$('Branche valide').first().json` ; `dossierUrl` depuis `$('Sub Creer espace Drive').first().json.dossierUrl`.

- [ ] **Step 9 : Notif admin avec lien de validation**

`n8n-nodes-base.httpRequest` (name `Notifier admin`) connecté à `Sub Email accueil` — envoie un email à l'admin via Brevo SMTP (`/v3/smtp/email`), `sender` = adresse de l'OF, `to` = email admin (`contact@example.com`), `subject` = `Nouveau formateur : {{nom}} {{prenom}}`, `htmlContent` contenant :
- récap des champs + lien du dossier Drive,
- un **lien de validation** : `https://n8n.example.com/webhook/formateur-valider?email={{email}}&token={{token}}` où `token` = `HMAC-SHA256(email, FORMATEUR_VALIDATION_SECRET)` calculé dans un Code node `Calculer token validation` placé juste avant (`crypto.createHmac('sha256', secret).update(email).digest('hex')`).

> Pour la Phase 1, le lien de validation peut pointer vers une page « à venir » — WF2 sera créé en Phase 2. Alternative Phase 1 : l'email dit simplement « valide ce formateur en cochant la colonne Valide du Sheet ».

- [ ] **Step 10 : Connexions complètes**

`Webhook formulaire` → `Normaliser payload` → `Valider` → (`Branche valide` → `Repondre OK` → `Sub Creer espace Drive` → `Sub Enregistrer fiche` → `Sub Email accueil` → `Calculer token validation` → `Notifier admin`) ; (`Branche invalide` → `Repondre erreur`).

- [ ] **Step 11 : Valider + tester**

`n8n_validate_workflow` (runtime) → valid. Test : activer le workflow, faire un `curl -X POST` vers le webhook avec un `multipart/form-data` minimal (champs + un faux `cv.pdf`) et le header `X-Formateur-Secret`. Vérifier : réponse 200, dossier Drive créé, ligne Sheet ajoutée, email accueil reçu, email admin reçu. Nettoyer (supprimer la ligne + le dossier). Désactiver le workflow.

- [ ] **Step 12 : Export + commit**

```bash
git add workflows/formateurs-onboarding-reception.json
git commit -m "feat(onboarding-formateur): WF1 reception orchestrateur (webhook)"
```

---

## TASK 5 : WF0 `Formateurs - Onboarding - Parse CV` (Webhook)

**Rôle :** reçoit un CV (PDF), en extrait du JSON structuré via Gemini, le renvoie pour pré-remplir le formulaire.

**Files:**
- n8n workflow : `Formateurs - Onboarding - Parse CV`
- Export : `workflows/formateurs-onboarding-parse-cv.json`

- [ ] **Step 1 : Squelette + Webhook**

`n8n_create_workflow` : name `Formateurs - Onboarding - Parse CV`, `active: false`. Node `n8n-nodes-base.webhook` (name `Webhook CV`) : `httpMethod: POST`, `path: formateur-parse-cv`, `responseMode: responseNode`, `options.binaryPropertyName: cv`. Vérifier le header `X-Formateur-Secret` dans le Code suivant.

- [ ] **Step 2 : Extract from File**

`n8n-nodes-base.extractFromFile` (name `Extraire texte CV`) : `operation: pdf`, `binaryPropertyName: cv`, `options.joinPages: true`. `Continue On Fail: true`.

- [ ] **Step 3 : HTTP Request Gemini — extraction structurée**

`n8n-nodes-base.httpRequest` (name `Extraire champs via Gemini`) :
- `method: POST`
- `url: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
- Auth : credential `GEMINI_CRED_ID` (Google Palm API — passe la clé). Si le credential n'injecte pas la clé en query, ajouter `?key=` via le credential prévu à cet effet.
- Body JSON :
```json
{
  "systemInstruction": { "parts": [ { "text": "Tu es un assistant qui extrait des informations structurees d'un CV de formateur/intervenant. Retourne UNIQUEMENT les champs presents dans le CV. Ne devine pas le statut juridique, le SIRET ni les disponibilites. Pour 'domaines', deduis 2 a 5 domaines d'expertise a partir des titres de poste, missions et competences. Pour 'anneesExperience', estime le nombre total d'annees d'experience professionnelle a partir de l'historique (entier). Si une information est absente, renvoie une chaine vide ou un tableau vide." } ] },
  "contents": [ { "role": "user", "parts": [ { "text": "=<cv>\n{{ $json.text }}\n</cv>\n\nExtrais les champs demandes a partir du CV ci-dessus." } ] } ],
  "generationConfig": {
    "temperature": 1.0,
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "object",
      "properties": {
        "prenom": { "type": "string", "description": "Prenom de la personne" },
        "nom": { "type": "string", "description": "Nom de famille" },
        "email": { "type": "string", "description": "Email si present dans le CV" },
        "telephone": { "type": "string", "description": "Telephone si present" },
        "diplomes": { "type": "array", "items": { "type": "string" }, "description": "Liste des diplomes et certifications" },
        "domaines": { "type": "array", "items": { "type": "string" }, "description": "2 a 5 domaines d'expertise deduits" },
        "anneesExperience": { "type": "string", "description": "Estimation du nombre d'annees d'experience, en chiffres" }
      },
      "required": ["prenom","nom","diplomes","domaines"]
    }
  }
}
```
- `Retry On Fail: true`, `Max Tries: 2`. `Continue On Fail: true`.

- [ ] **Step 4 : Code node — normaliser la sortie**

`n8n-nodes-base.code` (name `Formater reponse`, `runOnceForAllItems`) :

```javascript
let out = { prenom:'', nom:'', email:'', telephone:'', diplomes:[], domaines:[], anneesExperience:'' };
try {
  const resp = $input.first().json;
  const txt = resp?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (txt) {
    let parsed = JSON.parse(txt.replace(/^```json\s*/i,'').replace(/```\s*$/,'').trim());
    if (Array.isArray(parsed)) parsed = parsed[0] || {};
    out = { ...out, ...parsed };
  }
} catch (e) { /* best-effort : on renvoie l'objet vide */ }
// domaines en string aussi pour confort cote front
out.domainesStr = Array.isArray(out.domaines) ? out.domaines.join(', ') : (out.domaines || '');
out.diplomesStr = Array.isArray(out.diplomes) ? out.diplomes.join(' ; ') : (out.diplomes || '');
return [{ json: out }];
```

- [ ] **Step 5 : Respond to Webhook**

`n8n-nodes-base.respondToWebhook` (name `Repondre champs`) : `responseCode: 200`, body `={{ $json }}`, header `Content-Type: application/json` + `Access-Control-Allow-Origin: *` (la page est sur un autre domaine — gérer CORS ; idem pour WF1, ajouter les headers CORS dans `Repondre OK`/`Repondre erreur`, et gérer la requête `OPTIONS` preflight : ajouter un 2e webhook `httpMethod: OPTIONS` même path qui renvoie 204 + headers CORS, OU activer `options.allowedOrigins` si la version n8n le supporte).

- [ ] **Step 6 : Connexions, validation, test, export, commit**

`Webhook CV` → `Extraire texte CV` → `Extraire champs via Gemini` → `Formater reponse` → `Repondre champs`.
`n8n_validate_workflow` → valid. Test : `curl -X POST` avec un vrai PDF de CV → vérifier le JSON renvoyé. Exporter `workflows/formateurs-onboarding-parse-cv.json`.

```bash
git add workflows/formateurs-onboarding-parse-cv.json
git commit -m "feat(onboarding-formateur): WF0 parse CV (Gemini extraction)"
```

---

## TASK 6 : Page HTML `formulaire-formateur.html`

**Rôle :** fichier statique de référence que l'utilisateur héberge et stylise. Contient la structure des champs (noms exacts attendus par WF0/WF1), l'encart d'upload CV avec appel fetch vers WF0, le formulaire multipart vers WF1, la validation client, la page de confirmation. Le secret est injecté côté serveur (placeholder `__FORMATEUR_WEBHOOK_SECRET__`).

**Files:**
- Create: `docs/onboarding-formateur/formulaire-formateur.html`

- [ ] **Step 1 : Écrire le fichier HTML**

Create `docs/onboarding-formateur/formulaire-formateur.html` avec :
- `<head>` : meta, un `<style>` minimal (l'utilisateur le remplacera) ; deux constantes JS en haut : `const WF0_URL = "https://n8n.example.com/webhook/formateur-parse-cv";` et `const WF1_URL = "https://n8n.example.com/webhook/formateur-onboarding";` et `const SECRET = "__FORMATEUR_WEBHOOK_SECRET__";`
- **Encart CV** : `<input type="file" id="cvPrefill" accept="application/pdf">` + bouton « Pré-remplir depuis mon CV » + zone de statut. Au clic : `fetch(WF0_URL, { method:'POST', headers:{ 'X-Formateur-Secret': SECRET }, body: (() => { const fd = new FormData(); fd.append('cv', file); return fd; })() })` → `.then(r=>r.json())` → remplir les champs `prenom, nom, email, telephone`, cocher/sélectionner les domaines correspondants, mettre `annees_experience`, et préremplir un textarea « diplômes » d'aide. Gérer l'échec silencieusement (afficher « pré-remplissage indisponible, remplissez manuellement »).
- **Formulaire principal** `<form id="f" enctype="multipart/form-data">` avec les champs (attributs `name` **exacts**) :
  - `nom`, `prenom`, `email` (type email), `telephone`
  - `statut_juridique` (select : `Auto-entrepreneur` / `Portage salarial` / `Societe` / `Autre`)
  - `siret`
  - `domaines` (groupe de checkboxes `name="domaines"` — liste à fournir par l'utilisateur ; valeurs par défaut : `IA et data`, `Marketing digital`, `Management`, `Communication`, `Bureautique`, `Developpement web`, `Autre`)
  - `annees_experience` (number)
  - `disponibilites` (textarea)
  - Fichiers : `<input type="file" name="cv" accept="application/pdf" required>`, `name="diplomes"`, `name="piece_identite"`, `name="rc_pro"`, `name="rib"`, `name="attestation_insee"`, `name="attestation_vigilance"` (tous `accept="application/pdf,image/*"`)
  - `consent_rgpd` (checkbox required) + texte : « J'accepte que mes données et mon CV soient traités pour mon référencement comme formateur ; mon CV est analysé automatiquement pour pré-remplir ce formulaire. »
  - bouton submit.
- **Validation client** : champs requis, format email, CV obligatoire, taille fichiers ≤ 8 Mo (sinon message). 
- **Submit handler** : `e.preventDefault()`, construire `FormData(form)`, `fetch(WF1_URL, { method:'POST', headers:{'X-Formateur-Secret':SECRET}, body: fd })` → si 200 : masquer le form, afficher `<div id="confirm">Merci ! Votre candidature a bien été reçue...</div>` ; si erreur : afficher les erreurs renvoyées.
- En commentaire en tête du fichier : note expliquant que `__FORMATEUR_WEBHOOK_SECRET__` doit être remplacé à la livraison (server-side include / build), jamais commité avec la vraie valeur.

- [ ] **Step 2 : Commit**

```bash
git add docs/onboarding-formateur/formulaire-formateur.html
git commit -m "feat(onboarding-formateur): page formulaire HTML (reference, a heberger)"
```

---

## TASK 7 : Test bout-en-bout Phase 1

**Files:** aucun (validation manuelle) — éventuellement `docs/onboarding-formateur/test-protocol-phase1.md`

- [ ] **Step 1 : Déployer la page de test**

Héberger temporairement `formulaire-formateur.html` (avec le vrai secret injecté) sur le serveur de l'utilisateur ou en local (un simple `python3 -m http.server` ne suffira pas à cause de CORS sur les webhooks — soit on déploie sur le domaine prévu, soit on teste les webhooks au `curl` directement).

- [ ] **Step 2 : Activer WF0 et WF1**

Run (MCP) : `n8n_update_partial_workflow` pour passer `active: true` sur `Formateurs - Onboarding - Parse CV` et `Formateurs - Onboarding - Reception`.

- [ ] **Step 3 : Scénario complet**

1. Déposer un CV PDF dans l'encart → vérifier le pré-remplissage des champs.
2. Compléter le reste, joindre des PDF factices pour chaque justificatif, cocher RGPD, soumettre.
3. Vérifier : message de confirmation ; dossier `Nom Prenom/` créé dans Drive `Formateurs/` avec sous-dossiers et fichiers renommés ; ligne ajoutée au Sheet avec `Statut progression = Dossier recu`, `Justificatifs complets = oui` ; email d'accueil reçu (lien dossier cliquable) ; email admin reçu avec récap + lien de validation (même si WF2 pas encore là).
4. Resoumettre avec le même email → vérifier que la ligne est **mise à jour** (pas de doublon).
5. Vérifier dans `n8n_executions` qu'aucune exécution n'est en erreur.

- [ ] **Step 4 : Nettoyer + consigner**

Supprimer les données de test (ligne Sheet, dossier Drive, contact Brevo). Écrire un court `docs/onboarding-formateur/test-protocol-phase1.md` listant les étapes ci-dessus pour re-tests futurs.

- [ ] **Step 5 : Commit + checkpoint Phase 1**

```bash
git add docs/onboarding-formateur/test-protocol-phase1.md
git commit -m "test(onboarding-formateur): protocole de test Phase 1 valide"
```

Mettre à jour `memory/MEMORY.md` (ajouter le projet sous une section « Onboarding Formateur ») et créer `memory/project_onboarding-formateur.md` (statut Phase 1 OK, IDs workflows, webhook URLs). Commit séparé.

---

## TASK 8 : Google Docs templates (contrat de sous-traitance + charte qualité) [Phase 2]

**Files:**
- Create (Google Docs natifs via MCP) : `Template - Contrat sous-traitance formateur`, `Template - Charte qualite et deontologie formateur`
- Modify: bloc « IDs résolus » du plan (`CONTRAT_TPL_DOC_ID`, `CHARTE_TPL_DOC_ID`)

- [ ] **Step 1 : Créer le Google Doc « Contrat sous-traitance »**

Run (MCP `mcp__google-drive__createDocument`) : titre `Template - Contrat sous-traitance formateur`. Contenu : un contrat de sous-traitance de prestation de formation type, avec les **placeholders** `{{NOM}}`, `{{PRENOM}}`, `{{EMAIL}}`, `{{SIRET}}`, `{{STATUT_JURIDIQUE}}`, `{{DOMAINES}}`, `{{DATE_DU_JOUR}}`, `{{NOM_OF}}` (à remplir par l'utilisateur — fournir un squelette ; l'utilisateur ajustera les clauses). Noter le `documentId` → `CONTRAT_TPL_DOC_ID`.

- [ ] **Step 2 : Créer le Google Doc « Charte qualité / déontologie »**

`mcp__google-drive__createDocument` : titre `Template - Charte qualite et deontologie formateur`. Contenu : engagements qualité/déontologie (respect des référentiels, confidentialité, RGPD, ponctualité, mise à jour des compétences — Qualiopi indicateur 21/22), placeholders `{{NOM}}`, `{{PRENOM}}`, `{{DATE_DU_JOUR}}`. Noter `CHARTE_TPL_DOC_ID`.

- [ ] **Step 3 : Commit (mise à jour du plan)**

```bash
git add docs/plans/2026-05-11-onboarding-formateur-plan.md
git commit -m "chore(onboarding-formateur): IDs des Google Docs templates contrat/charte"
```

> Note : demander à l'utilisateur de relire/compléter le contenu juridique de ces 2 Docs avant la mise en production de la Phase 2.

---

## TASK 9 : Credential Yousign + helper d'appel API [Phase 2]

**Files:** credential n8n (manuel), pas de fichier repo.

- [ ] **Step 1 : Créer le credential Yousign**

Dans n8n : Credentials → New → `HTTP Header Auth` → name `Yousign API`, header name `Authorization`, value `Bearer <YOUSIGN_API_KEY>` (clé récupérée dans le dashboard Yousign — utiliser l'environnement **Sandbox** d'abord : `https://api-sandbox.yousign.app/v3`, puis Production `https://api.yousign.app/v3`). Noter l'ID du credential → `YOUSIGN_CRED_ID`. Définir une variable d'env n8n `YOUSIGN_BASE_URL` (sandbox au début).

- [ ] **Step 2 : Test de connectivité**

Faire un appel test `GET {{YOUSIGN_BASE_URL}}/signature_requests?limit=1` avec le credential → doit renvoyer 200 (liste vide ou non). Si 401 → corriger le credential.

- [ ] **Step 3 : Configurer le webhook Yousign**

Dans le dashboard Yousign (Sandbox) : Webhooks → ajouter un endpoint sur l'événement `signature_request.done` pointant vers `https://n8n.example.com/webhook/formateur-signature-callback` (l'URL de WF3 — à créer Task 12). Noter le secret de signature du webhook → variable d'env `YOUSIGN_WEBHOOK_SECRET`.

---

## TASK 10 : Sub-workflow `Sub - Formateur - Contrat Yousign` [Phase 2]

**Rôle / interface :** Input `{ nom, prenom, email, siret, statutJuridique, domaines, dossierId, rowNumber }`. Copie les 2 Docs templates, remplace les placeholders, exporte en PDF, crée une Signature Request Yousign (sandbox/prod) avec les 2 documents + le formateur comme signataire, l'active, met à jour le Sheet, range les PDF non signés dans `Contrats/`. Retourne `{ yousignRequestId, signatureUrl }`.

**Files:**
- n8n workflow : `Sub - Formateur - Contrat Yousign`
- Export : `workflows/sub-formateur-contrat-yousign.json`

- [ ] **Step 1 : Squelette**

`n8n_create_workflow` : name `Sub - Formateur - Contrat Yousign`, `active: false`. Node `Execute Workflow Trigger` (name `Recevoir input`), workflowInputs : `nom, prenom, email, siret, statutJuridique, domaines, dossierId, rowNumber` (string).

- [ ] **Step 2 : Copier les 2 Docs templates**

2 nodes `n8n-nodes-base.googleDrive` (`Copier contrat`, `Copier charte`) : `resource: file`, `operation: copy`, `fileId`: `CONTRAT_TPL_DOC_ID` / `CHARTE_TPL_DOC_ID`, `name`: `={{ "Contrat - " + $json.nom + " " + $json.prenom }}` / `={{ "Charte - " + $json.nom + " " + $json.prenom }}`, `parents`: `={{ [$json.dossierId] }}` (ou le sous-dossier `Contrats` — récupérer son ID via une recherche, ou stocker l'ID du sous-dossier Contrats dans le Sheet à la Task 1... simplification : copier dans le dossier racine du formateur). credential `GDRIVE_CRED_ID`.

- [ ] **Step 3 : Remplacer les placeholders (Docs API)**

2 nodes `n8n-nodes-base.httpRequest` (`Remplacer placeholders contrat`, `Remplacer placeholders charte`) :
- `method: POST`, `url: =https://docs.googleapis.com/v1/documents/{{ $json.id }}:batchUpdate`
- Auth : credential Google Drive OAuth2 (`GDRIVE_CRED_ID` — couvre Docs API, cf. REX) — type `OAuth2`.
- Body : un tableau de `replaceAllText` requests, un par placeholder :
```json
{ "requests": [
  { "replaceAllText": { "containsText": { "text": "{{NOM}}", "matchCase": true }, "replaceText": "={{ $('Recevoir input').first().json.nom }}" } },
  { "replaceAllText": { "containsText": { "text": "{{PRENOM}}", "matchCase": true }, "replaceText": "={{ $('Recevoir input').first().json.prenom }}" } },
  { "replaceAllText": { "containsText": { "text": "{{EMAIL}}", "matchCase": true }, "replaceText": "={{ $('Recevoir input').first().json.email }}" } },
  { "replaceAllText": { "containsText": { "text": "{{SIRET}}", "matchCase": true }, "replaceText": "={{ $('Recevoir input').first().json.siret }}" } },
  { "replaceAllText": { "containsText": { "text": "{{STATUT_JURIDIQUE}}", "matchCase": true }, "replaceText": "={{ $('Recevoir input').first().json.statutJuridique }}" } },
  { "replaceAllText": { "containsText": { "text": "{{DOMAINES}}", "matchCase": true }, "replaceText": "={{ $('Recevoir input').first().json.domaines }}" } },
  { "replaceAllText": { "containsText": { "text": "{{DATE_DU_JOUR}}", "matchCase": true }, "replaceText": "={{ $now.toFormat('dd/MM/yyyy') }}" } }
] }
```
(la charte n'a que `{{NOM}}`, `{{PRENOM}}`, `{{DATE_DU_JOUR}}` → adapter le body de `Remplacer placeholders charte`.)

- [ ] **Step 4 : Exporter les 2 Docs en PDF**

2 nodes `n8n-nodes-base.googleDrive` (`Exporter contrat PDF`, `Exporter charte PDF`) : `resource: file`, `operation: download`, `fileId`: `={{ $('Copier contrat').first().json.id }}` / charte, `options.googleFileConversion.docsToFormat: application/pdf`, `binaryPropertyName: contratPdf` / `chartePdf`. (cf. REX : `googleFileConversion` pour les Docs natifs.)

- [ ] **Step 5 : Yousign — créer la Signature Request (draft)**

`n8n-nodes-base.httpRequest` (name `Creer signature request`) :
- `method: POST`, `url: ={{ $env.YOUSIGN_BASE_URL }}/signature_requests`
- Auth : `YOUSIGN_CRED_ID`
- Body : `{ "name": "Contractualisation formateur {{ $('Recevoir input').first().json.nom }} {{ ... }}", "delivery_mode": "email", "timezone": "Europe/Paris" }`
- → renvoie `{ id, ... }` → `signatureRequestId`.

- [ ] **Step 6 : Yousign — uploader les 2 documents**

2 nodes `n8n-nodes-base.httpRequest` (`Uploader contrat Yousign`, `Uploader charte Yousign`) :
- `method: POST`, `url: =${YOUSIGN_BASE_URL}/signature_requests/{{ $('Creer signature request').first().json.id }}/documents`
- `contentType: multipart-form-data`, body : `file` = binaire (`contratPdf` / `chartePdf`), `nature` = `signable_document`.
- → chaque réponse renvoie `{ id }` → `documentId` (contrat & charte).

- [ ] **Step 7 : Yousign — ajouter le signataire**

`n8n-nodes-base.httpRequest` (name `Ajouter signataire`) :
- `method: POST`, `url: =.../signature_requests/{{...id}}/signers`
- Body :
```json
{
  "info": { "first_name": "={{ $('Recevoir input').first().json.prenom }}", "last_name": "={{ $('Recevoir input').first().json.nom }}", "email": "={{ $('Recevoir input').first().json.email }}", "locale": "fr" },
  "signature_level": "electronic_signature",
  "signature_authentication_mode": "no_otp",
  "fields": [
    { "document_id": "={{ $('Uploader contrat Yousign').first().json.id }}", "type": "signature", "page": 1, "x": 100, "y": 700, "width": 200, "height": 75 },
    { "document_id": "={{ $('Uploader charte Yousign').first().json.id }}", "type": "signature", "page": 1, "x": 100, "y": 700, "width": 200, "height": 75 }
  ]
}
```
(les coordonnées des champs de signature : à ajuster selon la mise en page réelle des Docs ; Yousign fournit aussi un mode « signature insertion » par l'expéditeur.)

- [ ] **Step 8 : Yousign — activer la demande**

`n8n-nodes-base.httpRequest` (name `Activer signature request`) : `method: POST`, `url: =.../signature_requests/{{...id}}/activate`. → renvoie le statut + (selon config) les liens. `Retry On Fail: true`.

- [ ] **Step 9 : Upload des PDF non signés dans Drive `Contrats/`**

2 nodes `googleDrive upload` (`Archiver contrat non signe`, `Archiver charte non signee`) → dans le dossier du formateur (ou son sous-dossier `Contrats`). Optionnel mais recommandé pour la traçabilité.

- [ ] **Step 10 : MAJ Sheet — `Contrat envoye`**

`n8n-nodes-base.googleSheets` (name `MAJ statut contrat envoye`, `operation: update`, match sur `Email` = `={{ $('Recevoir input').first().json.email }}`) : `Statut progression = Contrat envoye`, `Yousign request ID = ={{ $('Creer signature request').first().json.id }}`, `Date contrat envoye = ={{ $now.toISO() }}`. credential `GSHEETS_CRED_ID`, `Retry On Fail: true`.

- [ ] **Step 11 : Code output**

`n8n-nodes-base.code` (name `Output`) : `return [{ json: { yousignRequestId: $('Creer signature request').first().json.id, signatureUrl: $('Activer signature request').first().json.signers?.[0]?.signature_link || '' } }];`

- [ ] **Step 12 : Connexions, validation, test (sandbox), export, commit**

Chaîne : `Recevoir input` → `Copier contrat` → `Remplacer placeholders contrat` → `Exporter contrat PDF` → `Copier charte` → `Remplacer placeholders charte` → `Exporter charte PDF` → `Creer signature request` → `Uploader contrat Yousign` → `Uploader charte Yousign` → `Ajouter signataire` → `Activer signature request` → `Archiver contrat non signe` → `Archiver charte non signee` → `MAJ statut contrat envoye` → `Output`.
`n8n_validate_workflow` → valid. Test : `n8n_test_workflow` avec un input réel en **Sandbox Yousign** → vérifier qu'une signature request apparaît dans le dashboard Yousign sandbox, que le Sheet passe à `Contrat envoye`, que les PDF sont dans Drive. Exporter `workflows/sub-formateur-contrat-yousign.json`.

```bash
git add workflows/sub-formateur-contrat-yousign.json
git commit -m "feat(onboarding-formateur): sub-workflow contrat Yousign (sandbox)"
```

---

## TASK 11 : WF2 `Formateurs - Validation` (gate humaine, Webhook) [Phase 2]

**Rôle :** déclenché par le lien tokenisé de l'email admin. Vérifie le token, retrouve le formateur, appelle `Sub - Formateur - Contrat Yousign`, confirme.

**Files:**
- n8n workflow : `Formateurs - Validation`
- Export : `workflows/formateurs-validation.json`

- [ ] **Step 1 : Squelette + Webhook GET**

`n8n_create_workflow` : name `Formateurs - Validation`, `active: false`. Node `n8n-nodes-base.webhook` (name `Webhook validation`) : `httpMethod: GET`, `path: formateur-valider`, `responseMode: responseNode`. Query attendus : `email`, `token`.

- [ ] **Step 2 : Code — vérifier le token**

`n8n-nodes-base.code` (name `Verifier token`) :

```javascript
const crypto = require('crypto');
const secret = $env.FORMATEUR_VALIDATION_SECRET || '';
const q = $input.first().json.query || {};
const email = (q.email || '').toLowerCase();
const expected = crypto.createHmac('sha256', secret).update(email).digest('hex');
const ok = secret && q.token && q.token === expected;
return [{ json: { _ok: ok, email } }];
```

- [ ] **Step 3 : Router ok / ko (2 Code parallèles)** + **Lookup Sheet** sur la branche ok

Branche ok → `n8n-nodes-base.googleSheets` lookup `Email` = `={{ $json.email }}` (`alwaysOutputData: true`, `includeRowNumber: true`). Puis Code `Verifier eligibilite` : vérifier `Statut progression` ∈ `Dossier recu`/`Justificatifs complets` et `Yousign request ID` vide → sinon « déjà traité ».

- [ ] **Step 4 : Marquer `Valide = oui` + appeler le sub Yousign**

Sur la branche ok éligible : `googleSheets update` (`Valide = oui`) → `executeWorkflow` vers `Sub - Formateur - Contrat Yousign` avec les inputs `nom, prenom, email, siret, statutJuridique, domaines` depuis la ligne Sheet, `dossierId` (extrait du `Lien dossier` ou stocké séparément), `rowNumber`.

- [ ] **Step 5 : Réponses webhook**

- Branche ok éligible → `respondToWebhook` : 200, HTML simple « Formateur validé, contrat envoyé en signature. »
- Branche ok non éligible → 200, HTML « Ce formateur a déjà été traité. »
- Branche ko (token invalide) → 403, HTML « Lien invalide ou expiré. »
- Notif admin de confirmation (HTTP Brevo) optionnelle.

- [ ] **Step 6 : Connexions, validation, test, export, commit**

`n8n_validate_workflow` → valid. Test : générer un token valide pour un email de test présent dans le Sheet, appeler le webhook → vérifier le déclenchement du sub Yousign et la MAJ du Sheet. Tester aussi un token invalide → 403. Exporter `workflows/formateurs-validation.json`.

```bash
git add workflows/formateurs-validation.json
git commit -m "feat(onboarding-formateur): WF2 validation (gate humaine, webhook tokenise)"
```

---

## TASK 12 : WF3 `Formateurs - Callback Signature` (Webhook Yousign) [Phase 2]

**Rôle :** reçoit le webhook Yousign `signature_request.done`, met à jour le Sheet, télécharge le PDF signé, l'archive dans Drive, envoie les confirmations.

**Files:**
- n8n workflow : `Formateurs - Callback Signature`
- Export : `workflows/formateurs-callback-signature.json`

- [ ] **Step 1 : Squelette + Webhook POST**

`n8n_create_workflow` : name `Formateurs - Callback Signature`, `active: false`. Node `webhook` (name `Webhook Yousign`) : `httpMethod: POST`, `path: formateur-signature-callback`, `responseMode: onReceived` (répondre 200 tout de suite — Yousign attend un 2xx rapide).

- [ ] **Step 2 : Code — extraire l'ID + vérifier la signature du webhook**

`n8n-nodes-base.code` (name `Parser event Yousign`) :

```javascript
const crypto = require('crypto');
const item = $input.first();
const body = item.json.body || item.json;
const headers = item.json.headers || {};
// verification de signature (header X-Yousign-Signature-256 = HMAC-SHA256 hex du raw body avec YOUSIGN_WEBHOOK_SECRET)
// note: pour verifier le raw body, activer options.rawBody sur le webhook et utiliser $input.first().json.body en string.
const eventName = body.event_name || body.event || '';
const sr = body.data && body.data.signature_request ? body.data.signature_request : (body.signature_request || body.data || {});
const signatureRequestId = sr.id || (body.data && body.data.id) || '';
return [{ json: { eventName, signatureRequestId } }];
```

- [ ] **Step 3 : Filtrer l'événement** (Code) : ne garder que `eventName === 'signature_request.done'`. Si autre → `return [];` (fin).

- [ ] **Step 4 : Lookup Sheet par `Yousign request ID`**

`googleSheets` lookup : `lookupColumn: Yousign request ID`, `lookupValue: ={{ $json.signatureRequestId }}`, `alwaysOutputData: true`, `includeRowNumber: true`. Si rien trouvé → Code `return [];`.

- [ ] **Step 5 : MAJ Sheet — `Contrat signe`**

`googleSheets update` (match `Email` = ligne trouvée) : `Statut progression = Contrat signe`, `Date contrat signe = ={{ $now.toISO() }}`.

- [ ] **Step 6 : Télécharger le PDF signé depuis Yousign**

`n8n-nodes-base.httpRequest` (name `Telecharger PDF signe`) : `method: GET`, `url: =${YOUSIGN_BASE_URL}/signature_requests/{{ $('Parser event Yousign').first().json.signatureRequestId }}/documents/download` (ou récupérer la liste des documents puis chaque `/documents/{id}/download`), `responseFormat: file`, `binaryPropertyName: signedPdf`. credential `YOUSIGN_CRED_ID`.

- [ ] **Step 7 : Archiver dans Drive**

`googleDrive upload` : `name: =Contrat-signe-{{ $now.toFormat('yyyy-MM-dd') }}.pdf`, dossier = celui du formateur (extraire l'ID depuis `Lien dossier` de la ligne Sheet, ou recherche par nom). `inputDataFieldName: signedPdf`.

- [ ] **Step 8 : Confirmations email**

2 nodes `httpRequest` Brevo : (a) au formateur → template `BREVO_TPL_CONTRAT_SIGNE` ; (b) à l'admin → email simple « Contrat signé par {{nom}} {{prenom}} ».

- [ ] **Step 9 : Connexions, validation, test, export, commit**

`Webhook Yousign` → `Parser event Yousign` → `Filtrer event` → `Lookup Sheet` → `MAJ Sheet` → `Telecharger PDF signe` → `Archiver dans Drive` → (`Confirmer formateur`, `Confirmer admin`).
`n8n_validate_workflow` → valid. Test : en Sandbox Yousign, faire signer la demande de test (ou simuler le webhook au `curl` avec un payload `signature_request.done` contenant l'ID de la demande sandbox) → vérifier Sheet `Contrat signe`, PDF archivé, emails reçus. Exporter `workflows/formateurs-callback-signature.json`.

```bash
git add workflows/formateurs-callback-signature.json
git commit -m "feat(onboarding-formateur): WF3 callback signature Yousign"
```

---

## TASK 13 : Test bout-en-bout Phase 2

**Files:** `docs/onboarding-formateur/test-protocol-phase2.md`

- [ ] **Step 1 : Activer WF2 et WF3**, vérifier la config webhook Yousign (sandbox) pointe sur WF3.

- [ ] **Step 2 : Scénario complet** : soumettre une candidature (Phase 1) → recevoir l'email admin → cliquer le lien de validation → vérifier que le contrat + la charte arrivent par email Yousign au formateur de test → les signer → vérifier le Sheet `Contrat signe`, le PDF signé dans Drive, les emails de confirmation.

- [ ] **Step 3 : Cas limites** : cliquer 2× le lien de validation (le 2e doit dire « déjà traité ») ; lien avec token bidouillé → 403.

- [ ] **Step 4 : Bascule Production Yousign** : une fois validé en sandbox, changer `YOUSIGN_BASE_URL` et le credential vers la prod, recréer le webhook Yousign en prod.

- [ ] **Step 5 : Commit**

```bash
git add docs/onboarding-formateur/test-protocol-phase2.md
git commit -m "test(onboarding-formateur): protocole de test Phase 2"
```

---

## TASK 14 : WF4 `Formateurs - Relances et validation differee` (Schedule) [Phase 3]

**Rôle :** scan quotidien du Sheet ; relances justificatifs / signature ; alerte admin ; validation différée (case `Valide` cochée à la main).

**Files:**
- n8n workflow : `Formateurs - Relances et validation differee`
- Export : `workflows/formateurs-relances-validation-differee.json`

- [ ] **Step 1 : Squelette + Schedule**

`n8n_create_workflow` : name `Formateurs - Relances et validation differee`, `active: false`. Node `n8n-nodes-base.scheduleTrigger` (name `Tous les jours 9h`) : `rule.interval: [{ field: "days", triggerAtHour: 9 }]`, timezone `Europe/Paris`.

- [ ] **Step 2 : Lire tout le Sheet**

`googleSheets` (name `Lire formateurs`) : `operation: read` (Get many rows), `documentId: SHEET_ID`, `sheetName: Formateurs`, `options.returnAllMatches: true`. credential `GSHEETS_CRED_ID`.

- [ ] **Step 3 : Code — segmenter**

`n8n-nodes-base.code` (name `Segmenter`, `runOnceForAllItems`) :

```javascript
const rows = $input.all().map(i => i.json);
const now = new Date();
const days = (iso) => iso ? (now - new Date(iso)) / 86400000 : Infinity;

const relanceJustif = [], relanceSign = [], alerteAdmin = [], validationDifferee = [];
for (const r of rows) {
  const statut = r['Statut progression'];
  const nbRelances = parseInt(r['Nb relances'] || '0', 10);
  const dernierContact = days(r['Date dernier contact'] || r['Horodatage']);
  const dateEnvoye = days(r['Date contrat envoye']);

  if ((r.Valide || '').toLowerCase() === 'oui' && (statut === 'Dossier recu' || statut === 'Justificatifs complets') && !r['Yousign request ID']) {
    validationDifferee.push(r); continue;
  }
  if (statut === 'Dossier recu' && (r['Justificatifs complets'] || 'non').toLowerCase() !== 'oui' && dernierContact > 3) {
    relanceJustif.push(r); continue;
  }
  if (statut === 'Contrat envoye' && dateEnvoye > 5) {
    if (nbRelances >= 3) alerteAdmin.push(r);
    else relanceSign.push(r);
  }
}
return [
  ...relanceJustif.map(json => ({ json: { ...json, _seg: 'justif' } })),
  ...relanceSign.map(json => ({ json: { ...json, _seg: 'sign' } })),
  ...alerteAdmin.map(json => ({ json: { ...json, _seg: 'admin' } })),
  ...validationDifferee.map(json => ({ json: { ...json, _seg: 'valid' } })),
];
```

- [ ] **Step 4 : 4 Code nodes en parallèle** (filtrer par `_seg`) → `Filtrer justif`, `Filtrer sign`, `Filtrer admin`, `Filtrer valid` (chacun : `return $input.all().filter(i => i.json._seg === '<seg>');`).

- [ ] **Step 5 : Branche justif** : `httpRequest` Brevo (template `BREVO_TPL_RELANCE_JUSTIF`, `to` = email du formateur, params : prénom, liste des justificatifs manquants — calculée dans un petit Code amont à partir des colonnes `CV/Diplomes/...` vides) → `googleSheets update` (`Date dernier contact = now`).

- [ ] **Step 6 : Branche sign** : `httpRequest` Brevo (template `BREVO_TPL_RELANCE_SIGN`, params : prénom, lien de signature si stocké) → `googleSheets update` (`Nb relances = ={{ (parseInt($json['Nb relances']||'0',10)+1).toString() }}`, `Date dernier contact = now`).

- [ ] **Step 7 : Branche admin** : `httpRequest` Brevo email à l'admin « Dossier formateur bloqué : {{nom}} {{prenom}} — {{nbRelances}} relances sans signature ».

- [ ] **Step 8 : Branche valid** : `executeWorkflow` vers `Sub - Formateur - Contrat Yousign` (mêmes inputs que Task 11 Step 4). (Le sub met lui-même le Sheet à `Contrat envoye`.)

- [ ] **Step 9 : Connexions, validation, test, export, commit**

`Tous les jours 9h` → `Lire formateurs` → `Segmenter` → (4×) `Filtrer *` → branches respectives.
`n8n_validate_workflow` → valid. Test : préparer 3-4 lignes de test dans le Sheet couvrant chaque segment (dates anciennes), exécuter le workflow manuellement (`n8n_test_workflow`), vérifier les emails et MAJ. Nettoyer. Exporter `workflows/formateurs-relances-validation-differee.json`.

```bash
git add workflows/formateurs-relances-validation-differee.json
git commit -m "feat(onboarding-formateur): WF4 relances et validation differee"
```

---

## TASK 15 : Error workflow + activation + REX [Phase 3]

**Files:**
- Modify (via MCP) : les 5 workflows (settings → errorWorkflow)
- Modify: `docs/rex-automatisations.md`, `memory/MEMORY.md`, `memory/project_onboarding-formateur.md`

- [ ] **Step 1 : Assigner l'Error workflow**

Pour chacun des workflows (`Formateurs - Onboarding - Reception`, `Formateurs - Onboarding - Parse CV`, `Formateurs - Validation`, `Formateurs - Callback Signature`, `Formateurs - Relances et validation differee`, et les 4 sub-workflows) : via `n8n_update_partial_workflow`, mettre `settings.errorWorkflow = ERROR_WF_ID`.

- [ ] **Step 2 : Vérifier la checklist qualité CLAUDE.md**

Parcourir la checklist « avant publish » de `CLAUDE.md` pour chaque workflow : nodes nommés, sticky notes sur la logique non évidente, retry sur HTTP, validation des inputs, idempotence, pas de secrets en dur, désactivé par défaut jusqu'à validation. Corriger les manques.

- [ ] **Step 3 : Activer en production**

Passer `active: true` sur les 5 workflows (les 4 sub-workflows restent `active: false` — ils sont appelés, pas déclenchés). Vérifier `n8n_health_check` + une dernière soumission de test bout-en-bout (Phase 1+2), puis nettoyer.

- [ ] **Step 4 : Tag de version**

```bash
git tag -a v-onboarding-formateur-1.0 -m "Onboarding formateur : 5 workflows + page formulaire, Phases 1-3"
git push origin --tags   # si remote configure
```

- [ ] **Step 5 : REX + mémoire**

- Ajouter une section 8 (ou suite) à `docs/rex-automatisations.md` : leçons (multipart vers webhook n8n, CORS sur webhooks custom, Yousign API v3 sandbox→prod, Docs API batchUpdate replaceAllText pour les templates contrat, gate de validation tokenisée).
- Mettre à jour `memory/MEMORY.md` : section « Onboarding Formateur » avec les IDs des workflows + URLs webhook + Sheet ID + Brevo list ID.
- Finaliser `memory/project_onboarding-formateur.md` (statut : en production, date, architecture, points ouverts).

```bash
git add docs/rex-automatisations.md memory/
git commit -m "docs(onboarding-formateur): REX + mise a jour memoire (mise en production)"
```

- [ ] **Step 6 : Merge de la branche** (après validation utilisateur)

```bash
git checkout main && git merge --no-ff feat/onboarding-formateur && git branch -d feat/onboarding-formateur
```

---

## IDs résolus (à remplir pendant l'exécution)

- ERROR_WF_ID = …
- GDRIVE_CRED_ID = …
- GSHEETS_CRED_ID = …
- BREVO_CRED_ID = N8N_RESOURCE_ID_20
- GEMINI_CRED_ID = N8N_RESOURCE_ID_06
- YOUSIGN_CRED_ID = …
- SHEET_ID = …
- DRIVE_ROOT_FORMATEURS_ID = …
- BREVO_LIST_ID = …
- BREVO_TPL_BIENVENUE = …
- BREVO_TPL_CONTRAT_ENVOYE = …
- BREVO_TPL_CONTRAT_SIGNE = …
- BREVO_TPL_RELANCE_JUSTIF = …
- BREVO_TPL_RELANCE_SIGN = …
- CONTRAT_TPL_DOC_ID = …
- CHARTE_TPL_DOC_ID = …
- Workflow IDs : WF0=… WF1=… WF2=… WF3=… WF4=… ; Subs : drive=… fiche=… email=… yousign=…
