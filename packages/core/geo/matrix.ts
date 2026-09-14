// Singapore planning area travel-time matrix (precomputed estimated minutes by public transit/car)

const SG_TRAVEL_TIME_MATRIX: Record<string, Record<string, number>> = {
  'Tiong Bahru': {
    'Tiong Bahru': 5,
    'Tanjong Pagar': 10,
    'Orchard': 15,
    'Bugis': 15,
    'Queenstown': 12,
    'Novena': 20,
    'Bishan': 25,
    'Katong': 25,
    'Serangoon': 30,
    'Jurong East': 30,
    'Bedok': 35,
    'Tampines': 40,
    'Woodlands': 45,
    'Ang Mo Kio': 30,
  },
  'Tanjong Pagar': {
    'Tiong Bahru': 10,
    'Tanjong Pagar': 5,
    'Orchard': 12,
    'Bugis': 10,
    'Queenstown': 15,
    'Novena': 18,
    'Bishan': 22,
    'Katong': 22,
    'Serangoon': 25,
    'Jurong East': 32,
    'Bedok': 30,
    'Tampines': 38,
    'Woodlands': 45,
    'Ang Mo Kio': 28,
  },
  'Orchard': {
    'Tiong Bahru': 15,
    'Tanjong Pagar': 12,
    'Orchard': 5,
    'Bugis': 12,
    'Queenstown': 15,
    'Novena': 10,
    'Bishan': 18,
    'Katong': 25,
    'Serangoon': 22,
    'Jurong East': 30,
    'Bedok': 32,
    'Tampines': 40,
    'Woodlands': 40,
    'Ang Mo Kio': 22,
  },
  'Bishan': {
    'Tiong Bahru': 25,
    'Tanjong Pagar': 22,
    'Orchard': 18,
    'Bugis': 20,
    'Queenstown': 25,
    'Novena': 12,
    'Bishan': 5,
    'Katong': 30,
    'Serangoon': 12,
    'Jurong East': 28,
    'Bedok': 35,
    'Tampines': 35,
    'Woodlands': 30,
    'Ang Mo Kio': 10,
  },
  'Katong': {
    'Tiong Bahru': 25,
    'Tanjong Pagar': 22,
    'Orchard': 25,
    'Bugis': 20,
    'Queenstown': 30,
    'Novena': 28,
    'Bishan': 30,
    'Katong': 5,
    'Serangoon': 28,
    'Jurong East': 45,
    'Bedok': 12,
    'Tampines': 20,
    'Woodlands': 55,
    'Ang Mo Kio': 32,
  },
  'Jurong East': {
    'Tiong Bahru': 30,
    'Tanjong Pagar': 32,
    'Orchard': 30,
    'Bugis': 35,
    'Queenstown': 20,
    'Novena': 32,
    'Bishan': 28,
    'Katong': 45,
    'Serangoon': 35,
    'Jurong East': 5,
    'Bedok': 50,
    'Tampines': 55,
    'Woodlands': 35,
    'Ang Mo Kio': 30,
  },
};

export function getTravelTimeMinutes(areaA: string, areaB: string): number | null {
  const a = areaA.trim();
  const b = areaB.trim();
  if (!a || !b) return null;
  if (a === b) return 5;
  const direct = SG_TRAVEL_TIME_MATRIX[a]?.[b];
  if (typeof direct === 'number') return direct;
  const reverse = SG_TRAVEL_TIME_MATRIX[b]?.[a];
  if (typeof reverse === 'number') return reverse;
  return null;
}
