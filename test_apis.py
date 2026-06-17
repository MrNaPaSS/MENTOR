"""Тест внешних API - запускать из корня проекта: venv/Scripts/python test_apis.py"""
import asyncio
import aiohttp

async def test(name, url, params=None, headers=None):
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, params=params, headers=headers, ssl=False, timeout=aiohttp.ClientTimeout(total=10)) as r:
                text = await r.text()
                ok = "OK" if r.status == 200 else f"HTTP {r.status}"
                preview = text[:120].replace("\n", " ")
                print(f"[{ok}] {name}\n      {preview}\n")
    except Exception as e:
        print(f"[ERR] {name}\n      {e}\n")

async def main():
    YAHOO_H = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
        "Accept": "application/json,*/*",
        "Referer": "https://finance.yahoo.com/",
    }

    tests = [
        # CFTC COT
        ("CFTC BTC (contains filter)",
         "https://publicreporting.cftc.gov/api/odata/v1/FinancialFuturesOnly_001_Cr_ChAl",
         {"$filter":"contains(Market_and_Exchange_Names,'BITCOIN')","$top":"2","$orderby":"Report_Date_as_YYYY_MM_DD desc"}, None),

        ("CFTC BTC (no filter, first 2)",
         "https://publicreporting.cftc.gov/api/odata/v1/FinancialFuturesOnly_001_Cr_ChAl",
         {"$top":"2"}, None),

        # Yahoo Finance
        ("Yahoo Finance DXY",
         "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB",
         {"interval":"1d","range":"5d"}, YAHOO_H),

        ("Yahoo Finance SPX",
         "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC",
         {"interval":"1d","range":"5d"}, YAHOO_H),

        # Stooq (альтернатива Yahoo)
        ("Stooq DXY",  "https://stooq.com/q/l/?s=^dxy&f=sd2t2ohlcv&h&e=json",  None, None),
        ("Stooq SPX",  "https://stooq.com/q/l/?s=^spx&f=sd2t2ohlcv&h&e=json",  None, None),
        ("Stooq Gold", "https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=json", None, None),
        ("Stooq VIX",  "https://stooq.com/q/l/?s=^vix&f=sd2t2ohlcv&h&e=json",  None, None),
        ("Stooq US10Y","https://stooq.com/q/l/?s=10us.b&f=sd2t2ohlcv&h&e=json",None, None),
        ("Stooq Oil",  "https://stooq.com/q/l/?s=cl.f&f=sd2t2ohlcv&h&e=json",  None, None),

        # ETF via Stooq
        ("Stooq IBIT",  "https://stooq.com/q/l/?s=ibit.us&f=sd2t2ohlcv&h&e=json", None, None),
        ("Stooq FBTC",  "https://stooq.com/q/l/?s=fbtc.us&f=sd2t2ohlcv&h&e=json", None, None),

        # CoinGecko (крипто данные)
        ("CoinGecko global",
         "https://api.coingecko.com/api/v3/global", None, None),
    ]

    for name, url, params, headers in tests:
        await test(name, url, params, headers)

asyncio.run(main())
