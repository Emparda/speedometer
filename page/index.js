import * as ui from '@zos/ui'
import { Geolocation } from '@zos/sensor'
import { LocalStorage } from '@zos/storage'
import { setScrollLock } from '@zos/page'
import { setPageBrightTime, resetPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { Trip, duration } from '../lib/trip'

const CREAM = 0xeee6da
const MUTED = 0x69757b
const STORE_KEY = 'speedometer.trip.v1'

Page({
  build() {
    this.storage = new LocalStorage()
    let saved = null
    try { saved = this.storage.getItem(STORE_KEY) } catch (_) {}
    this.trip = new Trip(saved)
    this.widgets = []
    this.screen = 'speed'
    this.resetUntil = 0
    this.lastSave = Date.now()
    this.trip.tick(this.lastSave)
    this.gpsError = false
    setScrollLock({ lock: true })
    setPageBrightTime({ brightTime: 3600000 })
    pauseDropWristScreenOff({ duration: 0 })
    this.render()
    this.gps = new Geolocation()
    this.onFix = () => {
      try {
        if (this.gps.getStatus() === 'A') {
          this.trip.sample(this.gps.getLatitude({ format: 'DD' }), this.gps.getLongitude({ format: 'DD' }), Date.now())
          this.gpsError = false
        } else this.trip.loseFix()
      } catch (_) { this.gpsError = true; this.trip.loseFix() }
      this.update()
    }
    try { this.gps.onChange(this.onFix); this.gps.start() } catch (_) { this.gpsError = true }
    this.timer = setInterval(() => {
      const now = Date.now()
      this.trip.tick(now)
      if (this.resetUntil && now > this.resetUntil) {
        this.resetUntil = 0
        if (this.screen === 'trip') this.render()
      }
      if (now - this.lastSave >= 10000) { this.save(); this.lastSave = now }
      this.update()
    }, 1000)
    this.update()
  },
  add(type, options) {
    const w = ui.createWidget(type, options)
    this.widgets.push(w)
    return w
  },
  text(y, h, size, text, color = CREAM, x = 40, w = 400) {
    return this.add(ui.widget.TEXT, { x, y, w, h, text, text_size: size, color,
      align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V })
  },
  button(x, y, w, text, action) {
    return this.add(ui.widget.BUTTON, { x, y, w, h: 52, radius: 26, text,
      text_size: 22, color: CREAM, normal_color: 0x15191b, press_color: 0x303638, click_func: action })
  },
  render() {
    this.widgets.forEach(w => ui.deleteWidget(w))
    this.widgets = []
    this.add(ui.widget.FILL_RECT, { x: 0, y: 0, w: 480, h: 480, color: 0 })
    if (this.screen === 'speed') {
      this.clock = this.text(72, 32, 26, '', MUTED)
      this.value = this.text(131, 180, 170, '—')
      this.value.addEventListener(ui.event.CLICK_UP, () => { this.screen = 'trip'; this.render() })
      this.text(348, 40, 28, 'км/ч', MUTED)
      this.status = this.text(401, 27, 19, '', MUTED)
      this.status.addEventListener(ui.event.CLICK_UP, () => { this.screen = 'trip'; this.render() })
    } else {
      this.text(51, 35, 24, 'ПОЕЗДКА', MUTED)
      this.text(101, 25, 19, 'МАКСИМУМ · КМ/Ч', MUTED)
      this.maximum = this.text(126, 61, 48, '')
      this.text(200, 24, 19, 'РАССТОЯНИЕ · КМ', MUTED)
      this.distance = this.text(225, 58, 44, '')
      this.text(293, 24, 19, 'ВРЕМЯ ПОЕЗДКИ', MUTED)
      this.elapsed = this.text(318, 45, 34, '')
      this.button(90, 372, 142, 'Назад', () => { this.resetUntil = 0; this.screen = 'speed'; this.render() })
      this.button(248, 372, 142, this.resetUntil ? 'Точно?' : 'Сброс', () => {
        if (this.resetUntil && Date.now() <= this.resetUntil) {
          this.trip = new Trip()
          this.trip.tick(Date.now())
          this.resetUntil = 0
          this.save()
        } else this.resetUntil = Date.now() + 4000
        this.render()
      })
    }
    this.update()
  },
  update() {
    if (this.screen === 'speed') {
      const d = new Date()
      const minutes = d.getMinutes()
      this.clock.setProperty(ui.prop.TEXT, d.getHours() + ':' + (minutes < 10 ? '0' : '') + minutes)
      this.value.setProperty(ui.prop.TEXT, this.trip.speed === null ? '—' : String(Math.round(this.trip.speed)))
      this.status.setProperty(ui.prop.TEXT, this.gpsError ? 'GPS недоступен' : !this.trip.ready ? 'Поиск GPS…' : this.trip.speed === null ? 'Измерение…' : 'Поездка  ›')
    } else {
      this.maximum.setProperty(ui.prop.TEXT, String(Math.round(this.trip.max)))
      this.distance.setProperty(ui.prop.TEXT, (this.trip.distance / 1000).toFixed(2))
      this.elapsed.setProperty(ui.prop.TEXT, duration(this.trip.elapsed))
    }
  },
  save() {
    try { this.storage.setItem(STORE_KEY, this.trip.snapshot()) } catch (_) {}
  },
  onDestroy() {
    if (this.timer) clearInterval(this.timer)
    if (this.gps) {
      try { this.gps.offChange(this.onFix); this.gps.stop() } catch (_) {}
    }
    if (this.trip) { this.trip.tick(Date.now()); this.save() }
    resetDropWristScreenOff()
    resetPageBrightTime()
  }
})
