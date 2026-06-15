import asyncio
import os
import time
from dotenv import load_dotenv
from core.weex.real import RealWeexClient

load_dotenv(dotenv_path="e:/7777/бот и приложение weex/MENTOR/.env")

async def test():
    client = RealWeexClient(
        api_key=os.getenv("WEEX_API_KEY"),
        secret=os.getenv("WEEX_SECRET_KEY"),
        passphrase=os.getenv("WEEX_PASSPHRASE"),
        affiliate_key=os.getenv("WEEX_AFFILIATE_KEY"),
        affiliate_secret=os.getenv("WEEX_AFFILIATE_SECRET"),
        affiliate_passphrase=os.getenv("WEEX_AFFILIATE_PASSPHRASE")
    )
    
    now = int(time.time() * 1000)
    day_ms = 86400000
    
    # Ищем топ-трейдера UID 2161061235
    target_uid = "2161061235"
    
    for days in [7, 30, 90]:
        start = now - days * day_ms
        trade = await client.get_channel_trade_asset(start, now)
        
        target_record = next((r for r in trade if r["uid"] == target_uid), None)
        print(f"=== {days} DAYS ===")
        print(f"Record for {target_uid}: {target_record}")
        print()

    await client.close()

if __name__ == "__main__":
    asyncio.run(test())
