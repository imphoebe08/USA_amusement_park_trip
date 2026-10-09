const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const api = { exports: {}, Intl, Date }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/flightDuration.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, api)
const duration = (flight) => api.exports.getFlightDurationMinutes(flight, 2026)
const base = { date:'2026-11-04', departureAirport:'KHH', arrivalAirport:'NRT', departureTime:'11:30', arrivalTime:'15:55' }
test('Taiwan to Japan subtracts one hour time-zone difference', () => assert.equal(duration(base), 205))
test('Japan to Los Angeles crosses date line without subtracting local clocks directly', () => assert.equal(duration({...base,departureAirport:'NRT',arrivalAirport:'LAX',departureTime:'17:30',arrivalTime:'10:35'}),605))
test('legacy timestamps include next-day arrival', () => assert.equal(duration({...base,date:'11/15-16',departureAirport:'LAX',arrivalAirport:'NRT',departureTime:'11/15 11:05',arrivalTime:'11/16 15:55'}),710))
test('explicit arrival date supports year crossing', () => assert.equal(duration({...base,date:'2026-12-31',arrivalDate:'2027-01-01',departureAirport:'LAX',arrivalAirport:'NRT',departureTime:'11:05',arrivalTime:'15:55'}),710))
test('overnight domestic flight uses arrival local date', () => assert.equal(duration({...base,departureAirport:'LAS',arrivalAirport:'MCO',departureTime:'22:55',arrivalTime:'06:10'}),255))
test('daylight saving offset varies by flight date', () => {
 assert.equal(duration({...base,date:'2026-07-04',departureAirport:'NRT',arrivalAirport:'LAX',departureTime:'17:30',arrivalTime:'10:35'}),545)
})
test('unknown airports and invalid dates or times have no guessed result', () => {
 for(const patch of [{departureAirport:'ZZZ'},{date:'2026-02-30'},{arrivalDate:'2026-02-30'},{arrivalTime:'25:00'},{departureTime:''}]) assert.equal(duration({...base,...patch}),null)
})
test('nonexistent daylight saving time is rejected', () => assert.equal(duration({...base,date:'2026-03-08',departureAirport:'LAX',departureTime:'02:30'}),null))
test('ambiguous daylight saving time is rejected', () => assert.equal(duration({...base,date:'2026-11-01',departureAirport:'LAX',departureTime:'01:30'}),null))

test('each itinerary ticket calculates its own duration', () => {
  const flights = [base,
    {...base, departureAirport:'NRT',arrivalAirport:'LAX',departureTime:'17:30',arrivalTime:'10:35'},
    {...base, date:'11/15-16',departureAirport:'LAX',arrivalAirport:'NRT',departureTime:'11/15 11:05',arrivalTime:'11/16 15:55'},
    {...base, date:'11/16',departureAirport:'NRT',arrivalAirport:'KHH',departureTime:'17:50',arrivalTime:'21:25'},
  ]
  assert.deepEqual(flights.map(duration), [205,605,710,275])
})
test('opening a legacy overnight ticket retains its arrival date', () => {
  assert.equal(api.exports.getFlightArrivalDate({...base,date:'11/15-16',departureAirport:'LAX',arrivalAirport:'NRT',departureTime:'11/15 11:05',arrivalTime:'11/16 15:55'},2026),'2026-11-16')
})
test('airport code lookup accepts lowercase and airport labels', () => {
  assert.equal(duration({...base,departureAirport:' khh ',arrivalAirport:'NRT 東京'}),205)
})
