import { MARKET_CAP_BUCKETS } from '../screener/presets';

const SECTORS = [
  '',
  'Abrasives',
  'Advertising & Media',
  'Aerospace & Defense',
  'Agriculture',
  'Agrochemicals',
  'Air Conditioners',
  'Airport Management Services',
  'Alcoholic Beverages',
  'Aluminium',
  'Animal Feed',
  'Aquaculture',
  'Asset Management',
  'Auto Ancillary',
  'Automobiles',
  'Automobiles - Dealers & Distributors',
  'Aviation',
  'Banks',
  'Batteries',
  'Bearings',
  'Business Support',
  'CDMO',
  'Cables',
  'Carbon Black',
  'Castings & Forgings',
  'Cement',
  'Chemicals',
  'Commercial Vehicle',
  'Compressors / Pumps',
  'Construction Vehicles',
  'Consumer Durables',
  'Consumer Food',
  'Courier Services',
  'Cycles',
  'Dairy Products',
  'Depository Services',
  'Diagnostics',
  'Diamond & Jewellery',
  'Diesel Engines',
  'Diversified',
  'Dyes & Pigments',
  'EMS',
  'Edible Oil',
  'Educational Institutions',
  'Electric Equipment',
  'Electrodes & Welding',
  'Electronics',
  'Engineering',
  'Engineering - Construction',
  'Engineering - Industrial Equipments',
  'Engineering Consultancy',
  'Entertainment Parks',
  'Fasteners',
  'Ferro & Silica Manganese',
  'Fertilizers',
  'Finance',
  'Finance - Investment',
  'Finance - Lending',
  'Finance - NBFC',
  'Fintech',
  'Footwear',
  'Forgings',
  'Gas Transmission',
  'Glass',
  'Hospital & Healthcare',
  'Hotels & Restaurants',
  'Household & Personal Products',
  'Housing Finance',
  'IT - Education',
  'IT - Hardware',
  'IT - Networking',
  'IT - Software',
  'Industrial Gases & Fuels',
  'Insurance',
  'Laminates/Decoratives',
  'Leather',
  'Logistics',
  'Lubricants',
  'Media & Entertainment',
  'Medical Equipment',
  'Metal - Ferrous',
  'Metal - Non Ferrous',
  'Microfinance',
  'Mining & Minerals',
  'Miscellaneous',
  'Oil Exploration',
  'Packaging',
  'Paints',
  'Paper Products',
  'Passenger Vehicle',
  'Pesticides',
  'Petrochemicals',
  'Pharmaceuticals',
  'Photographic Products',
  'Plastic Pipes',
  'Plastic Products',
  'Plywood and Laminates',
  'Port',
  'Power Generation',
  'Pre Engineered Buildings',
  'Printing & Stationery',
  'Printing And Publishing',
  'Professional Services',
  'Railways',
  'Ratings',
  'Real Estate',
  'Recycling',
  'Refineries',
  'Refractories',
  'Restaurants',
  'Retailing',
  'Rubber Products',
  'Semiconductors',
  'Ship Building',
  'Shipping',
  'Software Platform',
  'Software Services',
  'Solar Panels',
  'Solvent  Extraction',
  'Steel & Iron Products',
  'Steel Pipes',
  'Steel/Sponge /Pig Iron',
  'Stock Broking',
  'Sugar',
  'TV Broadcasting & Software Production',
  'Tea/Coffee',
  'Telecom',
  'Telecom - Equipment',
  'Telecom - Infrastructure',
  'Textile',
  'Textile - Machinery',
  'Textile - Manmade  Fibres',
  'Textile - Spinning',
  'Textile - Weaving',
  'Tiles & Sanitaryware',
  'Tobacco',
  'Trading',
  'Transformers',
  'Transmission Towers & Equipments',
  'Travel Services',
  'Two & Three Wheelers',
  'Tyres',
  'Watches & Accessories',
  'Water Management',
  'Wires & Cables',
  'Wood & Wood Products',
  'e-Commerce',
];

export default function ScreenerFilters({
  marketCapId,
  setMarketCapId,
  sector,
  setSector,
  limit,
  setLimit,
  hideSectorFilter = false,
}) {
  return (
    <div className="screener-filters">
      <select
        className="filter-compact"
        value={marketCapId}
        onChange={(event) => setMarketCapId(event.target.value)}
        aria-label="Market cap"
      >
        {MARKET_CAP_BUCKETS.map((bucket) => (
          <option key={bucket.id} value={bucket.id}>
            {bucket.label} cap
          </option>
        ))}
      </select>

      <select
        className="filter-compact filter-sector"
        value={sector}
        onChange={(event) => setSector(event.target.value)}
        aria-label="Sector"
        disabled={hideSectorFilter}
        title={hideSectorFilter ? 'Sector filter is built into this screener' : undefined}
      >
        {SECTORS.map((item) => (
          <option key={item || 'all'} value={item}>
            {item || 'All sectors'}
          </option>
        ))}
      </select>

      <select
        className="filter-compact"
        value={limit}
        onChange={(event) => setLimit(Number(event.target.value))}
        aria-label="Limit"
      >
        {[100, 200, 500, 1000].map((value) => (
          <option key={value} value={value}>
            {value} rows
          </option>
        ))}
      </select>
    </div>
  );
}
