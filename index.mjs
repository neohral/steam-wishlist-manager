import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { Client as NotionClient } from '@notionhq/client';
import axios from 'axios';
import express from 'express';

// 各種トークン・ID
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const PORT = process.env.PORT;

// Discordクライアント
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Notionクライアント
const notion = new NotionClient({ auth: NOTION_TOKEN });

// SteamのURLからappIdを抽出
function extractAppId(url) {
  const match = url.match(/store\.steampowered\.com\/app\/(\d+)/);
  return match ? match[1] : null;
}

// Steam APIから情報取得
async function fetchSteamInfo(appId) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp&l=japanese`;
  const res = await axios.get(url);
  const data = res.data[appId].data;
  // 価格・セール情報を数値に変換
  let price = null;
  let originalPrice = null;
  let salePercent = null;
  if (data.price_overview) {
    price = parseInt(data.price_overview.final, 10) / 100;
    originalPrice = parseInt(data.price_overview.initial, 10) / 100;
    salePercent = data.price_overview.discount_percent;
  }
  return {
    title: data.name,
    price: price, // 割引後価格
    originalPrice: originalPrice, // 元値
    salePercent: salePercent, // 割引率
    url: `https://store.steampowered.com/app/${appId}/`,
    appId: appId,
    image: data.header_image
  };
}

// Notionに追加
async function addToNotion({ title, appId, url, price, originalPrice, salePercent, tag, imageUrl }) {
  const properties = {
    'Name': { title: [{ text: { content: title } }] },
    'AppID': { rich_text: [{ text: { content: appId } }] },
    'URL': { url: url },
    'Price': { number: price },
    'OriginalPrice': { number: originalPrice },
    'SalePercent': { number: salePercent/100 },
  };
  if (tag && tag.trim() !== '') {
    properties['Tags'] = { multi_select: [{ name: tag }] };
  }
  const coverUrl = imageUrl;
  await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    cover: {
      type: 'external',
      external: { url: coverUrl }
    },
    properties
  });
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('https://store.steampowered.com')) return;

  const args = message.content.split(' ');

  const steamUrl = args[0];
  let tag = args.slice(1).join(' ');
  const appId = extractAppId(steamUrl);

  if (!appId) {
    message.reply('SteamのURLが正しくありません。');
    return;
  }

  try {
    const info = await fetchSteamInfo(appId);
    await addToNotion({ ...info, tag, imageUrl: info.image });
  } catch (e) {
    console.error(e);
    message.reply('エラーが発生しました。');
  }
});

client.login(DISCORD_TOKEN);

// Express APIサーバー設定
// const app = express();

// // Steam情報取得API
// app.get('/api/steaminfo/:appId', async (req, res) => {
//   const appId = req.params.appId;
//   try {
//     const info = await fetchSteamInfo(appId);
//     res.json(info);
//   } catch (e) {
//     res.status(500).json({ error: '取得に失敗しました' });
//   }
// });

// app.listen(PORT, () => {
//   console.log(`APIサーバーが http://localhost:${PORT} で起動しました`);
// });