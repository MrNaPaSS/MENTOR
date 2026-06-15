import asyncio
import os
import time
import aiohttp
from dotenv import load_dotenv
from core.weex.real import RealWeexClient

load_dotenv(dotenv_path="e:/7777/бот и приложение weex/MENTOR/.env")

async def test():
    # Создадим сессию сами, чтобы перехватить ответ
    async with aiohttp.ClientSession() as session:
        client = RealWeexClient(
            api_key=os.getenv("WEEX_API_KEY"),
            secret=os.getenv("WEEX_SECRET_KEY"),
            passphrase=os.getenv("WEEX_PASSPHRASE"),
            affiliate_key=os.getenv("WEEX_AFFILIATE_KEY"),
            affiliate_secret=os.getenv("WEEX_AFFILIATE_SECRET"),
            affiliate_passphrase=os.getenv("WEEX_AFFILIATE_PASSPHRASE"),
            session=session
        )
        
        now = int(time.time() * 1000)
        day_ms = 86400000
        
        # Точный расчет как в бэкенде
        days = 30 # или любой другой
        end = now
        start = end - days * day_ms
        uid_start = end - 90 * day_ms
        
        # Выполняем GET вручную с заголовками от клиента, чтобы напечатать body при ошибке
        params = {"startTime": uid_start, "endTime": end, "pageNo": 1}
        query = "&".join(f"{k}={v}" for k, v in params.items())
        path_q = f"/api/v3/rebate/affiliate/getAffiliateUIDs?{query}"
        headers = client._signed_headers("GET", path_q, affiliate=True)
        
        async with session.get("https://api-spot.weex.com/api/v3/rebate/affiliate/getAffiliateUIDs", params=params, headers=headers) as resp:
            print(f"Status: {resp.status}")
            print(f"Body: {await resp.text()}")

asyncio.run(test())
