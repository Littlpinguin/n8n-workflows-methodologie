# Design — Onboarding Formateur (Organisme de Formation)

> Statut : design validé en brainstorming, à valider par l'utilisateur avant plan d'implémentation
> Date : 2026-05-11
> Pattern de référence : Diagnostic IA (`N8N_RESOURCE_ID_04`) — formulaire custom hébergé + webhook n8n + Gemini + Brevo

## 1. Objectif

Automatiser le parcours d'arrivée d'un nouveau **formateur / intervenant** dans l'organisme de formation : collecte des justificatifs (preuves Qualiopi indicateur 21 — compétences des intervenants), création de son espace documentaire, enregistrement dans la base de référence, contractualisation par signature électronique, email d'accueil avec le kit pédagogique, et relances automatiques sur les pièces ou la signature manquantes.

Le point d'entrée est un **formulaire custom hébergé sur le serveur de l'utilisateur** (HTML/CSS/JS statique, stylé par l'utilisateur), à la façon du diagnostic IA, qui POST vers un webhook n8n.

## 2. Périmètre

**Dans le périmètre**
- Page formulaire custom avec uploads multiples + **pré-remplissage du formulaire par analyse IA du CV**
- Création d'un espace Drive par formateur + classement des justificatifs
- Base de référence : Google Sheet « Formateurs » avec statut de progression
- **Gate de validation humaine** : l'envoi du contrat Yousign n'a lieu qu'après validation explicite de l'utilisateur
- Génération du contrat de sous-traitance + charte qualité/déontologie pré-remplis (Google Docs templates éditables) → signature électronique **Yousign**
- Suivi de la signature (callback webhook Yousign) → archivage du PDF signé
- Email d'accueil + kit (livret formateur, modèles émargement/évaluation/programmes, procédures, liste des accès à activer) via **Brevo**
- Relances automatiques (justificatifs incomplets, contrat non signé) + alerte admin
- Error workflow dédié

**Hors périmètre (YAGNI — backlog)**
- Création automatique de comptes outils / LMS (l'email liste les accès à activer manuellement)
- Screening / scoring IA du CV pour décision (l'utilisateur valide à la main ; l'IA sert uniquement au pré-remplissage)
- Stockage dans Notion (Google Sheet uniquement)
- Suivi des renouvellements annuels d'attestations (futur WF dédié)
- Upload des fichiers via Supabase Storage (plan B si les fichiers deviennent volumineux ; on part sur multipart → webhook)

## 3. Architecture

```
[Page formulaire custom — serveur utilisateur]
   │  1. (optionnel) POST le CV seul ─────────────▶ [WF0 — Parse CV]  ──JSON──▶ pré-remplit les champs
   │  2. POST multipart/form-data (toutes les données + fichiers) ─▶ [Webhook WF1]
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ WF1 — Formateurs · Onboarding · Reception   (orchestrateur, Webhook Trigger)   │
│   Webhook ▶ Valider payload ▶ Respond to Webhook (page de confirmation)        │
│           ▶ Sub: Creer espace Drive                                            │
│           ▶ Sub: Enregistrer fiche (Google Sheet)                              │
│           ▶ Sub: Email accueil + kit (Brevo)                                   │
│           ▶ Notif admin (email avec lien « Valider et envoyer le contrat »)    │
└──────────────────────────────────────────────────────────────────────────────┘

[Lien de validation dans l'email admin] ─▶ [WF2 — Formateurs · Validation]  (Webhook Trigger)
                                              ▶ Sub: Contrat Yousign
                                              ▶ MAJ Sheet « Contrat envoye »
   (fallback manuel : case « Valide » cochée dans le Sheet → reprise par WF4)

[Yousign] ─ webhook « signature_request.done » ─▶ [WF3 — Formateurs · Callback Signature]  (Webhook Trigger)
                                                    ▶ lookup ligne par Yousign request ID
                                                    ▶ MAJ Sheet « Contrat signe » + date
                                                    ▶ télécharge le PDF signé ▶ Drive/{Nom}/Contrats/
                                                    ▶ email confirmation formateur (Brevo) + notif admin

[Schedule quotidien ~9h] ─▶ [WF4 — Formateurs · Relances & validation différée]  (Schedule Trigger)
                              ▶ lit le Sheet, Code de tri ▶ branches parallèles :
                                 - relance justificatifs (Dossier recu + incomplets + > 3 j)
                                 - relance signature (Contrat envoye + > 5 j) + incrément Nb relances
                                 - alerte admin (Nb relances ≥ 3)
                                 - validation différée (case Valide cochée + statut ≤ Justificatifs complets → Sub Contrat Yousign)

Briques transverses :
  - Google Sheet « Formateurs »  (base de référence)
  - 2 Google Docs templates dans Drive : « Contrat de sous-traitance », « Charte qualité / déontologie » (éditables, à placeholders)
  - Brevo : liste « Formateurs » + templates (bienvenue+kit, relance justificatifs, relance signature, confirmation signature)
  - Error workflow dédié (Error Trigger → email admin avec contexte)
```

## 4. Workflows en détail

### WF0 — Formateurs · Onboarding · Parse CV (Webhook Trigger)
- **But** : à l'ouverture du formulaire, le formateur dépose son CV ; on renvoie un JSON pour pré-remplir les champs.
- **Flux** : `Webhook (POST le CV, multipart)` → `Extract from File` (texte du PDF) → `HTTP Request Gemini` (extraction structurée, `responseMimeType: application/json`, `responseSchema` détaillé) → `Respond to Webhook` (JSON).
- **Champs extraits** : `prenom`, `nom`, `email`, `telephone`, `diplomes` (liste), `domaines` (déduits du parcours), `anneesExperience` (estimation depuis l'historique). Les champs absents d'un CV (statut juridique, SIRET, disponibilités) ne sont pas extraits.
- **Best-effort, jamais bloquant** : si l'extraction échoue, le webhook renvoie `{}` et le formulaire reste pleinement utilisable.
- **Gemini** : `systemInstruction` séparé (rôle + règles d'extraction), balises XML, température 1.0, données avant instructions (cf. REX Gemini 3). Credential `googlePalmApi`.
- **RGPD** : la page affiche « votre CV est analysé automatiquement pour pré-remplir le formulaire » à côté du consentement.

### WF1 — Formateurs · Onboarding · Reception (Webhook Trigger — orchestrateur)
- **Webhook** : reçoit `multipart/form-data` — champs texte + fichiers binaires. Protégé par un header secret partagé avec la page.
- **Valider payload** (Code) : champs requis présents, consentement RGPD coché, fichiers obligatoires présents (CV ; les autres recommandés). Déduplication par email : si l'email existe déjà dans le Sheet → mode mise à jour de la ligne plutôt que création. Positionne `Justificatifs complets = oui` si tous les justificatifs attendus (CV, diplômes, pièce d'identité, RC pro, RIB, attestation INSEE) sont présents, sinon `non` (l'admin peut le forcer manuellement après revue).
- **Respond to Webhook** : réponse immédiate (200 + message/redirection) pour la page de confirmation ; le reste s'exécute derrière.
- **Sub: Creer espace Drive** → puis **Sub: Enregistrer fiche** → puis **Sub: Email accueil + kit** → puis **Notif admin**.
- Error handling : `continueOnFail` + routage sur les uploads Drive (un fichier en échec est noté dans le Sheet, n'arrête pas le workflow).

### WF2 — Formateurs · Validation (Webhook Trigger)
- Déclenché par un **lien tokenisé** dans l'email de notification admin (« Valider et envoyer le contrat »).
- Retrouve la ligne du formateur, vérifie l'éligibilité (justificatifs présents), appelle **Sub: Contrat Yousign**, met à jour le Sheet (`Contrat envoye`, `Yousign request ID`, `Date contrat envoye`), confirme à l'admin.
- **Fallback manuel** : si l'utilisateur préfère, il coche la colonne `Valide` dans le Sheet ; WF4 (scheduler) reprend les lignes validées non encore contractualisées.

### WF3 — Formateurs · Callback Signature Yousign (Webhook Trigger)
- URL configurée dans Yousign sur l'événement `signature_request.done`.
- Lookup de la ligne par `Yousign request ID` (Google Sheets, `alwaysOutputData: true`).
- MAJ : `Statut progression = Contrat signe`, `Date contrat signe`.
- Récupère le PDF signé via l'API Yousign → upload dans `Formateurs/{Nom Prénom}/Contrats/Contrat-signe-{date}.pdf`.
- Email de confirmation au formateur (Brevo) + email de notif à l'admin.

### WF4 — Formateurs · Relances & validation différée (Schedule Trigger ~9h)
- Lit le Sheet « Formateurs », un Code node de tri produit les segments, **branches parallèles** (pas d'IF via API — cf. REX, on utilise des Code nodes en parallèle) :
  - **Relance justificatifs** : `Statut = Dossier recu` ET `Justificatifs complets = non` ET dernier contact > 3 j → email relance (Brevo), MAJ date dernier contact.
  - **Relance signature** : `Statut = Contrat envoye` ET `Date contrat envoye` > 5 j → email relance, incrémente `Nb relances`.
  - **Alerte admin** : `Nb relances ≥ 3` → email à l'admin « dossier formateur bloqué ».
  - **Validation différée** : `Valide = oui` ET `Statut ≤ Justificatifs complets` → appelle **Sub: Contrat Yousign** puis MAJ Sheet.

## 5. Sub-workflows (1 responsabilité chacun, interface explicite)

| Sub-workflow | Input | Traitement | Output |
|---|---|---|---|
| **Sub · Formateur · Creer espace Drive** | `{nom, prenom, email, files[]}` | Crée `Formateurs/{Nom Prénom}/` + sous-dossiers `Administratif`, `Contrats`, `Pedagogie`. Upload chaque fichier dans `Administratif` avec un nommage normalisé (`CV-Nom-Prenom.pdf`, `Diplome-...`, `RC-pro-...`, `RIB-...`, `Attestation-INSEE-...`, `Attestation-vigilance-...`, `Piece-identite-...`). | `{dossierUrl, dossierId, liens: {cv, diplomes, pieceIdentite, rcPro, rib, attestInsee, attestVigilance}}` |
| **Sub · Formateur · Enregistrer fiche** | toutes les données + liens Drive | Append (ou update si déduplication) une ligne au Google Sheet « Formateurs ». `Statut progression = Dossier recu`. | `{rowNumber}` |
| **Sub · Formateur · Contrat Yousign** | `{identité, email, siret, statutJuridique, domaines, dossierId, rowNumber}` | Copie le Google Doc template (Drive API `files.copy`) → remplace les placeholders `{{...}}` via Docs API `documents.batchUpdate` → export PDF. Crée une Signature Request Yousign (API v3 : `POST /signature_requests` draft → upload du/des document(s) → ajout du signataire (le formateur) → `activate`). MAJ Sheet : `Contrat envoye`, `Yousign request ID`, `Date contrat envoye`. | `{yousignRequestId, signatureUrl}` |
| **Sub · Formateur · Email accueil** | `{email, prenom, dossierUrl}` | Ajoute le contact à la liste Brevo « Formateurs » (attributs : prénom, domaines, statut). Déclenche l'email « Bienvenue + kit » (template Brevo) : lien vers le dossier Drive partagé, livret formateur, modèles (feuilles d'émargement, évaluations à chaud/à froid, programmes types), procédures pédagogiques, liste des accès outils à activer. | — |

> Note : contrat + charte → décision à confirmer au moment du plan (1 seul PDF combiné, ou 2 documents dans la même Signature Request Yousign). Défaut proposé : **2 documents dans une même Signature Request**.

## 6. Données — Google Sheet « Formateurs »

Colonnes **ASCII-safe** (pas d'accents — cf. REX sur le matching headers/schema n8n) :

`Horodatage | Nom | Prenom | Email | Telephone | Statut juridique | SIRET | Domaines | Annees experience | Disponibilites | Lien dossier | CV | Diplomes | Piece identite | RC pro | RIB | Attestation INSEE | Attestation vigilance | Justificatifs complets | Statut progression | Valide | Yousign request ID | Date contrat envoye | Date contrat signe | Nb relances | Date dernier contact | Notes`

**Statut progression** : `Dossier recu` → `Justificatifs complets` → `Contrat envoye` → `Contrat signe` → `Actif`

## 7. Page formulaire (hébergée par l'utilisateur)

- HTML/CSS/JS statique, stylé par l'utilisateur (l'automatisation ne fournit pas le design de la page, seulement le contrat d'interface : champs attendus + endpoints).
- **Encart pré-remplissage** : zone de dépôt « Déposez votre CV pour gagner du temps » → POST du CV vers le webhook WF0 → spinner ~3-5 s → pré-remplissage des champs renvoyés → le formateur relit/corrige/complète.
- **Sections du formulaire** : Identité & contact / Statut juridique & SIRET / Domaines d'intervention (multi-choix) / Expérience & disponibilités / Justificatifs (uploads multiples : CV, diplômes & certifications, pièce d'identité, attestation RC pro, RIB, attestation INSEE, attestation de vigilance URSSAF) / Consentement RGPD (+ mention analyse IA du CV).
- `<form enctype="multipart/form-data">` → POST vers le webhook WF1. Validation côté client : champs requis, types de fichiers (PDF/JPG/PNG), taille max ~8 Mo/fichier.
- Page de confirmation rendue à partir de la réponse du `Respond to Webhook`.

## 8. Fiabilité & sécurité

- **Error workflow dédié** (Error Trigger → email admin avec workflow/exécution/contexte), assigné à tous les workflows via Settings.
- `Respond to Webhook` **tôt** dans WF1 (réponse immédiate, traitement asynchrone derrière).
- **Retry** activé sur les nodes HTTP (Yousign, Brevo, Gemini, Drive/Docs API) avec backoff.
- `continueOnFail` + routage sur les uploads Drive (échec d'un fichier → noté dans le Sheet, pas d'arrêt).
- **Idempotence** : déduplication par email dans le Sheet (resoumission → mise à jour de la ligne existante).
- **Webhooks protégés** : header secret partagé entre la page et n8n (WF0, WF1) ; lien de validation WF2 tokenisé ; webhook Yousign vérifié (signature/secret Yousign).
- **Aucun secret en dur** — credentials n8n : Google Drive OAuth2 (couvre Google Docs API), Google Sheets, Brevo API, Yousign API (HTTP Header Auth `Authorization: Bearer ...`), Google Palm API (Gemini).
- **RGPD** : consentement explicite sur la page ; CV analysé pour pré-remplissage uniquement ; justificatifs stockés dans un Drive à accès restreint.

## 9. Découpage de livraison

- **Phase 1** — Page formulaire (champs + uploads + encart CV) + **WF0 (Parse CV)** + **WF1 (Reception)** + Sub `Creer espace Drive` + Sub `Enregistrer fiche` + Sub `Email accueil` + Google Sheet « Formateurs » + liste/template Brevo « Bienvenue ». Sortie : un formateur peut candidater, son dossier est créé/classé, il est enregistré, il reçoit l'email d'accueil.
- **Phase 2** — Sub `Contrat Yousign` + **WF2 (Validation)** + **WF3 (Callback signature)** + Google Docs templates (contrat, charte) + templates Brevo (confirmation signature). Sortie : l'utilisateur valide un formateur → contrat envoyé en signature → suivi automatique.
- **Phase 3** — **WF4 (Relances & validation différée)** + Error workflow + templates Brevo (relances) + colonne/automatisation `Valide` fallback. Sortie : relances et alertes automatiques, robustesse.

## 10. Points laissés au plan d'implémentation

- Contrat + charte : 1 PDF combiné vs 2 documents dans la même Signature Request Yousign (défaut : 2 documents).
- Fréquence exacte du Schedule WF4 (quotidien vs deux fois/jour) et seuils de relance (3 j / 5 j proposés).
- Format précis du token de validation WF2 (HMAC du rowNumber+email vs UUID stocké dans le Sheet).
- Liste exacte des domaines d'intervention proposés dans le multi-choix du formulaire (à fournir par l'utilisateur).
- Contenu détaillé du kit pédagogique référencé dans l'email d'accueil (livret, modèles — à fournir/lier par l'utilisateur).
