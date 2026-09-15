// Chinese destination labels for this itinerary and common connecting airports.
const airportPlaces: Record<string, string> = {
  KHH: '高雄', TPE: '桃園', TSA: '台北（松山）',
  NRT: '東京（成田）', HND: '東京（羽田）', KIX: '大阪（關西）',
  PUS: '釜山', ICN: '首爾（仁川）', HKG: '香港',
  LAX: '洛杉磯', MCO: '奧蘭多', SFO: '舊金山', SEA: '西雅圖',
  JFK: '紐約（甘迺迪）', EWR: '紐瓦克', ORD: '芝加哥',
  DFW: '達拉斯／沃斯堡', IAH: '休士頓', ATL: '亞特蘭大', MIA: '邁阿密',
}

export function getAirportPlace(value: string): string {
  const text = value.trim()
  const code = text.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]
  return (code && airportPlaces[code]) || text || '未設定機場'
}
