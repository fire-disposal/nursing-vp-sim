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

  lifetimes: {
    attached() {
      this.initAnimation()
    },
  },

  methods: {
    initAnimation() {
      const query = this.createSelectorQuery()
      query.select("#lottie-canvas")
        .node((res) => {
          if (!res || !res.node) return
          const canvas = res.node
          const context = canvas.getContext("2d")
          canvas.width = this.properties.width * 2
          canvas.height = this.properties.height * 2

          try {
            const lottie = require("lottie-miniprogram")
            lottie.setup(canvas)
            const anim = lottie.loadAnimation({
              loop: this.properties.loop,
              autoplay: this.properties.autoplay,
              animationData: this.data.animationData,
              rendererSettings: { context },
            })
            this._anim = anim
          } catch (e) {
            console.error("[lottie-player] lottie-miniprogram load failed:", e)
          }
        })
        .exec()

      this.loadAnimationData()
    },

    loadAnimationData() {
      try {
        const data = require("../../assets/lottie/animation.json")
        this.setData({ animationData: data })
        setTimeout(() => {
          this.initAnimation()
        }, 100)
      } catch (e) {
        console.error("[lottie-player] animation.json load failed:", e)
      }
    },
  },
})
