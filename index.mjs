import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { Client as NotionClient } from '@notionhq/client';
import { fetchAppDetails, fetchOverallReview} from './services/steam-fetch.js';

// 各種トークン・ID
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

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
async function addToNotion({ title, appId, url, price, originalPrice, salePercent, tags, imageUrl, overallReview }) {
  const properties = {
    'Name': { title: [{ text: { content: title } }] },
    'AppID': { rich_text: [{ text: { content: appId } }] },
    'URL': { url: url },
    'Price': { number: price },
    'OriginalPrice': { number: originalPrice },
    'SalePercent': { number: salePercent/100 },
    'OverallReview': { rich_text: [{ text: { content: overallReview } }] }
  };
  if (tags && tags.length > 0) {
    properties['Tags'] = { multi_select: tags.map(tag => ({ name: tag.trim() })).filter(tag => tag.name !== '') };
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
  let tags = args.slice(1); // 複数のタグを配列として取得
  const appId = extractAppId(steamUrl);

  if (!appId) {
    message.reply('SteamのURLが正しくありません。');
    return;
  }

  try {
    const info = await fetchAppDetails(appId);
    const review = await fetchOverallReview(appId);
    const formaterdOverallReview = formatReviewText(review, "評価なし");
    await addToNotion({ ...info, tags, imageUrl: info.imageUrl, overallReview: formaterdOverallReview });
  } catch (e) {
    console.error(e);
    message.reply('エラーが発生しました。');
  }
});

const formatReviewText = (review, defaultMessage) => {
  if (review && review.summary && review.percent >= 0) {
    return `${review.summary}(${review.percent}%)`;
  }
  return defaultMessage;
};

client.login(DISCORD_TOKEN);