const airportTimeZones: Record<string, string> = {
  KHH: 'Asia/Taipei', TPE: 'Asia/Taipei', TSA: 'Asia/Taipei',
  NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo', KIX: 'Asia/Tokyo',
  PUS: 'Asia/Seoul', ICN: 'Asia/Seoul', HKG: 'Asia/Hong_Kong',
  LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', SEA: 'America/Los_Angeles', SAN: 'America/Los_Angeles', LAS: 'America/Los_Angeles',
  MCO: 'America/New_York', JFK: 'America/New_York', EWR: 'America/New_York', ATL: 'America/New_York', MIA: 'America/New_York', BOS: 'America/New_York',
  ORD: 'America/Chicago', DFW: 'America/Chicago', IAH: 'America/Chicago', ANC: 'America/Anchorage', HNL: 'Pacific/Honolulu',
}

type FlightTimes = { date: string; arrivalDate?: string; departureAirport: string; arrivalAirport: string; departureTime: string; arrivalTime: string }
const zoneFor = (airport: string) => airportTimeZones[airport.trim().toUpperCase().match(/\b[A-Z]{3}\b/)?.[0] || '']
const parseDate = (text: string, year: number): number | null => {
  const match = text.match(/^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})(?:-\d{1,2})?$/)
  if (!match) return null
  const y = Number(match[1] || year), m = Number(match[2]), d = Number(match[3])
  const timestamp = Date.UTC(y, m - 1, d)
  const date = new Date(timestamp)
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? timestamp : null
}
const parseTime = (text: string) => {
  const match = text.trim().match(/^(?:(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\s+)?(\d{1,2}):(\d{2})(?:\s*\+(\d))?$/)
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return null
  return { date: match[1], minutes: Number(match[2]) * 60 + Number(match[3]), days: match[4] ? Number(match[4]) : undefined }
}
// Resolve the offset for the actual travel date, including daylight saving time.
// Ambiguous or nonexistent local times require clarification rather than a guessed duration.
const localToUtc = (wallTime: number, timeZone: string): number | null => {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const localParts = (time: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map(part => [part.type, part.value]))
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  }
  const offsets = new Set([-36, 0, 36].map(hours => { const sample = wallTime + hours * 3600000; return localParts(sample) - sample }))
  const candidates = [...offsets].map(offset => wallTime - offset).filter(time => localParts(time) === wallTime)
  return candidates.length === 1 ? candidates[0] : null
}
export function getFlightDurationMinutes(flight: FlightTimes, year = new Date().getFullYear()): number | null {
  const departureZone = zoneFor(flight.departureAirport), arrivalZone = zoneFor(flight.arrivalAirport)
  const departureTime = parseTime(flight.departureTime), arrivalTime = parseTime(flight.arrivalTime)
  const baseDate = parseDate(flight.date, year)
  if (!departureZone || !arrivalZone || !departureTime || !arrivalTime || baseDate === null) return null
  const travelYear = new Date(baseDate).getUTCFullYear()
  const departureDate = departureTime.date ? parseDate(departureTime.date, travelYear) : baseDate
  if (departureDate === null) return null
  const departure = localToUtc(departureDate + departureTime.minutes * 60000, departureZone)
  if (departure === null) return null
  const explicitDate = flight.arrivalDate || arrivalTime.date
  const rangeEnd = flight.date.match(/^\d{1,2}\/(\d{1,2})-(\d{1,2})$/)
  const arrivalDate = explicitDate ? parseDate(explicitDate, travelYear) : arrivalTime.days !== undefined ? departureDate + arrivalTime.days * 86400000 : rangeEnd ? Date.UTC(travelYear, new Date(baseDate).getUTCMonth(), Number(rangeEnd[2])) : null
  if ((explicitDate || arrivalTime.days !== undefined || rangeEnd) && arrivalDate === null) return null
  const dates = arrivalDate !== null ? [arrivalDate] : [-1, 0, 1, 2].map(days => departureDate + days * 86400000)
  const durations = dates.map(date => localToUtc(date + arrivalTime.minutes * 60000, arrivalZone)).filter((time): time is number => time !== null).map(time => (time - departure) / 60000).filter(minutes => minutes > 0 && minutes <= 48 * 60)
  return durations.length ? Math.min(...durations) : null
}
export function formatFlightDuration(flight: FlightTimes): string {
  const minutes = getFlightDurationMinutes(flight)
  if (minutes === null) return '飛行時間：請確認日期、時間與機場'
  const hours = Math.floor(minutes / 60), remainder = minutes % 60
  return `飛行時間：${hours ? `${hours} 小時` : ''}${remainder ? `${hours ? ' ' : ''}${remainder} 分鐘` : ''}`
}
