import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

API_ID = 28045969
API_HASH = "d8e515c5687943e5e0bf046f87c3d2cc"

async def main():
    print("=" * 60)
    print("🔑 GENERADOR DE STRING SESSION DE TELEGRAM")
    print("=" * 60)
    print("Este script te pedirá tu número de teléfono y el código de Telegram")
    print("para generar una nueva StringSession limpia y válida.")
    print("-" * 60)
    
    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.start()
    
    session_string = client.session.save()
    me = await client.get_me()
    
    print("\n" + "=" * 60)
    print(f"✅ ¡SESIÓN GENERADA CON ÉXITO PARA: {me.first_name} (ID: {me.id})!")
    print("=" * 60)
    print("\nCopia esta cadena exacta y actualízala en tu .env y en Render (SESSION_BUNKER):\n")
    print(session_string)
    print("\n" + "=" * 60)
    
    await client.disconnect()

if __name__ == '__main__':
    asyncio.run(main())
