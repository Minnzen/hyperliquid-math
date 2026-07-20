#!/usr/bin/env python3
"""Generate or verify the official Hyperliquid Python SDK M1 oracle fixture."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

EXPECTED_COMMIT = "2fdb18f9517675ea03695a0962bd19eece9c83f0"
EXPECTED_VERSION = "0.24.0"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO_ROOT / "fixtures/oracles/official-python-sdk-0.24.0-2fdb18f-m1.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf8"))


def stable_json(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def git_output(sdk_path: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(sdk_path), *args], text=True).strip()


def import_sdk(sdk_path: Path):
    sys.path.insert(0, str(sdk_path))
    from hyperliquid.info import Info
    from hyperliquid.utils.signing import order_request_to_order_wire, order_wires_to_order_action

    return Info, order_request_to_order_wire, order_wires_to_order_action


def fixture_meta(path: str) -> dict[str, Any]:
    live = read_json(REPO_ROOT / path)
    return {
        "perp": {"universe": live["selection"]["perpUniverse"]},
        "spot": {
            "universe": live["selection"]["spotUniverse"],
            "tokens": live["selection"]["spotTokens"],
        },
        "perpDexs": live["selection"]["perpDexs"],
        "hip3": {"universe": live["selection"]["hip3Universe"]},
    }


def make_info_class(Info, meta: dict[str, Any]):
    class OfflineInfo(Info):
        def meta(self, dex: str = "") -> Any:
            if dex:
                return meta["hip3"]
            return meta["perp"]

        def spot_meta(self) -> Any:
            return meta["spot"]

        def perp_dexs(self) -> Any:
            rows: list[Any] = [None]
            for dex in meta["perpDexs"]:
                while len(rows) <= dex["dexIndex"]:
                    rows.append(None)
                rows[dex["dexIndex"]] = dex
            return rows

    return OfflineInfo


def prepared_order_case(
    Info,
    order_request_to_order_wire,
    order_wires_to_order_action,
    *,
    name: str,
    network: str,
    fixture: str,
    coin: str,
    asset: dict[str, Any],
    sz: float,
    limit_px: float,
    perp_dexs: list[str],
) -> dict[str, Any]:
    meta = fixture_meta(fixture)
    OfflineInfo = make_info_class(Info, meta)
    info = OfflineInfo(
        skip_ws=True,
        meta=meta["perp"],
        spot_meta=meta["spot"],
        perp_dexs=perp_dexs,
    )
    asset_id = info.name_to_asset(coin)
    order = {
        "coin": coin,
        "is_buy": True,
        "sz": sz,
        "limit_px": limit_px,
        "order_type": {"limit": {"tif": "Gtc"}},
        "reduce_only": False,
    }
    wire = order_request_to_order_wire(order, asset_id)
    action = order_wires_to_order_action([wire])

    return {
        "name": name,
        "network": network,
        "asset": {
            **asset,
            "assetId": asset_id,
            "sourceFixture": fixture,
        },
        "sdkOrderWire": wire,
        "sdkOrderAction": action,
        "wire": {
            "px": wire["p"],
            "sz": wire["s"],
        },
        "coverage": {
            "assetId": "partial" if asset["kind"] == "hip3-perp" else "full",
            "price": "partial",
            "size": "partial",
        },
    }


def generate(sdk_path: Path) -> dict[str, Any]:
    commit = git_output(sdk_path, "rev-parse", "HEAD")
    tags = git_output(sdk_path, "tag", "--points-at", "HEAD").splitlines()
    if commit != EXPECTED_COMMIT:
        raise SystemExit(f"SDK checkout is {commit}, expected {EXPECTED_COMMIT}")
    if EXPECTED_VERSION not in tags:
        raise SystemExit(f"SDK checkout is not tagged {EXPECTED_VERSION}; tags={tags}")

    Info, order_request_to_order_wire, order_wires_to_order_action = import_sdk(sdk_path)

    return {
        "schemaVersion": 1,
        "source": {
            "oracle": "official-python-sdk",
            "package": "hyperliquid-python-sdk",
            "version": EXPECTED_VERSION,
            "commit": EXPECTED_COMMIT,
            "license": "MIT",
        },
        "generation": {
            "mode": "deterministic SDK replay",
            "implementationCopied": False,
            "notes": "Fixture records SDK-prepared wire values and metadata IDs only; it does not vendor SDK code or claim server-side rounding.",
        },
        "preparedOrderCases": [
            prepared_order_case(
                Info,
                order_request_to_order_wire,
                order_wires_to_order_action,
                name="prepares a mainnet BTC perp order with canonical wire strings",
                network="mainnet",
                fixture="fixtures/live/2026-07-19-mainnet-m1.json",
                coin="BTC",
                asset={"kind": "perp", "symbol": "BTC", "index": 0},
                sz=0.00217,
                limit_px=64639,
                perp_dexs=[""],
            ),
            prepared_order_case(
                Info,
                order_request_to_order_wire,
                order_wires_to_order_action,
                name="prepares a mainnet PURR spot order with canonical wire strings",
                network="mainnet",
                fixture="fixtures/live/2026-07-19-mainnet-m1.json",
                coin="PURR/USDC",
                asset={"kind": "spot", "symbol": "PURR/USDC", "index": 0},
                sz=12,
                limit_px=1.2345,
                perp_dexs=[""],
            ),
            prepared_order_case(
                Info,
                order_request_to_order_wire,
                order_wires_to_order_action,
                name="prepares a testnet HIP-3 order with partial asset-id coverage",
                network="testnet",
                fixture="fixtures/live/2026-07-19-testnet-m1.json",
                coin="test:ABC",
                asset={"kind": "hip3-perp", "symbol": "test:ABC", "dexIndex": 1, "index": 0},
                sz=2,
                limit_px=10,
                perp_dexs=["test"],
            ),
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk-path", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    fixture = generate(args.sdk_path.resolve())
    rendered = stable_json(fixture)

    if args.check:
        expected = args.out.read_text(encoding="utf8")
        if rendered != expected:
            raise SystemExit(f"{args.out} is not reproducible from {args.sdk_path}")
        print(f"verified {args.out} from {args.sdk_path}")
        return 0

    args.out.write_text(rendered, encoding="utf8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
