const { Client, GatewayIntentBits, Partials } = require('discord.js');

// --- Configuration ---
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL; // ex: https://n8n.example.com/webhook/discord-growth-agent
// ---------------------

if (!BOT_TOKEN || !N8N_WEBHOOK_URL) {
  console.error('Variables manquantes: DISCORD_BOT_TOKEN et N8N_WEBHOOK_URL requis');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once('ready', () => {
  console.log(`Bot connecte: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignorer les messages du bot lui-meme
  if (message.author.bot) return;

  // Ne traiter que les DMs
  if (!message.channel.isDMBased()) return;

  // Collecter les pieces jointes (url, nom, type, taille)
  const attachments = message.attachments.map(a => ({
    url: a.url,
    name: a.name,
    contentType: a.contentType,
    size: a.size,
  }));

  const payload = {
    content: message.content,
    channelId: message.channelId,
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: false,
    },
    attachments,
    id: message.id,
    timestamp: message.createdTimestamp,
  };

  try {
    const resp = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      console.error(`Webhook erreur ${resp.status}: ${await resp.text()}`);
    }
  } catch (err) {
    console.error('Erreur envoi webhook:', err.message);
  }
});

client.login(BOT_TOKEN);
