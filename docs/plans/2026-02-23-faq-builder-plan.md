# FAQ Builder + Enrichissement Inbox Genie — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Creer un workflow qui transforme les threads email Client/Prospect avec reponse en FAQ Google Sheets, puis enrichir Inbox Genie pour que les brouillons s'appuient sur cette FAQ.

**Architecture:** Deux volets — (1) nouveau workflow FAQ Builder avec Schedule Trigger 10h, Gmail search threads, Gemini reecriture, Google Sheets append, label FAQ comme marqueur ; (2) modification d'Inbox Genie pour lire la FAQ et l'injecter dans le prompt brouillon.

**Tech Stack:** n8n (MCP), Gemini 2.5 Flash (HTTP Request), Google Sheets, Google Drive, Gmail OAuth2

---

## Contexte cle pour l'implementeur

### Credentials existants

| Credential | ID | Nom |
|---|---|---|
| Gmail OAuth2 | `N8N_RESOURCE_ID_10` | Gmail account |
| Gemini API | `N8N_RESOURCE_ID_06` | Google Gemini(PaLM) Api account |
| Google Drive | `N8N_RESOURCE_ID_18` | Google Drive account |
| Google Sheets | `N8N_RESOURCE_ID_03` | Google Sheets account |

### Ressources existantes

- Workflow Inbox Genie : `N8N_RESOURCE_ID_01`
- Google Doc Profil Business : `GOOGLE_DOC_ID_02`
- Dossier Drive Profil Business : `GOOGLE_DOC_ID_13`
- Google Sheet Inbox Genie Stats : `GOOGLE_DOC_ID_09`
- Error Workflow : `bAurtiK8UqF7Mlw6`
- Dossier Drive Automatisations : `1JrjrEv41AZ_Gq3S7-gFK64cROpJfLqe3`

### Patterns a suivre (REX)

- Gemini : HTTP Request direct, `responseMimeType: 'application/json'`, retry x2, 3s entre chaque
- Gmail : `getAll` pour batch (pas `gmailTrigger`), `simple: false`, utiliser `from.text` et `subject` (decodes)
- Gmail action nodes (addLabels) remplacent `$json` → branches paralleles ou references upstream
- Config globale (profil business) : `executeOnce: true`
- Profil business : Google Doc dans Drive, conversion text/plain via `googleFileConversion`

---

## Volet 1 — FAQ Builder (nouveau workflow)

### Task 1 : Creer la Google Sheet FAQ Base + label Gmail

**Objectif :** Creer la sheet de stockage FAQ et le label Gmail "FAQ".

**Step 1 : Creer la Google Sheet "FAQ Base"**

Via MCP Google Drive, creer une nouvelle spreadsheet dans le dossier Automatisations (`1JrjrEv41AZ_Gq3S7-gFK64cROpJfLqe3`).
Nom : `FAQ Base`
Colonnes de l'onglet 1 (renommer en "FAQ") :
- A1: `Date`
- B1: `Categorie`
- C1: `Question`
- D1: `Reponse`
- E1: `Email original (De)`
- F1: `Sujet original`

**Step 2 : Creer le label Gmail "FAQ"**

Utiliser le node Gmail via MCP ou creer manuellement.
Verifier que le label existe via `gmail label getAll`.

**Step 3 : Noter les IDs**

Conserver l'ID de la Google Sheet et l'ID du label Gmail pour les tasks suivantes.

---

### Task 2 : Workflow principal — Schedule Trigger + Gmail search + Profil business

**Objectif :** Creer le workflow avec les 3 premiers nodes : declencheur, recherche emails, lecture profil.

**Step 1 : Creer le workflow via `n8n_create_workflow`**

Nom : `Gmail - FAQ Builder`
Settings : `executionOrder: "v1"`, `errorWorkflow: "bAurtiK8UqF7Mlw6"`

Nodes :

1. **Declencheur quotidien** (`scheduleTrigger` v1.2)
   - Position : [250, 400]
   - Cron : `0 10 * * *` (tous les jours a 10h)

2. **Rechercher threads avec reponse** (`gmail` v2.1)
   - Position : [474, 400]
   - Operation : `getAll`
   - returnAll : false, limit : 50
   - simple : false
   - Filtre q : `(label:Client OR label:Prospect) from:me -label:FAQ`
   - readStatus : `all` (on cherche des threads ou on a repondu, pas forcement non lus)
   - Credentials : Gmail OAuth2 `N8N_RESOURCE_ID_10`

3. **Chercher profil business** (`googleDrive` v3)
   - Position : [698, 400]
   - Operation : search (fileFolder), limit 1
   - folderId : `GOOGLE_DOC_ID_13`
   - executeOnce : true, alwaysOutputData : true
   - Credentials : Google Drive `N8N_RESOURCE_ID_18`

4. **Telecharger profil business** (`googleDrive` v3)
   - Position : [922, 400]
   - Operation : download
   - fileId : `={{ $json.id }}`
   - googleFileConversion : docsToFormat text/plain
   - Credentials : Google Drive `N8N_RESOURCE_ID_18`

5. **Extraire texte profil** (`extractFromFile` v1)
   - Position : [1146, 400]
   - Operation : text
   - destinationKey : `profilBusiness`

Connexions : 1 → 2 → 3 → 4 → 5

**Step 2 : Verifier via `n8n_get_workflow` mode structure**

---

### Task 3 : Recuperer le thread complet + extraire question/reponse

**Objectif :** Pour chaque email trouve, recuperer le thread Gmail complet et extraire la question du client + la reponse d'Alex.

**Step 1 : Ajouter le node Gmail Get Thread**

6. **Recuperer thread complet** (`gmail` v2.1)
   - Position : [1370, 400]
   - resource : `thread`
   - operation : `get`
   - threadId : `={{ $('Rechercher threads avec reponse').item.json.threadId }}`
   - Credentials : Gmail OAuth2 `N8N_RESOURCE_ID_10`

Connexion : Extraire texte profil → Recuperer thread complet

**Step 2 : Ajouter le Code node pour extraire question + reponse**

7. **Extraire question et reponse** (`code` v2)
   - Position : [1594, 400]

```javascript
const thread = $json;
const messages = thread.messages || [];
const profilBusiness = $('Extraire texte profil').first().json.profilBusiness;
const emailSource = $('Rechercher threads avec reponse').item.json;

// Trouver le premier message qui n'est pas from:me (= question client)
// et le premier message from:me (= reponse d'Alex)
const myEmail = 'contact@example.com';

let question = null;
let answer = null;

for (const msg of messages) {
  const fromAddress = msg.from?.value?.[0]?.address || msg.from || '';
  const isFromMe = typeof fromAddress === 'string'
    ? fromAddress.toLowerCase().includes(myEmail)
    : false;

  if (!isFromMe && !question) {
    question = {
      from: typeof msg.from === 'object' ? (msg.from?.text || msg.from?.value?.[0]?.address || '') : msg.from,
      subject: msg.subject || emailSource.subject || '',
      body: msg.snippet || msg.text || ''
    };
  }

  if (isFromMe && !answer) {
    answer = {
      body: msg.snippet || msg.text || ''
    };
  }
}

// Si pas de question ou reponse trouvee, skip
if (!question || !answer) {
  return [];
}

// Recuperer le label (Client ou Prospect) depuis l'email source
const fromText = typeof emailSource.from === 'object'
  ? (emailSource.from?.text || emailSource.from?.value?.[0]?.address || '')
  : (emailSource.from || '');
const subjectText = typeof emailSource.subject === 'string' ? emailSource.subject : '';

return [{
  json: {
    threadId: emailSource.threadId || emailSource.id,
    questionFrom: question.from,
    questionSubject: question.subject,
    questionBody: question.body,
    answerBody: answer.body,
    originalFrom: fromText,
    originalSubject: subjectText,
    profilBusiness
  }
}];
```

Connexion : Recuperer thread complet → Extraire question et reponse

---

### Task 4 : Gemini reecriture FAQ

**Objectif :** Envoyer la question + reponse a Gemini pour reformulation en FAQ professionnelle.

**Step 1 : Ajouter le Code node pour construire le prompt**

8. **Construire prompt FAQ** (`code` v2)
   - Position : [1818, 400]

```javascript
const data = $json;

const systemPrompt = `Tu es un assistant qui transforme des echanges emails en entrees FAQ professionnelles.

Voici le profil business du proprietaire :
${data.profilBusiness}

# Regles
- Reformule la question pour qu'elle soit generique (supprime les noms de personnes, entreprises specifiques)
- Reformule la reponse de maniere concise et professionnelle
- Conserve les informations factuelles (prix, delais, conditions, process)
- Le ton doit etre coherent avec le profil business
- Si la question ou la reponse n'est pas pertinente pour une FAQ (ex: simple coordination logistique), retourne {"question": "", "answer": ""} pour signaler qu'il faut skip

# Output
Retourne un JSON : { "question": "...", "answer": "..." }`;

const userPrompt = `Email recu :
Sujet : ${data.originalSubject}
Question du client :
${data.questionBody}

Reponse envoyee :
${data.answerBody}`;

const requestBody = {
  contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
  systemInstruction: { parts: [{ text: systemPrompt }] },
  generationConfig: {
    temperature: 0.3,
    responseMimeType: 'application/json'
  }
};

return [{ json: { ...data, requestBody } }];
```

Connexion : Extraire question et reponse → Construire prompt FAQ

**Step 2 : Ajouter le HTTP Request Gemini**

9. **Generer FAQ via Gemini** (`httpRequest` v4.2)
   - Position : [2042, 400]
   - method : POST
   - url : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
   - authentication : predefinedCredentialType → googlePalmApi
   - sendBody : true, specifyBody : json
   - jsonBody : `={{ JSON.stringify($json.requestBody) }}`
   - timeout : 60000
   - retryOnFail : true, maxTries : 2, waitBetweenTries : 3000
   - Credentials : Gemini API `N8N_RESOURCE_ID_06`

Connexion : Construire prompt FAQ → Generer FAQ via Gemini

---

### Task 5 : Parser + Google Sheets append + addLabel FAQ

**Objectif :** Parser la reponse Gemini, ajouter dans la sheet, marquer le thread.

**Step 1 : Ajouter le Code node pour parser**

10. **Parser FAQ** (`code` v2)
    - Position : [2266, 400]

```javascript
const response = $json.candidates[0].content.parts[0].text;
const faq = JSON.parse(response);
const data = $('Construire prompt FAQ').item.json;

// Skip si Gemini a retourne une FAQ vide (pas pertinent)
if (!faq.question || !faq.answer) {
  return [];
}

return [{
  json: {
    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    categorie: data.originalSubject, // sera affine si on a le label
    question: faq.question,
    answer: faq.answer,
    originalFrom: data.originalFrom,
    originalSubject: data.originalSubject,
    threadId: data.threadId
  }
}];
```

Connexion : Generer FAQ via Gemini → Parser FAQ

**Step 2 : Ajouter Google Sheets append**

11. **Sauvegarder dans FAQ Base** (`googleSheets` v4.6)
    - Position : [2490, 400]
    - operation : append
    - documentId : `[ID de la sheet creee en Task 1]`
    - sheetName : FAQ (gid=0)
    - Mapping :
      - Date : `={{ $json.date }}`
      - Categorie : `={{ $json.categorie }}`
      - Question : `={{ $json.question }}`
      - Reponse : `={{ $json.answer }}`
      - Email original (De) : `={{ $json.originalFrom }}`
      - Sujet original : `={{ $json.originalSubject }}`
    - Credentials : Google Sheets `N8N_RESOURCE_ID_03`

Connexion : Parser FAQ → Sauvegarder dans FAQ Base

**Step 3 : Ajouter Gmail addLabel "FAQ"**

12. **Marquer thread FAQ** (`gmail` v2.1)
    - Position : [2490, 600]
    - operation : addLabels
    - messageId : `={{ $('Parser FAQ').item.json.threadId }}`
    - labelIds : `={{ ['[ID du label FAQ]'] }}`
    - onError : continueRegularOutput
    - Credentials : Gmail OAuth2 `N8N_RESOURCE_ID_10`

Connexion : Parser FAQ → Marquer thread FAQ (en parallele avec Sauvegarder)

Note : les deux nodes (Sheets + addLabel) partent en parallele depuis Parser FAQ pour eviter la perte de donnees par le node Gmail.

---

### Task 6 : Sticky notes + verification workflow complet

**Objectif :** Documenter le workflow et verifier la structure complete.

**Step 1 : Ajouter 3 sticky notes**

- Sticky 1 : "1. Recherche emails" (position [220, 120], couleur 2)
  Contenu : Schedule Trigger 10h + Gmail getAll threads Client/Prospect avec reponse, sans label FAQ

- Sticky 2 : "2. Extraction + IA" (position [1340, 120], couleur 5)
  Contenu : Get thread complet, extraire Q/R, Gemini reformule en FAQ

- Sticky 3 : "3. Sauvegarde" (position [2400, 120], couleur 7)
  Contenu : Google Sheets FAQ Base + label Gmail "FAQ" pour eviter retraitement

**Step 2 : Verifier la structure complete via `n8n_get_workflow` mode structure**

---

## Volet 2 — Enrichissement Inbox Genie

### Task 7 : Ajouter la lecture FAQ dans Inbox Genie

**Objectif :** Modifier le workflow Inbox Genie (`N8N_RESOURCE_ID_01`) pour lire la FAQ Base et l'injecter dans le prompt brouillon.

**Step 1 : Ajouter un node Google Sheets getAll entre IF et Construire prompt brouillon**

13. **Lire FAQ Base** (`googleSheets` v4.6)
    - Position : [2528, 304] (entre Reponse necessaire et Construire prompt brouillon)
    - operation : read (getAll)
    - documentId : `[ID de la sheet FAQ Base]`
    - sheetName : FAQ
    - executeOnce : true
    - Credentials : Google Sheets `N8N_RESOURCE_ID_03`

**Step 2 : Modifier les connexions**

- Supprimer connexion : Reponse necessaire (TRUE) → Construire prompt brouillon
- Ajouter connexion : Reponse necessaire (TRUE) → Lire FAQ Base
- Ajouter connexion : Lire FAQ Base → Construire prompt brouillon

**Step 3 : Modifier le Code node "Construire prompt brouillon"**

Mettre a jour le code pour inclure la FAQ :

```javascript
const email = $json;
const faqItems = $('Lire FAQ Base').all();

// Formater la FAQ pour le prompt
let faqSection = '';
if (faqItems && faqItems.length > 0) {
  const faqEntries = faqItems
    .filter(item => item.json.Question && item.json.Reponse)
    .map(item => `Q: ${item.json.Question}\nR: ${item.json.Reponse}`)
    .join('\n\n');

  if (faqEntries) {
    faqSection = `\n\n# FAQ existante (reponses deja validees)\nSi une question similaire existe ci-dessous, inspire-toi de la reponse pour rester coherent. Adapte au contexte de l'email, ne copie pas mot pour mot.\n\n${faqEntries}`;
  }
}

const systemPrompt = `Tu es l'assistant personnel de l'utilisateur. Tu rediges des brouillons de reponses a ses emails.

Voici son profil business et ses exemples de style :
${email.profilBusiness}${faqSection}

# Regles
- Reproduis le ton et le style des exemples d'emails fournis dans le profil
- Sois concis et professionnel
- Commence par "Bonjour," ou "Hello," selon la langue de l'email recu
- Termine par "Cordialement," ou "Best," selon la langue
- Pour les questions oui/non, redige 2 versions separees par "------- OU -------"
- Si tu ne connais pas la reponse, utilise des placeholders [A COMPLETER]
- Ne fabrique jamais d'informations
- Reponds dans la meme langue que l'email recu
- Format texte brut uniquement, pas de HTML ni markdown`;

const userPrompt = `Email recu :\nDe: ${email.from}\nSujet: ${email.subject}\nContenu:\n${email.body}`;

const requestBody = {
  contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
  systemInstruction: { parts: [{ text: systemPrompt }] },
  generationConfig: {
    temperature: 0.4
  }
};

return [{ json: { requestBody, emailId: email.emailId, threadId: email.threadId, from: email.from, subject: email.subject } }];
```

**Step 4 : Repositionner les nodes si necessaire**

Decaler "Construire prompt brouillon" pour faire de la place au nouveau node "Lire FAQ Base".

---

### Task 8 : Test E2E

**Objectif :** Tester les deux volets.

**Step 1 : Test FAQ Builder**

- S'assurer qu'il existe au moins 1 thread email avec label Client ou Prospect ou Alex a repondu
- Executer manuellement le workflow FAQ Builder
- Verifier : la sheet FAQ Base contient une nouvelle entree, le thread a le label "FAQ"

**Step 2 : Test Inbox Genie enrichi**

- S'assurer que la FAQ Base contient au moins 1 entree
- Envoyer un email de test similaire a une question existante dans la FAQ
- Executer manuellement Inbox Genie
- Verifier : le brouillon genere s'inspire de la FAQ existante

**Step 3 : Export + documentation**

- Exporter le workflow FAQ Builder en JSON dans `workflows/gmail-faq-builder.json`
- Mettre a jour le workflow Inbox Genie export dans `workflows/gmail-inbox-genie.json`
- Mettre a jour le REX dans `docs/rex-automatisations.md`
- Commit + push
