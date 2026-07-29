import { defineConfig } from 'vitepress'

const GITHUB = 'https://github.com/Minnzen/hyperliquid-math'

type Item = { text: string; link: string }
type Group = { text: string; items: Item[] }

// Guide sidebar. Getting Started and Error Handling & Units are translated prose;
// Field Mapping (spec/KIT-MAPPING.md) and For AI Agents (SKILL.md) are the English
// source of truth and are labelled "(English)" on the zh side.
function guideItems(prefix: string, zh: boolean): Item[] {
  const en = (t: string) => (zh ? `${t} (English)` : t)
  return [
    { text: zh ? '快速开始' : 'Getting Started', link: `${prefix}getting-started` },
    { text: en(zh ? '字段映射' : 'Field Mapping'), link: `${prefix}field-mapping` },
    { text: zh ? '错误处理与单位' : 'Error Handling & Units', link: `${prefix}error-handling` },
    { text: en(zh ? '面向 AI Agent' : 'For AI Agents'), link: `${prefix}for-ai-agents` },
  ]
}

// Reference sidebar, grouped by domain. The reference manual is generated from
// spec/ and is English-only; zh mounts the same English pages, marked "(English)".
function refGroups(prefix: string, zh: boolean): Group[] {
  const mark = zh ? ' (English)' : ''
  const L = (seg: string, text: string): Item => ({
    text: `${text}${mark}`,
    link: `${prefix}${seg}`,
  })
  return [
    { text: zh ? '概览' : 'Overview', items: [L('', 'Formula Index')] },
    {
      text: zh ? '精度与标识' : 'Precision & Identity',
      items: [L('precision', 'Precision'), L('identifiers', 'Identifiers')],
    },
    {
      text: zh ? '市场数据' : 'Market Data',
      items: [
        L('orderbook', 'Orderbook'),
        L('fees', 'Fees'),
        L('positions', 'Positions'),
        L('funding', 'Funding'),
      ],
    },
    {
      text: zh ? '保证金与风险' : 'Margin & Risk',
      items: [L('margin', 'Margin'), L('liquidation', 'Liquidation'), L('scenarios', 'Scenarios')],
    },
    {
      text: zh ? '订单与账务' : 'Orders & Accounting',
      items: [L('orders', 'Orders'), L('reconciliation', 'Reconciliation')],
    },
    {
      text: zh ? 'Spot 与 HIP' : 'Spot & HIP',
      items: [L('spot', 'Spot'), L('hip1', 'HIP-1'), L('hip3', 'HIP-3'), L('hip4', 'HIP-4')],
    },
    {
      text: zh ? '附录' : 'Appendix',
      items: [
        L('numerics', 'Numerics'),
        L('worked-examples', 'Worked Examples'),
        L('oracles', 'Oracle Coverage'),
        L('sources', 'Sources'),
      ],
    },
  ]
}

export default defineConfig({
  base: '/hyperliquid-math/',
  title: 'hyperliquid-math',
  description:
    'Deterministic, explainable Hyperliquid math — exact decimals, zero network I/O, every result carries an auditable trace.',
  cleanUrls: false,
  lastUpdated: false,
  markdown: {
    lineNumbers: true,
  },
  srcExclude: ['**/node_modules/**'],
  themeConfig: {
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: GITHUB }],
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
          { text: 'Reference', link: '/reference/', activeMatch: '/reference/' },
        ],
        sidebar: {
          '/guide/': [{ text: 'Guide', items: guideItems('/guide/', false) }],
          '/reference/': refGroups('/reference/', false),
        },
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '指南', link: '/zh/guide/getting-started', activeMatch: '/zh/guide/' },
          { text: '参考', link: '/zh/reference/', activeMatch: '/zh/reference/' },
        ],
        sidebar: {
          '/zh/guide/': [{ text: '指南', items: guideItems('/zh/guide/', true) }],
          '/zh/reference/': refGroups('/zh/reference/', true),
        },
        outline: { level: [2, 3], label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        sidebarMenuLabel: '菜单',
        returnToTopLabel: '返回顶部',
        langMenuLabel: '切换语言',
      },
    },
  },
})
