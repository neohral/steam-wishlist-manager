import 'dotenv/config';
import { Client as NotionClient } from '@notionhq/client';
import axios from 'axios';
import { Client, GatewayIntentBits } from 'discord.js';

// 各種トークン・ID
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Notionクライアント
const notion = new NotionClient({ auth: NOTION_TOKEN });

// Discordクライアント
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
let discordReady = false;
discordClient.once('ready', () => {
  discordReady = true;
  console.log('Discord bot ready');
});
discordClient.login(DISCORD_TOKEN);

async function sendDiscordNotification(message) {
  if (!discordReady) return;
  const channel = await discordClient.channels.fetch(DISCORD_CHANNEL_ID);
  if (channel && channel.isTextBased()) {
    await channel.send(message);
  }
}

// Steam APIから情報取得
async function fetchSteamInfo(appId) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp&l=japanese`;
  const res = await axios.get(url);
  const data = res.data[appId].data;
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
    price: price,
    originalPrice: originalPrice,
    salePercent: salePercent,
    url: `https://store.steampowered.com/app/${appId}/`,
    appId: appId
  };
}

// Notionデータベースから全ゲームを取得
async function getAllGamesFromNotion() {
  const pages = [];
  let cursor = undefined;
  do {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// Notionページを更新
async function updateNotionPage(pageId, { price, originalPrice, salePercent }) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      'Price': { number: price },
      'OriginalPrice': { number: originalPrice },
      'SalePercent': { number: salePercent/100 },
    },
  });
}

// メイン処理
(async () => {
  // Discordの準備ができるまで待つ
  while (!discordReady) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const games = await getAllGamesFromNotion();
  for (const page of games) {
    const appIdProp = page.properties['AppID'];
    const appId = appIdProp && appIdProp.rich_text && appIdProp.rich_text[0]?.plain_text;
    if (!appId) continue;

    // タグ取得（プロパティ名は適宜修正）
    const tagsProp = page.properties['Tags'];
    const tags = tagsProp && tagsProp.multi_select
      ? tagsProp.multi_select.map(tag => tag.name)
      : [];

    try {
      const info = await fetchSteamInfo(appId);
      // 既存のSalePercentを取得
      const oldSalePercent = page.properties['SalePercent']?.number ?? null;
      const oldPrice = page.properties['Price']?.number ?? null;
      await updateNotionPage(page.id, info);
      if ((oldSalePercent === 0 || oldSalePercent === null) && info.salePercent && info.salePercent !== 0) {
        // 「非通知」タグがあれば通知しない
        if (!tags.includes('非通知')) {
          const saleMsg = `SALE開始検知\nタイトル: ${info.title}\nURL: ${info.url}\n割引率: ${info.salePercent}%\n価格: ${info.price}円`;
          console.log(saleMsg);
          await sendDiscordNotification(saleMsg);
        } else {
          console.log(`非通知タグのため通知スキップ: ${info.title}`);
        }
      } else if ((oldPrice === null) && (info.price !== null)) {
        // 価格がnull→値ありになった場合のリリース通知
        if (!tags.includes('非通知')) {
          const releaseMsg = `リリース検知\nタイトル: ${info.title}\nURL: ${info.url}\n割引率: ${info.salePercent}%\n価格: ${info.price}円`;
          console.log(releaseMsg);
          await sendDiscordNotification(releaseMsg);
        } else {
          console.log(`非通知タグのためリリース通知スキップ: ${info.title}`);
        }
      } else {
        console.log(`Updated: ${info.title}`);
      }
    } catch (e) {
      console.error(`Failed to update AppID ${appId}:`, e.message);
    }
  }
  // Discordクライアントを終了
  discordClient.destroy();
})(); 