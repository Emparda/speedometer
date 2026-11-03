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
const SCROLL_ARC_START = 150
const SCROLL_ARC_END = 210

Page({
  build() {
    this.scenes = {}
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
      if (!this.isForeground()) { this.stopMeasurement(); this.render(); return }
      try {
        if (this.gps.getStatus() === 'A') {
          this.measurement.sample(this.gps.getLatitude({ format: 'DD' }), this.gps.getLongitude({ format: 'DD' }), Date.now())
          this.gpsError = false
        } else this.measurement.loseFix()
      } catch (_) { this.gpsError = true; this.measurement.loseFix() }
      this.update()
    }
    this.onScreenChange = () => {
      if (this.destroyed || this.exiting) return
      if (!this.isForeground()) {
        this.stopMeasurement()
        this.cancelHold()
        this.stopLoading()
      } else this.render()
    }
    this.display.onChange(this.onScreenChange)
    setScrollLock({ lock: this.screenIndex !== 2 || this.records.length === 0 })
    this.registerInput()
    this.appCleanup = () => this.dispose()
    getApp()._options.globalData.stopMeasurement = this.appCleanup
    this.startMeasurement()
    this.render()
  },
  isForeground() {
    if (this.exiting || this.destroyed) return false
    try { return this.display.getStatus() === 1 } catch (_) { return false }
  },
  registerInput() {
    interaction.onGesture({ callback: event => {
      if (this.destroyed || !this.isForeground()) return false
      this.cancelHold()
      if (event === interaction.GESTURE_UP) return this.swipe(1)
      if (event === interaction.GESTURE_DOWN) return this.swipe(-1)
      if (event === interaction.GESTURE_RIGHT) this.beginExit()
      return false
    } })
    interaction.onKey({ callback: (key, event) => {
      if (this.destroyed) return false
      if (key === interaction.KEY_UP || key === interaction.KEY_DOWN) {
        if (event === interaction.KEY_EVENT_CLICK && this.isForeground()) this.navigate(key === interaction.KEY_DOWN ? 1 : -1)
        return true
      }
      if (key === interaction.KEY_BACK || key === interaction.KEY_HOME) {
        this.beginExit()
      }
      return false
    } })
  },
  startMeasurement() {
    if (this.destroyed || !this.isForeground()) return
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
      if (!this.isForeground()) { this.stopMeasurement(); return }
      this.measurement.tick(Date.now())
      this.update()
    }, 1000)
  },
  stopMeasurement() {
    this.touch = null
    this.cancelTransition()
    Object.keys(this.scenes).forEach(index => this.hideScrollbar(this.scenes[index]))
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
    if (!this.isForeground()) {
      this.destroyIndicator()
      Object.keys(this.scenes).forEach(index => this.destroyScene(index))
      this.adoptScene()
    }
  },
  navigate(direction) {
    if (this.destroyed || !this.isForeground()) return
    this.touch = null
    this.cancelHold()
    if (this.slideTimer) return
    this.prepareSlide(direction)
    this.finishSlide(true)
  },
  prepareSlide(direction) {
    if (this.slide && this.slide.direction === direction) return
    this.cancelTransition()
    this.hideScrollbar(this.scenes[2])
    setScrollLock({ lock: true })
    const next = (this.screenIndex + direction + 3) % 3
    this.createScene(next, direction * 480)
    this.slide = { from: this.screenIndex, next, direction, offset: 0 }
  },
  paintSlide(offset) {
    if (!this.slide) return
    this.slide.offset = offset
    this.moveScene(this.scenes[this.slide.from], offset)
    this.moveScene(this.scenes[this.slide.next], offset + this.slide.direction * 480)
  },
  finishSlide(commit) {
    const slide = this.slide
    if (!slide || this.slideTimer) return
    this.touch = null
    this.suppressGestureUntil = Date.now() + 350
    const start = Date.now(), from = slide.offset, target = commit ? -slide.direction * 480 : 0
    this.slideTimer = setInterval(() => {
      if (this.destroyed || !this.isForeground()) { this.cancelTransition(); return }
      const t = Math.min(1, (Date.now() - start) / 180)
      this.paintSlide(Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3))))
      if (t < 1) return
      clearInterval(this.slideTimer)
      this.slideTimer = null
      this.slide = null
      if (commit) {
        this.screenIndex = slide.next
        this.destroyScene(slide.from)
        if (slide.from === 2) { this.editing = false; this.selected = [] }
      } else this.destroyScene(slide.next)
      this.moveScene(this.scenes[this.screenIndex], 0)
      this.adoptScene()
      setScrollLock({ lock: this.screenIndex !== 2 || this.records.length === 0 })
      this.update()
    }, 20)
  },
  cancelTransition() {
    if (this.slideTimer != null) clearInterval(this.slideTimer)
    this.slideTimer = null
    if (this.slide) {
      const slide = this.slide
      this.slide = null
      this.destroyScene(slide.next)
      this.moveScene(this.scenes[slide.from], 0)
    }
    setScrollLock({ lock: this.screenIndex !== 2 || this.records.length === 0 })
  },
  moveScene(scene, offset) {
    if (!scene) return
    scene.offset = offset
    scene.widgets.forEach(entry => entry.w.setProperty(entry.prop, entry.y + offset))
  },
  destroyScene(index) {
    const scene = this.scenes[index]
    if (!scene) return
    this.hideScrollbar(scene)
    this.stopLoading(scene)
    scene.widgets.forEach(entry => ui.deleteWidget(entry.w))
    delete this.scenes[index]
  },
  adoptScene() {
    if (this.indicatorDots) this.indicatorDots.forEach((w, i) => w.setProperty(ui.prop.COLOR, i === this.screenIndex ? CREAM : 0x353c40))
    const scene = this.scenes[this.screenIndex]
    // Public references also keep the lifecycle/UI harness straightforward.
    for (const key of ['clock','value','status','startStop','maximum','distance','elapsed','list','scrollThumb','loading']) {
      this[key] = scene?.[key] || null
    }
  },
  swipe(direction) {
    if (this.destroyed || !this.isForeground()) return true
    if (this.slideTimer) return true
    if (this.touch?.zone === 'list') return true
    if (Date.now() < (this.suppressGestureUntil || 0)) return true
    if (this.slide) { this.finishSlide(Math.abs(this.slide.offset) >= 28); return true }
    if (this.touch?.zone === 'page') {
      this.prepareSlide(direction)
      this.finishSlide(true)
      return true
    }
    // A direction-only event has no origin. Never let it escape the list.
    if (this.screenIndex === 2 && this.records.length > 0) return true
    this.navigate(direction)
    return true
  },
  maxOffset() { return Math.max(0, this.records.length * 136 - 12 - 260) },
  readOffset(scene = this.scenes[2]) {
    if (!scene?.list) return this.listOffset
    return Math.max(0, Math.min(this.maxOffset(), -scene.list.getProperty(ui.prop.POS_Y)))
  },
  touchDown(e, zone = 'page') {
    if (!e || !Number.isFinite(e.y) || this.destroyed || !this.isForeground() || this.slideTimer) return
    if (this.touch) return
    this.suppressGestureUntil = 0
    if (this.screenIndex === 2 && this.records.length > 0 && e.y >= 100 && e.y < 360) zone = 'list'
    this.lastTouchZone = zone
    this.touch = { x: e.x, y: e.y, zone, moved: false }
  },
  touchMove(e) {
    const touch = this.touch
    if (!touch || !e || this.destroyed || !this.isForeground()) return
    const dy = e.y - touch.y, dx = e.x - touch.x
    if (Math.abs(dy) > 8 || Math.abs(dx) > 8) {
      touch.moved = true
      this.cancelHold()
    }
    if (touch.zone === 'list' && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) this.showScrollbar(this.scenes[2])
    if (touch.zone === 'list' || Math.abs(dy) <= 8 || Math.abs(dy) <= Math.abs(dx) * 1.2) return
    this.prepareSlide(dy < 0 ? 1 : -1)
    this.paintSlide(Math.max(-480, Math.min(480, dy)))
  },
  touchUp(e) {
    if (this.destroyed || !this.isForeground()) { this.touch = null; return false }
    const touch = this.touch
    if (!touch) return false
    if (e && Number.isFinite(e.y)) this.touchMove(e)
    const dy = e && Number.isFinite(e.y) ? e.y - touch.y : 0
    const dx = e && Number.isFinite(e.x) ? e.x - touch.x : 0
    const moved = touch.moved
    this.touch = null
    this.lastTouchZone = touch.zone
    if (moved) this.suppressGestureUntil = Date.now() + 350
    if (touch.zone === 'page' && this.slide) this.finishSlide(Math.abs(dy) >= 28 && Math.abs(dy) > Math.abs(dx) * 1.2)
    return moved
  },
  bindTouch(w, zone = 'page') {
    w.addEventListener(ui.event.CLICK_DOWN, e => this.touchDown(e, zone))
    w.addEventListener(ui.event.MOVE, e => this.touchMove(e))
    w.addEventListener(ui.event.MOVE_OUT, e => this.touchMove(e))
    w.addEventListener(ui.event.CLICK_UP, e => this.touchUp(e))
  },
  add(type, options, scene = this.buildingScene || this.scenes[this.screenIndex], zone = 'page') {
    const isCircle = type === ui.widget.CIRCLE
    const field = isCircle ? 'center_y' : 'y'
    const y = options[field] || 0
    const w = ui.createWidget(type, { ...options, [field]: y + scene.offset })
    scene.widgets.push({ w, y, prop: isCircle ? ui.prop.CENTER_Y : ui.prop.Y })
    // Decorative arcs have full-screen bounding boxes: let touches pass through.
    if (type === ui.widget.ARC) w.setEnable(false)
    else this.bindTouch(w, zone)
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
        if (!this.destroyed && !this.slide && this.isForeground() && !this.touch?.moved && Date.now() >= (this.suppressGestureUntil || 0)) action()
      } })
  },
  render() {
    if (this.destroyed || !this.isForeground()) return
    this.touch = null
    this.cancelHold()
    this.cancelTransition()
    Object.keys(this.scenes).forEach(index => this.destroyScene(index))
    this.createScene(this.screenIndex, 0)
    this.adoptScene()
  },
  createScene(index, offset) {
    const scene = { index, offset, widgets: [] }
    this.scenes[index] = scene
    this.buildingScene = scene
    this.add(ui.widget.FILL_RECT, { x: 0, y: 0, w: 480, h: 480, color: 0 })
    if (scene.index === 0) {
      scene.clock = this.text(72, 32, 26, '', MUTED)
      scene.value = this.text(131, 180, 170, '')
      this.text(328, 35, 28, 'км/ч', MUTED)
      scene.status = this.text(275, 24, 18, '', MUTED)
      scene.startStop = this.button(169, 385, this.running ? 'Стоп' : 'Запуск', () => {
        if (this.running) this.stopMeasurement()
        else this.startMeasurement()
        scene.startStop.setProperty(ui.prop.TEXT, this.running ? 'Стоп' : 'Запуск')
        this.update()
      })
    } else if (scene.index === 1) {
      this.text(66, 26, 19, 'МАКСИМУМ · КМ/Ч', MUTED)
      scene.maximum = this.text(94, 60, 48, '')
      this.text(174, 26, 19, 'РАССТОЯНИЕ · КМ', MUTED)
      scene.distance = this.text(202, 57, 44, '')
      this.text(279, 26, 19, 'ВРЕМЯ', MUTED)
      scene.elapsed = this.text(307, 45, 34, '')
      this.button(169, 385, 'Сохранить', () => this.saveSnapshot())
    } else this.renderResults(scene)
    this.buildingScene = null
    this.updateScene(scene)
    this.ensureIndicator()
    return scene
  },
  ensureIndicator() {
    if (this.indicator || !this.isForeground()) return
    this.indicator = ui.createWidget(ui.widget.VIEW_CONTAINER, {
      x: 446, y: 210, w: 16, h: 60, z_index: 10, modal: 0, scroll_enable: 0
    })
    this.indicator.setEnable(false)
    this.indicatorDots = []
    for (let i = 0; i < 3; i++) {
      const w = this.indicator.createWidget(ui.widget.CIRCLE, {
        center_x: 8, center_y: 12 + i * 18, radius: 3,
        color: i === this.screenIndex ? CREAM : 0x353c40
      })
      w.setEnable(false)
      this.indicatorDots.push(w)
    }
  },
  destroyIndicator() {
    if (this.indicator) ui.deleteWidget(this.indicator)
    this.indicator = null
    this.indicatorDots = null
  },
  renderResults(scene) {
    this.text(43, 30, 22, this.editing ? 'ВЫБРАТЬ' : 'РЕЗУЛЬТАТЫ', MUTED)
    if (this.storageError) { this.text(185, 80, 22, 'Ошибка чтения\nсохранённых данных'); return }
    if (!this.records.length) { this.text(185, 70, 23, 'Нет сохранённых\nрезультатов', MUTED); return }
    this.listOffset = Math.min(this.listOffset, this.maxOffset())
    scene.list = this.add(ui.widget.VIEW_CONTAINER, {
      x: 66, y: 100, w: 348, h: 260, scroll_enable: 1, bounce: 0,
      scroll_frame_func: () => {
        if (this.destroyed || this.scenes[2] !== scene || this.slide || this.screenIndex !== 2 || !this.isForeground()) return
        this.cancelHold()
        const previous = this.listOffset
        this.listOffset = this.readOffset(scene)
        this.updateScrollbar(scene)
        if (this.listOffset !== previous) this.showScrollbar(scene)
      },
      scroll_complete_func: () => {
        if (this.destroyed || this.scenes[2] !== scene || this.slide || this.screenIndex !== 2 || !this.isForeground()) return
        this.listOffset = this.readOffset(scene)
        this.updateScrollbar(scene)
        if (scene.scrollVisible) this.showScrollbar(scene)
      }
    }, scene, 'list')
    this.records.forEach((r, index) => {
      const y = index * 136
      const chosen = this.selected.indexOf(r.id) >= 0
      const card = (type, props) => {
        const w = scene.list.createWidget(type, props)
        this.bindCard(w, r.id)
      }
      card(ui.widget.FILL_RECT, { x: 0, y, w: 348, h: 124, radius: 18, color: chosen ? 0x303638 : BUTTON })
      const label = (offset, h, size, text, color) => card(ui.widget.TEXT, {
        x: 10, y: y + offset, w: 328, h, text_size: size, text, color,
        align_h: ui.align.CENTER_H, align_v: ui.align.CENTER_V
      })
      label(15, 26, 20, dateLabel(r.savedAt), CREAM)
      label(47, 30, 22, 'Макс. ' + Math.round(r.max) + ' км/ч  ·  ' + (r.distance / 1000).toFixed(2) + ' км', CREAM)
      label(83, 26, 22, duration(r.elapsed), MUTED)
    })
    scene.list.setProperty(ui.prop.POS_Y, -this.listOffset)
    if (this.records.length > 2) {
      const arc = { x: 16, y: 6, w: 448, h: 448, radius: 224, line_width: 3 }
      scene.scrollTrack = this.add(ui.widget.ARC, { ...arc, start_angle: SCROLL_ARC_START, end_angle: SCROLL_ARC_END, color: 0x171d20 })
      scene.scrollThumb = this.add(ui.widget.ARC, { ...arc, start_angle: SCROLL_ARC_START, end_angle: SCROLL_ARC_END, color: 0x465056 })
      this.updateScrollbar(scene)
      this.hideScrollbar(scene)
    }
    if (this.editing) {
      this.button(90, 382, 'Удалить', () => this.removeSelected())
      this.button(248, 382, 'Готово', () => { this.editing = false; this.selected = []; this.render() })
    } else this.text(390, 27, 18, 'Сохранено: ' + this.records.length + ' / 20', MUTED)
  },
  updateScrollbar(scene) {
    if (!scene.scrollThumb) return
    const sweep = SCROLL_ARC_END - SCROLL_ARC_START
    const span = Math.max(5, sweep * 260 / (this.maxOffset() + 260))
    const end = SCROLL_ARC_END - (sweep - span) * this.readOffset(scene) / this.maxOffset()
    scene.scrollThumb.setProperty(ui.prop.MORE, { start_angle: end - span, end_angle: end })
  },
  hideScrollbar(scene) {
    if (!scene) return
    if (scene.scrollHideTimer != null) clearTimeout(scene.scrollHideTimer)
    scene.scrollHideTimer = null
    scene.scrollVisible = false
    if (scene.scrollTrack) scene.scrollTrack.setProperty(ui.prop.VISIBLE, false)
    if (scene.scrollThumb) scene.scrollThumb.setProperty(ui.prop.VISIBLE, false)
  },
  showScrollbar(scene) {
    if (!scene?.scrollThumb || this.records.length <= 2 || this.scenes[2] !== scene ||
      this.screenIndex !== 2 || this.slide || !this.isForeground()) return
    if (!scene.scrollVisible) {
      scene.scrollTrack.setProperty(ui.prop.VISIBLE, true)
      scene.scrollThumb.setProperty(ui.prop.VISIBLE, true)
      scene.scrollVisible = true
    }
    if (scene.scrollHideTimer != null) clearTimeout(scene.scrollHideTimer)
    scene.scrollHideTimer = setTimeout(() => {
      scene.scrollHideTimer = null
      if (this.scenes[2] === scene) this.hideScrollbar(scene)
    }, 1000)
  },
  bindCard(w, id) {
    w.addEventListener(ui.event.CLICK_DOWN, e => {
      if (this.slide || this.destroyed || !this.isForeground()) return
      this.touchDown(e, 'list')
      this.cancelHold()
      this.pressedId = id
      this.holdTriggered = false
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null
        if (this.destroyed || this.pressedId !== id || !this.isForeground()) return
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
    if (this.destroyed || !this.isForeground()) return
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
    Object.keys(this.scenes).forEach(index => this.updateScene(this.scenes[index]))
    this.adoptScene()
  },
  updateScene(scene) {
    if (this.destroyed) return
    if (scene.index === 0) {
      const d = new Date(), minutes = d.getMinutes()
      scene.clock.setProperty(ui.prop.TEXT, d.getHours() + ':' + (minutes < 10 ? '0' : '') + minutes)
      const loading = this.running && this.measurement.speed === null
      scene.value.setProperty(ui.prop.TEXT, loading ? '' : String(Math.round(this.measurement.speed || 0)))
      if (loading && this.isForeground()) this.startLoading(scene)
      else this.stopLoading(scene)
      scene.status.setProperty(ui.prop.TEXT, !this.running ? '' : this.gpsError ? 'GPS недоступен' :
        !this.measurement.ready ? 'Поиск GPS…' : loading ? 'Измерение…' : '')
    } else if (scene.index === 1) {
      scene.maximum.setProperty(ui.prop.TEXT, String(Math.round(this.measurement.max)))
      scene.distance.setProperty(ui.prop.TEXT, (this.measurement.distance / 1000).toFixed(2))
      scene.elapsed.setProperty(ui.prop.TEXT, duration(this.measurement.elapsed))
    }
  },
  startLoading(scene) {
    if (scene.loading) return
    scene.loading = this.add(ui.widget.IMG_ANIM, { x: 176, y: 181,
      anim_path: 'gps-loading', anim_prefix: 'loading', anim_ext: 'png',
      anim_fps: 40, anim_size: 48, repeat_count: 0, anim_status: ui.anim_status.START }, scene)
  },
  stopLoading(scene) {
    if (!scene) {
      Object.keys(this.scenes).forEach(index => this.stopLoading(this.scenes[index]))
      this.loading = null
      return
    }
    if (!scene.loading) return
    if (!scene.loadingStopped) scene.loading.setProperty(ui.prop.ANIM_STATUS, ui.anim_status.STOP)
    ui.deleteWidget(scene.loading)
    scene.widgets = scene.widgets.filter(entry => entry.w !== scene.loading)
    scene.loading = null
  },
  beginExit() {
    if (this.exiting) return
    this.exiting = true
    // Stop work before touching the UI. Keep the final frame until OS closes the page.
    this.running = false
    this.touch = null
    if (this.timer != null) clearInterval(this.timer)
    this.timer = null
    if (this.slideTimer != null) clearInterval(this.slideTimer)
    this.slideTimer = null
    this.slide = null
    this.cancelHold()
    if (this.gpsSubscribed) {
      try { this.gps.offChange(this.onFix) } catch (_) {}
      try { this.gps.stop() } catch (_) {}
      this.gpsSubscribed = false
    }
    Object.keys(this.scenes).forEach(index => {
      const scene = this.scenes[index]
      if (scene.scrollHideTimer != null) clearTimeout(scene.scrollHideTimer)
      scene.scrollHideTimer = null
      if (scene.loading) {
        scene.loading.setProperty(ui.prop.ANIM_STATUS, ui.anim_status.STOP)
        scene.loadingStopped = true
      }
    })
    this.loading = null
    resetDropWristScreenOff()
    resetPageBrightTime()
  },
  dispose() {
    if (this.destroyed) return
    this.beginExit()
    this.destroyed = true
    this.destroyIndicator()
    this.cancelHold()
    Object.keys(this.scenes).forEach(index => this.destroyScene(index))
    try { this.display.offChange(this.onScreenChange) } catch (_) {}
    interaction.offGesture()
    interaction.offKey()
    const global = getApp()._options.globalData
    if (global.stopMeasurement === this.appCleanup) global.stopMeasurement = null
  },
  onDestroy() { this.dispose() }
})
