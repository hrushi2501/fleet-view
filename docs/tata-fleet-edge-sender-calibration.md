# Fuel sender calibration and reporting faults — Tata Fleet Edge

**Customer:** Mahadev Constructions
**Subscription:** Fleet Edge Basic Push API, 13 vehicles
**Evidence period:** 20 Aug – 2 Sep 2026 (14 days), taken from the Basic Push feed as received
**Raised:** 2 September 2026

---

## Summary

Of 13 subscribed vehicles, **3 fuel senders are reporting impossible values** and
**2 units are not reporting at all**. We are asking for on-site calibration or
replacement of the three senders, and for the two silent units to be investigated.

We use this feed to detect diesel theft. A sender that invents 200 litres cannot
support that, and — more seriously — risks a driver being wrongly accused. We
have had to switch these vehicles off in our own system until they are fixed.

---

## Issue 1 — Three fuel senders report physically impossible values

**Priority: high.**

Diesel cannot appear in a sealed tank. To avoid any argument about whether a
rise was a genuine refuel, the figures below count **only** rises that then
collapse back below their own starting level within 15 minutes. No refuel
behaves that way; this can only be sender error.

| Vehicle | Registration | Device IMEI | Tank | False gains in 14 days | Worst single error |
|---|---|---|---|---|---|
| TRU-114 | RJ21GE3219 | 864568069379619 | 300 L | **52** | **209.8 L — 70% of tank** |
| TRU-112 | RJ21GE1657 | 869128060472528 | 300 L | **111** | **193.0 L — 64% of tank** |
| TRU-102 | RJ21GD0599 | 866562068821836 | 160 L | **8** | **122.0 L — 76% of tank** |

These units alternate between two states minutes apart. Over a 24-hour window
the swings measured:

- **RJ21GE1657** — rises of +238.7 L and falls of −243.2 L on a 300 L tank
- **RJ21GE3219** — rises of +177.9 L and falls of −172.4 L on a 300 L tank
- **RJ21GD0599** — rises of +76.0 L and falls of −67.0 L on a 160 L tank

**Requested action:** on-site inspection, recalibration, or replacement of the
fuel level sender on these three vehicles. Please confirm whether this is a
sender fault, a wiring/earthing fault, or a calibration table issue.

---

## Issue 2 — Residual error on the working senders

**Priority: medium.** The remaining units are usable but not precise.

Measured on the same conservative basis (rises that collapse back), the working
senders show:

| Vehicle | Registration | IMEI | Worst error | As % of tank |
|---|---|---|---|---|
| TRU-106 | RJ21GD6559 | 867018061396457 | 10.3 L | 3.4% |
| TRU-108 | RJ21GD6558 | 869860089541715 | 9.3 L | 3.1% |
| TRU-109 | RJ21GE2479 | 864568069278266 | 9.3 L | 3.1% |
| TRU-54 | RJ21GC7857 | 860037051995240 | 8.0 L | 2.7% |
| TRU-053 | RJ21GE3220 | 869128067042480 | 6.6 L | 2.2% |
| TRU-101 | RJ21GD0598 | 866562069615187 | 6.0 L | 3.8% |
| TRU-111 | RJ21GE1656 | 869128060454807 | 5.5 L | 1.8% |
| TRU-107 | RJ21GD6557 | 868274067363327 | 5.6 L | 1.9% |

A worked example, RJ21GD0598 on the evening of 30 Aug 2026, parked, engine off,
nobody filling it:

```
19:50 IST    93 L
20:17 IST   101 L     (+8 L — no fill took place)
20:47 IST    89 L     (−12 L)
21:52 IST    93 L     (recovered to the original level)
```

**Questions for your team:**

1. What fuel-level accuracy is specified for these senders — as a percentage of
   tank, or in litres?
2. Is the ±2–3.4% we are measuring within that specification, or does it also
   indicate units needing calibration?
3. Can accuracy be improved by recalibration against a known tank volume, and is
   that a service you provide?

This matters because it sets the smallest theft we can detect. At 3% of a 300 L
tank, a loss below roughly 10 litres is indistinguishable from sender error.

---

## Issue 3 — Two vehicles not reporting

**Priority: high.**

| Vehicle | Registration | Chassis | Status |
|---|---|---|---|
| TRU-110 | RJ21GE1659 | MAT566006R3B04319 | **Never reported.** Zero readings received since subscription began. No IMEI has ever appeared in the feed for this vehicle. |
| TRU-54 | RJ21GC7857 | MAT777012M3H17382 | **Silent since 27 Aug 2026, 13:33 IST.** Reported normally before that (2,892 readings). |

Your own Fleet Edge portal shows the same last-seen date for RJ21GC7857, so this
is not a fault in our integration.

**Requested action:** confirm whether these two devices are provisioned and
active on your side, and what is needed to restore reporting.

---

## Issue 4 — Occasional long reporting gaps

**Priority: low.**

Normal reporting is good — median 1 minute, 90th percentile 2 minutes, whether
parked or moving. However the tail is long:

| Vehicle state | Median | 90th pct | 99th pct | Worst gap |
|---|---|---|---|---|
| Parked (ignition off) | 1.0 min | 2.0 min | 63.2 min | 258 min |
| Moving (ignition on) | 1.0 min | 2.0 min | 11.5 min | 126 min |

A 4-hour gap on a parked vehicle is a window in which fuel could be removed
unseen. **Question:** is there a configurable parked/ignition-off reporting
interval, and can the long tail be reduced?

---

## Issue 5 — Confirmation on `fuelLevelPercent`

**Priority: informational.**

The Basic Push specification lists a `fuelLevelPercent` field. Across roughly
30,000 readings from all 13 vehicles it has never been populated; only litres
arrive. We derive the percentage from litres and tank capacity.

**Question:** is `fuelLevelPercent` deprecated, or does it require enabling on
the subscription? We would prefer to use your value than compute our own.

---

## What we are asking for

1. **Calibrate or replace** the fuel senders on RJ21GE3219, RJ21GE1657 and
   RJ21GD0599.
2. **Restore reporting** on RJ21GE1659 and RJ21GC7857.
3. **Confirm the accuracy specification** for the fuel sender, and whether the
   remaining units meet it.
4. **Advise** on the parked reporting interval and on `fuelLevelPercent`.

We are happy to provide the raw readings behind any figure in this document.

---

*All figures measured directly from the Basic Push feed as delivered to our
endpoint, 20 Aug – 2 Sep 2026. Timestamps are IST.*
