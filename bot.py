import os
import sys
import logging
import asyncio
import time
import discord
import yaml

from logger.logging import print_log, Colors
from handler.voice import connect_voice, handle_voice_state_update
from handler.autoquest import run_auto_quest
from handler.giveaway import process_giveaway
from handler.streamRPC import start_rpc

os.system('')
logging.getLogger('discord').setLevel(logging.CRITICAL)
logging.getLogger('discord.http').setLevel(logging.CRITICAL)
logging.getLogger('discord.gateway').setLevel(logging.CRITICAL)
logging.getLogger('discord.client').setLevel(logging.CRITICAL)


def load_config():
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yml")
    if not os.path.exists(config_path):
        print_log("[</>] Error : config.yml not found!\n", Colors.red_to_yellow, interval=0.05)
        sys.exit(1)
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


class SelfBot(discord.Client):
    def __init__(self, config):
        super().__init__(self_bot=True)
        self.config = config
        self.status_index = -1
        self.rpc_index = -1
        self.asset_cache = {}
        self.start_time = int(time.time())

        self.joined_giveaways = set()

        rpc_cfg = self.config.get("rpc_config") or {}
        self.loop_delay = rpc_cfg.get("delay", 5)

    async def on_message(self, message):
        await process_giveaway(self, message)

    async def on_message_edit(self, before, after):
        await process_giveaway(self, after)

    async def on_voice_state_update(self, member, before, after):
        if member.id == self.user.id:
            await handle_voice_state_update(self, before, after)

    async def on_ready(self):
        sys.stdout.write('\r' + ' ' * 50 + '\r')
        sys.stdout.flush()

        print_log(f"[</>] Connected | {self.user.display_name}\n\n", Colors.cyan_to_blue, interval=0.05)
        print_log("Welcome to Discord Self Bot , made by Tuan Haii - w love\n\n", Colors.cyan_to_blue, interval=0.05)

        rpc_data = (self.config.get("rpc_config") or {}).get("data", [])
        rpc_count = len(rpc_data) if isinstance(rpc_data, list) else 0
        status_data = (self.config.get("custom_status") or {}).get("data", [])
        status_count = len(status_data) if isinstance(status_data, list) else 0

        print_log(f"[</>] RPCs      : {rpc_count} loaded\n", Colors.green_to_cyan, interval=0.03)
        print_log(f"[</>] Statuses  : {status_count} loaded\n", Colors.green_to_cyan, interval=0.03)
        print_log(f"[</>] Loop Delay: {self.loop_delay}s\n\n", Colors.green_to_cyan, interval=0.03)

        if not hasattr(self, 'status_changer_started'):
            self.status_changer_started = True
            asyncio.create_task(start_rpc(self))
            asyncio.create_task(run_auto_quest(self))

        asyncio.create_task(connect_voice(self))


def main():
    config = load_config()
    token = config.get("token", "")

    if not token:
        print_log("[</>] Error : No token found in config.yml!\n", Colors.red_to_yellow, interval=0.05)
        sys.exit(1)

    print_log("[</>] Connecting...", Colors.cyan_to_blue, interval=0.05)

    client = SelfBot(config)
    try:
        try:
            client.run(token, log_handler=None)
        except TypeError:
            client.run(token)
    except discord.LoginFailure:
        sys.stdout.write('\r' + ' ' * 50 + '\r')
        sys.stdout.flush()
        print_log("[</>] Error : Invalid token\n", Colors.red_to_yellow, interval=0.05)
    except Exception as e:
        sys.stdout.write('\r' + ' ' * 50 + '\r')
        sys.stdout.flush()
        print_log(f"[</>] Error : {e}\n", Colors.red_to_yellow, interval=0.05)


if __name__ == "__main__":
    main()