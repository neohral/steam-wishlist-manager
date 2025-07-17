import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { Client as NotionClient } from '@notionhq/client';
import axios from 'axios';
import express from 'express';
import * as cheerio from 'cheerio';

// 各種トークン・ID
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const PORT = process.env.PORT;

// Steam情報取得関連の定数
const STEAM_CONSTANTS = {
  BASE_URL: 'store.steampowered.com',
  JAPANESE_LOCALE: 'japanese',
  SELECTORS: {
    TITLE: '.apphub_AppName',
    PRICE: {
      CONTAINER: '.game_area_purchase_game_wrapper',
      REGULAR: '.game_purchase_price',
      DISCOUNT: '.discount_final_price'
    },
    REVIEWS: {
      CONTAINER: '.user_reviews_summary_row',
      SUBTITLE: '.subtitle',
      SUMMARY: '.game_review_summary',
      DESCRIPTION: '.responsive_reviewdesc'
    }
  },
  LABELS: {
    RECENT_JP: '最近のレビュー：',
    RECENT_EN: 'Recent Reviews:',
    OVERALL_JP: 'すべてのレビュー：',
    OVERALL_EN: 'All Reviews:'
  },
  DEFAULT_MESSAGES: {
    NO_RECENT_REVIEW: '',
    NO_OVERALL_REVIEW: 'すべてのレビュー：評価なし'
  }
};


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
// レビュー評価を取得
async function fetchReview(appId) {
  const url = `https://store.steampowered.com/app/${appId}?l=japanese&agecheck=1`;
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
  let recentReview = { label: '', summary: '', percent: 0 };
  let overallReview = { label: '', summary: '', percent: 0 };

  $(STEAM_CONSTANTS.SELECTORS.REVIEWS.CONTAINER).each((i, elem) => {
    const label = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.SUBTITLE).text().trim();
    const summary = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.SUMMARY).text().trim();
    const description = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.DESCRIPTION).text().trim();

    // パーセンテージを抽出
    const match = description.match(/(\d+)%\s.*$/);
    const percent = match ? parseInt(match[1], 10) : 0;

    // 最近のレビュー
    if (label === STEAM_CONSTANTS.LABELS.RECENT_JP ) {
      recentReview = `${summary} (${percent}%)`;
    }

    // 全体のレビュー
    if (label === STEAM_CONSTANTS.LABELS.OVERALL_JP) {
      overallReview = `${summary} (${percent}%)`;
      return false; // ループを終了
    }
  });

  return { recentReview, overallReview };
};

// Notionに追加
async function addToNotion({ title, appId, url, price, originalPrice, salePercent, tag, imageUrl, overallReview }) {
  const properties = {
    'Name': { title: [{ text: { content: title } }] },
    'AppID': { rich_text: [{ text: { content: appId } }] },
    'URL': { url: url },
    'Price': { number: price },
    'OriginalPrice': { number: originalPrice },
    'SalePercent': { number: salePercent/100 },
    'OverallReview': { rich_text: [{ text: { content: overallReview } }] }
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
    const review = await fetchReview(appId);
    await addToNotion({ ...info, tag, imageUrl: info.image, overallReview: review.overallReview });
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