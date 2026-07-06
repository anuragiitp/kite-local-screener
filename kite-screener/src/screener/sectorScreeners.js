import { buildRequestBody } from './queryBuilder';
import { fetchUpToRows } from './kiteApi';

/** Macro sector groups → exact Kite `sector="..."` names (from GlobalFilterBar list). */
export const SECTOR_GROUP_DEFINITIONS = [
  {
    id: 'sector-financials',
    title: 'Financials',
    description: 'Banks, NBFC, insurance, AMC, housing finance',
    sectors: [
      'Banks',
      'Asset Management',
      'Finance - NBFC',
      'Finance - Lending',
      'Insurance',
      'Stock Broking',
      'Housing Finance',
      'Fintech',
      'Microfinance',
      'Finance - Investment',
    ],
  },
  {
    id: 'sector-it-telecom',
    title: 'IT & Telecom',
    description: 'Software, IT services, telecom',
    sectors: [
      'IT - Software',
      'Software Services',
      'Software Platform',
      'Telecom',
      'Telecom - Equipment',
      'Telecom - Infrastructure',
      'IT - Hardware',
      'IT - Networking',
    ],
  },
  {
    id: 'sector-pharma-healthcare',
    title: 'Pharma & Healthcare',
    description: 'Pharma, hospitals, diagnostics, med equipment',
    sectors: [
      'Pharmaceuticals',
      'Hospital & Healthcare',
      'Diagnostics',
      'Medical Equipment',
      'CDMO',
    ],
  },
  {
    id: 'sector-auto',
    title: 'Auto',
    description: 'Passenger, commercial, ancillary, two-wheelers',
    sectors: [
      'Passenger Vehicle',
      'Commercial Vehicle',
      'Auto Ancillary',
      'Automobiles',
      'Two & Three Wheelers',
      'Automobiles - Dealers & Distributors',
      'Tyres',
    ],
  },
  {
    id: 'sector-fmcg-consumer',
    title: 'FMCG & Consumer',
    description: 'FMCG, food, durables, beverages',
    sectors: [
      'Household & Personal Products',
      'Consumer Food',
      'Consumer Durables',
      'Dairy Products',
      'Edible Oil',
      'Tobacco',
      'Alcoholic Beverages',
      'Tea/Coffee',
      'Footwear',
    ],
  },
  {
    id: 'sector-real-estate-infra',
    title: 'Real Estate & Infra',
    description: 'Real estate, construction, ports, railways',
    sectors: [
      'Real Estate',
      'Engineering - Construction',
      'Pre Engineered Buildings',
      'Port',
      'Railways',
      'Water Management',
    ],
  },
  {
    id: 'sector-cement-metals',
    title: 'Cement & Metals',
    description: 'Cement, steel, mining, ferrous & non-ferrous',
    sectors: [
      'Cement',
      'Metal - Ferrous',
      'Metal - Non Ferrous',
      'Aluminium',
      'Steel & Iron Products',
      'Steel Pipes',
      'Steel/Sponge /Pig Iron',
      'Mining & Minerals',
      'Ferro & Silica Manganese',
    ],
  },
  {
    id: 'sector-energy-power',
    title: 'Energy & Power',
    description: 'Oil, gas, refineries, power, renewables',
    sectors: [
      'Oil Exploration',
      'Refineries',
      'Gas Transmission',
      'Power Generation',
      'Industrial Gases & Fuels',
      'Lubricants',
      'Solar Panels',
    ],
  },
  {
    id: 'sector-industrials',
    title: 'Industrials',
    description: 'Engineering, chemicals, logistics, capital goods',
    sectors: [
      'Engineering',
      'Engineering - Industrial Equipments',
      'Chemicals',
      'Petrochemicals',
      'Agrochemicals',
      'Pesticides',
      'Logistics',
      'Courier Services',
      'Shipping',
      'Compressors / Pumps',
      'Electric Equipment',
    ],
  },
  {
    id: 'sector-new-economy',
    title: 'New Economy & Others',
    description: 'Defence, media, hotels, textiles, agri, retail',
    sectors: [
      'Aerospace & Defense',
      'Media & Entertainment',
      'Hotels & Restaurants',
      'Travel Services',
      'Textile',
      'Textile - Spinning',
      'Textile - Weaving',
      'Fertilizers',
      'Entertainment Parks',
      'e-Commerce',
      'Retailing',
    ],
  },
];

export function buildSectorScreeners() {
  return SECTOR_GROUP_DEFINITIONS.map((def) => ({
    id: def.id,
    category: 'Sectors',
    title: def.title,
    description: def.description,
    isSectorGroup: true,
    sectors: def.sectors.map((name) => ({ label: name, name })),
    query: 'market_cap>0',
    order_by: 'market_cap',
    order: 'desc',
  }));
}

function perSectorTarget(limit, sectorCount) {
  if (!sectorCount) return 25;
  return Math.min(50, Math.max(20, Math.floor(limit / sectorCount)));
}

/** Fetch each sub-sector and merge into one table with separator rows. */
export async function fetchSectorGroupRows(screener, { marketCapId, limit, signal } = {}) {
  const sectors = screener.sectors || [];
  const target = perSectorTarget(limit || 500, sectors.length);
  const merged = [];
  let stockCount = 0;

  for (const { label, name } of sectors) {
    const body = buildRequestBody({
      screener,
      marketCapId,
      sector: name,
      limit: target,
    });

    let result;
    try {
      result = await fetchUpToRows(body, { targetRows: target, signal });
    } catch (error) {
      if (merged.length) continue;
      throw error;
    }

    if (!result.rows.length) continue;

    merged.push({ type: 'separator', label: label || name });
    merged.push(...result.rows);
    stockCount += result.rows.length;
  }

  return {
    rows: merged,
    total: stockCount,
    hasMore: false,
    nextOffset: merged.length,
  };
}
