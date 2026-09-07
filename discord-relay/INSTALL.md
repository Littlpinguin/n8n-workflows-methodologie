# Relais Discord → n8n

Petit bot Node.js qui transfère les messages privés reçus sur Discord vers un
webhook n8n. Utile pour piloter un agent n8n depuis un DM Discord.

## Prérequis

- Une application Discord avec un bot ([Developer Portal](https://discord.com/developers/applications))
- Les intents **Direct Messages** et **Message Content** activés sur le bot
- Node.js 18+ (pour `fetch` natif)
- Un webhook n8n actif

## Installation

```bash
mkdir -p ~/discord-relay && cd ~/discord-relay
# copier bot.js et package.json depuis ce dossier
npm install
npm install -g pm2
```

## Lancement

Le bot lit sa configuration dans deux variables d'environnement. **Ne jamais écrire
le token dans un fichier, un script ou une commande versionnée** — le shell garde
un historique.

```bash
export DISCORD_BOT_TOKEN="<votre-token-de-bot>"
export N8N_WEBHOOK_URL="https://n8n.example.com/webhook/<votre-chemin>"

pm2 start bot.js --name discord-relay
pm2 save && pm2 startup
```

Pour éviter l'historique shell, préférer un fichier d'environnement non versionné :

```bash
echo "DISCORD_BOT_TOKEN=..." > ~/.discord-relay.env
echo "N8N_WEBHOOK_URL=..."  >> ~/.discord-relay.env
chmod 600 ~/.discord-relay.env
pm2 start bot.js --name discord-relay --env-file ~/.discord-relay.env
```

## Vérification

```bash
pm2 status                        # doit afficher "online"
pm2 logs discord-relay --lines 5  # doit afficher "Bot connecte: <nom>"
```

## Commandes utiles

| Action | Commande |
|---|---|
| Voir les logs | `pm2 logs discord-relay` |
| Redémarrer | `pm2 restart discord-relay` |
| Arrêter | `pm2 stop discord-relay` |

## En cas de fuite du token

Si le token du bot se retrouve exposé (commit, capture, log), le régénérer
immédiatement : Developer Portal → votre application → Bot → **Reset Token**.
L'ancien est invalidé sur-le-champ.
