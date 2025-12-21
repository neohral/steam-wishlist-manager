import axios from 'axios';
import * as cheerio from 'cheerio';

// Steam情報取得関連の定数
export const STEAM_CONSTANTS = {
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

// Steam APIから情報取得
export async function fetchSteamInfo(appId) {
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
    appId: appId,
    image: data.game_header_image_full
  };
}

// レビュー評価を取得
export async function fetchReview(appId) {
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
export function extractReviewInfo($) {
  let recentReview = '評価なし';
  let overallReview = '評価なし';

  $((STEAM_CONSTANTS.SELECTORS.REVIEWS.CONTAINER)).each((i, elem) => {
    const label = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.SUBTITLE).text().trim();
    const summary = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.SUMMARY).text().trim();
    const description = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.DESCRIPTION).text().trim();
    // パーセンテージを抽出
    const match = description.match(/(\d+)%/);
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
} 
