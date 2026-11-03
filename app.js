App({
  globalData: { stopMeasurement: null },
  onCreate() {},
  onDestroy() {
    const stop = this.globalData.stopMeasurement
    if (stop) stop()
    this.globalData.stopMeasurement = null
  }
})
