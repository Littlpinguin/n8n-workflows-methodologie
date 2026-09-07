---
name: n8n $env interdit dans sub-workflows
description: $env est bloque dans les Code nodes des sub-workflows executes via executeWorkflow - utiliser des HTTP nodes avec credentials a la place
type: feedback
---

`$env` est completement interdit dans les Code nodes des sub-workflows appeles via `executeWorkflow` (toolWorkflow inclus). L'erreur est : `access to env vars denied`.

**Why:** n8n bloque l'acces aux variables d'environnement dans le contexte d'execution des sub-workflows pour des raisons de securite. Ce n'est pas configurable.

**How to apply:** Ne JAMAIS utiliser `$env` dans un Code node d'un sub-workflow. Pour acceder a des APIs externes qui necessitent un token (Notion, Brevo, etc.), utiliser un HTTP Request node avec un credential n8n configure (`httpHeaderAuth`, `oAuth2Api`, etc.). Si le Code node a besoin d'un secret, le passer en parametre d'entree depuis le workflow parent.
