import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../lib/measurement.js', import.meta.url), 'utf8')
const { Measurement, metersBetween, duration } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const lngForMeters = m => m / 6371000 * 180 / Math.PI

test('constant 36 km/h: speed, maximum and distance', () => {
  const t = new Measurement()
  for (let i = 0; i <= 30; i++) t.sample(0, lngForMeters(i * 10), 1000 + i * 1000)
  assert.ok(Math.abs(t.speed - 36) < 0.001)
  assert.ok(Math.abs(t.max - 36) < 0.001)
  assert.ok(Math.abs(t.distance - 300) < 0.001)
})
test('stationary coordinates and small drift do not accumulate distance', () => {
  const t = new Measurement()
  for (let i = 0; i < 30; i++) t.sample(0, lngForMeters(i % 2), 1000 + i * 1000)
  assert.equal(t.distance, 0)
  assert.equal(t.speed, 0)
})
test('GPS loss clears speed and does not bridge missing route', () => {
  const t = new Measurement()
  t.sample(0, 0, 1000); t.sample(0, lngForMeters(30), 4000)
  t.tick(10000)
  assert.equal(t.speed, null)
  t.sample(0, 1, 11000); t.sample(0, 1, 14000)
  assert.ok(Math.abs(t.distance - 30) < 0.001)
})
test('gross GPS jump rejected; out-of-range fix rejected', () => {
  const t = new Measurement()
  t.sample(0, 0, 1000); t.sample(0, 1, 4000)
  assert.equal(t.distance, 0); assert.equal(t.speed, null)
  t.sample(100, 0, 5000); assert.equal(t.ready, false)
})
test('time includes foreground stops, excludes suspension and reopening gap', () => {
  const t = new Measurement()
  t.tick(1000); t.tick(2000); t.tick(3000); t.tick(20000)
  assert.equal(t.elapsed, 2000)
  const restored = new Measurement(t.snapshot())
  restored.tick(100000); restored.tick(101000)
  assert.equal(restored.elapsed, 3000)
  assert.equal(restored.speed, null)
})
test('invalid storage, reset and time formatting', () => {
  const t = new Measurement({ max: NaN, distance: -1, elapsed: 'broken' })
  assert.deepEqual(t.snapshot(), { max: 0, distance: 0, elapsed: 0 })
  assert.equal(duration(3661000), '01:01:01')
  assert.ok(metersBetween({ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 }) < 223)
})
