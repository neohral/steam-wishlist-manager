const formatReviewText = (review, defaultMessage) => {
  if (review && review.summary && review.percent >= 0) {
    return `${review.summary}(${review.percent}%)`;
  }
  return defaultMessage;
};

module.exports = {
  formatReviewText
};