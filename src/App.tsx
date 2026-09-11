import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCalendarDays,
  faCar,
  faCamera,
  faCartShopping,
  faFileLines,
  faHeart,
  faHotel,
  faListCheck,
  faMapLocationDot,
  faPen,
  faPlane,
  faPlus,
  faSuitcaseRolling,
  faTicket,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { doc, getDoc, setDoc } from 'firebase/firestore'

import { db, ensureAnonymousAuth, storage } from './firebase'

type TabId = 'schedule' | 'bookings' | 'expense' | 'park' | 'planning' | 'members'
type Category = '景點' | '美食' | '交通' | '住宿'
type ParkGroup = '迪士尼' | '環球影城'
type BookingMode = 'flight' | 'hotel' | 'car' | 'voucher'
type FlightInfo = {
  airline: string
  flightNumber: string
  departureAirport: string
  departureTime: string
  arrivalAirport: string
  arrivalTime: string
  date: string
  baggage: string
  aircraft: string
  price: string
  confirmationCode: string
}

type DayPlan = {
  date: string
  dayLabel: string
  weather: string
  temperature: string
  items: {
    time: string
    title: string
    place: string
    category: Category
    note: string
    mapUrl?: string
  }[]
}

type ScheduleItem = DayPlan['items'][number]
type DataEditorKind = 'booking' | 'flight' | 'tripSettings' | 'expense' | 'task' | 'member' | 'route' | 'parkDay'
type DataEditor = {
  kind: DataEditorKind
  index: number | null
  parkId?: 'disney' | 'universal'
  dayId?: string
}

type ParkDayRoute = {
  time: string
  title: string
  area: string
  type: '景點' | '美食' | '交通' | '休息'
  note: string
}

type ParkDay = {
  id: string
  name: string
  date: string
  routes: ParkDayRoute[]
}

type ParkSection = {
  id: 'disney' | 'universal'
  name: ParkGroup
  description: string
  days: ParkDay[]
}

type TripData = {
  flightInfo: FlightInfo[]
  tripSettings: { title: string; subtitle: string; countdown: string }
  dayPlans: DayPlan[]
  bookingCards: {
    title: string
    label: string
    body: string
    meta: string
    accent: string
    startDate?: string
    endDate?: string
    attachment?: { url: string; name: string; type: string }
  }[]
  expenseEntries: {
    date: string
    item: string
    amount: string
    payer: string
  }[]
  planningTasks: {
    title: string
    assignee: string
    done: boolean
  }[]
  members: {
    name: string
    role: string
    color: string
  }[]
  parkSections: ParkSection[]
}

const tabs: { id: TabId; label: string; icon: typeof faCalendarDays }[] = [
  { id: 'schedule', label: '行程', icon: faCalendarDays },
  { id: 'bookings', label: '預訂', icon: faTicket },
  { id: 'park', label: '樂園', icon: faPlane },
  { id: 'planning', label: '準備', icon: faListCheck },
  { id: 'members', label: '成員', icon: faUsers },
]

const bookingModes: { id: BookingMode; label: string; icon: typeof faPlane }[] = [
  { id: 'flight', label: '機票', icon: faPlane },
  { id: 'hotel', label: '住宿', icon: faHotel },
  { id: 'car', label: '租車', icon: faCar },
  { id: 'voucher', label: '憑證', icon: faFileLines },
]

const preparationModes = [
  { label: '待辦', icon: faListCheck },
  { label: '行李', icon: faSuitcaseRolling },
  { label: '想去', icon: faHeart },
  { label: '採購', icon: faCartShopping },
]

const weatherLocations = [
  { name: 'Anchorage', keywords: ['anchorage', '安克拉治'], latitude: 61.2181, longitude: -149.9003 },
  { name: 'Tokyo', keywords: ['tokyo', '東京', 'narita', '成田'], latitude: 35.6762, longitude: 139.6503 },
  { name: 'Los Angeles', keywords: ['los angeles', '洛杉磯', 'lax', 'hollywood', 'santa monica', 'venice'], latitude: 34.0522, longitude: -118.2437 },
  { name: 'Joshua Tree', keywords: ['joshua tree', 'keys view'], latitude: 34.1347, longitude: -116.3131 },
  { name: 'Las Vegas', keywords: ['las vegas', '拉斯維加斯', 'bellagio', 'caesars palace'], latitude: 36.1699, longitude: -115.1398 },
  { name: 'Orlando', keywords: ['orlando', '奧蘭多', 'mco', 'disney', 'universal', 'magic kingdom', 'epcot'], latitude: 28.5383, longitude: -81.3792 },
]

const weatherDescription = (code: number | undefined) => {
  if (code === undefined) return '尚未開放'
  if (code === 0) return '晴朗'
  if ([1, 2, 3].includes(code)) return '多雲'
  if ([45, 48].includes(code)) return '霧'
  if ([51, 53, 55, 56, 57].includes(code)) return '細雨'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '雨'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '降雪'
  if ([95, 96, 99].includes(code)) return '雷雨'
  return '多雲'
}

const toDateInputValue = (dateText: string) => {
  const match = dateText.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})|^(\d{1,2})\/(\d{1,2})$/)
  if (!match) return ''
  const year = match[1] ? Number(match[1]) : new Date().getFullYear()
  const month = Number(match[2] ?? match[4])
  const day = Number(match[3] ?? match[5])
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const formatDateLabel = (dateText: string) => {
  if (!dateText) return '未設定日期'
  const date = new Date(`${dateText}T00:00:00`)
  return Number.isNaN(date.getTime()) ? dateText : new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(date)
}

const isPastFlight = (flight: FlightInfo) => {
  const dateValue = toDateInputValue(flight.date)
  if (!dateValue) return false
  return new Date(`${dateValue}T23:59:59`).getTime() < Date.now()
}

type WeatherSummary = { location: string; description: string; temperature: string }

const compressImageToWebp = async (file: File) => {
  const imageUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = imageUrl
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('無法讀取圖片。'))
    })

    const maxDimension = 1800
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('圖片壓縮失敗。'))
      }, 'image/webp', 0.82)
    })
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

const uploadCertificate = async (file: File) => {
  if (!storage) throw new Error('Firebase Storage 尚未設定。')
  const isImage = file.type.startsWith('image/')
  const content = isImage ? await compressImageToWebp(file) : file
  const extension = isImage ? 'webp' : 'pdf'
  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileRef = storageRef(storage, `trip/orlando-escape/certificates/${Date.now()}-${baseName}.${extension}`)
  const snapshot = await uploadBytes(fileRef, content, { contentType: isImage ? 'image/webp' : 'application/pdf' })
  return {
    url: await getDownloadURL(snapshot.ref),
    name: file.name,
    type: isImage ? 'image/webp' : 'application/pdf',
  }
}

const getFirebaseErrorMessage = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied')) {
    return 'Firebase 拒絕寫入：請確認已啟用 Anonymous Authentication，且 Firestore Rules 允許 request.auth。'
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

const getFlightDate = (dateText: string) => {
  const match = dateText.match(/(\d{1,2})\/(\d{1,2})/)
  if (!match) return null

  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setMonth(Number(match[1]) - 1, Number(match[2]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (date < today) date.setFullYear(date.getFullYear() + 1)
  return date
}

const getFlightCountdown = (flights: FlightInfo[]) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upcoming = flights
    .map((flight) => getFlightDate(flight.date))
    .filter((date): date is Date => date !== null && date >= today)
    .sort((first, second) => first.getTime() - second.getTime())[0]

  if (!upcoming) return '--'
  return String(Math.ceil((upcoming.getTime() - today.getTime()) / 86400000)).padStart(2, '0')
}

const localTripData: TripData = {
  flightInfo: [
    {
      airline: 'United Airlines', flightNumber: 'UA838', departureAirport: 'KHH', departureTime: '11:30',
      arrivalAirport: 'NRT', arrivalTime: '15:55', date: '11/4', baggage: '--', aircraft: '--', price: '--', confirmationCode: 'DT4YHZ',
    },
    {
      airline: 'United Airlines', flightNumber: 'UA33', departureAirport: 'NRT', departureTime: '17:30',
      arrivalAirport: 'LAX', arrivalTime: '10:35', date: '11/4', baggage: '--', aircraft: '--', price: '--', confirmationCode: 'DT4YHZ',
    },
    {
      airline: 'United Airlines', flightNumber: 'UA32', departureAirport: 'LAX', departureTime: '11/15 11:05',
      arrivalAirport: 'NRT', arrivalTime: '11/16 15:55', date: '11/15-16', baggage: '--', aircraft: '--', price: '--', confirmationCode: 'DT4YHZ',
    },
    {
      airline: 'United Airlines', flightNumber: 'UA837', departureAirport: 'NRT', departureTime: '17:50',
      arrivalAirport: 'KHH', arrivalTime: '21:25', date: '11/16', baggage: '--', aircraft: '--', price: '--', confirmationCode: 'DT4YHZ',
    },
  ],
  tripSettings: {
    title: 'Disney + Universal',
    subtitle: '13 days · 2 parks · 6 cities',
    countdown: '07',
  },
  dayPlans: [
    {
      date: '11/4',
      dayLabel: 'Day 1',
      weather: '轉機',
      temperature: '--',
      items: [
        { time: '10:15', title: 'Anchorage → Tokyo → Los Angeles', place: 'Anchorage / Tokyo / LAX', category: '交通', note: '跨時區長途飛行，抵達後前往飯店休息' },
        { time: '晚間', title: '前往比佛利山', place: 'LAX → The Beverly Hills Hotel', category: '交通', note: '入住 The Beverly Hills Hotel' },
      ],
    },
    {
      date: '11/5',
      dayLabel: 'Day 2',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '09:00', title: 'Hollywood Walk of Fame', place: 'Hollywood', category: '景點', note: '星光大道與好萊塢標誌' },
        { time: '上午', title: 'Griffith Observatory', place: 'Griffith Observatory', category: '景點', note: '觀景台與洛杉磯城市景觀' },
        { time: '下午', title: 'Santa Monica Pier / Venice', place: 'Santa Monica / Venice Beach', category: '景點', note: '海邊散步，可延伸至 Beverly Hills、Melrose' },
        { time: '晚間', title: '返回飯店', place: 'The Beverly Laurel Hotel', category: '住宿', note: '入住 The Beverly Laurel Hotel' },
      ],
    },
    {
      date: '11/6',
      dayLabel: 'Day 3',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '上午', title: '前往 Joshua Tree', place: 'Los Angeles → Joshua Tree', category: '交通', note: '離開洛杉磯前往 Joshua Tree National Park' },
        { time: '下午', title: 'Joshua Tree National Park', place: 'Joshua Tree', category: '景點', note: '安排園區景觀與沙漠公路行程' },
        { time: '傍晚', title: 'Keys View', place: 'Joshua Tree', category: '景點', note: '日落與高地景觀' },
        { time: '晚間', title: '入住飯店', place: 'Oasis Hotel', category: '住宿', note: 'Joshua Tree 住宿' },
      ],
    },
    {
      date: '11/7',
      dayLabel: 'Day 4',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '上午', title: 'Joshua Tree → Las Vegas', place: 'Joshua Tree → Las Vegas', category: '交通', note: '前往拉斯維加斯' },
        { time: '下午', title: 'Las Vegas Strip', place: 'Bellagio / Caesars Palace', category: '景點', note: 'Bellagio、Caesars Palace 與 Strip 景點' },
        { time: '晚間', title: '入住 Las Vegas', place: 'Hilton', category: '住宿', note: '入住 Hilton' },
      ],
    },
    {
      date: '11/8',
      dayLabel: 'Day 5',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '上午', title: 'Welcome to Fabulous Las Vegas Sign', place: 'Las Vegas', category: '景點', note: '拍照與城市地標巡禮' },
        { time: '下午', title: 'Bellagio / Caesars Palace / Strip', place: 'Las Vegas Strip', category: '景點', note: '安排飯店與 Strip 景點散步' },
        { time: '22:55', title: '飛往 Orlando', place: 'Las Vegas → MCO', category: '交通', note: 'Southwest 航班，約 11/9 01:10 抵達 Orlando' },
      ],
    },
    {
      date: '11/9',
      dayLabel: 'Day 6',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '01:10', title: '抵達 Orlando', place: 'MCO', category: '交通', note: '凌晨抵達，前往 Universal 區域' },
        { time: '白天', title: '休息與 Disney Springs', place: 'Orlando', category: '景點', note: '安排輕鬆行程與補充物資' },
        { time: '晚間', title: '入住飯店', place: 'Universal Stella Nova Resort', category: '住宿', note: '入住 Universal Stella Nova Resort' },
      ],
    },
    {
      date: '11/10',
      dayLabel: 'Day 7',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '全天', title: 'Epic Universe', place: 'Universal Epic Universe', category: '景點', note: '使用 Early Park Admission，優先安排熱門設施' },
        { time: '晚間', title: '返回飯店', place: 'Universal Stella Nova Resort', category: '住宿', note: '整理隔日 Universal 行程' },
      ],
    },
    {
      date: '11/11',
      dayLabel: 'Day 8',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '全天', title: 'Islands of Adventure + Universal Studios', place: 'Universal Orlando Resort', category: '景點', note: '使用 Park-to-Park 票券，安排兩園區移動' },
        { time: '晚間', title: '入住 Disney 飯店', place: "Disney's All-Star Music Resort", category: '住宿', note: "轉往 Disney's All-Star Music Resort" },
      ],
    },
    {
      date: '11/12',
      dayLabel: 'Day 9',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '全天', title: 'Magic Kingdom', place: 'Magic Kingdom', category: '景點', note: '使用 Disney 交通，安排園區經典設施' },
        { time: '16:00', title: "Mickey's Very Merry Christmas Party", place: 'Magic Kingdom', category: '景點', note: '聖誕派對入場時間，依票券安排晚間活動' },
      ],
    },
    {
      date: '11/13',
      dayLabel: 'Day 10',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '上午', title: 'EPCOT', place: 'EPCOT', category: '景點', note: '使用 Disney 交通前往 EPCOT' },
        { time: '下午', title: 'Hollywood Studios', place: 'Disney\'s Hollywood Studios', category: '景點', note: '安排園區熱門設施與表演' },
        { time: '晚間', title: '返回飯店', place: "Disney's All-Star Music Resort", category: '住宿', note: '返回 Disney 飯店休息' },
      ],
    },
    {
      date: '11/14',
      dayLabel: 'Day 11',
      weather: '晴',
      temperature: '--',
      items: [
        { time: '上午', title: 'Disney\'s Animal Kingdom', place: "Disney's Animal Kingdom", category: '景點', note: '最後一個 Disney 園區行程' },
        { time: '晚間', title: 'Orlando → Los Angeles', place: 'MCO → LAX', category: '交通', note: '搭乘晚間航班前往洛杉磯' },
        { time: '晚間', title: '入住機場飯店', place: 'Sonesta Los Angeles Airport LAX', category: '住宿', note: '抵達後入住 LAX 附近飯店' },
      ],
    },
    {
      date: '11/15',
      dayLabel: 'Day 12',
      weather: '轉機',
      temperature: '--',
      items: [
        { time: '11:05', title: 'Los Angeles → Tokyo', place: 'LAX → NRT', category: '交通', note: '搭乘國際航班返回東京' },
        { time: '全天', title: '長途飛行', place: '機上', category: '交通', note: '跨時區飛行，於機上休息' },
      ],
    },
    {
      date: '11/16',
      dayLabel: 'Day 13',
      weather: '轉機',
      temperature: '--',
      items: [
        { time: '上午', title: '抵達 Tokyo', place: 'Narita Airport', category: '交通', note: '東京轉機' },
        { time: '19:50', title: 'Tokyo → Anchorage', place: 'NRT → ANC', category: '交通', note: '搭乘最後一段航班返回 Anchorage' },
      ],
    },
  ],
  bookingCards: [
    { title: '機票', label: 'Flight', body: 'Orlando Airport', meta: '出發 08:40 · 2h 30m', accent: 'bg-emerald-100 text-emerald-700' },
    { title: '住宿', label: 'Hotel', body: 'Disney Resort Hotel', meta: 'Check-in 15:00 · Check-out 11:00', accent: 'bg-amber-100 text-amber-700' },
    { title: '租車', label: 'Car', body: 'SUV Rental', meta: '取車 08:00 · 還車 19:00', accent: 'bg-sky-100 text-sky-700' },
  ],
  expenseEntries: [
    { date: '7/13', item: '迪士尼門票', amount: 'NT$ 3,200', payer: 'Ava' },
    { date: '7/13', item: '晚餐', amount: 'USD 48', payer: 'Milo' },
    { date: '7/14', item: '租車', amount: 'USD 96', payer: 'Nia' },
  ],
  planningTasks: [
    { title: '確認行李清單', assignee: '全體', done: true },
    { title: '購買防曬用品', assignee: 'Ava', done: false },
    { title: '確認景點時間表', assignee: 'Milo', done: false },
  ],
  members: [
    { name: 'Ava', role: '總規劃', color: 'bg-rose-200 text-rose-700' },
    { name: 'Milo', role: '預算', color: 'bg-amber-200 text-amber-700' },
    { name: 'Nia', role: '攝影', color: 'bg-emerald-200 text-emerald-700' },
  ],
  parkSections: [
    {
      id: 'disney',
      name: '迪士尼',
      description: '迪士尼園區路線與重點設施',
      days: [
        {
          id: 'disney-day-1',
          name: '11/12 · Magic Kingdom',
          date: '11/12',
          routes: [
            { time: '全天', title: 'Magic Kingdom', area: 'Magic Kingdom', type: '景點', note: '使用 Disney 交通，安排園區經典設施' },
            { time: '16:00', title: "Mickey's Very Merry Christmas Party", area: 'Magic Kingdom', type: '景點', note: '聖誕派對入場，依票券安排晚間活動' },
          ],
        },
        {
          id: 'disney-day-2',
          name: '11/13 · EPCOT + Hollywood Studios',
          date: '11/13',
          routes: [
            { time: '上午', title: 'EPCOT', area: 'EPCOT', type: '景點', note: '使用 Disney 交通前往 EPCOT' },
            { time: '下午', title: 'Hollywood Studios', area: "Disney's Hollywood Studios", type: '景點', note: '安排園區熱門設施與表演' },
            { time: '晚間', title: '返回飯店', area: "Disney's All-Star Music Resort", type: '休息', note: '返回 Disney 飯店休息' },
          ],
        },
        {
          id: 'disney-day-3',
          name: '11/14 · Animal Kingdom',
          date: '11/14',
          routes: [
            { time: '上午', title: "Disney's Animal Kingdom", area: "Disney's Animal Kingdom", type: '景點', note: '最後一個 Disney 園區行程' },
            { time: '晚間', title: '前往機場', area: 'Orlando → LAX', type: '交通', note: '搭乘晚間航班前往洛杉磯' },
          ],
        },
      ],
    },
    {
      id: 'universal',
      name: '環球影城',
      description: '環球影城日程與重點區域',
      days: [
        {
          id: 'universal-day-1',
          name: '11/10 · Epic Universe',
          date: '11/10',
          routes: [
            { time: '全天', title: 'Epic Universe', area: 'Universal Epic Universe', type: '景點', note: '使用 Early Park Admission，優先安排熱門設施' },
            { time: '晚間', title: '返回飯店', area: 'Universal Stella Nova Resort', type: '休息', note: '整理隔日 Universal 行程' },
          ],
        },
        {
          id: 'universal-day-2',
          name: '11/11 · Islands + Universal Studios',
          date: '11/11',
          routes: [
            { time: '全天', title: 'Islands of Adventure', area: 'Universal Orlando Resort', type: '景點', note: '使用 Park-to-Park 票券' },
            { time: '下午', title: 'Universal Studios', area: 'Universal Orlando Resort', type: '景點', note: '兩園區移動，安排熱門設施與表演' },
            { time: '晚間', title: '轉往 Disney 飯店', area: "Disney's All-Star Music Resort", type: '交通', note: "入住 Disney's All-Star Music Resort" },
          ],
        },
      ],
    },
  ],
}

const normalizeTripData = (value: Partial<TripData> | null | undefined): TripData => ({
  flightInfo: Array.isArray(value?.flightInfo)
    ? value.flightInfo.map((flight) => ({
        ...flight,
        confirmationCode: flight.confirmationCode || (flight as FlightInfo & { purchased?: string }).purchased || '',
      }))
    : localTripData.flightInfo,
  tripSettings: value?.tripSettings ?? localTripData.tripSettings,
  dayPlans: Array.isArray(value?.dayPlans) ? (value.dayPlans as DayPlan[]) : localTripData.dayPlans,
  bookingCards: Array.isArray(value?.bookingCards)
    ? (value.bookingCards as TripData['bookingCards']).map((card) => ({
        ...card,
        startDate: card.startDate || '',
        endDate: card.endDate || '',
      }))
    : localTripData.bookingCards,
  expenseEntries: Array.isArray(value?.expenseEntries) ? (value.expenseEntries as TripData['expenseEntries']) : localTripData.expenseEntries,
  planningTasks: Array.isArray(value?.planningTasks) ? (value.planningTasks as TripData['planningTasks']) : localTripData.planningTasks,
  members: Array.isArray(value?.members) ? (value.members as TripData['members']) : localTripData.members,
  parkSections: Array.isArray(value?.parkSections) ? (value.parkSections as ParkSection[]) : localTripData.parkSections,
})

const removeUndefined = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefined(item)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, removeUndefined(entry)]),
    ) as T
  }

  return value
}

const getTripDataFromFirebase = async (): Promise<TripData> => {
  if (!db) {
    return localTripData
  }

  await ensureAnonymousAuth()

  const docRef = doc(db, 'trip', 'orlando-escape')
  const snapshot = await Promise.race([
    getDoc(docRef),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Firestore request timed out.')), 4000)
    }),
  ])

  if (!snapshot.exists()) {
    await setDoc(docRef, removeUndefined(localTripData))
    return localTripData
  }

  return normalizeTripData(snapshot.data() as Partial<TripData>)
}

const saveTripDataToFirebase = async (tripData: TripData) => {
  if (!db) {
    throw new Error('Firebase is not configured.')
  }

  await ensureAnonymousAuth()
  await setDoc(doc(db, 'trip', 'orlando-escape'), removeUndefined(tripData))
}

const emptyScheduleItem: ScheduleItem = {
  time: '',
  title: '',
  place: '',
  category: '景點',
  note: '',
}

function App() {
  const [tripData, setTripData] = useState<TripData>(localTripData)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('schedule')
  const [selectedDate, setSelectedDate] = useState('11/4')
  const [selectedParkId, setSelectedParkId] = useState<'disney' | 'universal'>('disney')
  const [selectedParkDayId, setSelectedParkDayId] = useState('disney-day-1')
  const [bookingMode, setBookingMode] = useState<BookingMode>('flight')
  const [expandedFlightIndex, setExpandedFlightIndex] = useState<number | null>(0)
  const [preparationMode, setPreparationMode] = useState('待辦')
  const [preparationAssignee, setPreparationAssignee] = useState('全體')
  const [weatherState, setWeatherState] = useState<WeatherSummary>({ location: '讀取中', description: '讀取中', temperature: '--' })
  const [previewAttachment, setPreviewAttachment] = useState<{ url: string; name: string; type: string } | null>(null)
  const [editingItem, setEditingItem] = useState<{ date: string; index: number | null } | null>(null)
  const [draftItem, setDraftItem] = useState<ScheduleItem>(emptyScheduleItem)
  const [dataEditor, setDataEditor] = useState<DataEditor | null>(null)
  const [dataDraft, setDataDraft] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [draggingScheduleIndex, setDraggingScheduleIndex] = useState<number | null>(null)
  const [draggingRouteIndex, setDraggingRouteIndex] = useState<number | null>(null)

  useEffect(() => {
    let isCancelled = false

    const loadTripData = async () => {
      try {
        const data = await getTripDataFromFirebase()
        if (!isCancelled) {
          setTripData(data)
          setErrorMessage(null)
        }
      } catch (error) {
        console.error('Failed to load Firestore trip data:', error)
        if (!isCancelled) {
          setErrorMessage(getFirebaseErrorMessage(error, 'Firebase 資料讀取失敗'))
          setTripData(localTripData)
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadTripData()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!tripData.dayPlans.some((day) => day.date === selectedDate)) {
      setSelectedDate(tripData.dayPlans[0]?.date ?? '7/13')
    }
  }, [selectedDate, tripData.dayPlans])

  useEffect(() => {
    if (!tripData.parkSections.some((park) => park.id === selectedParkId)) {
      setSelectedParkId(tripData.parkSections[0]?.id ?? 'disney')
    }
  }, [selectedParkId, tripData.parkSections])

  useEffect(() => {
    const days = tripData.parkSections.find((park) => park.id === selectedParkId)?.days ?? []
    if (!days.some((day) => day.id === selectedParkDayId)) {
      setSelectedParkDayId(days[0]?.id ?? '')
    }
  }, [selectedParkDayId, selectedParkId, tripData.parkSections])

  useEffect(() => {
    const controller = new AbortController()
    const fallbackLocation = weatherLocations.find((candidate) => candidate.name === 'Orlando')!

    const loadWeather = async (latitude: number, longitude: number, locationName: string) => {
      setWeatherState({ location: locationName, description: '讀取中', temperature: '--' })
      try {
        const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: 'temperature_2m,weather_code', timezone: 'auto' })
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Weather request failed')
        const data = await response.json() as { current?: { temperature_2m?: number; weather_code?: number } }
        setWeatherState({
          location: locationName,
          description: weatherDescription(data.current?.weather_code),
          temperature: data.current?.temperature_2m !== undefined ? `${Math.round(data.current.temperature_2m)}°C` : '--',
        })
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setWeatherState({ location: locationName, description: '無法取得', temperature: '--' })
      }
    }

    if (!navigator.geolocation) {
      void loadWeather(fallbackLocation.latitude, fallbackLocation.longitude, 'Orlando')
    } else {
      navigator.geolocation.getCurrentPosition(
        (position) => void loadWeather(position.coords.latitude, position.coords.longitude, '目前位置'),
        () => void loadWeather(fallbackLocation.latitude, fallbackLocation.longitude, 'Orlando'),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
      )
    }

    return () => controller.abort()
  }, [])

  const selectedPlan = useMemo(
    () => tripData.dayPlans.find((day) => day.date === selectedDate) ?? tripData.dayPlans[0] ?? localTripData.dayPlans[0],
    [selectedDate, tripData.dayPlans],
  )

  const selectedPark = useMemo(
    () => tripData.parkSections.find((park) => park.id === selectedParkId) ?? tripData.parkSections[0] ?? localTripData.parkSections[0],
    [selectedParkId, tripData.parkSections],
  )
  const selectedParkDay = selectedPark.days.find((day) => day.id === selectedParkDayId) ?? selectedPark.days[0]

  const bookingCards = tripData.bookingCards
  const flightInfo = tripData.flightInfo[expandedFlightIndex ?? 0] ?? localTripData.flightInfo[0]
  const tripSettings = tripData.tripSettings
  const countdown = getFlightCountdown(tripData.flightInfo)
  const expenseEntries = tripData.expenseEntries
  const planningTasks = tripData.planningTasks
  const members = tripData.members
  const parkSections = tripData.parkSections

  const openNewScheduleItem = () => {
    setDraftItem({ ...emptyScheduleItem })
    setEditingItem({ date: selectedPlan.date, index: null })
    setErrorMessage(null)
  }

  const openEditScheduleItem = (item: ScheduleItem, index: number) => {
    setDraftItem({ ...item })
    setEditingItem({ date: selectedPlan.date, index })
    setErrorMessage(null)
  }

  const closeScheduleEditor = () => {
    if (!isSaving) {
      setEditingItem(null)
    }
  }

  const saveScheduleItem = async () => {
    if (!editingItem || !draftItem.title.trim() || !draftItem.time.trim()) {
      setErrorMessage('請至少填寫時間與行程名稱。')
      return
    }

    const nextDayPlans = tripData.dayPlans.map((day) => {
      if (day.date !== editingItem.date) {
        return day
      }

      const nextItems = [...day.items]
      if (editingItem.index === null) {
        nextItems.push(removeUndefined({ ...draftItem, title: draftItem.title.trim(), time: draftItem.time.trim(), mapUrl: draftItem.mapUrl?.trim() }))
      } else {
        nextItems[editingItem.index] = removeUndefined({ ...draftItem, title: draftItem.title.trim(), time: draftItem.time.trim(), mapUrl: draftItem.mapUrl?.trim() })
      }

      return { ...day, items: nextItems }
    })

    const nextTripData = { ...tripData, dayPlans: nextDayPlans }
    setIsSaving(true)

    try {
      await saveTripDataToFirebase(nextTripData)
      setTripData(nextTripData)
      setEditingItem(null)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to save itinerary item:', error)
      setErrorMessage(getFirebaseErrorMessage(error, '行程儲存失敗'))
    } finally {
      setIsSaving(false)
    }
  }

  const deleteScheduleItem = async () => {
    if (!editingItem || editingItem.index === null) {
      return
    }

    const nextDayPlans = tripData.dayPlans.map((day) => {
      if (day.date !== editingItem.date) {
        return day
      }

      return {
        ...day,
        items: day.items.filter((_, index) => index !== editingItem.index),
      }
    })

    const nextTripData = { ...tripData, dayPlans: nextDayPlans }
    setIsSaving(true)

    try {
      await saveTripDataToFirebase(nextTripData)
      setTripData(nextTripData)
      setEditingItem(null)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to delete itinerary item:', error)
      setErrorMessage(getFirebaseErrorMessage(error, '行程刪除失敗'))
    } finally {
      setIsSaving(false)
    }
  }

  const openDataEditor = (editor: DataEditor, draft: Record<string, string>) => {
    setDataEditor(editor)
    setDataDraft(draft)
    setErrorMessage(null)
  }

  const handleCertificateChange = async (file: File | undefined) => {
    if (!file) return
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMessage('憑證只支援 PDF、JPG、PNG 或 WebP。')
      return
    }

    setIsSaving(true)
    try {
      const attachment = await uploadCertificate(file)
      setDataDraft((current) => ({
        ...current,
        attachmentUrl: attachment.url,
        attachmentName: attachment.name,
        attachmentType: attachment.type,
      }))
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to upload certificate:', error)
      setErrorMessage('憑證上傳失敗，請確認 Firebase Storage rules。')
    } finally {
      setIsSaving(false)
    }
  }

  const closeDataEditor = () => {
    if (!isSaving) setDataEditor(null)
  }

  const saveDataEditor = async () => {
    if (!dataEditor || !dataDraft.title?.trim()) {
      setErrorMessage('請至少填寫名稱。')
      return
    }

    let nextTripData = tripData

    if (dataEditor.kind === 'flight') {
      const item: FlightInfo = {
        airline: dataDraft.airline || '', flightNumber: dataDraft.flightNumber || '',
        departureAirport: dataDraft.departureAirport || '', departureTime: dataDraft.departureTime || '',
        arrivalAirport: dataDraft.arrivalAirport || '', arrivalTime: dataDraft.arrivalTime || '',
        date: dataDraft.date || '', baggage: dataDraft.baggage || '', aircraft: dataDraft.aircraft || '',
        price: dataDraft.price || '', confirmationCode: dataDraft.confirmationCode || '',
      }
      const flightInfo = [...tripData.flightInfo]
      if (dataEditor.index === null) flightInfo.push(item)
      else flightInfo[dataEditor.index] = item
      nextTripData = { ...tripData, flightInfo }
    }

    if (dataEditor.kind === 'tripSettings') {
      nextTripData = {
        ...tripData,
        tripSettings: {
          title: dataDraft.title.trim(),
          subtitle: dataDraft.subtitle || '',
          countdown: dataDraft.countdown || '00',
        },
      }
    }

    if (dataEditor.kind === 'booking') {
        const item = {
        title: dataDraft.title.trim(),
        label: dataDraft.label || 'Info',
        body: dataDraft.body || '',
        meta: dataDraft.meta || '',
        accent: dataDraft.accent || 'bg-emerald-100 text-emerald-700',
          startDate: dataDraft.startDate || '',
          endDate: dataDraft.endDate || '',
        ...(dataDraft.attachmentUrl ? {
          attachment: {
            url: dataDraft.attachmentUrl,
            name: dataDraft.attachmentName || 'certificate',
            type: dataDraft.attachmentType || 'application/pdf',
          },
        } : {}),
      }
      const bookingCards = [...tripData.bookingCards]
      if (dataEditor.index === null) bookingCards.push(item)
      else bookingCards[dataEditor.index] = item
      nextTripData = { ...tripData, bookingCards }
    }

    if (dataEditor.kind === 'expense') {
      const item = {
        date: dataDraft.date || selectedDate,
        item: dataDraft.title.trim(),
        amount: dataDraft.amount || 'NT$ 0',
        payer: dataDraft.payer || '未指定',
      }
      const expenseEntries = [...tripData.expenseEntries]
      if (dataEditor.index === null) expenseEntries.push(item)
      else expenseEntries[dataEditor.index] = item
      nextTripData = { ...tripData, expenseEntries }
    }

    if (dataEditor.kind === 'task') {
      const item = { title: dataDraft.title.trim(), assignee: dataDraft.assignee || '全體', done: dataDraft.done === 'true' }
      const planningTasks = [...tripData.planningTasks]
      if (dataEditor.index === null) planningTasks.push(item)
      else planningTasks[dataEditor.index] = item
      nextTripData = { ...tripData, planningTasks }
    }

    if (dataEditor.kind === 'member') {
      const item = { name: dataDraft.title.trim(), role: dataDraft.role || '旅伴', color: dataDraft.color || 'bg-emerald-200 text-emerald-700' }
      const members = [...tripData.members]
      if (dataEditor.index === null) members.push(item)
      else members[dataEditor.index] = item
      nextTripData = { ...tripData, members }
    }

    if (dataEditor.kind === 'route' && dataEditor.parkId && dataEditor.dayId) {
      const route = {
        time: dataDraft.time || '全天',
        title: dataDraft.title.trim(),
        area: dataDraft.area || '',
        type: (dataDraft.type || '景點') as ParkDayRoute['type'],
        note: dataDraft.note || '',
      }
      const parkSections = tripData.parkSections.map((park) => {
        if (park.id !== dataEditor.parkId) return park
        return {
          ...park,
          days: park.days.map((day) => {
            if (day.id !== dataEditor.dayId) return day
            const routes = [...day.routes]
            if (dataEditor.index === null) routes.push(route)
            else routes[dataEditor.index] = route
            return { ...day, routes }
          }),
        }
      })
      nextTripData = { ...tripData, parkSections }
    }

    if (dataEditor.kind === 'parkDay' && dataEditor.parkId && dataEditor.dayId) {
      nextTripData = {
        ...tripData,
        parkSections: tripData.parkSections.map((park) => park.id !== dataEditor.parkId ? park : {
          ...park,
          days: park.days.map((day) => day.id === dataEditor.dayId ? { ...day, name: dataDraft.title.trim() } : day),
        }),
      }
    }

    setIsSaving(true)
    try {
      await saveTripDataToFirebase(nextTripData)
      setTripData(nextTripData)
      setDataEditor(null)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to save data:', error)
      setErrorMessage(getFirebaseErrorMessage(error, '資料儲存失敗'))
    } finally {
      setIsSaving(false)
    }
  }

  const deleteDataEditor = async () => {
    if (!dataEditor || dataEditor.index === null) return
    let nextTripData = tripData

    if (dataEditor.kind === 'flight') nextTripData = { ...tripData, flightInfo: tripData.flightInfo.filter((_, index) => index !== dataEditor.index) }
    if (dataEditor.kind === 'booking') nextTripData = { ...tripData, bookingCards: tripData.bookingCards.filter((_, index) => index !== dataEditor.index) }
    if (dataEditor.kind === 'expense') nextTripData = { ...tripData, expenseEntries: tripData.expenseEntries.filter((_, index) => index !== dataEditor.index) }
    if (dataEditor.kind === 'task') nextTripData = { ...tripData, planningTasks: tripData.planningTasks.filter((_, index) => index !== dataEditor.index) }
    if (dataEditor.kind === 'member') nextTripData = { ...tripData, members: tripData.members.filter((_, index) => index !== dataEditor.index) }
    if (dataEditor.kind === 'route' && dataEditor.parkId && dataEditor.dayId) {
      nextTripData = {
        ...tripData,
        parkSections: tripData.parkSections.map((park) => park.id !== dataEditor.parkId ? park : {
          ...park,
          days: park.days.map((day) => day.id !== dataEditor.dayId ? day : {
            ...day,
            routes: day.routes.filter((_, index) => index !== dataEditor.index),
          }),
        }),
      }
    }

    setIsSaving(true)
    try {
      await saveTripDataToFirebase(nextTripData)
      setTripData(nextTripData)
      setDataEditor(null)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to delete data:', error)
      setErrorMessage(getFirebaseErrorMessage(error, '資料刪除失敗'))
    } finally {
      setIsSaving(false)
    }
  }

  const togglePlanningTask = async (index: number) => {
    const planningTasks = tripData.planningTasks.map((task, taskIndex) =>
      taskIndex === index ? { ...task, done: !task.done } : task,
    )
    const nextTripData = { ...tripData, planningTasks }

    try {
      await saveTripDataToFirebase(nextTripData)
      setTripData(nextTripData)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to update task:', error)
      setErrorMessage(getFirebaseErrorMessage(error, '待辦事項更新失敗'))
    }
  }

  const reorderScheduleItems = async (targetIndex: number) => {
    if (draggingScheduleIndex === null || draggingScheduleIndex === targetIndex) return
    const nextDayPlans = tripData.dayPlans.map((day) => {
      if (day.date !== selectedPlan.date) return day
      const items = [...day.items]
      const [movedItem] = items.splice(draggingScheduleIndex, 1)
      items.splice(targetIndex, 0, movedItem)
      return { ...day, items }
    })
    const nextTripData = { ...tripData, dayPlans: nextDayPlans }
    setDraggingScheduleIndex(null)
    try {
      await saveTripDataToFirebase(nextTripData)
      setTripData(nextTripData)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to reorder itinerary items:', error)
      setErrorMessage(getFirebaseErrorMessage(error, '行程排序儲存失敗'))
    }
  }

  const reorderParkRoutes = async (targetIndex: number) => {
    if (draggingRouteIndex === null || draggingRouteIndex === targetIndex || !selectedParkDay) return
    const parkSections = tripData.parkSections.map((park) => {
      if (park.id !== selectedPark.id) return park
      return {
        ...park,
        days: park.days.map((day) => {
          if (day.id !== selectedParkDay.id) return day
          const routes = [...day.routes]
          const [movedRoute] = routes.splice(draggingRouteIndex, 1)
          routes.splice(targetIndex, 0, movedRoute)
          return { ...day, routes }
        }),
      }
    })
    const nextTripData = { ...tripData, parkSections }
    setDraggingRouteIndex(null)
    try {
      await saveTripDataToFirebase(nextTripData)
      setTripData(nextTripData)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to reorder park routes:', error)
      setErrorMessage(getFirebaseErrorMessage(error, '樂園路線排序儲存失敗'))
    }
  }

  const renderedContent = (() => {
    if (isLoading) {
      return (
        <main className="px-4 pb-6 pt-4">
          <section className="soft-card p-4 text-sm text-muted">載入旅遊資料中…</section>
        </main>
      )
    }

    return (
      <main className="px-4 pb-6">
        {errorMessage && (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {errorMessage}
          </div>
        )}

        {activeTab === 'schedule' && (
          <>
            <section className="mb-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black tracking-[-0.02em]">Daily plan</h2>
                <button type="button" className="text-xs font-semibold text-olive">
                  view map
                </button>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2">
                {tripData.dayPlans.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedDate(day.date)}
                    className={`min-w-[86px] rounded-[22px] border px-3 py-3 text-left shadow-sm transition active:scale-95 ${
                      selectedDate === day.date
                        ? 'border-olive bg-olive text-white'
                        : 'border-white/80 bg-white/80 text-ink'
                    }`}
                  >
                    <div className="text-[9px] uppercase tracking-[0.14em] opacity-80">{day.dayLabel}</div>
                    <div className="mt-1 text-lg font-black">{day.date}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="weather-card mb-5 overflow-hidden p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/75">Weather forecast</p>
                  <h2 className="mt-2 text-2xl font-black text-white">{weatherState.location}</h2>
                  <div className="mt-1 text-base font-bold text-white/90">{weatherState.description}</div>
                  <p className="mt-1 text-[10px] font-bold text-white/65">目前位置 · Open-Meteo</p>
                </div>
                <div className="weather-sun" aria-hidden="true">☀</div>
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <div className="text-4xl font-black tracking-[-0.04em] text-white">{weatherState.temperature}</div>
                <div className="rounded-2xl bg-white/20 px-3 py-2 text-right text-[10px] font-bold text-white/85">今日<br />即時天氣</div>
              </div>
            </section>

            <section className="soft-card p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{selectedPlan.date}</p>
                  <h3 className="mt-1 text-lg font-black tracking-[-0.02em]">Timeline</h3>
                </div>
                <button
                  type="button"
                  onClick={openNewScheduleItem}
                  className="rounded-full bg-olive px-3 py-1.5 text-[10px] font-black text-white active:scale-95"
                >
                  + 新增
                </button>
              </div>

              <div className="space-y-4">
                {selectedPlan.items.map((item, index) => {
                  const categoryStyle =
                    item.category === '景點'
                      ? 'bg-emerald-100 text-emerald-700'
                      : item.category === '美食'
                        ? 'bg-orange-100 text-orange-700'
                        : item.category === '交通'
                          ? 'bg-sky-100 text-sky-700'
                          : 'bg-violet-100 text-violet-700'

                  return (
                    <div
                      key={`${item.time}-${item.title}`}
                      draggable
                      onDragStart={() => setDraggingScheduleIndex(index)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => void reorderScheduleItems(index)}
                      onDragEnd={() => setDraggingScheduleIndex(null)}
                      className={`schedule-item flex cursor-grab gap-3 rounded-[22px] p-3 active:cursor-grabbing ${draggingScheduleIndex === index ? 'opacity-50' : ''}`}
                    >
                      <div className="flex w-14 flex-col items-center pt-1">
                        <div className="mb-1 text-[10px] text-muted" title="拖曳排序">☷</div>
                        <div className="text-[11px] font-black text-muted">{item.time}</div>
                        <div className="mt-2 h-8 w-px bg-olive/20" />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-black text-ink">{item.title}</div>
                          <button
                            type="button"
                            onClick={() => openEditScheduleItem(item, index)}
                            className="shrink-0 text-[10px] font-black text-olive"
                          >
                            編輯
                          </button>
                        </div>
                        <span className={`label-chip mt-1 ${categoryStyle}`}>{item.category}</span>
                        <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                          <span>{item.place}</span>
                          {item.mapUrl && (
                            <a href={item.mapUrl} target="_blank" rel="noreferrer" className="font-black text-sky-700" aria-label="開啟 Google Maps">
                              <FontAwesomeIcon icon={faMapLocationDot} />
                            </a>
                          )}
                        </div>
                        <div className="mt-2 text-xs leading-5 text-ink/70">{item.note}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {activeTab === 'bookings' && (
          <div className="space-y-4">
              <section className="soft-card section-info p-2.5">
              <div className="grid grid-cols-4 gap-1 rounded-full bg-transparent p-1">
                {bookingModes.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setBookingMode(mode.id)}
                    className={`flex flex-col items-center gap-1 rounded-full px-1 py-2 text-[10px] font-black transition active:scale-95 ${
                      bookingMode === mode.id ? 'bg-[#80B95D] text-white shadow-sm' : 'text-[#9B907E]'
                    }`}
                  >
                    <FontAwesomeIcon icon={mode.icon} className="text-sm" />
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>
            </section>

            {bookingMode === 'flight' && (
              <>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-black">航班航段</h3>
                <button type="button" onClick={() => openDataEditor({ kind: 'flight', index: null }, { title: '', airline: '', flightNumber: '' })} className="rounded-full bg-olive px-3 py-1.5 text-xs font-black text-white">
                  + 新增航段
                </button>
              </div>
              <div className="space-y-2">
                {tripData.flightInfo.map((flight, index) => (
                  <div key={`${flight.flightNumber}-${flight.date}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedFlightIndex(expandedFlightIndex === index ? null : index)}
                      className={`flex w-full items-center justify-between rounded-[20px] border px-4 py-3 text-left transition active:scale-[0.99] ${isPastFlight(flight) ? 'border-[#e5e5e1] bg-[#f1f1ee] text-[#aaa89f]' : expandedFlightIndex === index ? 'border-[#80B95D] bg-[#effbea]' : 'border-[#e2e7dc] bg-white'}`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="w-12 shrink-0 text-center text-xs font-black leading-tight text-muted">{formatDateLabel(toDateInputValue(flight.date))}</div>
                        <div className="flex min-w-0 flex-1 items-end justify-center gap-2">
                          <div className="min-w-0 text-center">
                            <div className="text-[10px] font-bold text-muted">{flight.departureTime || '--'}</div>
                            <div className={`truncate text-sm font-black ${isPastFlight(flight) ? 'text-[#aaa89f]' : 'text-ink'}`}>{flight.departureAirport || '--'}</div>
                          </div>
                          <span className="pb-0.5 text-xs text-muted">→</span>
                          <div className="min-w-0 text-center">
                            <div className="text-[10px] font-bold text-muted">{flight.arrivalTime || '--'}</div>
                            <div className={`truncate text-sm font-black ${isPastFlight(flight) ? 'text-[#aaa89f]' : 'text-ink'}`}>{flight.arrivalAirport || '--'}</div>
                          </div>
                        </div>
                        <div className={`w-14 shrink-0 text-right text-sm font-black ${isPastFlight(flight) ? 'text-[#aaa89f]' : 'text-olive'}`}>{flight.flightNumber || '--'}</div>
                      </div>
                      <span className={`ml-2 text-lg font-black ${isPastFlight(flight) ? 'text-[#aaa89f]' : 'text-olive'}`}>{isPastFlight(flight) ? '已過期' : expandedFlightIndex === index ? '−' : '+'}</span>
                    </button>
                    {expandedFlightIndex === index && (
              <section className="overflow-hidden rounded-[30px] border border-white/80 bg-white shadow-soft">
                <div className="bg-[#E9F0FF] px-5 pb-5 pt-4 text-center">
                  <div className="text-sm font-black tracking-[0.18em] text-[#8D8478]">{flightInfo.airline}</div>
                  <div className="mt-3 rounded-[22px] bg-white/80 px-5 py-2 text-5xl font-black tracking-[0.08em] text-[#725B4A] shadow-sm">
                    {flightInfo.flightNumber}
                  </div>
                  <div className="mt-4 flex items-center justify-between rounded-[26px] bg-white px-5 py-5 shadow-sm">
                    <div className="text-left">
                      <div className="text-3xl font-black text-[#725B4A]">{flightInfo.departureAirport}</div>
                      <div className="mt-1 text-2xl font-black text-[#725B4A]">{flightInfo.departureTime}</div>
                      <span className="mt-2 inline-block rounded-full bg-[#80B95D] px-3 py-1 text-[10px] font-black text-white">高雄</span>
                    </div>
                    <div className="px-2 text-center text-xs font-bold text-[#B0A695]">
                      <div>02h25m</div>
                      <FontAwesomeIcon icon={faPlane} className="my-2 text-xl text-[#3976D8]" />
                      <div>{flightInfo.date}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-black text-[#725B4A]">{flightInfo.arrivalAirport}</div>
                      <div className="mt-1 text-2xl font-black text-[#725B4A]">{flightInfo.arrivalTime}</div>
                      <span className="mt-2 inline-block rounded-full bg-[#F1A24D] px-3 py-1 text-[10px] font-black text-white">釜山</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 p-4">
                  <div className="rounded-[20px] border border-[#E6E7DE] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Baggage</div>
                    <div className="mt-2 text-xl font-black text-[#725B4A]">{flightInfo.baggage}</div>
                  </div>
                  <div className="rounded-[20px] border border-[#E6E7DE] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Aircraft</div>
                    <div className="mt-2 text-xl font-black text-[#725B4A]">{flightInfo.aircraft}</div>
                  </div>
                  <div className="rounded-[20px] border border-[#E6E7DE] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Price & type</div>
                    <div className="mt-2 text-lg font-black text-[#725B4A]">{flightInfo.price}</div>
                    <div className="text-[10px] text-muted">同一張訂單</div>
                  </div>
                  <div className="rounded-[20px] border border-[#E6E7DE] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Confirmation</div>
                    <div className="mt-2 text-lg font-black text-[#725B4A]">{flightInfo.confirmationCode}</div>
                    <div className="text-[10px] text-muted">訂位代碼</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openDataEditor({ kind: 'flight', index: expandedFlightIndex }, { ...flightInfo, date: toDateInputValue(flightInfo.date), title: flightInfo.flightNumber })}
                  className="mx-4 mb-4 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-[20px] border-2 border-[#DCE4D2] py-3 text-sm font-black text-[#9B907E]"
                >
                  編輯航班資訊
                </button>
              </section>
                    )}
                  </div>
                ))}
              </div>
              </>
            )}

            {bookingMode !== 'flight' && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-black">{bookingMode === 'hotel' ? '住宿資訊' : bookingMode === 'car' ? '租車資訊' : '其他預訂'}</h3>
                  <button
                    type="button"
                    onClick={() => openDataEditor({ kind: 'booking', index: null }, { title: '', label: bookingMode === 'hotel' ? 'Hotel' : bookingMode === 'car' ? 'Car' : 'Voucher' })}
                    className="rounded-full bg-olive px-3 py-1.5 text-xs font-black text-white"
                  >
                    + 新增
                  </button>
                </div>
                {bookingCards
                  .filter((card) => (bookingMode === 'hotel' ? card.label === 'Hotel' : bookingMode === 'car' ? card.label === 'Car' : true))
                  .map((card) => {
                    const index = bookingCards.indexOf(card)
                    return (
                    <div key={`${card.title}-${card.startDate}`} className="soft-card mb-3 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-base font-black text-ink">{card.title}</div>
                          {card.startDate && <div className="mt-1 text-xs font-bold text-muted">{formatDateLabel(card.startDate)}{card.endDate ? ` - ${formatDateLabel(card.endDate)}` : ''}</div>}
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${card.accent}`}>
                          {card.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => openDataEditor({ kind: 'booking', index }, { title: card.title, label: card.label, body: card.body, meta: card.meta, accent: card.accent, startDate: card.startDate ?? '', endDate: card.endDate ?? '', attachmentUrl: card.attachment?.url ?? '', attachmentName: card.attachment?.name ?? '', attachmentType: card.attachment?.type ?? '' })}
                          className="text-[10px] font-black uppercase tracking-[0.14em] text-olive"
                        >
                          編輯
                        </button>
                      </div>
                      <div className="mt-3 text-lg font-black tracking-[-0.03em] text-ink">{card.body}</div>
                      <div className="mt-1 text-sm text-muted">{card.meta}</div>
                      {card.attachment && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => setPreviewAttachment(card.attachment!)} className="rounded-full bg-sky-100 px-3 py-1.5 text-xs font-black text-sky-700">預覽憑證</button>
                          <a href={card.attachment.url} download={card.attachment.name} target="_blank" rel="noreferrer" className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-700">下載</a>
                        </div>
                      )}
                    </div>
                    )
                  })}
              </section>
            )}

          </div>
        )}

        {activeTab === 'expense' && (
          <div className="space-y-4">
            <section className="soft-card section-park p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Total spend</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <div className="text-3xl font-black tracking-[-0.05em] text-ink">NT$ 86,400</div>
                  <div className="mt-1 text-sm text-muted">USD 2,760</div>
                </div>
                <button
                  type="button"
                  onClick={() => openDataEditor({ kind: 'expense', index: null }, { date: selectedDate, title: '', amount: '', payer: '' })}
                  className="rounded-full bg-olive px-3 py-2 text-xs font-black text-white active:scale-95"
                >
                  + Add
                </button>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <div className="soft-card p-3">
                <div className="text-[9px] uppercase tracking-[0.14em] text-muted">Food</div>
                <div className="mt-2 text-xl font-black text-ink">NT$ 24K</div>
              </div>
              <div className="soft-card p-3">
                <div className="text-[9px] uppercase tracking-[0.14em] text-muted">Transport</div>
                <div className="mt-2 text-xl font-black text-ink">NT$ 18K</div>
              </div>
            </section>

            <section className="soft-card section-action p-4">
              <h3 className="mb-3 text-base font-black">Daily details</h3>
              <div className="space-y-2">
                {expenseEntries.map((entry, index) => (
                  <div key={`${entry.date}-${entry.item}`} className="flex items-center justify-between rounded-[18px] bg-transparent px-3 py-2.5">
                    <div>
                      <div className="font-bold text-ink">{entry.item}</div>
                      <div className="text-xs text-muted">{entry.date} · {entry.payer}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openDataEditor({ kind: 'expense', index }, { date: entry.date, title: entry.item, amount: entry.amount, payer: entry.payer })}
                      className="font-black text-olive"
                    >
                      {entry.amount}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'park' && (
          <div className="space-y-4">
            <section className="soft-card p-2.5">
              <div className="flex gap-2 rounded-full bg-transparent p-1">
                {parkSections.map((park) => (
                  <button
                    key={park.id}
                    type="button"
                    onClick={() => setSelectedParkId(park.id)}
                    className={`flex-1 rounded-full px-3 py-2 text-sm font-black transition active:scale-95 ${
                      selectedParkId === park.id ? 'bg-olive text-white shadow-sm' : 'text-muted'
                    }`}
                  >
                    {park.name}
                  </button>
                ))}
              </div>
            </section>

            <section className="soft-card section-info p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{selectedPark.name}</p>
              <h2 className="mt-1 text-lg font-black tracking-[-0.02em]">{selectedPark.description}</h2>
            </section>

            <section className="soft-card section-park p-2.5">
              <div className="flex gap-2 overflow-x-auto">
                {selectedPark.days.map((day) => (
                  <button key={day.id} type="button" onClick={() => setSelectedParkDayId(day.id)} className={`min-w-[92px] rounded-[18px] px-3 py-2 text-center text-xs font-black ${selectedParkDay?.id === day.id ? 'bg-violet-700 text-white' : 'bg-white text-muted'}`}>
                    <span className="block text-[11px] font-black">{day.date}</span>
                  </button>
                ))}
              </div>
            </section>

            {selectedParkDay && (
              <section key={selectedParkDay.id} className="soft-card section-park p-4">
                <div className="mb-3">
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.14em] text-muted">Title</p>
                    <button type="button" onClick={() => openDataEditor({ kind: 'parkDay', index: 0, parkId: selectedPark.id, dayId: selectedParkDay.id }, { title: selectedParkDay.name })} className="mt-1 text-left text-base font-black text-ink">{selectedParkDay.name}</button>
                  </div>
                  <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => openDataEditor({ kind: 'route', index: null, parkId: selectedPark.id, dayId: selectedParkDay.id }, { type: '景點' })}
                    className="rounded-full bg-olive px-2.5 py-1.5 text-[9px] font-black text-white"
                  >
                    + 路線
                  </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedParkDay.routes.map((route, index) => {
                    const colorMap = {
                      景點: 'bg-emerald-100 text-emerald-700',
                      美食: 'bg-orange-100 text-orange-700',
                      交通: 'bg-sky-100 text-sky-700',
                      休息: 'bg-violet-100 text-violet-700',
                    }

                    return (
                      <div
                        key={`${selectedParkDay.id}-${route.time}-${route.title}`}
                        draggable
                        onDragStart={() => setDraggingRouteIndex(index)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => void reorderParkRoutes(index)}
                        onDragEnd={() => setDraggingRouteIndex(null)}
                        className={`park-route-item cursor-grab rounded-[20px] bg-transparent p-3 active:cursor-grabbing ${draggingRouteIndex === index ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2"><span className="text-sm text-muted" title="拖曳排序">☷</span><div className="text-[11px] font-black text-muted">{route.time}</div></div>
                          <span className={`label-chip ${colorMap[route.type]}`}>{route.type}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="font-black text-ink">{route.title}</div>
                          <button
                            type="button"
                            onClick={() => openDataEditor({ kind: 'route', index, parkId: selectedPark.id, dayId: selectedParkDay.id }, { time: route.time, title: route.title, area: route.area, type: route.type, note: route.note })}
                            className="text-[10px] font-black text-olive"
                          >
                            編輯
                          </button>
                        </div>
                        <div className="mt-1 text-sm text-muted">{route.area}</div>
                        <div className="mt-2 text-xs leading-5 text-ink/70">{route.note}</div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'planning' && (
          <div className="space-y-4">
            <section className="soft-card section-action p-2.5">
              <div className="grid grid-cols-4 gap-1 rounded-full bg-transparent p-1">
                {preparationModes.map((mode) => (
                  <button key={mode.label} type="button" onClick={() => setPreparationMode(mode.label)} className={`flex flex-col items-center gap-1 rounded-full px-1 py-2 text-[10px] font-black ${preparationMode === mode.label ? 'bg-[#80B95D] text-white shadow-sm' : 'text-[#9B907E]'}`}>
                    <FontAwesomeIcon icon={mode.icon} className="text-sm" />
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="soft-card section-info p-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {['全體', ...members.map((member) => member.name)].map((assignee) => (
                  <button key={assignee} type="button" onClick={() => setPreparationAssignee(assignee)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-black ${preparationAssignee === assignee ? 'bg-[#725B4A] text-white' : 'bg-white text-[#9B907E]'}`}>
                    {assignee}
                  </button>
                ))}
              </div>
            </section>

            <section className="soft-card todo-composer p-4">
              <div className="flex items-center gap-3">
                <button type="button" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E5F2DD] text-xl text-olive" aria-label="拍照新增">
                  <FontAwesomeIcon icon={faCamera} />
                </button>
                <div className="flex-1 rounded-2xl border border-[#DCE4D2] bg-transparent px-3 py-3 text-sm font-bold text-[#B8AD99]">
                  新增{preparationMode}（全體）…
                </div>
                <button type="button" onClick={() => openDataEditor({ kind: 'task', index: null }, { title: '', assignee: preparationAssignee, done: 'false' })} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-olive text-xl text-white shadow-sm" aria-label="新增待辦">
                  <FontAwesomeIcon icon={faPlus} />
                </button>
              </div>
            </section>

            {preparationMode === '待辦' && planningTasks.filter((task) => preparationAssignee === '全體' || task.assignee === preparationAssignee).map((task) => {
              const index = planningTasks.indexOf(task)
              return (
                <section key={task.title} className="todo-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-black text-[#9B907E]">
                    <span className="rounded-md bg-[#E5EBD8] px-2 py-1">{task.assignee}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => void togglePlanningTask(index)} className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${task.done ? 'border-olive bg-olive text-white' : 'border-[#A8D093] text-olive'}`}>
                      {task.done ? '✓' : ''}
                    </button>
                    <div className={`flex-1 text-lg font-black ${task.done ? 'text-ink/40 line-through' : 'text-ink'}`}>{task.title}</div>
                    <button type="button" onClick={() => openDataEditor({ kind: 'task', index }, { title: task.title, assignee: task.assignee, done: String(task.done) })} className="text-lg text-[#B8AD99]" aria-label="編輯待辦">
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                  </div>
                </section>
              )
            })}

            {preparationMode !== '待辦' && (
              <section className="todo-empty p-5 text-center text-sm font-bold text-muted">
                目前尚未建立{preparationMode}資料，請使用上方新增按鈕。
              </section>
            )}
          </div>
        )}

        {activeTab === 'members' && (
          <div className="space-y-4">
            <section className="soft-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black tracking-[-0.02em]">Travel crew</h2>
                <button
                  type="button"
                  onClick={() => openDataEditor({ kind: 'member', index: null }, { title: '', role: '旅伴', color: 'bg-emerald-200 text-emerald-700' })}
                  className="rounded-full bg-olive px-3 py-1.5 text-xs font-black text-white active:scale-95"
                >
                  + Add
                </button>
              </div>

              <div className="space-y-3">
                  {members.map((member, index) => (
                  <div key={member.name} className="flex items-center justify-between rounded-[18px] bg-transparent p-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-black ${member.color}`}>
                        {member.name.slice(0, 1)}
                      </div>
                      <div>
                        <div className="font-black text-ink">{member.name}</div>
                        <div className="text-xs text-muted">{member.role}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openDataEditor({ kind: 'member', index }, { title: member.name, role: member.role, color: member.color })}
                      className="text-sm font-bold text-olive active:scale-95"
                    >
                      編輯
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    )
  })()

  return (
    <div className="min-h-screen bg-sand text-ink">
      <div className="mx-auto min-h-screen max-w-md bg-sand pb-28">
        <header className="px-4 pb-3 pt-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">Florida trip</p>
              <h1 className="mt-1 text-2xl font-black tracking-[-0.03em] text-ink">Orlando Escape</h1>
            </div>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-olive/10 bg-white/80 text-lg shadow-soft active:scale-95"
            >
              ☼
            </button>
          </div>

          <div className="rounded-[30px] bg-gradient-to-br from-[#EAF0DB] via-[#F7F4EB] to-[#F7E9D6] p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Next adventure</p>
                <div className="mt-2 text-2xl font-black tracking-[-0.04em] text-ink">{tripSettings.title}</div>
                <div className="mt-1 text-sm text-muted">{tripSettings.subtitle}</div>
              </div>
              <button
                type="button"
                onClick={() => openDataEditor({ kind: 'tripSettings', index: 0 }, { ...tripSettings })}
                className="rounded-[20px] bg-white/80 px-3 py-2 text-right shadow-sm active:scale-95"
              >
                <div className="text-[9px] uppercase tracking-[0.14em] text-muted">countdown</div>
                <div className="text-2xl font-black text-olive">{countdown}</div>
                <div className="text-[10px] text-muted">days</div>
              </button>
            </div>
          </div>
        </header>

        {renderedContent}

        {editingItem && (
          <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/30 px-4 pb-24 pt-8 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{editingItem.date}</p>
                  <h2 className="mt-1 text-lg font-black">{editingItem.index === null ? '新增行程' : '編輯行程'}</h2>
                </div>
                <button type="button" onClick={closeScheduleEditor} className="text-sm font-bold text-muted">
                  關閉
                </button>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-bold text-muted">
                    時間
                    <input
                      value={draftItem.time}
                      onChange={(event) => setDraftItem({ ...draftItem, time: event.target.value })}
                      placeholder="09:30"
                      className="mt-1 w-full rounded-2xl bg-[#F7F4EB] px-3 py-2.5 text-sm font-bold text-ink outline-none ring-olive/30 focus:ring-2"
                    />
                  </label>
                  <label className="text-xs font-bold text-muted">
                    類別
                    <select
                      value={draftItem.category}
                      onChange={(event) => setDraftItem({ ...draftItem, category: event.target.value as Category })}
                      className="mt-1 w-full rounded-2xl bg-[#F7F4EB] px-3 py-2.5 text-sm font-bold text-ink outline-none ring-olive/30 focus:ring-2"
                    >
                      <option value="景點">景點</option>
                      <option value="美食">美食</option>
                      <option value="交通">交通</option>
                      <option value="住宿">住宿</option>
                    </select>
                  </label>
                </div>

                <label className="block text-xs font-bold text-muted">
                  行程名稱
                  <input
                    value={draftItem.title}
                    onChange={(event) => setDraftItem({ ...draftItem, title: event.target.value })}
                    placeholder="例如：參觀 Magic Kingdom"
                    className="mt-1 w-full rounded-2xl bg-[#F7F4EB] px-3 py-2.5 text-sm font-bold text-ink outline-none ring-olive/30 focus:ring-2"
                  />
                </label>

                <label className="block text-xs font-bold text-muted">
                  地點
                  <input
                    value={draftItem.place}
                    onChange={(event) => setDraftItem({ ...draftItem, place: event.target.value })}
                    placeholder="例如：Magic Kingdom"
                    className="mt-1 w-full rounded-2xl bg-[#F7F4EB] px-3 py-2.5 text-sm font-bold text-ink outline-none ring-olive/30 focus:ring-2"
                  />
                </label>

                <label className="block text-xs font-bold text-muted">
                  Google Maps 連結
                  <input
                    value={draftItem.mapUrl ?? ''}
                    onChange={(event) => setDraftItem({ ...draftItem, mapUrl: event.target.value })}
                    placeholder="https://maps.google.com/..."
                    className="mt-1 w-full rounded-2xl bg-[#F7F4EB] px-3 py-2.5 text-sm font-bold text-ink outline-none ring-olive/30 focus:ring-2"
                  />
                </label>

                <label className="block text-xs font-bold text-muted">
                  備註
                  <textarea
                    value={draftItem.note}
                    onChange={(event) => setDraftItem({ ...draftItem, note: event.target.value })}
                    placeholder="補充票券、交通或預約資訊"
                    rows={3}
                    className="mt-1 w-full resize-none rounded-2xl bg-[#F7F4EB] px-3 py-2.5 text-sm font-bold text-ink outline-none ring-olive/30 focus:ring-2"
                  />
                </label>
              </div>

              <div className="mt-5 flex gap-2">
                {editingItem.index !== null && (
                  <button
                    type="button"
                    onClick={() => void deleteScheduleItem()}
                    disabled={isSaving}
                    className="rounded-full border border-red-200 px-4 py-2.5 text-xs font-black text-red-600 disabled:opacity-50"
                  >
                    刪除
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void saveScheduleItem()}
                  disabled={isSaving}
                  className="flex-1 rounded-full bg-olive px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
                >
                  {isSaving ? '儲存中…' : '儲存'}
                </button>
              </div>
            </div>
          </div>
        )}

        {dataEditor && (
          <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/30 px-4 pb-24 pt-8 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Firebase data</p>
                  <h2 className="mt-1 text-lg font-black">
                    {dataEditor.index === null ? '新增資料' : '編輯資料'}
                  </h2>
                </div>
                <button type="button" onClick={closeDataEditor} className="text-sm font-bold text-muted">
                  關閉
                </button>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-bold text-muted">
                  名稱
                  <input
                    value={dataDraft.title ?? ''}
                    onChange={(event) => setDataDraft({ ...dataDraft, title: event.target.value })}
                    placeholder="請輸入名稱"
                    className="mt-1 w-full rounded-2xl bg-[#F7F4EB] px-3 py-2.5 text-sm font-bold text-ink outline-none ring-olive/30 focus:ring-2"
                  />
                </label>

                {dataEditor.kind === 'booking' && (
                  <>
                    <label className="block text-xs font-bold text-muted">類型<input value={dataDraft.label ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, label: event.target.value })} className="form-field" /></label>
                    <label className="block text-xs font-bold text-muted">補充資訊<input value={dataDraft.meta ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, meta: event.target.value })} className="form-field" /></label>
                    {dataDraft.label === 'Hotel' && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-bold text-muted">入住日期<input type="date" value={dataDraft.startDate ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, startDate: event.target.value })} className="form-field" /></label>
                        <label className="text-xs font-bold text-muted">退房日期<input type="date" value={dataDraft.endDate ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, endDate: event.target.value })} className="form-field" /></label>
                      </div>
                    )}
                    <label className="block text-xs font-bold text-muted">
                      憑證檔案（PDF / JPG / PNG）
                      <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void handleCertificateChange(event.target.files?.[0])} className="form-field file:mr-2 file:rounded-full file:border-0 file:bg-olive file:px-3 file:py-1 file:text-xs file:font-black file:text-white" />
                    </label>
                    {dataDraft.attachmentUrl && (
                      <button type="button" onClick={() => setPreviewAttachment({ url: dataDraft.attachmentUrl, name: dataDraft.attachmentName || 'certificate', type: dataDraft.attachmentType || 'application/pdf' })} className="w-full rounded-2xl bg-sky-50 px-3 py-2 text-left text-xs font-black text-sky-700">
                        已上傳：{dataDraft.attachmentName || '憑證'}，點擊預覽
                      </button>
                    )}
                  </>
                )}

                {dataEditor.kind === 'flight' && (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['airline', '航空公司'],
                      ['flightNumber', '航班號碼'],
                      ['departureAirport', '出發機場'],
                      ['departureTime', '出發時間'],
                      ['arrivalAirport', '抵達機場'],
                      ['arrivalTime', '抵達時間'],
                      ['date', '日期'],
                      ['baggage', '行李'],
                      ['aircraft', '機型'],
                      ['price', '價格'],
                      ['confirmationCode', '確認碼'],
                    ].map(([key, label]) => (
                      <label key={key} className="text-xs font-bold text-muted">
                        {label}
                        <input type={key === 'date' ? 'date' : 'text'} value={key === 'date' ? toDateInputValue(dataDraft[key] ?? '') : dataDraft[key] ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, [key]: event.target.value })} className="form-field" />
                      </label>
                    ))}
                  </div>
                )}

                {dataEditor.kind === 'tripSettings' && (
                  <>
                    <label className="block text-xs font-bold text-muted">摘要文字<input value={dataDraft.subtitle ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, subtitle: event.target.value })} className="form-field" /></label>
                    <label className="block text-xs font-bold text-muted">Countdown 天數<input value={dataDraft.countdown ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, countdown: event.target.value })} className="form-field" /></label>
                  </>
                )}

                {dataEditor.kind === 'expense' && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold text-muted">日期<input type="date" value={toDateInputValue(dataDraft.date ?? '')} onChange={(event) => setDataDraft({ ...dataDraft, date: event.target.value })} className="form-field" /></label>
                    <label className="text-xs font-bold text-muted">金額<input value={dataDraft.amount ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, amount: event.target.value })} className="form-field" /></label>
                    <label className="col-span-2 text-xs font-bold text-muted">付款人<input value={dataDraft.payer ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, payer: event.target.value })} className="form-field" /></label>
                  </div>
                )}

                {dataEditor.kind === 'task' && (
                  <label className="block text-xs font-bold text-muted">
                    負責人
                    <select value={dataDraft.assignee ?? '全體'} onChange={(event) => setDataDraft({ ...dataDraft, assignee: event.target.value })} className="form-field">
                      <option value="全體">全體</option>
                      {members.map((member) => <option key={member.name} value={member.name}>{member.name}</option>)}
                    </select>
                  </label>
                )}

                {dataEditor.kind === 'member' && (
                  <label className="block text-xs font-bold text-muted">角色<input value={dataDraft.role ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, role: event.target.value })} className="form-field" /></label>
                )}

                {dataEditor.kind === 'route' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-bold text-muted">時間<input value={dataDraft.time ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, time: event.target.value })} className="form-field" /></label>
                      <label className="text-xs font-bold text-muted">類型<select value={dataDraft.type ?? '景點'} onChange={(event) => setDataDraft({ ...dataDraft, type: event.target.value })} className="form-field"><option>景點</option><option>美食</option><option>交通</option><option>休息</option></select></label>
                    </div>
                    <label className="block text-xs font-bold text-muted">區域<input value={dataDraft.area ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, area: event.target.value })} className="form-field" /></label>
                    <label className="block text-xs font-bold text-muted">備註<textarea value={dataDraft.note ?? ''} onChange={(event) => setDataDraft({ ...dataDraft, note: event.target.value })} rows={2} className="form-field resize-none" /></label>
                  </>
                )}
              </div>

              <div className="mt-5 flex gap-2">
                {dataEditor.index !== null && dataEditor.kind !== 'parkDay' && (
                  <button type="button" onClick={() => void deleteDataEditor()} disabled={isSaving} className="rounded-full border border-red-200 px-4 py-2.5 text-xs font-black text-red-600 disabled:opacity-50">
                    刪除
                  </button>
                )}
                <button type="button" onClick={() => void saveDataEditor()} disabled={isSaving} className="flex-1 rounded-full bg-olive px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
                  {isSaving ? '儲存中…' : '儲存'}
                </button>
              </div>
            </div>
          </div>
        )}

        {previewAttachment && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/60 px-4 py-8 backdrop-blur-sm">
            <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-[28px] bg-white shadow-xl">
              <div className="flex items-center justify-between gap-3 border-b border-[#E6E7DE] px-4 py-3">
                <div className="truncate text-sm font-black text-ink">{previewAttachment.name}</div>
                <div className="flex shrink-0 items-center gap-2">
                  <a href={previewAttachment.url} download={previewAttachment.name} target="_blank" rel="noreferrer" className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-700">下載</a>
                  <button type="button" onClick={() => setPreviewAttachment(null)} className="rounded-full bg-sage px-3 py-1.5 text-xs font-black text-olive">關閉</button>
                </div>
              </div>
              <div className="min-h-0 overflow-auto bg-[#F7F4EB] p-3">
                {previewAttachment.type.startsWith('image/') ? (
                  <img src={previewAttachment.url} alt={previewAttachment.name} className="mx-auto h-auto max-w-full rounded-2xl bg-white" />
                ) : (
                  <iframe title={previewAttachment.name} src={previewAttachment.url} className="h-[70vh] w-full rounded-2xl border-0 bg-white" />
                )}
              </div>
            </div>
          </div>
        )}

        <nav className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 border-t border-olive/10 bg-white/80 px-2 py-2 backdrop-blur-sm">
          <div className="grid grid-cols-5 gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`bottom-nav-item rounded-[18px] px-1 py-2 ${
                  activeTab === tab.id ? 'bg-sage text-olive' : 'text-muted'
                }`}
              >
                <FontAwesomeIcon icon={tab.icon} className="text-lg" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}

export default App
