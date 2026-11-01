import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../page/index.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
const tripSource = readFileSync(new URL('../lib/trip.js', import.meta.url), 'utf8')
const { Trip, duration } = await import('data:text/javascript;base64,' + Buffer.from(tripSource).toString('base64'))

function harness() {
  let page, now = 1000, timer, stopped = false, unsubscribed = false, cleared = false
  const data = new Map()
  const widgets = []
  const enumProxy = new Proxy({}, { get: (_, key) => key })
  const ui = { widget: enumProxy, align: enumProxy, prop: enumProxy, event: enumProxy,
    createWidget(type, props) {
      const w = { type, ...props, events: {}, setProperty(k, v) { this[k === 'TEXT' ? 'text' : k] = v }, addEventListener(k, v) { this.events[k] = v } }
      widgets.push(w); return w
    }, deleteWidget(w) { widgets.splice(widgets.indexOf(w), 1) } }
  class GPS { onChange(cb) { this.callback = cb } start() {} stop() { stopped = true } offChange(cb) { unsubscribed = cb === this.callback } getStatus() { return 'A' } getLatitude() { return 0 } getLongitude() { return (now - 1000) / 1000 * 10 / 6371000 * 180 / Math.PI } }
  class Storage { getItem(k) { return data.get(k) } setItem(k, v) { data.set(k, v) } }
  class Clock extends Date { constructor() { super(now) } static now() { return now } }
  const nop = () => {}
  vm.runInNewContext(source, { ui, Trip, duration, Date: Clock, LocalStorage: Storage, Geolocation: GPS,
    Page(p) { page = p }, setScrollLock: nop, setPageBrightTime: nop, resetPageBrightTime: nop,
    pauseDropWristScreenOff: nop, resetDropWristScreenOff: nop,
    setInterval(cb) { timer = cb; return 1 }, clearInterval() { cleared = true } })
  page.build()
  return { page, widgets, data, advance(t) { now = t; timer() }, cleanup() { return stopped && unsubscribed && cleared } }
}

test('screen navigation, GPS update, two-tap reset, cleanup and persistence', () => {
  const h = harness(), p = h.page
  assert.equal(p.value.text, '—')
  p.onFix(); h.advance(4000); p.onFix()
  assert.equal(p.value.text, '36')
  p.value.events.CLICK_UP()
  assert.equal(p.maximum.text, '36')
  assert.equal(p.distance.text, '0.03')
  h.widgets.find(w => w.text === 'Сброс').click_func()
  assert.ok(p.trip.distance > 0)
  h.widgets.find(w => w.text === 'Точно?').click_func()
  assert.equal(p.trip.distance, 0)
  assert.equal(p.maximum.text, '0')
  p.onDestroy()
  assert.ok(h.cleanup())
  assert.equal(h.data.get('speedometer.trip.v1').distance, 0)
})
test('reset confirmation expires without deleting the trip', () => {
  const h = harness(), p = h.page
  p.onFix(); h.advance(4000); p.onFix(); p.value.events.CLICK_UP()
  h.widgets.find(w => w.text === 'Сброс').click_func()
  h.advance(9000)
  assert.ok(h.widgets.some(w => w.text === 'Сброс'))
  assert.ok(p.trip.distance > 0)
  p.onDestroy()
})
