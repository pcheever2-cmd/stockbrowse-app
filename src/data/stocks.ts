// Real stock data from Compass Score database
import stocksData from './stocks.json';

export interface Stock {
  symbol: string;
  name: string;
  price: number;
  compassScore: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  industry: string;
  sector: string;
  marketCap: number; // in billions
  description: string; // company profile

  // Analyst data (consensus free, details premium)
  numAnalysts: number | null;
  consensus: string | null;
  // Premium analyst details
  avgPriceTarget: number | null;
  upside: number | null;
  recentRatings: string;
  analystPriceTargets: string;

  // Premium: Valuation metrics
  evEbitda: number | null;
  forwardPe: number | null;
  sectorPe: number | null;  // Median P/E for this sector (for comparison)
  pegRatio: number | null;

  // Premium: Growth metrics
  epsGrowth: number | null;
  revenueGrowth: number | null;

  // Premium: Financial health
  piotroskiScore: number | null;  // 0-9 scale
  altmanZ: number | null;

  // Premium: Technical indicators
  rsi: number | null;
  sma50: number | null;
  sma200: number | null;
  trendSignal: string | null;

  // Premium: Additional scores
  valueScore: number | null;
  longTermScore: number | null;

  // Premium: Analyst accuracy
  sectorAnalystAccuracy: number | null;
  coveringAnalysts: Array<{
    firm: string;
    hitRate: number;
    percentile: number;  // Rank vs all 174 analysts (0-100)
    totalCalls: number;
  }> | null;

  // Factor values for Score Breakdown (displayed as percentages)
  factorValues: {
    roa: number | null;           // Return on Assets %
    grossProfit: number | null;   // Gross Profit / Assets %
    operatingCashFlow: number | null;  // OCF / Assets %
    freeCashFlow: number | null;  // FCF / Assets %
    volatility: number | null;    // 60-day annualized volatility %
    assetGrowth: number | null;   // YoY asset growth %
  } | null;

  // Special note explaining score context (for holding companies, etc.)
  scoreNote: {
    title: string;
    text: string;
  } | null;

  // Moonshot Score (Quality Growth)
  moonshotScore: number | null;
  moonshotGrade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  isGolden: boolean;

  // Valuation Score (Technical Valuation)
  valuationScore: number | null;
  valuationRating: 'Undervalued' | 'Fair Value' | 'Overvalued' | null;
  valuationData: {
    vsSma200: number | null;
    vsSma50: number | null;
    position52w: number | null;
    high52w: number | null;
    low52w: number | null;
  } | null;
}

export const stocks: Stock[] = stocksData as Stock[];

// Normalized industry mapping (FMP industries -> display categories)
const industryMapping: Record<string, string> = {
  // Technology
  'Software - Application': 'Technology',
  'Software - Infrastructure': 'Technology',
  'Semiconductors': 'Technology',
  'Semiconductor Equipment & Materials': 'Technology',
  'Information Technology Services': 'Technology',
  'Hardware, Equipment & Parts': 'Technology',
  'Electronic Components': 'Technology',
  'Computer Hardware': 'Technology',
  'Communication Equipment': 'Technology',
  'Consumer Electronics': 'Technology',
  'Scientific & Technical Instruments': 'Technology',
  'Electronics & Computer Distribution': 'Technology',

  // Healthcare
  'Biotechnology': 'Healthcare',
  'Medical - Devices': 'Healthcare',
  'Medical - Diagnostics & Research': 'Healthcare',
  'Medical - Healthcare Plans': 'Healthcare',
  'Medical - Pharmaceuticals': 'Healthcare',
  'Medical - Care Facilities': 'Healthcare',
  'Medical - Distribution': 'Healthcare',
  'Drug Manufacturers - General': 'Healthcare',
  'Drug Manufacturers - Specialty & Generic': 'Healthcare',
  'Healthcare Plans': 'Healthcare',

  // Finance
  'Banks - Regional': 'Finance',
  'Banks - Diversified': 'Finance',
  'Asset Management': 'Finance',
  'Insurance - Life': 'Finance',
  'Insurance - Property & Casualty': 'Finance',
  'Insurance - Diversified': 'Finance',
  'Insurance - Specialty': 'Finance',
  'Insurance Brokers': 'Finance',
  'Capital Markets': 'Finance',
  'Financial - Data & Stock Exchanges': 'Finance',
  'Financial Conglomerates': 'Finance',
  'Credit Services': 'Finance',
  'Mortgage Finance': 'Finance',
  'Insurance - Reinsurance': 'Finance',
  'Shell Companies': 'Finance',

  // Consumer
  'Specialty Retail': 'Consumer',
  'Restaurants': 'Consumer',
  'Apparel Retail': 'Consumer',
  'Home Improvement Retail': 'Consumer',
  'Auto - Dealerships': 'Consumer',
  'Department Stores': 'Consumer',
  'Discount Stores': 'Consumer',
  'Grocery Stores': 'Consumer',
  'Internet Retail': 'Consumer',
  'Apparel Manufacturing': 'Consumer',
  'Footwear & Accessories': 'Consumer',
  'Household & Personal Products': 'Consumer',
  'Packaged Foods': 'Consumer',
  'Beverages - Non-Alcoholic': 'Consumer',
  'Beverages - Wineries & Distilleries': 'Consumer',
  'Beverages - Brewers': 'Consumer',
  'Tobacco': 'Consumer',
  'Confectioners': 'Consumer',
  'Auto - Manufacturers': 'Consumer',
  'Auto - Parts': 'Consumer',
  'Recreational Vehicles': 'Consumer',
  'Leisure': 'Consumer',
  'Gambling': 'Consumer',
  'Resorts & Casinos': 'Consumer',
  'Lodging': 'Consumer',
  'Travel Services': 'Consumer',
  'Personal Services': 'Consumer',
  'Education & Training Services': 'Consumer',
  'Luxury Goods': 'Consumer',
  'Furnishings, Fixtures & Appliances': 'Consumer',

  // Energy
  'Oil & Gas Exploration & Production': 'Energy',
  'Oil & Gas Integrated': 'Energy',
  'Oil & Gas E&P': 'Energy',
  'Oil & Gas Midstream': 'Energy',
  'Oil & Gas Refining & Marketing': 'Energy',
  'Oil & Gas Equipment & Services': 'Energy',
  'Oil & Gas Drilling': 'Energy',
  'Uranium': 'Energy',
  'Thermal Coal': 'Energy',

  // Industrials
  'Aerospace & Defense': 'Industrials',
  'Industrial - Machinery': 'Industrials',
  'Industrial Distribution': 'Industrials',
  'Specialty Industrial Machinery': 'Industrials',
  'Farm & Heavy Construction Machinery': 'Industrials',
  'Building Products & Equipment': 'Industrials',
  'Engineering & Construction': 'Industrials',
  'Electrical Equipment & Parts': 'Industrials',
  'Trucking': 'Industrials',
  'Railroads': 'Industrials',
  'Airlines': 'Industrials',
  'Marine Shipping': 'Industrials',
  'Integrated Freight & Logistics': 'Industrials',
  'Waste Management': 'Industrials',
  'Pollution & Treatment Controls': 'Industrials',
  'Conglomerates': 'Industrials',
  'Rental & Leasing Services': 'Industrials',
  'Security & Protection Services': 'Industrials',
  'Staffing & Employment Services': 'Industrials',
  'Consulting Services': 'Industrials',
  'Business Equipment & Supplies': 'Industrials',
  'Metal Fabrication': 'Industrials',
  'Tools & Accessories': 'Industrials',

  // Real Estate
  'REIT - Industrial': 'Real Estate',
  'REIT - Retail': 'Real Estate',
  'REIT - Residential': 'Real Estate',
  'REIT - Office': 'Real Estate',
  'REIT - Healthcare Facilities': 'Real Estate',
  'REIT - Hotel & Motel': 'Real Estate',
  'REIT - Mortgage': 'Real Estate',
  'REIT - Diversified': 'Real Estate',
  'REIT - Specialty': 'Real Estate',
  'Real Estate Services': 'Real Estate',
  'Real Estate - Development': 'Real Estate',
  'Real Estate - Diversified': 'Real Estate',

  // Utilities
  'Utilities - Regulated Electric': 'Utilities',
  'Utilities - Regulated Gas': 'Utilities',
  'Utilities - Diversified': 'Utilities',
  'Utilities - Renewable': 'Utilities',
  'Utilities - Independent Power Producers': 'Utilities',
  'Utilities - Regulated Water': 'Utilities',
  'Regulated Electric': 'Utilities',
  'Regulated Gas': 'Utilities',
  'Regulated Water': 'Utilities',
  'Diversified Utilities': 'Utilities',
  'Renewable Utilities': 'Utilities',
  'Independent Power Producers': 'Utilities',
  'General Utilities': 'Utilities',

  // Materials
  'Specialty Chemicals': 'Materials',
  'Chemicals': 'Materials',
  'Agricultural Inputs': 'Materials',
  'Gold': 'Materials',
  'Silver': 'Materials',
  'Copper': 'Materials',
  'Steel': 'Materials',
  'Aluminum': 'Materials',
  'Other Industrial Metals & Mining': 'Materials',
  'Other Precious Metals & Mining': 'Materials',
  'Coking Coal': 'Materials',
  'Building Materials': 'Materials',
  'Paper & Paper Products': 'Materials',
  'Lumber & Wood Production': 'Materials',
  'Packaging & Containers': 'Materials',

  // Communication Services
  'Entertainment': 'Communication Services',
  'Internet Content & Information': 'Communication Services',
  'Telecom Services': 'Communication Services',
  'Broadcasting': 'Communication Services',
  'Advertising Agencies': 'Communication Services',
  'Publishing': 'Communication Services',
  'Electronic Gaming & Multimedia': 'Communication Services',
};

// Get normalized industry
export function getNormalizedIndustry(industry: string): string {
  return industryMapping[industry] || 'Other';
}

// Display industries
export const displayIndustries = [
  { name: 'Technology', icon: '💻', color: 'blue' },
  { name: 'Healthcare', icon: '🏥', color: 'green' },
  { name: 'Finance', icon: '🏦', color: 'purple' },
  { name: 'Consumer', icon: '🛒', color: 'orange' },
  { name: 'Energy', icon: '⚡', color: 'yellow' },
  { name: 'Industrials', icon: '🏭', color: 'slate' },
  { name: 'Real Estate', icon: '🏢', color: 'teal' },
  { name: 'Utilities', icon: '💡', color: 'cyan' },
  { name: 'Materials', icon: '🔧', color: 'amber' },
  { name: 'Communication Services', icon: '📡', color: 'pink' },
];

// Helper functions
export function getStocksByIndustry(industry: string): Stock[] {
  return stocks.filter(s => getNormalizedIndustry(s.industry) === industry);
}

export function getStocksByGrade(grade: string): Stock[] {
  return stocks.filter(s => s.grade === grade);
}

export function getStockBySymbol(symbol: string): Stock | undefined {
  return stocks.find(s => s.symbol.toLowerCase() === symbol.toLowerCase());
}

export function searchStocks(query: string): Stock[] {
  const q = query.toLowerCase();
  return stocks.filter(s =>
    s.symbol.toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q)
  ).slice(0, 20);
}

export function getIndustryStats(industry: string) {
  const industryStocks = getStocksByIndustry(industry);
  if (industryStocks.length === 0) return { count: 0, avgScore: 0, aGradeCount: 0 };
  const avgScore = industryStocks.reduce((sum, s) => sum + s.compassScore, 0) / industryStocks.length;
  return {
    count: industryStocks.length,
    avgScore: Math.round(avgScore),
    aGradeCount: industryStocks.filter(s => s.grade === 'A').length,
  };
}

// Browse by Goal filters
export function getDividendStocks(): Stock[] {
  // For now, filter by sectors that typically pay dividends and good scores
  const dividendSectors = ['Utilities', 'Real Estate', 'Finance', 'Consumer', 'Energy'];
  return stocks
    .filter(s => dividendSectors.includes(getNormalizedIndustry(s.industry)) && s.compassScore >= 60)
    .sort((a, b) => b.compassScore - a.compassScore)
    .slice(0, 100);
}

export function getGrowthStocks(): Stock[] {
  const growthSectors = ['Technology', 'Healthcare', 'Communication Services'];
  return stocks
    .filter(s => growthSectors.includes(getNormalizedIndustry(s.industry)) && s.compassScore >= 70)
    .sort((a, b) => b.compassScore - a.compassScore)
    .slice(0, 100);
}

export function getLowRiskStocks(): Stock[] {
  // High quality stocks (A or B grade)
  return stocks
    .filter(s => s.grade === 'A' || s.grade === 'B')
    .sort((a, b) => b.compassScore - a.compassScore)
    .slice(0, 100);
}

export function getStocksUnderPrice(maxPrice: number): Stock[] {
  return stocks
    .filter(s => s.price > 0 && s.price <= maxPrice && s.compassScore >= 50)
    .sort((a, b) => b.compassScore - a.compassScore)
    .slice(0, 100);
}

export function getUndervaluedStocks(): Stock[] {
  return stocks
    .filter(s => s.valuationRating === 'Undervalued' && (s.compassScore ?? 0) >= 50)
    .sort((a, b) => (b.compassScore ?? 0) - (a.compassScore ?? 0))
    .slice(0, 100);
}

export function getTopStocks(limit: number = 20): Stock[] {
  return [...stocks].sort((a, b) => b.compassScore - a.compassScore).slice(0, limit);
}

export function getGradeColor(grade: string): { bg: string; text: string; border: string } {
  switch (grade) {
    case 'A': return { bg: 'bg-[#22D3EE15]', text: 'text-[#22D3EE]', border: 'border-[#22D3EE33]' };
    case 'B': return { bg: 'bg-[#34D39915]', text: 'text-[#34D399]', border: 'border-[#34D39933]' };
    case 'C': return { bg: 'bg-[#94A3B815]', text: 'text-[#94A3B8]', border: 'border-[#94A3B833]' };
    case 'D': return { bg: 'bg-[#FBBF2415]', text: 'text-[#FBBF24]', border: 'border-[#FBBF2433]' };
    case 'F': return { bg: 'bg-[#F8717115]', text: 'text-[#F87171]', border: 'border-[#F8717133]' };
    default: return { bg: 'bg-[#94A3B815]', text: 'text-[#94A3B8]', border: 'border-[#94A3B833]' };
  }
}

export function generateSummary(stock: Stock): string {
  const quality = stock.grade === 'A' ? 'high-quality' :
                  stock.grade === 'B' ? 'above-average quality' :
                  stock.grade === 'C' ? 'average quality' :
                  stock.grade === 'D' ? 'below-average quality' : 'high-risk';

  const industry = getNormalizedIndustry(stock.industry).toLowerCase();

  let summary = `${stock.name} is a ${quality} ${industry} company with a Compass Score of ${stock.compassScore}. `;

  if (stock.grade === 'A') {
    summary += 'This stock demonstrates strong fundamentals across profitability, cash flow, and stability metrics. Suitable for long-term investors seeking quality.';
  } else if (stock.grade === 'B') {
    summary += 'This stock shows solid fundamentals with room for improvement in some areas. Worth considering for a diversified portfolio.';
  } else if (stock.grade === 'C') {
    summary += 'This stock has mixed fundamentals. Consider carefully and ensure it fits your investment strategy before buying.';
  } else if (stock.grade === 'D') {
    summary += 'This stock shows weak fundamentals or high volatility. May be suitable for speculative positions only.';
  } else {
    summary += 'This stock has poor quality metrics and high risk. Not recommended for conservative investors.';
  }

  return summary;
}

// Get company description, truncated to a reasonable length
export function getCompanyProfile(stock: Stock): string {
  if (!stock.description || stock.description.length < 20) {
    return '';
  }
  // Return first 2-3 sentences (roughly 400 chars)
  const desc = stock.description;
  if (desc.length <= 400) return desc;

  // Find a good cutoff point (end of sentence)
  const cutoff = desc.slice(0, 450).lastIndexOf('. ');
  if (cutoff > 200) {
    return desc.slice(0, cutoff + 1);
  }
  return desc.slice(0, 400) + '...';
}

export function formatPrice(price: number): string {
  if (!price || price <= 0) return 'N/A';
  return `$${price.toFixed(2)}`;
}

export function formatMarketCap(marketCap: number): string {
  if (!marketCap || marketCap <= 0) return 'N/A';
  if (marketCap >= 1000) return `$${(marketCap / 1000).toFixed(1)}T`;
  if (marketCap >= 1) return `$${marketCap.toFixed(1)}B`;
  return `$${(marketCap * 1000).toFixed(0)}M`;
}

// Get related stocks (same industry, similar grade)
export function getRelatedStocks(stock: Stock, limit: number = 6): Stock[] {
  const industry = getNormalizedIndustry(stock.industry);
  return stocks
    .filter(s =>
      s.symbol !== stock.symbol &&
      getNormalizedIndustry(s.industry) === industry &&
      (s.grade === stock.grade || Math.abs(s.compassScore - stock.compassScore) <= 15)
    )
    .sort((a, b) => b.compassScore - a.compassScore)
    .slice(0, limit);
}

// Score breakdown indicator type
export type FactorRating = 'strong' | 'average' | 'weak';

export interface ScoreBreakdown {
  roa: FactorRating;
  grossProfit: FactorRating;
  operatingCashFlow: FactorRating;
  freeCashFlow: FactorRating;
  volatility: FactorRating;
  assetGrowth: FactorRating;
}

// Universe averages for factor rating thresholds (from research)
const FACTOR_THRESHOLDS = {
  roa: { strong: 5, weak: -2 },           // ROA > 5% is strong, < -2% is weak
  grossProfit: { strong: 35, weak: 15 },  // GP/Assets > 35% is strong
  operatingCashFlow: { strong: 10, weak: 0 },  // OCF/Assets > 10% is strong
  freeCashFlow: { strong: 8, weak: -2 },  // FCF/Assets > 8% is strong
  volatility: { strong: 35, weak: 60 },   // Vol < 35% is strong (inverted)
  assetGrowth: { strong: 5, weak: 25 },   // Growth 0-5% is strong (inverted)
};

// Rate a single factor value
function rateFactorValue(value: number | null, factor: keyof typeof FACTOR_THRESHOLDS): FactorRating {
  if (value === null) return 'average';

  const thresholds = FACTOR_THRESHOLDS[factor];

  // Volatility and assetGrowth are inverted (lower is better)
  if (factor === 'volatility' || factor === 'assetGrowth') {
    if (value <= thresholds.strong) return 'strong';
    if (value >= thresholds.weak) return 'weak';
    return 'average';
  }

  // Normal factors (higher is better)
  if (value >= thresholds.strong) return 'strong';
  if (value <= thresholds.weak) return 'weak';
  return 'average';
}

// Generate score breakdown using actual factor values when available
export function getScoreBreakdown(stock: Stock): ScoreBreakdown {
  const fv = stock.factorValues;

  // If we have actual factor values, use them
  if (fv) {
    return {
      roa: rateFactorValue(fv.roa, 'roa'),
      grossProfit: rateFactorValue(fv.grossProfit, 'grossProfit'),
      operatingCashFlow: rateFactorValue(fv.operatingCashFlow, 'operatingCashFlow'),
      freeCashFlow: rateFactorValue(fv.freeCashFlow, 'freeCashFlow'),
      volatility: rateFactorValue(fv.volatility, 'volatility'),
      assetGrowth: rateFactorValue(fv.assetGrowth, 'assetGrowth'),
    };
  }

  // Fallback: estimate from grade (legacy behavior)
  const score = stock.compassScore;
  const grade = stock.grade;

  if (grade === 'A') {
    return {
      roa: 'strong',
      grossProfit: 'strong',
      operatingCashFlow: score >= 90 ? 'strong' : 'average',
      freeCashFlow: 'strong',
      volatility: 'strong',
      assetGrowth: score >= 95 ? 'strong' : 'average',
    };
  } else if (grade === 'B') {
    return {
      roa: score >= 75 ? 'strong' : 'average',
      grossProfit: 'average',
      operatingCashFlow: score >= 70 ? 'strong' : 'average',
      freeCashFlow: 'average',
      volatility: score >= 75 ? 'strong' : 'average',
      assetGrowth: 'average',
    };
  } else if (grade === 'C') {
    return {
      roa: 'average',
      grossProfit: score >= 50 ? 'average' : 'weak',
      operatingCashFlow: 'average',
      freeCashFlow: score >= 45 ? 'average' : 'weak',
      volatility: 'average',
      assetGrowth: 'average',
    };
  } else if (grade === 'D') {
    return {
      roa: score >= 30 ? 'average' : 'weak',
      grossProfit: 'weak',
      operatingCashFlow: score >= 25 ? 'average' : 'weak',
      freeCashFlow: 'weak',
      volatility: 'weak',
      assetGrowth: 'average',
    };
  } else {
    return {
      roa: 'weak',
      grossProfit: 'weak',
      operatingCashFlow: 'weak',
      freeCashFlow: score >= 10 ? 'average' : 'weak',
      volatility: 'weak',
      assetGrowth: 'weak',
    };
  }
}

export function getFactorRatingColor(rating: FactorRating): { bg: string; text: string; label: string } {
  switch (rating) {
    case 'strong': return { bg: 'bg-emerald-900/40', text: 'text-emerald-400', label: 'Strong' };
    case 'average': return { bg: 'bg-slate-700/40', text: 'text-slate-300', label: 'Average' };
    case 'weak': return { bg: 'bg-red-900/40', text: 'text-red-400', label: 'Weak' };
  }
}

// Analyst consensus helpers - calculates from actual analyst ratings
// Now considers price target vs current price (upside) to avoid contradictory displays
export function getConsensusInfo(_consensus: string | null, recentRatings: string = '', upside: number | null = null): { label: string; color: string; bgColor: string } {
  // Calculate consensus from recent ratings (consensus param reserved for future use)
  if (recentRatings) {
    const ratings = parseRecentRatings(recentRatings);
    if (ratings.length > 0) {
      // Count rating types
      let buyCount = 0;
      let holdCount = 0;
      let sellCount = 0;

      ratings.forEach(r => {
        const rating = r.rating.toLowerCase();
        if (rating.includes('buy') || rating.includes('outperform') || rating.includes('overweight')) {
          buyCount++;
        } else if (rating.includes('sell') || rating.includes('underperform') || rating.includes('underweight')) {
          sellCount++;
        } else {
          holdCount++;
        }
      });

      // Calculate consensus based on majority
      const total = buyCount + holdCount + sellCount;
      const buyPct = buyCount / total;
      const sellPct = sellCount / total;

      // Determine base consensus
      let consensus: { label: string; color: string; bgColor: string };
      if (buyPct >= 0.6) {
        consensus = { label: 'Strong Buy', color: 'text-emerald-400', bgColor: 'bg-emerald-900/40' };
      } else if (buyPct >= 0.4) {
        consensus = { label: 'Buy', color: 'text-blue-400', bgColor: 'bg-blue-900/40' };
      } else if (sellPct >= 0.6) {
        consensus = { label: 'Strong Sell', color: 'text-red-400', bgColor: 'bg-red-900/40' };
      } else if (sellPct >= 0.4) {
        consensus = { label: 'Sell', color: 'text-amber-400', bgColor: 'bg-amber-900/40' };
      } else {
        consensus = { label: 'Hold', color: 'text-slate-300', bgColor: 'bg-slate-700/40' };
      }

      // Override if price target conflicts with rating
      // If upside is significantly negative (stock > 15% above target), downgrade buy ratings
      if (upside !== null && upside < -15) {
        if (consensus.label === 'Strong Buy' || consensus.label === 'Buy') {
          // Stock is well above analyst targets - show "Above Target" instead
          return { label: 'Above Target', color: 'text-amber-400', bgColor: 'bg-amber-900/40' };
        }
      }
      // If upside is very positive (>30%) but analysts say sell, flag as "Below Target"
      if (upside !== null && upside > 30) {
        if (consensus.label === 'Strong Sell' || consensus.label === 'Sell') {
          return { label: 'Below Target', color: 'text-blue-400', bgColor: 'bg-blue-900/40' };
        }
      }

      return consensus;
    }
  }

  return { label: 'N/A', color: 'text-slate-400', bgColor: 'bg-slate-800/40' };
}

// Parse recent ratings into structured format
export function parseRecentRatings(ratingsStr: string): Array<{ date: string; firm: string; rating: string; icon: string }> {
  if (!ratingsStr) return [];

  const lines = ratingsStr.split('\n').filter(l => l.trim());
  return lines.slice(0, 5).map(line => {
    // Format: "◾ 2026-01-12: B of A Securities → Buy" or "⬆️ 2026-01-08: Evercore ISI Group → Outperform"
    const icon = line.charAt(0);
    const rest = line.slice(2).trim();
    const dateMatch = rest.match(/^(\d{4}-\d{2}-\d{2}):\s*/);
    if (!dateMatch) return { date: '', firm: '', rating: rest, icon };

    const date = dateMatch[1];
    const afterDate = rest.slice(dateMatch[0].length);
    const [firm, rating] = afterDate.split('→').map(s => s.trim());

    return { date, firm: firm || '', rating: rating || '', icon };
  });
}

// Parse analyst price targets into structured format
export function parseAnalystPriceTargets(targetsStr: string): Array<{ date: string; firm: string; priceTarget: number; priceWhenPosted: number | null }> {
  if (!targetsStr) return [];

  const lines = targetsStr.split('\n').filter(l => l.trim());
  return lines.map(line => {
    // Format: "2026-01-15|Goldman Sachs|200|185" (date|firm|target|priceWhenPosted)
    const parts = line.split('|');
    if (parts.length < 3) return null;

    const [date, firm, targetStr, priceWhenPostedStr] = parts;
    const priceTarget = parseFloat(targetStr);
    const priceWhenPosted = priceWhenPostedStr ? parseFloat(priceWhenPostedStr) : null;

    if (isNaN(priceTarget)) return null;

    return {
      date: date || '',
      firm: firm || '',
      priceTarget,
      priceWhenPosted: priceWhenPosted && !isNaN(priceWhenPosted) ? priceWhenPosted : null
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
}
