const axios = require('axios');
const cheerio = require('cheerio');

// ========== 定数 ==========
const STEAM_CONSTANTS = {
  BASE_URL: 'store.steampowered.com',
  JAPANESE_LOCALE: 'japanese',
  API_ENDPOINTS: {
    APP_DETAILS: 'https://store.steampowered.com/api/appdetails',
    APP_REVIEWS: 'https://store.steampowered.com/appreviews'
  },
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
  },
  DEFAULT_MESSAGES: {
    NO_RECENT_REVIEW: '',
    NO_OVERALL_REVIEW: 'すべてのレビュー：評価なし'
  }
};

const REVIEW_SCORE_JA_MAP = {
  "Overwhelmingly Positive": "圧倒的に好評",
  "Very Positive": "非常に好評",
  "Positive": "好評",
  "Mostly Positive": "やや好評",
  "Mixed": "賛否両論",
  "Mostly Negative": "やや不評",
  "Negative": "不評",
  "Very Negative": "非常に不評",
  "Overwhelmingly Negative": "圧倒的に不評",
  "No user reviews": "レビューなし"
};

const AXIOS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Cookie': 'birthtime=631152000; lastagecheckage=18; mature_content=1'
};

const ERROR_MESSAGES = {
  INVALID_URL: 'URLが指定されていません',
  INVALID_STEAM_URL: 'SteamストアのURLではありません',
  APP_NOT_FOUND: 'ゲーム情報が見つかりません',
  FETCH_FAILED: 'Steamページの取得に失敗しました'
};

// ========== URL操作 ==========
const validateSteamUrl = (url) => {
  if (!url || typeof url !== 'string') {
    throw new Error(ERROR_MESSAGES.INVALID_URL);
  }

  if (!url.includes(STEAM_CONSTANTS.BASE_URL)) {
    throw new Error(ERROR_MESSAGES.INVALID_STEAM_URL);
  }

  return true;
};

const addJapaneseLocale = (url) => {
  if (!url.includes('?l=')) {
    return `${url}?l=${STEAM_CONSTANTS.JAPANESE_LOCALE}`;
  }
  return url;
};

const extractAppIdFromUrl = (url) => {
  const appIdMatch = url.match(/\/app\/(\d+)/);
  if (!appIdMatch) {
    throw new Error(ERROR_MESSAGES.INVALID_STEAM_URL);
  }
  return appIdMatch[1];
};

// ========== スクレイピング関数 ==========
const extractRecentReview = ($) => {
  let recentReview = { label: '', summary: '', percent: 0 };

  $(STEAM_CONSTANTS.SELECTORS.REVIEWS.CONTAINER).each((i, elem) => {
    const label = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.SUBTITLE).text().trim();
    const summary = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.SUMMARY).text().trim();
    const description = $(elem).find(STEAM_CONSTANTS.SELECTORS.REVIEWS.DESCRIPTION).text().trim();

    const match = description.match(/(\d+)%/);
    const percent = match ? parseInt(match[1], 10) : 0;

    if (label === STEAM_CONSTANTS.LABELS.RECENT_JP) {
      recentReview = { label: STEAM_CONSTANTS.LABELS.RECENT_JP, summary, percent };
      return false;
    }
  });

  return recentReview;
};

// ========== API取得関数 ==========
const fetchAppDetails = async (appId) => {
  const url = `${STEAM_CONSTANTS.API_ENDPOINTS.APP_DETAILS}?appids=${appId}&l=japanese`;
  const response = await axios.get(url);
  const appData = response.data[appId];

  if (!appData.success) {
    throw new Error(ERROR_MESSAGES.APP_NOT_FOUND);
  }

  const data = appData.data;
  const imageUrl = new URL(data.header_image);
  const cleanImageUrl = imageUrl.origin + imageUrl.pathname;
  const price = data.price_overview ? Number(data.price_overview.final_formatted.replace(/[^\d]/g, '')) : null
  const originalPrice = data.price_overview ? Number(data.price_overview.initial_formatted.replace(/[^\d]/g, '')) : null
  return {
    title: data.name,
    imageUrl: cleanImageUrl,
    price,
    originalPrice,
    salePercent: data.price_overview ? data.price_overview.discount_percent : null,
    url: `https://store.steampowered.com/app/${appId}/`,
    appId: appId,
  };
};

const fetchOverallReview = async (appId) => {
  try {
    const url = `${STEAM_CONSTANTS.API_ENDPOINTS.APP_REVIEWS}/${appId}?json=1&language=all`;
    const response = await axios.get(url);
    const data = response.data;

    if (data.success !== 1 || !data.query_summary) {
      return null;
    }

    const { review_score_desc, total_positive, total_reviews } = data.query_summary;

    if (total_reviews === 0) {
      return null;
    }

    const summary = REVIEW_SCORE_JA_MAP[review_score_desc] ?? review_score_desc;
    const percent = Math.round((total_positive / total_reviews) * 100);

    return {
      label: 'すべてのレビュー：',
      summary,
      percent
    };
  } catch (error) {
    console.error('全体レビューAPI取得エラー:', error);
    return null;
  }
};

const fetchPageContent = async (url) => {
  const normalizedUrl = `${addJapaneseLocale(url)}&agecheck=1`;
  const response = await axios.get(normalizedUrl, { headers: AXIOS_HEADERS });
  return cheerio.load(response.data);
};

// ========== フォーマット関数 ==========
const formatReviewText = (review, defaultMessage) => {
  if (review && review.summary && review.percent >= 0) {
    return `${review.label}${review.summary}(${review.percent}%)`;
  }
  return defaultMessage;
};

// ========== メイン関数 ==========
const fetchSteamGameInfo = async (url) => {
  try {
    validateSteamUrl(url);
    const appId = extractAppIdFromUrl(url);

    // 並列でデータを取得
    const [appDetails, $, overallReview] = await Promise.all([
      fetchAppDetails(appId),
      fetchPageContent(url),
      fetchOverallReview(appId)
    ]);

    const recentReview = extractRecentReview($);

    return {
      title: appDetails.title,
      imageUrl: appDetails.imageUrl,
      price: appDetails.price,
      storeUrl: `https://store.steampowered.com/app/${appId}`,
      review: formatReviewText(recentReview, STEAM_CONSTANTS.DEFAULT_MESSAGES.NO_RECENT_REVIEW),
      overallReview: formatReviewText(overallReview, STEAM_CONSTANTS.DEFAULT_MESSAGES.NO_OVERALL_REVIEW)
    };
  } catch (error) {
    if (Object.values(ERROR_MESSAGES).some(msg => error.message.includes(msg))) {
      throw error;
    }

    console.error('Steam情報取得エラー:', error);
    throw new Error(ERROR_MESSAGES.FETCH_FAILED);
  }
};

module.exports = {
  fetchSteamGameInfo,fetchAppDetails,fetchPageContent,fetchOverallReview,extractRecentReview,formatReviewText
};