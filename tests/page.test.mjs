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
  h.fix(); h.advance(4000); h.fix(); h.swipe('GESTURE_UP'); h.settle()
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

function drag(h, y, dy, x=240) {
  h.page.touchDown({x,y})
  h.page.touchMove({x,y:y+dy})
  h.page.touchUp({x,y:y+dy})
}

test('cyclic navigation: first/last and hardware buttons; empty results uses header/footer', () => {
  const h=harness(),p=h.page
  drag(h,240,80);h.settle();assert.equal(p.screenIndex,2)
  drag(h,420,-80);h.settle();assert.equal(p.screenIndex,0)
  h.key('KEY_UP');h.settle();assert.equal(p.screenIndex,2)
  h.key('KEY_DOWN');h.settle();assert.equal(p.screenIndex,0)
  h.go(1);h.go(1);drag(h,60,60);h.settle();assert.equal(p.screenIndex,1)
  p.onDestroy()
})

for(const count of [1,2,4,20]) {
  test('list gestures never leave results, header/footer independent: '+count+' records', () => {
    const h=harness({records:Array.from({length:count},(_,i)=>result(i))}),p=h.page
    h.go(-1)
    if(count<=2)assert.equal(h.widgets.filter(w=>w.type==='ARC').length,0)
    for(const offset of [0,p.maxOffset()/2,p.maxOffset()]) {
      if(p.list) {p.list.setProperty('POS_Y',-offset);p.list.scroll_frame_func()}
      for(const dy of [-130,130]) {
        drag(h,220,dy)
        assert.equal(h.swipe(dy<0?'GESTURE_UP':'GESTURE_DOWN'),true)
        h.settle();assert.equal(p.screenIndex,2);assert.ok(!p.slide)
      }
    }
    const offset=p.listOffset
    drag(h,420,-90);h.settle();assert.equal(p.screenIndex,0)
    h.go(-1);assert.equal(p.listOffset,offset)
    drag(h,55,80);h.settle();assert.equal(p.screenIndex,1)
    p.onDestroy()
  })
}

test('two screens move together under the finger; release eases to the next; duplicate gesture ignored', () => {
  const h=harness(),p=h.page
  p.value.events.CLICK_DOWN({x:240,y:240})
  p.value.events.MOVE({x:240,y:120})
  assert.equal(p.screenIndex,0)
  assert.equal(p.scenes[0].offset,-120);assert.equal(p.scenes[1].offset,360)
  assert.equal(p.scenes[0].value.y,11);assert.equal(p.scenes[1].maximum.y,454)
  assert.equal(h.activeTimers(),1) // no animation polling while finger is down
  p.touchUp({x:240,y:120})
  h.elapse(60)
  assert.ok(p.scenes[0].offset < -120 && p.scenes[0].offset > -480)
  assert.equal(p.scenes[1].offset-p.scenes[0].offset,480)
  h.swipe('GESTURE_UP');h.settle();assert.equal(p.screenIndex,1)
  assert.deepEqual(Object.keys(p.scenes),['1']);assert.equal(h.activeTimers(),1)
  p.onDestroy()
})

test('short drag snaps back, horizontal drag stays; reversing direction shows correct cyclic neighbour', () => {
  const h=harness(),p=h.page
  drag(h,240,-15);h.settle();assert.equal(p.screenIndex,0)
  assert.equal(p.scenes[0].offset,0);assert.deepEqual(Object.keys(p.scenes),['0'])
  p.touchDown({x:200,y:240});p.touchMove({x:280,y:250});p.touchUp({x:280,y:250})
  assert.equal(p.screenIndex,0)
  p.touchDown({x:240,y:240});p.touchMove({x:240,y:180})
  assert.equal(p.slide.next,1)
  p.touchMove({x:240,y:300});assert.equal(p.slide.next,2);assert.ok(!p.scenes[1])
  p.touchUp({x:240,y:300});h.settle();assert.equal(p.screenIndex,2)
  p.onDestroy()
})

test('scroll frames retain list; left arc follows position, decorative arc does not intercept input', () => {
  const h=harness({records:Array.from({length:4},(_,i)=>result(i))}),p=h.page
  h.go(-1);const list=p.list,thumb=p.scrollThumb
  assert.equal(list.scroll_enable,1)
  assert.equal(thumb.type,'ARC');assert.equal(thumb.enabled,false)
  assert.equal(thumb.end_angle,210)
  list.setProperty('POS_Y',-53);list.scroll_frame_func()
  assert.equal(p.list,list);assert.equal(p.listOffset,53);assert.ok(thumb.end_angle<210)
  list.setProperty('POS_Y',-p.maxOffset());list.scroll_frame_func()
  assert.ok(Math.abs(thumb.start_angle-150)<0.001)
  const labels=list.children.filter(w=>w.type==='TEXT').slice(0,3)
  assert.equal(labels[0].y,124-(labels[2].y+labels[2].h))
  assert.equal(labels[1].y+labels[1].h/2,62)
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
  h.go(1); h.go(1)
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
  h.go(1); h.click('Сохранить')
  assert.equal(p.records.length,20); assert.equal(h.writes.length,0); assert.equal(p.screenIndex,2)
  p.selected=['r19']; p.removeSelected(); assert.equal(p.records.length,19)
  h.go(-1); h.click('Сохранить'); assert.equal(p.records.length,20)
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
  const h=harness({ records:[result(1)] });h.go(1);h.go(1)
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

test('repeated cyclic transitions release outgoing widgets and transition timers', () => {
  const h=harness({records:Array.from({length:20},(_,i)=>result(i))}),p=h.page
  for(let i=0;i<30;i++) {
    h.go(i%2?1:-1)
    assert.equal(Object.keys(p.scenes).length,1)
    assert.equal(p.slideTimer,null)
    assert.equal(h.activeTimers(),1)
    assert.ok(h.widgets.length<105)
  }
  p.onDestroy();assert.equal(h.widgets.length,0);assert.equal(h.activeTimers(),0)
})

test('scrollbar starts hidden, follows native scrolling/inertia, hides one second after completion', () => {
  const h=harness({records:[result(1),result(2),result(3),result(4)]}),p=h.page
  h.go(-1)
  const scene=p.scenes[2],thumb=p.scrollThumb,list=p.list
  assert.equal(thumb.visible,false);assert.equal(scene.scrollTrack.visible,false)
  list.scroll_frame_func();assert.equal(thumb.visible,false) // unchanged initial frame
  list.setProperty('POS_Y',-30);list.scroll_frame_func()
  assert.equal(thumb.visible,true);assert.equal(scene.scrollTrack.visible,true)
  h.elapse(700);list.setProperty('POS_Y',-60);list.scroll_frame_func()
  h.elapse(700);assert.equal(thumb.visible,true)
  list.scroll_complete_func();h.elapse(999);assert.equal(thumb.visible,true)
  h.elapse(1);assert.equal(thumb.visible,false);assert.equal(scene.scrollTrack.visible,false)
  assert.equal(h.activeTimers(),1) // only measurement, no idle scrollbar polling
  p.touchDown({x:200,y:200},'list');p.touchMove({x:200,y:150})
  assert.equal(thumb.visible,true)
  h.go(-1);assert.equal(h.activeTimers(),1)
  h.go(1);assert.equal(p.scrollThumb.visible,false)
  p.onDestroy();assert.equal(h.activeTimers(),0)
})


test('empty results accepts central swipes; duplicate/opposite system events cannot replace a settling scene', () => {
 const h=harness(),p=h.page;h.go(-1)
 p.touchDown({x:240,y:240});p.touchMove({x:240,y:160})
 const next=p.scenes[0]
 h.swipe('GESTURE_DOWN')
 assert.equal(p.slide.next,0);assert.equal(p.scenes[0],next)
 h.swipe('GESTURE_UP');p.touchUp({x:240,y:160});h.settle()
 assert.equal(p.screenIndex,0);assert.equal(p.scenes[0],next)
 h.go(-1);drag(h,240,80);h.settle();assert.equal(p.screenIndex,1)
 p.onDestroy()
})

test('indicator stays in the same overlay during drag, reversal, settle and cancellation', () => {
 const h=harness(),p=h.page,overlay=p.indicator,dots=[...p.indicatorDots]
 const check=()=>{assert.equal(p.indicator,overlay);assert.equal(overlay.x,446);assert.equal(overlay.y,210);dots.forEach((w,i)=>{assert.equal(p.indicatorDots[i],w);assert.equal(w.center_y,12+i*18)})}
 p.touchDown({x:240,y:240});p.touchMove({x:240,y:150});check()
 p.touchMove({x:240,y:300});check();p.touchUp({x:240,y:300});h.elapse(80);check();h.settle();check()
 assert.equal(dots[2].color,0xeee6da)
 drag(h,50,-15);h.settle();check();h.go(1);check();assert.equal(dots[0].color,0xeee6da)
 p.onDestroy()
})

test('exit freezes final frame, stops GPS once and repeated exits do not repeat cleanup', () => {
 const h=harness(),p=h.page
 p.touchDown({x:240,y:240});p.touchMove({x:240,y:120});p.touchUp({x:240,y:120})
 const count=h.widgets.length,offset=p.scenes[0].offset
 h.key('KEY_HOME');assert.equal(h.widgets.length,count);assert.equal(p.scenes[0].offset,offset)
 assert.equal(h.activeTimers(),0);assert.equal(h.activity.gpsStops,1)
 const writes=h.activity.uiWrites
 h.key('KEY_HOME');h.key('KEY_BACK');assert.equal(h.activity.uiWrites,writes);assert.equal(h.activity.gpsStops,1)
 p.onDestroy();h.app.onDestroy();assert.equal(h.activity.gpsStops,1);assert.equal(h.widgets.length,0)
})
