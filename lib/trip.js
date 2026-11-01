// Pure calculation module. Coordinates are WGS-84 decimal degrees.
export function metersBetween(a, b) {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLon = (b.lon - a.lon) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}
export function duration(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const pad = n => n < 10 ? '0' + n : '' + n
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60)
}
export class Trip {
  constructor(saved) {
    const safe = n => typeof n === 'number' && isFinite(n) && n >= 0 ? n : 0
    this.distance = safe(saved && saved.distance)
    this.max = safe(saved && saved.max)
    this.elapsed = safe(saved && saved.elapsed)
    this.speed = null
    this.lastTick = null
    this.lastFix = null
    this.anchor = null
    this.ready = false
  }
  tick(now) {
    // Count foreground time only. Do not count OS suspension as a recorded trip.
    if (this.lastTick !== null) {
      const dt = now - this.lastTick
      if (dt > 0 && dt <= 5000) this.elapsed += dt
    }
    this.lastTick = now
    if (this.lastFix !== null && now - this.lastFix > 5000) this.loseFix()
  }
  loseFix() {
    this.speed = null
    this.anchor = null
    this.lastFix = null
    this.ready = false
  }
  sample(lat, lon, now) {
    if (![lat, lon, now].every(n => typeof n === 'number' && isFinite(n)) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      this.loseFix()
      return
    }
    const point = { lat, lon, time: now }
    if (this.lastFix !== null && (now <= this.lastFix || now - this.lastFix > 5000)) this.loseFix()
    this.lastFix = now
    this.ready = true
    if (!this.anchor) { this.anchor = point; return }
    const seconds = (now - this.anchor.time) / 1000
    if (seconds < 3) return
    const distance = metersBetween(this.anchor, point)
    this.anchor = point
    const mps = distance / seconds
    // Reject gross jumps. Ordinary GPS drift still needs an outdoor device test.
    if (mps > 100) { this.loseFix(); return }
    const kmh = mps < 1 ? 0 : mps * 3.6
    this.speed = this.speed === null ? kmh : this.speed * 0.25 + kmh * 0.75
    if (kmh === 0) this.speed = 0
    if (kmh > 0) this.distance += distance
    this.max = Math.max(this.max, this.speed)
  }
  snapshot() { return { distance: this.distance, max: this.max, elapsed: this.elapsed } }
}
