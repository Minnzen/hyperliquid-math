---
layout: home
hero:
  name: hyperliquid-math
  text: Deterministic, explainable Hyperliquid math
  tagline: Exact decimals, zero network I/O, and every result carries its own audit trace.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Minnzen/hyperliquid-math
features:
  - title: Exact decimals
    details: "All arithmetic runs on 40-significant-digit decimals; rounding direction is always conservative for the user. CCXT-class float precision bugs are structurally impossible."
  - title: Audit trace
    details: "Every function returns { value, trace } — normalized inputs, formula and source IDs, every rounding decision and every assumption. Audit any number back to the docs it came from."
  - title: Verified against mainnet
    details: "1,100+ tests at 100% line, branch, and function coverage, a pinned official-SDK oracle in CI, and dated live-API fixtures."
  - title: Zero network I/O
    details: "The package computes; you fetch and map. No fetching, caching, signing, or submitting — pure deterministic functions with one runtime dependency."
---
