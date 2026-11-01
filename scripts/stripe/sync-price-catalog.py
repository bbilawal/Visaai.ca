#!/usr/bin/env python3
"""Idempotently provision the VisaAI subscription catalog in a Stripe account.

Creates the three plan products and their month/year recurring prices if they do
not already exist, then prints the SUBSCRIPTION_PRICES JSON that apps/api expects.

Prices are matched by `lookup_key` (visaai_<plan>_<interval>), which is unique per
mode. That is what keeps test and live catalogs in sync: the IDs differ between
modes, but the lookup keys — and therefore this script — do not.

Usage:
    scripts/stripe/sync-price-catalog.py --key sk_test_...
    STRIPE_SECRET_KEY=sk_live_... scripts/stripe/sync-price-catalog.py

Re-running is safe: existing products/prices are reused, never duplicated.
Stripe prices are immutable, so a price whose amount no longer matches the table
below is reported as a mismatch rather than silently edited.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.stripe.com/v1"

# Source of truth, mirrors apps/api/src/modules/subscriptions/subscription.constants.ts
PLANS = {
    "base": {
        "name": "VisaAI Base",
        "description": "VisaAI Base plan — core immigration application tooling.",
        "credit_cap": 0,
        "amounts": {"month": 1500, "year": 19000},
    },
    "pro": {
        "name": "VisaAI Pro",
        "description": "VisaAI Pro plan — includes 1 premium review credit per billing period.",
        "credit_cap": 1,
        "amounts": {"month": 4900, "year": 49000},
    },
    "premium": {
        "name": "VisaAI Premium",
        "description": "VisaAI Premium plan — includes 2 premium review credits per billing period.",
        "credit_cap": 2,
        "amounts": {"month": 9900, "year": 99000},
    },
}
INTERVALS = ("month", "year")
CURRENCY = "usd"


def lookup_key(plan: str, interval: str) -> str:
    return f"visaai_{plan}_{interval}"


class Stripe:
    def __init__(self, key: str) -> None:
        self.key = key

    def _request(self, method: str, path: str, params=None):
        url = f"{API}{path}"
        data = None
        # Stripe expects form encoding with bracket notation for nested fields.
        if params and method == "GET":
            url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
        elif params:
            data = urllib.parse.urlencode(params, doseq=True).encode()

        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.key}")
        req.add_header("Stripe-Version", "2024-06-20")
        try:
            with urllib.request.urlopen(req) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            try:
                message = json.loads(body)["error"]["message"]
            except Exception:
                message = body[:300]
            sys.exit(f"Stripe API error ({exc.code}) on {method} {path}: {message}")

    def get(self, path, params=None):
        return self._request("GET", path, params)

    def post(self, path, params=None):
        return self._request("POST", path, params)


def flatten(prefix: str, mapping: dict) -> dict:
    return {f"{prefix}[{k}]": v for k, v in mapping.items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key", help="Stripe secret key; defaults to $STRIPE_SECRET_KEY")
    args = parser.parse_args()

    key = args.key or os.environ.get("STRIPE_SECRET_KEY", "")
    if not key.startswith(("sk_", "rk_")):
        sys.exit("Provide a Stripe secret key via --key or $STRIPE_SECRET_KEY.")

    stripe = Stripe(key)
    mode = "LIVE" if key.startswith(("sk_live_", "rk_live_")) else "TEST"
    print(f"Syncing VisaAI subscription catalog in {mode} mode…\n", file=sys.stderr)

    wanted = [lookup_key(p, i) for p in PLANS for i in INTERVALS]
    existing = {
        price["lookup_key"]: price
        for price in stripe.get("/prices", {"lookup_keys[]": wanted, "limit": 100})["data"]
    }

    # Products carry no lookup_key, so match them on metadata instead.
    products = {
        product["metadata"]["plan"]: product
        for product in stripe.get("/products", {"limit": 100, "active": "true"})["data"]
        if product.get("metadata", {}).get("app") == "visaai"
        and product.get("metadata", {}).get("plan") in PLANS
    }

    catalog: dict[str, dict[str, str]] = {}
    mismatches: list[str] = []

    for plan, spec in PLANS.items():
        product = products.get(plan)
        if product is None:
            product = stripe.post(
                "/products",
                {
                    "name": spec["name"],
                    "description": spec["description"],
                    **flatten("metadata", {
                        "plan": plan,
                        "app": "visaai",
                        "credit_cap": str(spec["credit_cap"]),
                    }),
                },
            )
            print(f"  + product {plan:<8} {product['id']}", file=sys.stderr)
        else:
            print(f"  = product {plan:<8} {product['id']}", file=sys.stderr)

        catalog[plan] = {}
        for interval in INTERVALS:
            lk = lookup_key(plan, interval)
            amount = spec["amounts"][interval]
            price = existing.get(lk)

            if price is None:
                price = stripe.post(
                    "/prices",
                    {
                        "product": product["id"],
                        "unit_amount": amount,
                        "currency": CURRENCY,
                        "recurring[interval]": interval,
                        "lookup_key": lk,
                        **flatten("metadata", {"plan": plan, "interval": interval}),
                    },
                )
                print(f"  + price   {lk:<22} {price['id']}", file=sys.stderr)
            else:
                print(f"  = price   {lk:<22} {price['id']}", file=sys.stderr)
                if price["unit_amount"] != amount:
                    mismatches.append(
                        f"{lk}: Stripe has {price['unit_amount']}, code expects {amount}"
                    )

            catalog[plan][interval] = price["id"]

    if mismatches:
        print("\nWARNING — price amounts differ from subscription.constants.ts:", file=sys.stderr)
        for line in mismatches:
            print(f"  ! {line}", file=sys.stderr)
        print(
            "Stripe prices are immutable. To change an amount, create a new price\n"
            "(new lookup_key or archive the old one first) and migrate subscriptions.",
            file=sys.stderr,
        )

    print(f"\nAdd to your {mode.lower()}-mode apps/api/.env:\n", file=sys.stderr)
    print(f"SUBSCRIPTION_PRICES='{json.dumps(catalog, separators=(',', ':'))}'")


if __name__ == "__main__":
    main()
