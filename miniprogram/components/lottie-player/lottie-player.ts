Component({
  properties: {
    width: { type: Number, value: 400 },
    height: { type: Number, value: 400 },
    autoplay: { type: Boolean, value: true },
    loop: { type: Boolean, value: true },
  },

  data: {
    animationData: null as Record<string, unknown> | null,
  },

  _anim: null as { destroy?: () => void } | null,
  _initDone: false,

  lifetimes: {
    attached() {
      this.loadDataAndInit()
    },

    detached() {
      if (this._anim?.destroy) {
        this._anim.destroy()
      }
      this._anim = null
    },
  },

  methods: {
    loadDataAndInit() {
      try {
        const data = require("../../assets/lottie/animation.json")
        this.setData({ animationData: data as Record<string, unknown> })
        setTimeout(() => {
          this.initAnimation()
        }, 50)
      } catch (e) {
        console.error("[lottie-player] animation.json load failed:", e)
      }
    },

    initAnimation() {
      if (this._initDone) return
      this._initDone = true

      const query = this.createSelectorQuery()
      query.select("#lottie-canvas")
        .node((res) => {
          if (!res || !res.node) {
            this._initDone = false
            return
          }
          const canvas = res.node
          const context = canvas.getContext("2d")
          canvas.width = this.properties.width * 2
          canvas.height = this.properties.height * 2

          try {
            const lottie = require("lottie-miniprogram")
            lottie.setup(canvas)
            this._anim = lottie.loadAnimation({
              loop: this.properties.loop,
              autoplay: this.properties.autoplay,
              animationData: this.data.animationData,
              rendererSettings: { context },
            })
          } catch (e) {
            console.error("[lottie-player] lottie init failed:", e)
          }
        })
        .exec()
    },
  },
})
