import * as ui from '@zos/ui'
import * as interaction from '@zos/interaction'
import { Geolocation, Screen } from '@zos/sensor'
import { LocalStorage } from '@zos/storage'
import { setScrollLock } from '@zos/page'
import { setPageBrightTime, resetPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { Measurement, duration } from '../lib/measurement'
import { RESULTS_KEY, MAX_RESULTS, readResults, saveResult, deleteResults, dateLabel } from '../lib/results'

const CREAM = 0xeee6da
const MUTED = 0x69757b
const BUTTON = 0x15191b

Page({
  build() {
    this.widgets = []
    this.screenIndex = 0
    this.listOffset = 0
    this.selected = []
    this.editing = false
    this.destroyed = false
    this.running = false
    this.serial = 0
    this.lastSavedSignature = ''
    this.measurement = new Measurement()
    this.storage = new LocalStorage()
    try { this.records = readResults(this.storage.getItem(RESULTS_KEY)) }
    catch (_) { this.records = []; this.storageError = true }
    this.gps = new Geolocation()
    this.display = new Screen()
    this.onFix = () => {
      if (!this.running || this.destroyed) return
      if (!this.screenIsOn()) { this.stopMeasurement(); this.render(); return }
      try {
        if (this.gps.getStatus() === 'A') {
          this.measurement.sample(this.gps.getLatitude({ format: 'DD' }), this.gps.getLongitude({ format: 'DD' }), Date.now())
          this.gpsError = false
        } else this.measurement.loseFix()
      } catch (_) { this.gpsError = true; this.measurement.loseFix() }
      this.update()
    }
    this.onScreenChange = () => {
      if (this.destroyed) return
      if (!this.screenIsOn()) {
        this.stopMeasurement()
        this.cancelHold()
        this.stopLoading()
      } else this.render()
    }
    this.display.onChange(this.onScreenChange)
    setScrollLock({ lock: false })
    this.registerInput()
    this.appCleanup = () => this.dispose()
    getApp()._options.globalData.stopMeasurement = this.appCleanup
    this.startMeasurement()
    this.render()
  },
  screenIsOn() {
    try { return this.display.getStatus() === 1 } catch (_) { return false }
  },
  registerInput() {
    interaction.onGesture({ callback: event => {
      if (this.destroyed || !this.screenIsOn()) return false
      this.cancelHold()
      if (event === interaction.GESTURE_UP) return this.swipe(1)
      if (event === interaction.GESTURE_DOWN) return this.swipe(-1)
      if (event === interaction.GESTURE_RIGHT) { this.stopMeasurement(); this.render() }
      return false
    } })
    interaction.onKey({ callback: (key, event) => {
      if (this.destroyed) return false
      if (key === interaction.KEY_UP || key === interaction.KEY_DOWN) {
        if (event === interaction.KEY_EVENT_CLICK && this.screenIsOn()) this.navigate(key === interaction.KEY_DOWN ? 1 : -1)
        return true
      }
      if (key === interaction.KEY_BACK || key === interaction.KEY_HOME) {
        this.stopMeasurement()
        this.cancelHold()
        this.stopLoading()
        if (this.screenIsOn()) this.render()
      }
      return false
    } })
  },
  startMeasurement() {
    if (this.destroyed || !this.screenIsOn()) return
    this.stopMeasurement()
    this.measurement = new Measurement()
    this.measurement.tick(Date.now())
    this.sessionId = String(Date.now()) + '-' + (++this.serial)
    this.lastSavedSignature = ''
    this.gpsError = false
    this.running = true
    setPageBrightTime({ brightTime: 3600000 })
    pauseDropWristScreenOff({ duration: 0 })
    try {
      this.gpsSubscribed = true
      this.gps.onChange(this.onFix)
      this.gps.start()
    } catch (_) { this.gpsError = true }
    this.timer = setInterval(() => {
      if (!this.running || this.destroyed) return
      if (!this.screenIsOn()) { this.stopMeasurement(); return }
      this.measurement.tick(Date.now())
      this.update()
    }, 1000)
  },
  stopMeasurement() {
    this.touch = null
    if (this.running) this.measurement.tick(Date.now())
    this.running = false
    if (this.timer !== undefined && this.timer !== null) clearInterval(this.timer)
    this.timer = null
    if (this.gpsSubscribed) {
      try { this.gps.offChange(this.onFix) } catch (_) {}
      try { this.gps.stop() } catch (_) {}
      this.gpsSubscribed = false
    }
    if (this.measurement) {
      this.measurement.lastTick = null
      this.measurement.loseFix()
      this.measurement.speed = 0
    }
    this.stopLoading()
    resetDropWristScreenOff()
    resetPageBrightTime()
  },
  navigate(direction) {
    this.cancelHold()
    const next = (this.screenIndex + direction + 3) % 3
    if (next === this.screenIndex) return
    this.screenIndex = next
    this.editing = false
    this.selected = []
    if (next === 2) this.listOffset = 0
    this.render()
  },
  swipe(direction) {
    if (this.destroyed || !this.screenIsOn()) return true
    if (Date.now() < (this.suppressGestureUntil || 0)) return true
    if (this.screenIndex === 2 && this.records.length > 2) {
      const offset = this.touch ? this.touch.offset : this.readOffset()
      if (direction < 0 ? offset > 1 : offset < this.maxOffset() - 1) return false
    }
    this.touch = null
    this.navigate(direction)
    return true
  },
  maxOffset() { return Math.max(0, this.records.length * 136 - 12 - 260) },
  readOffset() {
    if (!this.list) return 0
    return Math.max(0, Math.min(this.maxOffset(), -this.list.getProperty(ui.prop.POS_Y)))
  },
  touchDown(e) {
    if (!e || !Number.isFinite(e.y) || this.destroyed || !this.screenIsOn()) return
    this.suppressGestureUntil = 0
    this.touch = { x: e.x, y: e.y, offset: this.readOffset(), moved: false }
  },
  touchMove(e) {
    if (!this.touch) return
    if (!e || Math.abs(e.y - this.touch.y) > 8 || Math.abs(e.x - this.touch.x) > 8) {
      this.touch.moved = true
      this.cancelHold()
    }
  },
  touchUp(e) {
    if (this.destroyed || !this.screenIsOn()) { this.touch = null; return false }
    const touch = this.touch
    if (!touch || !e || !Number.isFinite(e.y)) { this.touch = null; return false }
    const dy = e.y - touch.y, dx = e.x - touch.x
    const moved = touch.moved || Math.abs(dy) > 8 || Math.abs(dx) > 8
    if (Math.abs(dy) >= 28 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      this.swipe(dy < 0 ? 1 : -1)
      // One finger movement must not trigger both raw and system navigation.
      this.suppressGestureUntil = Date.now() + 350
    }
    this.touch = null
    return moved
  },
  bindTouch(w) {
    w.addEventListener(ui.event.CLICK_DOWN, e => this.touchDown(e))
    w.addEventListener(ui.event.MOVE, e => this.touchMove(e))
    w.addEventListener(ui.event.MOVE_OUT, e => this.touchMove(e))
    w.addEventListener(ui.event.CLICK_UP, e => this.touchUp(e))
  },
  add(type, options) {
    const w = ui.createWidget(type, options)
    this.widgets.push(w)
    this.bindTouch(w)
    return w
  },
  text(y, h, size, text, color = CREAM, x = 40, w = 400) {
    return this.add(ui.widget.TEXT, { x, y, w, h, text, text_size: size, color,
      align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V })
  },
  button(x, y, text, action) {
    return this.add(ui.widget.BUTTON, { x, y, w: 142, h: 52, radius: 26, text,
      text_size: 22, color: CREAM, normal_color: BUTTON, press_color: BUTTON,
      click_func: () => {
        if (!this.destroyed && this.screenIsOn() && !this.touch?.moved && Date.now() >= (this.suppressGestureUntil || 0)) action()
      } })
  },
  render() {
    if (this.destroyed) return
    this.cancelHold()
    this.stopLoading()
    this.widgets.forEach(w => ui.deleteWidget(w))
    this.widgets = []
    this.list = null
    this.scrollThumb = null
    this.add(ui.widget.FILL_RECT, { x: 0, y: 0, w: 480, h: 480, color: 0 })
    if (this.screenIndex === 0) {
      this.clock = this.text(72, 32, 26, '', MUTED)
      this.value = this.text(131, 180, 170, '')
      this.text(328, 35, 28, 'км/ч', MUTED)
      this.status = this.text(275, 24, 18, '', MUTED)
      this.startStop = this.button(169, 385, this.running ? 'Стоп' : 'Запуск', () => {
        if (this.running) this.stopMeasurement()
        else this.startMeasurement()
        this.startStop.setProperty(ui.prop.TEXT, this.running ? 'Стоп' : 'Запуск')
        this.update()
      })
    } else if (this.screenIndex === 1) {
      this.text(66, 26, 19, 'МАКСИМУМ · КМ/Ч', MUTED)
      this.maximum = this.text(94, 60, 48, '')
      this.text(174, 26, 19, 'РАССТОЯНИЕ · КМ', MUTED)
      this.distance = this.text(202, 57, 44, '')
      this.text(279, 26, 19, 'ВРЕМЯ', MUTED)
      this.elapsed = this.text(307, 45, 34, '')
      this.button(169, 385, 'Сохранить', () => this.saveSnapshot())
    } else this.renderResults()
    for (let i = 0; i < 3; i++) this.add(ui.widget.CIRCLE, {
      center_x: 454, center_y: 222 + i * 18, radius: 3,
      color: i === this.screenIndex ? CREAM : 0x353c40
    })
    this.update()
  },
  renderResults() {
    this.text(43, 30, 22, this.editing ? 'ВЫБРАТЬ' : 'РЕЗУЛЬТАТЫ', MUTED)
    if (this.storageError) { this.text(185, 80, 22, 'Ошибка чтения\nсохранённых данных'); return }
    if (!this.records.length) { this.text(185, 70, 23, 'Нет сохранённых\nрезультатов', MUTED); return }
    this.listOffset = Math.min(this.listOffset, this.maxOffset())
    this.list = this.add(ui.widget.VIEW_CONTAINER, {
      x: 66, y: 100, w: 348, h: 260, scroll_enable: 1, bounce: 0,
      scroll_frame_func: () => {
        if (this.destroyed || this.screenIndex !== 2 || !this.screenIsOn()) return
        this.cancelHold()
        this.listOffset = this.readOffset()
        this.updateScrollbar()
      },
      scroll_complete_func: () => {
        if (this.destroyed || this.screenIndex !== 2) return
        this.listOffset = this.readOffset()
        this.updateScrollbar()
      }
    })
    this.records.forEach((r, index) => {
      const y = index * 136
      const chosen = this.selected.indexOf(r.id) >= 0
      const card = (type, props) => {
        const w = this.list.createWidget(type, props)
        this.bindCard(w, r.id)
      }
      card(ui.widget.FILL_RECT, { x: 0, y, w: 348, h: 124, radius: 18, color: chosen ? 0x303638 : BUTTON })
      const label = (offset, h, size, text, color) => card(ui.widget.TEXT, {
        x: 10, y: y + offset, w: 328, h, text_size: size, text, color,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V
      })
      label(10, 26, 20, dateLabel(r.savedAt), CREAM)
      label(40, 30, 22, 'Макс. ' + Math.round(r.max) + ' км/ч  ·  ' + (r.distance / 1000).toFixed(2) + ' км', CREAM)
      label(78, 26, 22, duration(r.elapsed), MUTED)
    })
    this.list.setProperty(ui.prop.POS_Y, -this.listOffset)
    if (this.records.length > 2) {
      this.add(ui.widget.FILL_RECT, { x: 426, y: 140, w: 3, h: 180, radius: 1, color: 0x252c30 })
      this.scrollThumb = this.add(ui.widget.FILL_RECT, { x: 426, y: 140, w: 3,
        h: Math.max(18, Math.round(180 * 260 / (this.maxOffset() + 260))), radius: 1, color: MUTED })
      this.updateScrollbar()
    }
    if (this.editing) {
      this.button(90, 382, 'Удалить', () => this.removeSelected())
      this.button(248, 382, 'Готово', () => { this.editing = false; this.selected = []; this.render() })
    } else this.text(390, 27, 18, 'Сохранено: ' + this.records.length + ' / 20', MUTED)
  },
  updateScrollbar() {
    if (!this.scrollThumb) return
    const h = Math.max(18, Math.round(180 * 260 / (this.maxOffset() + 260)))
    this.scrollThumb.setProperty(ui.prop.Y, 140 + Math.round((180 - h) * this.readOffset() / this.maxOffset()))
  },
  bindCard(w, id) {
    w.addEventListener(ui.event.CLICK_DOWN, e => {
      this.touchDown(e)
      this.cancelHold()
      this.pressedId = id
      this.holdTriggered = false
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null
        if (this.destroyed || this.pressedId !== id || !this.screenIsOn()) return
        this.holdTriggered = true
        this.editing = true
        if (this.selected.indexOf(id) < 0) this.selected.push(id)
        this.render()
      }, 650)
    })
    w.addEventListener(ui.event.MOVE, e => { this.touchMove(e); this.cancelHold() })
    w.addEventListener(ui.event.MOVE_OUT, e => { this.touchMove(e); this.cancelHold() })
    w.addEventListener(ui.event.CLICK_UP, e => {
      const tap = this.pressedId === id && !this.holdTriggered
      const moved = this.touchUp(e)
      this.cancelHold()
      if (tap && !moved && this.editing) {
        this.selected = this.selected.indexOf(id) >= 0 ? this.selected.filter(x => x !== id) : this.selected.concat([id])
        this.render()
      }
    })
  },
  cancelHold() {
    if (this.holdTimer !== undefined && this.holdTimer !== null) clearTimeout(this.holdTimer)
    this.holdTimer = null
    this.pressedId = null
  },
  saveSnapshot() {
    if (this.destroyed || !this.screenIsOn()) return
    if (this.storageError) { this.toast('Ошибка чтения данных'); return }
    if (this.running) this.measurement.tick(Date.now())
    const snapshot = this.measurement.snapshot()
    const signature = this.sessionId + ':' + JSON.stringify(snapshot)
    if (signature === this.lastSavedSignature) { this.toast('Этот результат уже сохранён'); return }
    if (this.records.length >= MAX_RESULTS) { this.toast('Лимит 20. Удалите старый результат'); this.screenIndex = 2; this.render(); return }
    try {
      const result = saveResult(this.storage, this.records, { ...snapshot, savedAt: Date.now(), id: String(Date.now()) + '-' + (++this.serial) })
      if (!result.ok) { this.toast('Не удалось сохранить'); return }
      this.records = result.records
      this.lastSavedSignature = signature
      this.toast('Сохранено')
    } catch (_) { this.toast('Ошибка сохранения'); return }
    this.update()
  },
  removeSelected() {
    if (!this.selected.length) { this.toast('Выберите карточки'); return }
    try {
      this.records = deleteResults(this.storage, this.records, this.selected)
      this.selected = []
      this.lastSavedSignature = ''
      if (!this.records.length) this.editing = false
      this.render()
    } catch (_) { this.toast('Ошибка удаления') }
  },
  toast(content) { interaction.showToast({ content }) },
  update() {
    if (this.destroyed) return
    if (this.screenIndex === 0) {
      const d = new Date(), minutes = d.getMinutes()
      this.clock.setProperty(ui.prop.TEXT, d.getHours() + ':' + (minutes < 10 ? '0' : '') + minutes)
      const loading = this.running && this.measurement.speed === null
      this.value.setProperty(ui.prop.TEXT, loading ? '' : String(Math.round(this.measurement.speed || 0)))
      if (loading && this.screenIsOn()) this.startLoading()
      else this.stopLoading()
      this.status.setProperty(ui.prop.TEXT, !this.running ? '' : this.gpsError ? 'GPS недоступен' :
        !this.measurement.ready ? 'Поиск GPS…' : loading ? 'Измерение…' : '')
    } else if (this.screenIndex === 1) {
      this.maximum.setProperty(ui.prop.TEXT, String(Math.round(this.measurement.max)))
      this.distance.setProperty(ui.prop.TEXT, (this.measurement.distance / 1000).toFixed(2))
      this.elapsed.setProperty(ui.prop.TEXT, duration(this.measurement.elapsed))
    }
  },
  startLoading() {
    if (this.loading) return
    this.loading = this.add(ui.widget.IMG_ANIM, { x: 176, y: 181,
      anim_path: 'gps-loading', anim_prefix: 'loading', anim_ext: 'png',
      anim_fps: 40, anim_size: 48, repeat_count: 0, anim_status: ui.anim_status.START })
  },
  stopLoading() {
    if (!this.loading) return
    this.loading.setProperty(ui.prop.ANIM_STATUS, ui.anim_status.STOP)
    ui.deleteWidget(this.loading)
    this.widgets = this.widgets.filter(w => w !== this.loading)
    this.loading = null
  },
  dispose() {
    if (this.destroyed) return
    this.destroyed = true
    this.stopMeasurement()
    this.cancelHold()
    try { this.display.offChange(this.onScreenChange) } catch (_) {}
    interaction.offGesture()
    interaction.offKey()
    const global = getApp()._options.globalData
    if (global.stopMeasurement === this.appCleanup) global.stopMeasurement = null
  },
  onDestroy() { this.dispose() }
})
