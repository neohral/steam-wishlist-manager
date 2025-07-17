import 'dotenv/config';
import { Client as NotionClient } from '@notionhq/client';
import axios from 'axios';
import { Client, GatewayIntentBits } from 'discord.js';
import * as cheerio from 'cheerio';

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

// Steam情報取得関連の定数
const STEAM_CONSTANTS = {
  SELECTORS: {
    REVIEWS: {
      CONTAINER: '.user_reviews_summary_row',
      SUBTITLE: '.subtitle',
      SUMMARY: '.game_review_summary',
      DESCRIPTION: '.responsive_reviewdesc'
    }
  },
  LABELS: {
    RECENT_JP: '最近のレビュー：',
    OVERALL_JP: 'すべてのレビュー：',
  },
};


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

// レビュー評価を取得
async function fetchReview(appId) {
  const url = `https://store.steampowered.com/app/${appId}?l=japanese`;
  // Steamページを取得
  const response = await axios.get(url, {
    headers: {
      'Cookie': 'wants_mature_content=1'
    }
  });
  const $ = cheerio.load(response.data);

  // 各情報を抽出
  const { recentReview, overallReview } = extractReviewInfo($);
  return { recentReview, overallReview };
}

// レビュー情報を抽出
const extractReviewInfo = ($) => {
  let recentReview = '評価なし';
  let overallReview = '評価なし';

  $(STEAM_CONSTANTS.SELECTORS.REVIEWS.CONTAINER).each((i, elem) => {
    const label = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.SUBTITLE).text().trim();
    const summary = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.SUMMARY).text().trim();
    const description = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.DESCRIPTION).text().trim();

    // パーセンテージを抽出
    const match = description.match(/(\d+)%\s.*$/);
    const percent = match ? parseInt(match[1], 10) : 0;

    // 最近のレビュー
    if (label === STEAM_CONSTANTS.LABELS.RECENT_JP && summary != '') {
      recentReview = `${summary} (${percent}%)`;
    }

    // 全体のレビュー
    if (label === STEAM_CONSTANTS.LABELS.OVERALL_JP && summary != '') {
      overallReview = `${summary} (${percent}%)`;
      return false; // ループを終了
    }
  });

  return { recentReview, overallReview };
};

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
async function updateNotionPage(pageId, { price, originalPrice, salePercent }, overallReview) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      'Price': { number: price },
      'OriginalPrice': { number: originalPrice },
      'SalePercent': { number: salePercent/100 },
      'OverallReview': { rich_text: [{ text: { content: overallReview } }] }
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
      const review = await fetchReview(appId);
      // 既存のSalePercentを取得
      const oldSalePercent = page.properties['SalePercent']?.number ?? null;
      const oldPrice = page.properties['Price']?.number ?? null;
      await updateNotionPage(page.id, info, review.overallReview);
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