import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, result } from './harness.mjs'

for (const exit of ['screenOff','KEY_BACK','KEY_HOME','GESTURE_RIGHT','pageDestroy','appDestroy']) {
  for(const state of ['drag','settle','list']) {
    test('background activity: '+exit+' during '+state+'; simulated hour', () => {
      const h=harness({records:Array.from({length:20},(_,i)=>result(i))}),p=h.page
      const lateClick=p.startStop.click_func
      let oldList
      if(state==='list') {
        h.go(-1);oldList=p.list
        oldList.setProperty('POS_Y',-40);oldList.scroll_frame_func()
        h.cards()[0].events.CLICK_DOWN({x:150,y:150})
      } else {
        p.touchDown({x:240,y:240});p.touchMove({x:240,y:150})
        if(state==='settle')p.touchUp({x:240,y:150})
      }
      if(exit==='screenOff')h.screen(2)
      else if(exit==='pageDestroy')p.onDestroy()
      else if(exit==='appDestroy')h.app.onDestroy()
      else if(exit==='GESTURE_RIGHT')h.swipe(exit)
      else h.key(exit)
      assert.equal(h.activeTimers(),0);assert.equal(h.gps.running,false)
      assert.equal(h.gps.callback,null);if(!['KEY_BACK','KEY_HOME','GESTURE_RIGHT'].includes(exit))assert.equal(h.widgets.length,0)
      const activity=JSON.stringify(h.activity), snapshot=JSON.stringify(p.measurement.snapshot())
      for(let i=0;i<360;i++)h.elapse(10000)
      h.lateFix();lateClick()
      oldList?.scroll_frame_func();oldList?.scroll_complete_func()
      p.touchDown({x:240,y:240});p.touchMove({x:240,y:120});p.touchUp({x:240,y:120})
      assert.equal(JSON.stringify(h.activity),activity)
      assert.equal(JSON.stringify(p.measurement.snapshot()),snapshot)
      assert.equal(h.activeTimers(),0);assert.equal(h.writes.length,0)
      if(exit==='screenOff') {h.screen(1);assert.equal(p.running,false);assert.equal(h.activeTimers(),0)}
      p.onDestroy()
    })
  }
}
