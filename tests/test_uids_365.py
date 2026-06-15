import asyncio, os, time
from dotenv import load_dotenv
load_dotenv(override=True)
from core.weex.real import RealWeexClient

async def main():
    c = RealWeexClient(
        api_key=os.getenv("WEEX_API_KEY"),
        secret=os.getenv("WEEX_SECRET_KEY"),
        passphrase=os.getenv("WEEX_PASSPHRASE"),
        affiliate_key=os.getenv("WEEX_AFFILIATE_KEY"),
        affiliate_secret=os.getenv("WEEX_AFFILIATE_SECRET"),
        affiliate_passphrase=os.getenv("WEEX_AFFILIATE_PASSPHRASE"),
    )
    now = int(time.time() * 1000)
    day = 86_400_000

    for days in [7, 30, 90, 180, 365]:
        start = now - days * day
        uids = await c.get_affiliate_uids(start, now)
        print(f"{days:3}d UIDs: {len(uids)}")

    # Попробуем с page=2 для 90 дней
    uids_p1 = await c.get_affiliate_uids(now - 90*day, now, page=1)
    uids_p2 = await c.get_affiliate_uids(now - 90*day, now, page=2)
    print(f"\n90d page1: {len(uids_p1)}, page2: {len(uids_p2)}")
    if uids_p1:
        print("First uid sample:", uids_p1[0])

    await c.close()

asyncio.run(main())
