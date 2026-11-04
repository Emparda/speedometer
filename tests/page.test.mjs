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

for (const count of [0, 1, 2, 3, 19]) test('save then navigate without native root drift: '+count, () => {
  const h=harness({records:Array.from({length:count},(_,i)=>result(i))}),p=h.page
  h.go(1);h.click('Сохранить');assert.equal(p.records.length,count+1)
  h.go(1);h.nativeDrag(-90)
  assert.equal(h.rootOffset(),0)
  assert.ok(h.scrollLocks.every(Boolean))
  const list=p.list,offset=p.listOffset
  p.touchDown({x:240,y:420});p.touchMove({x:240,y:340})
  assert.equal(list.y,20);assert.equal(list.getProperty('POS_Y'),-offset || 0)
  assert.equal(p.scenes[2].offset,-80)
  list.scroll_frame_func();assert.equal(p.listOffset,offset)
  p.touchUp({x:240,y:340});h.settle();assert.equal(p.screenIndex,0)
  h.go(-1);h.nativeDrag(-70,true)
  assert.equal(p.listOffset,Math.min(70,p.maxOffset()))
  assert.equal(h.rootOffset(),0)
  p.onDestroy()
})

test('lost release recovers on next contact; malformed moves cannot poison positions',()=>{
  const h=harness(),p=h.page
  p.touchDown({x:240,y:220});p.touchMove({x:240,y:150})
  h.elapse(50);p.touchDown({x:240,y:220})
  assert.equal(p.slide,null);assert.equal(p.scenes[0].offset,0)
  p.touchMove({y:100});p.touchMove({x:240,y:NaN})
  assert.equal(p.slide,null)
  p.touchMove({x:240,y:120});p.touchUp({x:240,y:120});h.settle()
  assert.equal(p.screenIndex,1);assert.equal(p.scenes[1].offset,0)
  p.onDestroy()
})

test('six-pixel button margins accept taps but vertical drags navigate without activating',()=>{
  const h=harness(),p=h.page
  const margin=()=>h.widgets.find(w=>w.type==='FILL_RECT'&&w.x===163&&w.y===379&&w.w===154)
  let m=margin();m.events.CLICK_DOWN({x:240,y:382});m.events.CLICK_UP({x:240,y:382})
  assert.equal(p.running,false);assert.equal(p.startStop.w,142);assert.equal(p.startStop.h,52)
  m.events.CLICK_DOWN({x:240,y:382});m.events.MOVE({x:240,y:300});m.events.CLICK_UP({x:240,y:300})
  h.settle();assert.equal(p.screenIndex,1);assert.equal(p.running,false);assert.equal(p.records.length,0)
  m=margin();m.events.CLICK_DOWN({x:240,y:382});m.events.CLICK_UP({x:240,y:382})
  assert.equal(p.records.length,1)
  p.onDestroy()
})

test('offscreen and deleted buttons cannot save or change measurement',()=>{
  const h=harness(),p=h.page,stop=p.startStop
  h.go(1);stop.click_func();assert.equal(p.running,true)
  const save=h.widgets.find(w=>w.text==='Сохранить')
  p.touchDown({x:240,y:200});p.touchMove({x:240,y:100})
  save.click_func();p.saveSnapshot();assert.equal(p.records.length,0)
  p.touchUp({x:240,y:100});h.settle();save.click_func();assert.equal(p.records.length,0)
  p.onDestroy()
})

test('seeded mixed-event simulation: saving, deleting, gestures, GPS and screen sleep',()=>{
  let seed=27841
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n}
  for(let run=0;run<20;run++) {
    const h=harness({records:Array.from({length:random(21)},(_,i)=>result(i))}),p=h.page
    for(let step=0;step<250;step++) {
      switch(random(10)) {
        case 0:h.go(random(2)?1:-1);break
        case 1:drag(h,p.screenIndex===2&&p.records.length?420:220,random(2)?80:-80);h.settle();break
        case 2:p.saveSnapshot();break
        case 3:if(p.records.length){p.selected=[p.records[random(p.records.length)].id];p.removeSelected()}break
        case 4:if(p.list){h.nativeDrag(random(301)-150,true);p.list.scroll_complete_func()}break
        case 5:h.screen(2);h.lateFix();assert.equal(h.activeTimers(),0);h.screen(1);break
        case 6:if(!p.running)p.startMeasurement();h.elapse(1000);h.fix();break
        case 7:p.touchDown({x:240,y:60});p.touchMove({x:240,y:120});h.go(-1);break
        case 8:p.touchDown({x:240,y:60});p.touchMove({x:240,y:20});p.touchUp({x:240,y:20});h.swipe('GESTURE_DOWN');h.settle();break
        case 9:p.stopMeasurement();break
      }
      h.settle()
      assert.ok(!p.slide);assert.ok(!p.slideTimer)
      assert.deepEqual(Object.keys(p.scenes),[String(p.screenIndex)])
      assert.equal(p.scenes[p.screenIndex].offset,0)
      assert.ok(h.widgets.every(w=>w.y===undefined||Number.isFinite(w.y)))
      assert.ok(p.records.length<=20);assert.ok(p.listOffset>=0)
      assert.ok(h.scrollLocks.every(Boolean));assert.equal(h.rootOffset(),0)
      assert.equal(p.indicator.y,210)
      assert.ok(h.widgets.length<115)
    }
    p.onDestroy();assert.equal(h.activeTimers(),0);assert.equal(h.widgets.length,0);assert.equal(h.gps.running,false)
  }
})
