const YahooFinance = require("yahoo-finance2").default;

const QUOTE_FIELDS = [
  "symbol",
  "shortName",
  "longName",
  "currency",
  "marketState",
  "regularMarketPrice",
  "regularMarketPreviousClose",
  "regularMarketTime",
  "preMarketPrice",
  "postMarketPrice",
];

class YahooQuoteProvider {
  constructor() {
    this.client = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
    });
  }

  async getQuotes(symbols) {
    const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
    if (!uniqueSymbols.length) {
      return {};
    }

    const quoteMap = await this.client.quote(uniqueSymbols, {
      fields: QUOTE_FIELDS,
      return: "object",
    });

    const result = {};
    for (const symbol of uniqueSymbols) {
      result[symbol] = quoteMap[symbol] || null;
    }

    return result;
  }
}

module.exports = {
  YahooQuoteProvider,
};
