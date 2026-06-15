import asyncio
import os
import time
from dotenv import load_dotenv
from core.weex.real import RealWeexClient

# Загрузим .env
load_dotenv(dotenv_path="e:/7777/бот и приложение weex/MENTOR/.env")

async def test():
    api_key = os.getenv("WEEX_API_KEY")
    secret = os.getenv("WEEX_SECRET_KEY")
    passphrase = os.getenv("WEEX_PASSPHRASE")
    
    aff_key = os.getenv("WEEX_AFFILIATE_KEY")
    aff_secret = os.getenv("WEEX_AFFILIATE_SECRET")
    aff_passphrase = os.getenv("WEEX_AFFILIATE_PASSPHRASE")
    
    client = RealWeexClient(
        api_key=api_key,
        secret=secret,
        passphrase=passphrase,
        affiliate_key=aff_key,
        affiliate_secret=aff_secret,
        affiliate_passphrase=aff_passphrase
    )
    
    now = int(time.time() * 1000)
    day_ms = 86400000
    
    for days in [7, 30, 90]:
        start = now - days * day_ms
        uids = await client.get_affiliate_uids(start, now)
        trade = await client.get_channel_trade_asset(start, now)
        
        print(f"=== {days} DAYS ===")
        print(f"Range: {start} to {now}")
        print(f"UIDs count: {len(uids)}")
        print(f"Trade count: {len(trade)}")
        if uids:
            print(f"First UID in list: {uids[0]}")
        if trade:
            print(f"First Trade in list: {trade[0]}")
        print()

    await client.close()

if __name__ == "__main__":
    asyncio.run(test())
