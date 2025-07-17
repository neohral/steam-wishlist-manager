import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { Client as NotionClient } from '@notionhq/client';
import { fetchSteamInfo, fetchReview } from './steamUtils.mjs';

// 各種トークン・ID
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

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