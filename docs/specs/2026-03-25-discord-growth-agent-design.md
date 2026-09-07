# Discord Growth Agent — Design Spec

> Agent conversationnel Discord connecté au pipeline AI CRM de l'Agence.
> Permet à Alex et Sam d'interagir en langage naturel avec Notion, Brevo, Apollo et Lemlist depuis un DM Discord.

**Date :** 2026-03-25
**Statut :** Draft
**Prérequis :** Pipeline AI CRM Phases 1-4a validées, bot Discord créé (voir section 15)

---

## 1. Vue d'ensemble

### Objectif

Un bot Discord en DM qui agit comme un growth marketer IA : il consulte les données CRM, enrichit des prospects à la demande, lance des campagnes de sourcing, génère des emails personnalisés et pousse sur Lemlist — le tout en langage naturel.

### Utilisateurs

| Utilisateur | Discord ID | Droits |
|---|---|---|
| Alex | À configurer | Tous les outils |
| Sam (yacine9388) | À configurer | Tous les outils |

Mêmes droits, traçabilité par utilisateur (chaque action est loguée avec le nom de l'auteur).

### Choix de design validés

| Aspect | Choix |
|---|---|
| Canal | DM Discord avec le bot |
| Interface | Langage naturel libre (pas de commandes slash) |
| Réponses | Adaptatives — concis pour les listes, détaillé pour un focus prospect |
| Confirmation | Uniquement actions coûteuses (Apollo, Lemlist, génération emails) |
| Mémoire | Par thread/session (max 20 messages, expiration 2h) |
| Multi-user | Mêmes droits, traçabilité par utilisateur |
| Actions longues | Accusé réception + progression + résultat final |

---

## 2. Architecture

### Schéma global

```
Discord DM (Alex / Sam)
  │
  ▼
WF: Discord Growth Agent (orchestrateur)
  │
  ├─ Discord Trigger (DM)
  ├─ Code: identifier utilisateur + charger historique (Notion)
  ├─ AI Agent (Gemini 2.5 Flash — choisi pour sa latence faible
  │           en conversationnel ; les sub-WF utilisent leurs
  │           propres modèles pour les tâches lourdes)
  │    ├── query_notion         (lecture)
  │    ├── query_brevo          (lecture)
  │    ├── search_web           (lecture)
  │    ├── create_offre         (écriture)
  │    ├── create_persona       (écriture)
  │    ├── create_deal_brevo    (écriture)
  │    ├── enrich_prospect      (écriture)
  │    ├── score_prospects      (écriture)
  │    ├── source_apollo        (écriture, confirmation ⚠️)
  │    ├── generate_emails      (écriture, confirmation ⚠️)
  │    └── push_lemlist         (écriture, confirmation ⚠️)
  │
  ├─ Code: sauvegarder échange (Notion)
  └─ Discord: réponse (texte ou embed)
        │
        ▼ (sub-workflows via toolWorkflow)
  Phases existantes réutilisées :
    Phase 1  Personas IA           N8N_RESOURCE_ID_31
    Phase 2  Sourcing Apollo       N8N_RESOURCE_ID_25
    Phase 3  Scoring Pipeline      N8N_RESOURCE_ID_33
    Phase 3b Deep Research         N8N_RESOURCE_ID_22
    Phase 4a Generation Emails     N8N_RESOURCE_ID_27
    Phase 4b Push Lemlist          N8N_RESOURCE_ID_23
    Phase 9  Conversion Brevo      N8N_RESOURCE_ID_29
        │
        ▼ (data layer)
  Notion (7 DBs) · Brevo CRM · Apollo · Lemlist
```

### Approche retenue

**Monolithique (Approche A)** : 1 workflow orchestrateur avec un AI Agent LangChain qui dispose de 11 outils (sub-workflows). Les workflows de production existants sont réutilisés via des wrappers `Execute Sub-workflow`.

**Justification :**
- Le node AI Agent de n8n avec `toolWorkflow` est conçu pour ce pattern
- 1 seul workflow à maintenir comme point d'entrée
- La confirmation s'intègre naturellement via la mémoire de conversation
- 80% de la logique existe déjà dans les phases 1-9
- On peut itérer en ajoutant les outils un par un

---

## 3. Les 11 outils de l'agent

### 3.1 Outils de consultation (exécution directe)

#### `query_notion`
- **Input :** `database_name` (enum : prospects / offres / personas / sequences / signaux / deals / stats) + `filter_type` (enum de filtres pré-construits, voir ci-dessous) + `filter_value` (valeur du filtre)
- **Logique :** le sub-workflow contient des templates de filtres pré-construits pour les requêtes courantes. L'agent choisit le bon template et passe la valeur. Cela évite de faire générer du JSON Notion brut par le LLM.
- **Templates de filtres :**
  - `by_status` : filtre par Statut pipeline (value = nom du statut)
  - `by_score_above` : Score IA > value
  - `by_offre` : prospects liés à une offre (value = nom offre)
  - `by_name` : recherche par nom (value = texte)
  - `all_active` : toutes les entrées actives (pas de value)
  - `recent` : créés/modifiés dans les N derniers jours (value = nombre de jours)
- **Fallback :** si aucun template ne correspond, le sub-workflow fetch les 50 dernières entrées et filtre en mémoire via Code node (viable car < 500 prospects)
- **Bases interrogeables :** Prospects, Offres, Personas, Sequences, Signaux, Pipeline Deals, Stats conversion
- **Output :** résultats formatés (liste ou détail selon le nombre)
- **Limite Discord :** les résultats sont tronqués à 1900 chars. Au-delà : "N résultats au total, demande-moi de filtrer davantage"

#### `query_brevo`
- **Input :** requête ("deals en négociation", "contacts ajoutés cette semaine")
- **Endpoints :** GET /contacts, GET /deals (par stage), GET /companies
- **Auth :** API key Brevo via credential n8n
- **Output :** données structurées

#### `search_web`
- **Input :** URL (site web, page LinkedIn publique, article)
- **Appel :** `https://r.jina.ai/{url}` avec Accept: application/json
- **Output :** contenu markdown tronqué à 4000 chars
- **Usage :** enrichissement à la demande, recherche d'infos entreprise

### 3.2 Outils de création (exécution directe)

#### `create_offre`
- **Input :** nom, proposition de valeur, arguments clés, pain points, prix, secteurs cibles
- **Action :** POST Notion API → base Offres actives (`NOTION_ID_07`)
- **Output :** confirmation + lien Notion

#### `create_persona`
- **Input :** intitulé poste, secteurs, taille entreprise, offre liée
- **Action :** POST Notion API → base Personas (`NOTION_ID_08`) avec relation vers l'offre
- **Output :** confirmation + lien Notion

#### `create_deal_brevo`
- **Input :** nom contact, email, entreprise, montant estimé, étape pipeline
- **Action :** POST Brevo API — créer contact + company + deal (réutilise la logique Phase 9 étapes 2-4)
- **Pipeline Brevo :** `67c831a51f27cfb9fc9b13d3`
- **Output :** confirmation + lien Brevo

#### `enrich_prospect`
- **Input :** lien LinkedIn, nom, ou email
- **Actions chaînées :**
  1. Apollo `people/match` — données pro (poste, entreprise, email, phone)
  2. Jina scraping du site web entreprise (si trouvé)
  3. Upsert Notion base Prospects avec statut "Enrichi"
  4. Optionnel : upsert Brevo si demandé explicitement
- **Note :** consomme 1 crédit Apollo par appel (rate limit 200/h). L'agent avertit l'utilisateur si > 5 enrichissements demandés d'un coup.
- **Output :** fiche résumée du prospect enrichi

#### `score_prospects`
- **Input :** filtres optionnels (offre, nombre max)
- **Action :** appelle le sub-workflow Phase 3 (scoring pipeline complet : pré-score /80 rule-based + Score IA /100 via Gemini)
- **Output :** nombre de prospects scorés + top 5 avec scores IA (/100)

### 3.3 Outils avec confirmation (⚠️)

#### `source_apollo`
- **Input :** critères (secteur, localisation, taille, poste, nombre)
- **Confirmation :** "Je vais chercher N prospects [critères]. Ça consomme des crédits Apollo. On y va ?"
- **Action :** appelle le sub-workflow Phase 2
- **Progression :** message Discord tous les 5 prospects trouvés
- **Output :** résumé + top 3 + proposition de scorer

#### `generate_emails`
- **Input :** filtres (tous les scorés, ou prospects spécifiques par nom)
- **Confirmation :** "Je vais générer les emails pour N prospects. OK ?"
- **Action :** appelle le sub-workflow Phase 4a
- **Progression :** message Discord tous les 3 prospects traités
- **Output :** résumé + lien Notion pour relire

#### `push_lemlist`
- **Input :** prospects avec "Messages validés" cochés, ou liste spécifique
- **Confirmation :** "Je vais envoyer N prospects sur la campagne Lemlist [nom]. Confirmes-tu ?"
- **Action :** appelle le sub-workflow Phase 4b
- **Output :** confirmation + lien campagne Lemlist

---

## 4. Mémoire de conversation

### Stockage

**Nouvelle base Notion : `Conversations Agent`**

| Propriété | Type | Description |
|---|---|---|
| Session ID | Title | `{dm_channel_id}_{session_start_timestamp}` |
| User | Select | alex / yacine |
| Discord User ID | Rich text | Pour traçabilité |
| Discord Channel ID | Rich text | Channel DM stable |
| Statut | Select | active / archivée |
| Action en attente | Rich text | JSON de l'action pendante (max 2000 chars) |

**Base ID :** à créer lors de l'implémentation.

**Stockage des messages :** les messages de conversation sont stockés dans le **corps de la page Notion** (children blocks), pas dans une propriété rich_text. Chaque échange = 1 block texte (`{role}: {content}`). Cela contourne la limite de 2000 chars/propriété et permet un historique plus long.

### Flux

```
Message Discord reçu
  → Extraire dm_channel_id (stable par utilisateur)
  → Query Notion "Conversations Agent" :
    filtre channel_id + statut=active + last_edited < 2h
     OUI → Session active trouvée → charger les blocks enfants (messages)
     NON → Créer nouvelle page, Session ID = {channel_id}_{now}
  → Vérifier "Action en attente" (propriété de la page)
     OUI → Lookup par user_id (pas juste session) pour éviter les conflits multi-user
       Réponse positive → exécuter action pendante, vider le champ
       Réponse négative → annuler, vider le champ
       Question de clarification → l'agent voit le contexte de l'action
         pendante dans son prompt et peut répondre puis re-demander confirmation
     NON → traitement normal par l'agent
  → Agent traite (avec historique injecté)
  → Append 2 blocks enfants (user + assistant) dans la page Notion
```

### Limites

- **20 messages max** par session — au-delà, élaguer les blocks les plus anciens (garder les 2 premiers + les 18 derniers)
- **Expiration 2h** — un message après 2h d'inactivité crée une nouvelle session (la précédente passe en "archivée")
- **Timeout confirmation** — une action en attente expire après 5 minutes sans réponse

### Note sur les DM Discord

Les DM Discord n'ont pas de concept de "thread" natif. Le `dm_channel_id` est un identifiant stable entre un utilisateur et le bot. Le concept de "session" est géré logiquement par le workflow (nouvelle session après 2h d'inactivité), pas par Discord.

---

## 5. Confirmation des actions coûteuses

### Mécanisme

```
1. L'utilisateur demande une action coûteuse
2. L'agent retourne un message de confirmation dans Discord
   avec le détail de ce qu'il va faire
3. Le champ "Action en attente" est sauvegardé en Notion :
   { action: "source_apollo", params: {...}, user_id: "123", timestamp: "..." }
4. Le message suivant de l'utilisateur arrive
5. Le Code node vérifie "Action en attente" :
   - Vérifie que le user_id correspond (évite les conflits multi-user)
   - Vérifie que l'action n'a pas expiré (timeout 5 min)
   - Réponse positive (oui, ok, go, yes, valide) → exécuter
   - Réponse négative (non, annule, stop) → annuler
   - Autre message → l'action reste pendante, le contexte est injecté
     dans le prompt pour que l'agent puisse répondre à une question
     de clarification et re-demander confirmation
```

### Actions nécessitant confirmation

| Outil | Pourquoi |
|---|---|
| `source_apollo` | Consomme des crédits Apollo (rate limit 200/h) |
| `generate_emails` | Appels Gemini coûteux, irréversible (écrase les emails existants) |
| `push_lemlist` | Envoi réel d'emails, irréversible |

---

## 6. Progression des actions longues

### Mécanisme technique

Le sub-workflow reçoit le `channel_id` Discord en paramètre d'entrée. À intervalles réguliers pendant l'exécution, un node Discord Send envoie un message de progression.

### Fréquence des mises à jour

| Outil | Fréquence progression |
|---|---|
| `source_apollo` | Tous les 5 prospects trouvés |
| `score_prospects` | Tous les 5 prospects scorés |
| `generate_emails` | Tous les 3 prospects traités |
| `push_lemlist` | Tous les 3 prospects envoyés |

### Format

```
Accusé :    "⏳ Je lance [action]. Je te tiens au courant."
Progression : "🔍 8/20 prospects trouvés..."
Résultat :  "✅ 20 prospects trouvés. Top 3 : [...]"
             "→ Veux-tu que je les score ?"
```

---

## 7. Format des réponses Discord

### Réponse courte (consultation simple)

Texte brut, pas d'embed.

```
Tu as 14 prospects Enrichi et 59 Scoré.
3 deals en négociation pour un total de 8 500€ estimés.
```

### Réponse liste (plusieurs résultats)

Embed Discord avec tableau formaté.

```
🎯 Top 5 prospects (Score IA > 85)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
95 — Claire Martin, DG, AquaVert
90 — Thomas Cador, DAF, IWF France
90 — Kataline Pousse, DRH, DeltaTech
90 — Eric Simon, DG, PAV Simon
88 — Cyril Galet, DAF, Certix Group
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
14 résultats total • Filtré par: Score > 85
```

### Réponse fiche détaillée (1 prospect)

Embed Discord riche avec tous les champs pertinents.

```
👤 Claire Martin
DG — AquaVert • 11-50 employés
Score IA: 95/100 • Statut: Enrichi
📧 c.martin@aquavert.fr
🔗 linkedin.com/in/claire-martin-demo

Signaux: Lancement nouvelle gamme
Angle: Automatisation process qualité

📎 Notion • 📎 Brevo
```

### Propositions proactives

L'agent propose systématiquement la suite logique du pipeline :

| Après | Proposition |
|---|---|
| Sourcing | "Veux-tu que je les score ?" |
| Scoring | "3 prospects au-dessus de 85. Je génère les emails ?" |
| Génération emails | "Emails prêts dans Notion. Tu veux les relire avant envoi Lemlist ?" |
| Enrichissement | "Prospect ajouté avec un score de 82. Je le rattache à quelle offre ?" |

---

## 8. System prompt de l'agent

```
Tu es le Growth Agent de l'Agence. Tu assistes Alex et Sam
dans leur prospection B2B.

IDENTITÉ: Assistant growth marketing IA, direct et efficace.
Tu connais intimement le pipeline commercial de l'Agence
(automatisations IA pour PME).

UTILISATEUR ACTUEL: {user_name} (Discord ID: {user_id})

COMPORTEMENT:
- Réponds en français, ton direct et pro, pas de blabla
- Adapte le niveau de détail à la requête
  (liste = concis, focus 1 prospect = détaillé)
- Après chaque action, propose la suite logique du pipeline
- Trace toutes les actions avec le nom de l'utilisateur

OUTILS:
Tu disposes de 11 outils. Utilise-les selon le besoin.
Pour les actions coûteuses (source_apollo, generate_emails,
push_lemlist), TOUJOURS demander confirmation AVANT d'exécuter.
Formule la confirmation avec : ce que tu vas faire, le volume,
et demande un "OK" explicite.

PIPELINE DE RÉFÉRENCE:
- Statuts prospect (dans l'ordre du pipeline):
  Brut → Pré-scoré → Enrichi → Scoré → Emails générés →
  En séquence → Signal chaud → Opportunité → Dead / Nurture
- Offres dans Notion, Personas liés aux offres
- Brevo CRM : Qualifié → RDV pris → RDV effectué →
  Proposition envoyée → Négociation → Gagné / Perdu

CONTEXTE CONVERSATION:
{conversation_history}

RÈGLES:
- Ne jamais exposer de tokens, clés API ou IDs internes
- Si tu ne sais pas, dis-le plutôt que d'inventer
- Si une action échoue, explique pourquoi et propose une alternative
- Tutoiement dans Discord (c'est interne, entre nous)
  ATTENTION: le vouvoiement reste obligatoire pour tout contenu
  destiné aux prospects (emails, messages LinkedIn). Cette règle
  ne concerne que les échanges internes Discord.
```

---

## 9. Gestion des erreurs

| Erreur | Comportement |
|---|---|
| Notion timeout | Retry 1x, puis "Notion ne répond pas, réessaie dans 1 min" |
| Apollo rate limit (200/h) | "Apollo est limité. Il reste ~X crédits. Je relance dans Y min ?" |
| Jina scraping échoue | "Je n'ai pas pu scraper ce site. Donne-moi un autre lien ou des infos manuelles" |
| Brevo API erreur | Retry 1x, puis message d'erreur explicite |
| Gemini timeout | Retry avec prompt plus court, sinon "Reformule ta demande" |
| Sub-workflow échoue | Message Discord + log dans Error Handler (`N8N_RESOURCE_ID_26`) |
| Prospect introuvable | "Aucun résultat. Veux-tu élargir la recherche ?" |
| Confirmation non comprise | "Réponds 'oui' pour lancer ou 'non' pour annuler." |

**Error workflow :** le workflow orchestrateur est rattaché à l'Error Handler existant (`N8N_RESOURCE_ID_26`).

---

## 10. Sécurité

- **Whitelist Discord** : seuls les Discord User IDs d'Alex et Sam sont autorisés. Tout autre message est ignoré silencieusement.
- **Pas de secrets en clair** : l'agent ne renvoie jamais de tokens, clés API ou IDs Notion/Brevo dans Discord.
- **Rate limiting** : max 30 messages/heure par utilisateur (protection anti-boucle).
- **Credentials** : tous via les credentials n8n existants (Notion, Brevo, Apollo, Gemini). Aucun secret en dur.
- **Audit trail** : chaque action est loguée dans la base Conversations Agent (qui, quand, quoi).

---

## 11. Adaptation des sub-workflows

### Principe : wrappers

Les workflows de production (Phases 1-9) restent intacts et autonomes. Pour chaque outil de l'agent, on crée un **wrapper léger** qui :
1. Reçoit les paramètres via `Execute Workflow Trigger`
2. Exécute la logique (réutilise les nodes existants ou appelle le workflow)
3. Envoie des messages de progression dans Discord (via `channel_id` passé en paramètre)
4. Retourne un résultat structuré à l'agent

### Inventaire

| Outil | Type | Base existante |
|---|---|---|
| `query_notion` | Nouveau | — |
| `query_brevo` | Nouveau | — |
| `search_web` | Nouveau | — |
| `create_offre` | Nouveau | — |
| `create_persona` | Nouveau | — |
| `create_deal_brevo` | Wrapper | Phase 9 (étapes 2-4) |
| `enrich_prospect` | Nouveau | Inspiré Phase 3b |
| `score_prospects` | Wrapper | Phase 3 |
| `source_apollo` | Wrapper | Phase 2 |
| `generate_emails` | Wrapper | Phase 4a |
| `push_lemlist` | Wrapper | Phase 4b |

### Phases non exposées (hors périmètre)

| Phase CdC | Raison d'exclusion |
|---|---|
| Phase 6 — Vérification email | Automatique dans le pipeline (pas d'action manuelle) |
| Phase 7 — Outreach multicanal (LinkedIn/call) | Seul l'email via Lemlist est exposé. LinkedIn et appels restent manuels. |
| Phase 8 — Signal tracking | Webhook-driven (automatique). Les signaux sont consultables via `query_notion` sur la base Signaux. |

Ces phases pourront être ajoutées ultérieurement si le besoin se confirme.

### Ce qui ne change pas

- Les workflows de production restent intacts et autonomes (Schedule Triggers)
- Les credentials existants sont réutilisés
- L'Error Handler existant reste branché
- Les 7 bases Notion ne changent pas de structure (1 base ajoutée : Conversations Agent)

---

## 12. Données Notion — État actuel des bases

### Offres actives (14 propriétés)

Nom offre (title), Proposition de valeur, Arguments clés, Pain points résolus (multi_select), Prix, Secteurs cibles (multi_select), Taille entreprise cible (multi_select), Zones géographiques (multi_select), Modèle tarifaire (select), Statut (select: Actif/En pause/Archivé), URL page offre, Date création, Personas liés (relation → Personas), Objections fréquentes.

### Personas (15 propriétés)

Nom persona (title), Offre liée (relation → Offres), Intitulés poste LinkedIn, Mots-clés Apollo, Pain points spécifiques, Secteurs NACE (multi_select), Taille entreprise min/max, Budget estimé persona (select: 2k-10k/10k-50k/50k+), Zones géographiques (multi_select), Statut (select: Actif/En pause/Archivé), Sourcing fait (checkbox), Score conversion historique, Prompt Gemini utilisé, Date génération.

### Prospects (46 propriétés — nettoyé)

**Identité :** Nom complet (title), Prénom, Nom, Email, Téléphone, LinkedIn URL, Poste actuel, Entreprise, Localisation, Secteur entreprise (select), Taille entreprise (select), Site web entreprise.

**Scoring :** Score IA, Score IA justification, Pré-score, Angle approche suggéré, Signaux détectés (multi_select), Actualités entreprise.

**Enrichissement :** Contexte enrichi, Deep research, Ice-breaker, Objections anticipees, Reference client, Apollo ID, Date enrichissement, Date scoring, Date sourcing.

**Emails :** Email 1-4, Message LinkedIn, Messages validés (checkbox), Email deliverability (select).

**Pipeline :** Statut pipeline (select: Brut → Pré-scoré → Scoré → Enrichi → Emails générés → En séquence → Signal chaud → Opportunité → Dead → Nurture), Offre cible (relation → Offres), Persona source (relation → Personas).

**Tracking :** Dernier signal (select), Date dernier signal, Date signal chaud, Date entrée séquence, Lemlist campaign ID, Nb emails ouverts, Nb clics, Brevo contact ID, Brevo deal ID.

### Sequences Lemlist (15 propriétés)

Nom campagne (title), Lemlist campaign ID, Offre liée (relation), Persona lié (relation), Statut (select: Draft/Active/Paused/Terminée), Date lancement, Date fin, Nb leads/opens/clicks/replies/positives, Email template V1/V2, Notes.

### Signaux & événements (10 propriétés)

Événement (title), Type signal (select: open/click/reply_positive/reply_negative/reply_ooo/bounce/linkedin_accept/linkedin_reply/booking/phone_call), Source (select: Lemlist/Cal.com/Manuel/LinkedIn), Température (select: Chaud/Tiède/Froid/Neutre), Date, Contenu, Prospect lié (relation), Campagne Lemlist (relation), Step Lemlist, Action déclenchée (select: Phase 9/Relance/Nurture/Rien).

### Pipeline Deals (19 propriétés)

Nom deal (title), Étape (select: Qualifié → RDV pris → RDV effectué → Proposition envoyée → Négociation → Gagné → Perdu), Prospect lié (relation), Offre liée (relation), Persona source (relation), Score IA, Montant estimé, Montant réel, Brief pré-RDV, Canal premier contact (select), Date création/RDV/closing/prochaine action, Prochaine action, Compte-rendu RDV, Suggestion relance, Raison perdu, Brevo deal ID.

### Stats conversion (13 propriétés)

Période (title), Offre (relation), Persona (relation), Nb sourcés/pré-scorés OK/scorés IA OK/en séquence/signaux chauds/deals créés/deals gagnés, CA généré, Meilleur canal (select), Meilleur step Lemlist.

---

## 13. Données Brevo — Configuration

**API Key :** credential n8n `brevoApi`
**Pipeline :** "Pipeline de vente" (ID `67c831a51f27cfb9fc9b13d3`)

| Stage ID | Nom |
|---|---|
| `a9d3a131-02b9-4c95-9472-69ad7f2e4021` | Qualifié |
| `66bcac10-259c-468a-8ff1-c88ade800063` | RDV pris |
| `426751d5-4b08-41da-a729-82e8812d814e` | RDV effectué |
| `8f0b8a22-bce9-4863-8436-8da52c387bb4` | Proposition envoyée |
| `aac282f1-f9b8-4953-a0d3-0858bb85e430` | Négociation |
| `2ef14efe-53c3-42ad-b734-034603bd0031` | Gagné |
| `5883ea3b-7c16-4e7a-9f85-ff8e09a2cc89` | Perdu |

**Attributs custom contact :** SCORE_IA (float), PERSONA_SOURCE, OFFRE_CIBLE, SOURCE, DATE_PREMIER_SIGNAL, LINKEDIN_URL

**Attributs custom deal :** score_ia, persona_source, offre_cible, canal_premier_contact, date_premier_signal, contexte_ia, notion_prospect_id

---

## 14. Périmètre de l'implémentation

### Phase 1 — Socle (prioritaire)

- Workflow orchestrateur : Discord Trigger → identification user → mémoire → AI Agent → réponse
- Base Notion "Conversations Agent"
- System prompt
- 3 outils lecture : `query_notion`, `query_brevo`, `search_web`

### Phase 2 — Création

- 3 outils : `create_offre`, `create_persona`, `create_deal_brevo`
- `enrich_prospect` (Apollo + Jina + upsert Notion/Brevo)

### Phase 3 — Actions pipeline

- `score_prospects` (wrapper Phase 3)
- `source_apollo` (wrapper Phase 2 + confirmation + progression)
- `generate_emails` (wrapper Phase 4a + confirmation + progression)
- `push_lemlist` (wrapper Phase 4b + confirmation + progression)

### Livrables par phase

Chaque phase produit :
- Les sub-workflows n8n créés et testés
- Le workflow orchestrateur mis à jour avec les nouveaux outils
- Test end-to-end via DM Discord

---

## 15. Prérequis — Setup du bot Discord

Avant l'implémentation, les étapes suivantes doivent être réalisées manuellement :

1. **Créer une application Discord** sur le [Developer Portal](https://discord.com/developers/applications)
2. **Créer un bot** dans l'application et récupérer le token
3. **Activer le privileged intent "Message Content"** (nécessaire pour lire le contenu des DMs)
4. **Inviter le bot** sur le serveur Discord partagé avec Alex et Sam (les DMs nécessitent un serveur en commun)
5. **Configurer le credential Discord dans n8n** avec le token du bot
6. **Noter les Discord User IDs** d'Alex et Sam pour la whitelist
