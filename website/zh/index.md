---
layout: home
hero:
  name: hyperliquid-math
  text: 确定性的、可解释的 Hyperliquid 数学库
  tagline: 精确 decimal、零网络 I/O，每个结果都带着自己的审计链。
  actions:
    - theme: brand
      text: 开始使用
      link: /zh/guide/getting-started
    - theme: alt
      text: 在 GitHub 查看
      link: https://github.com/Minnzen/hyperliquid-math
features:
  - title: 精确 decimal
    details: "全部运算基于 40 位有效数字的 decimal；取整方向永远对用户保守。CCXT 那类档案化的浮点精度 bug 在这里结构性不可能发生。"
  - title: 审计链
    details: "每个函数返回 { value, trace }——记录规范化输入、公式与来源 ID、每一次取整决策、每一条假设。任何一个数都能审计回它出自的官方文档。"
  - title: 对过主网
    details: "1100+ 测试、100% 行 / 分支 / 函数覆盖、CI 内 pin 死官方 SDK oracle，以及带日期的 live API fixtures。"
  - title: 零网络 I/O
    details: "这个包只负责计算；取数和映射是你的代码。不 fetch、不缓存、不签名、不提交——纯确定性函数，只有一个运行时依赖。"
---
