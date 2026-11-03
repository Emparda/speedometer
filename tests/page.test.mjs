import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { harness, result, RESULTS_KEY } from './harness.mjs'

test('auto-start, stop freezes all metrics, restart resets; never auto-saves', () => {
  const h = harness(), p = h.page
  assert.equal(p.running, true); assert.ok(p.loading)
  h.fix(); h.advance(4000); h.fix()
  assert.equal(p.value.text, '36')
  assert.equal(p.loading, null)
  h.click('Стоп')
  assert.equal(h.activeTimers(), 0); assert.equal(h.gps.running, false)
  const frozen = JSON.stringify(p.measurement.snapshot())
  h.advance(100000); h.lateFix()
  assert.equal(JSON.stringify(p.measurement.snapshot()), frozen)
  assert.equal(h.writes.length, 0)
  h.click('Запуск')
  assert.equal(p.measurement.elapsed, 0); assert.equal(p.measurement.max, 0)
  assert.equal(p.measurement.distance, 0); assert.ok(p.loading)
  p.onDestroy(); assert.equal(h.writes.length, 0)
})

test('manual save is an immutable snapshot without stopping; no duplicates while stopped', () => {
  const h = harness(), p = h.page
  h.fix(); h.advance(4000); h.fix(); h.swipe('GESTURE_UP')
  h.click('Сохранить')
  assert.equal(p.running, true); assert.equal(p.records.length, 1)
  const saved = JSON.stringify(p.records[0])
  h.advance(7000); h.fix()
  assert.equal(JSON.stringify(p.records[0]), saved)
  h.click('Сохранить'); assert.equal(p.records.length, 2)
  p.stopMeasurement(); p.saveSnapshot(); const count = p.records.length
  p.saveSnapshot(); assert.equal(p.records.length, count)
  p.onDestroy()
  const reopened = harness({ data: h.data })
  assert.equal(reopened.page.records.length, count)
  assert.equal(reopened.page.measurement.elapsed, 0)
  reopened.page.onDestroy()
})

test('screens wrap in both directions with gestures and hardware buttons, including empty results', () => {
  const h=harness(),p=h.page
  h.swipe('GESTURE_DOWN'); assert.equal(p.screenIndex,2)
  h.swipe('GESTURE_UP'); assert.equal(p.screenIndex,0)
  h.key('KEY_UP'); assert.equal(p.screenIndex,2)
  h.key('KEY_DOWN'); assert.equal(p.screenIndex,0)
  h.swipe('GESTURE_UP'); h.swipe('GESTURE_UP'); assert.equal(p.screenIndex,2)
  h.swipe('GESTURE_DOWN'); assert.equal(p.screenIndex,1)
  p.onDestroy()
})

test('native list scrolls continuously; only gestures starting at an edge change screen', () => {
  const h=harness({records:Array.from({length:4},(_,i)=>result(i))}),p=h.page
  p.navigate(-1)
  const list=p.list
  assert.equal(list.scroll_enable,1); assert.equal(h.cards().length,4)
  assert.equal(h.swipe('GESTURE_UP'),false); assert.equal(p.screenIndex,2)
  // Simulate a native frame during finger movement, not a whole-card jump.
  list.setProperty('POS_Y',-53); list.scroll_frame_func()
  assert.equal(p.listOffset,53); assert.equal(p.list,list)
  assert.ok(p.scrollThumb.y>140)
  p.touchDown({x:200,y:250})
  list.setProperty('POS_Y',-p.maxOffset()); list.scroll_frame_func()
  p.touchUp({x:200,y:180}); assert.equal(p.screenIndex,2)
  h.advance(1500)
  p.touchDown({x:200,y:250});p.touchUp({x:200,y:210})
  assert.equal(p.screenIndex,0)
  h.swipe('GESTURE_UP'); assert.equal(p.screenIndex,0) // duplicate system event
  h.key('KEY_UP'); assert.equal(p.screenIndex,2)
  h.key('KEY_UP'); assert.equal(p.screenIndex,1)
  p.onDestroy()
})

test('short swipes over text navigate once, horizontal movement does not navigate', () => {
  const h=harness(),p=h.page
  p.value.events.CLICK_DOWN({x:240,y:240})
  p.value.events.MOVE({x:240,y:218})
  p.value.events.CLICK_UP({x:240,y:205})
  assert.equal(p.screenIndex,1)
  h.swipe('GESTURE_UP');assert.equal(p.screenIndex,1)
  p.maximum.events.CLICK_DOWN({x:180,y:120})
  p.maximum.events.CLICK_UP({x:230,y:130})
  assert.equal(p.screenIndex,1)
  p.onDestroy()
})

test('buttons retain their widget/background; equal coordinates; three indicators on all screens', () => {
  const h=harness(),p=h.page
  const button=p.startStop, initialWidgets=h.widgets.length
  assert.equal(button.normal_color,button.press_color)
  h.click('Стоп');assert.equal(p.startStop,button);assert.equal(button.text,'Запуск')
  h.click('Запуск');assert.equal(p.startStop,button);assert.equal(h.widgets.length,initialWidgets)
  assert.ok(p.status.y>=181+80);assert.ok(p.status.y+p.status.h<328)
  for(let i=0;i<3;i++) {
    p.screenIndex=i;p.render()
    const dots=h.widgets.filter(w=>w.type==='CIRCLE')
    assert.equal(dots.length,3);assert.equal(dots.filter(w=>w.color===0xeee6da).length,1)
    assert.equal(dots[i].color,0xeee6da)
    if(i===1) {
      const save=h.widgets.find(w=>w.text==='Сохранить')
      assert.equal(save.y,button.y);assert.equal(save.x,button.x)
    }
  }
  p.onDestroy()
})

test('long press selects, swipe does not delete; choose multiple cards and delete', () => {
  const h = harness({ records: [result(1), result(2), result(3)] }), p = h.page
  p.navigate(1); p.navigate(1)
  let card = h.cards()[0]
  card.events.CLICK_DOWN(); card.events.MOVE(); h.advance(1700)
  assert.equal(p.editing, false)
  card.events.CLICK_DOWN(); h.advance(2400)
  assert.equal(p.editing, true); assert.deepEqual(Array.from(p.selected), ['r1'])
  card = h.cards()[1]; card.events.CLICK_DOWN(); card.events.CLICK_UP()
  assert.equal(p.selected.length, 2)
  h.click('Удалить')
  assert.equal(p.records.length, 1); assert.equal(p.records[0].id, 'r3')
  assert.equal(JSON.parse(h.data.get(RESULTS_KEY)).length, 1)
  p.onDestroy()
})

test('20-record cap does not evict; save after explicit deletion', () => {
  const h = harness({ records: Array.from({length:20},(_,i)=>result(i)) }), p=h.page
  p.navigate(1); h.click('Сохранить')
  assert.equal(p.records.length,20); assert.equal(h.writes.length,0); assert.equal(p.screenIndex,2)
  p.selected=['r19']; p.removeSelected(); assert.equal(p.records.length,19)
  p.navigate(-1); h.click('Сохранить'); assert.equal(p.records.length,20)
  p.onDestroy()
})

test('failed writes preserve records; corrupt storage is not overwritten', () => {
  const h=harness({ records:[result(1)], failWrites:true }),p=h.page
  p.saveSnapshot(); assert.equal(p.records.length,1)
  p.selected=['r1']; p.removeSelected(); assert.equal(p.records.length,1)
  p.onDestroy()
  const broken=harness({ data:new Map([[RESULTS_KEY,'broken']]) })
  broken.page.saveSnapshot(); assert.equal(broken.writes.length,0)
  assert.ok(broken.page.storageError); broken.page.onDestroy()
})

for (const exit of ['screenOff','KEY_BACK','KEY_HOME','GESTURE_RIGHT','pageDestroy','appDestroy']) {
  test('no recording/timers/animation after '+exit, () => {
    const h=harness(),p=h.page
    h.fix(); h.advance(4000); h.fix()
    if(exit==='screenOff') h.screen(2)
    else if(exit==='pageDestroy') p.onDestroy()
    else if(exit==='appDestroy') h.app.onDestroy()
    else if(exit==='GESTURE_RIGHT') h.swipe(exit)
    else h.key(exit)
    const frozen=JSON.stringify(p.measurement.snapshot())
    assert.equal(p.running,false); assert.equal(h.gps.running,false)
    assert.equal(h.gps.callback,null); assert.equal(h.activeTimers(),0); assert.equal(p.loading,null)
    h.advance(500000); h.lateFix()
    assert.equal(JSON.stringify(p.measurement.snapshot()),frozen); assert.equal(h.writes.length,0)
    if(exit==='screenOff') { h.screen(1); assert.equal(p.running,false); assert.ok(h.widgets.some(w=>w.text==='Запуск')) }
    p.onDestroy(); p.onDestroy(); assert.equal(h.activeTimers(),0)
    assert.equal(h.screenSensor.callback,null); assert.equal(h.input.key,null); assert.equal(h.input.gesture,null)
  })
}

test('long press timer is cancelled when display switches off', () => {
  const h=harness({ records:[result(1)] });h.page.navigate(1);h.page.navigate(1)
  h.cards()[0].events.CLICK_DOWN(); h.screen(2)
  assert.equal(h.activeTimers(),0);h.advance(10000);assert.equal(h.page.editing,false)
  h.page.onDestroy()
})

test('configuration has no phone module, background service or ZML dependency', () => {
  const manifest=JSON.parse(readFileSync(new URL('../app.json',import.meta.url)))
  assert.deepEqual(Object.keys(manifest.targets['t-rex-3'].module),['page'])
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)))
  assert.equal(pkg.dependencies?.['@zeppos/zml'],undefined)
})
