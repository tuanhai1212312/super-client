import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
import asyncio
import requests
import discord

from logger.logging import print_log, Colors
from handler.custom_Status import parse_status


def register_asset(token, app_id, url):
    if not url:
        return url
    try:
        headers = {"Authorization": token, "Content-Type": "application/json"}
        r = requests.post(
            f"https://discord.com/api/v9/applications/{app_id}/external-assets",
            headers=headers,
            json={"urls": [url]},
            timeout=3
        )
        if r.status_code == 200:
            data = r.json()
            if data and len(data) > 0:
                path = data[0].get("external_asset_path", "")
                if path:
                    return f"mp:{path}"
    except Exception:
        pass
    return url


def preload_assets(token, app_id, large_url, small_url):
    cache = {}
    loaded = 0

    if large_url:
        resolved = register_asset(token, app_id, large_url)
        cache["large"] = resolved
        if resolved.startswith("mp:"):
            loaded += 1

    if small_url:
        resolved = register_asset(token, app_id, small_url)
        cache["small"] = resolved
        if resolved.startswith("mp:"):
            loaded += 1

    return cache, loaded


class RichActivity(discord.Activity):
    def __init__(self, **kwargs):
        self._assets = kwargs.pop('assets', {})
        self._buttons = kwargs.pop('buttons', [])
        self._metadata = kwargs.pop('metadata', {})
        self._app_id = kwargs.pop('application_id', "1504319607975051294")
        self._timestamps = kwargs.pop('timestamps', None)
        self._stream_url = kwargs.pop('stream_url', None)
        self._force_type = kwargs.pop('force_type', None)
        super().__init__(**kwargs)

    def to_dict(self):
        ret = super().to_dict()
        ret['application_id'] = self._app_id
        if self._force_type is not None:
            ret['type'] = self._force_type
        if self._stream_url:
            ret['url'] = self._stream_url
        if self._assets:
            ret['assets'] = self._assets
        if self._buttons:
            ret['buttons'] = self._buttons
        if self._metadata:
            ret['metadata'] = self._metadata
        if self._timestamps:
            ret['timestamps'] = self._timestamps
        return ret


async def start_rpc(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        try:
            config = bot.config
            rpc_config = config.get("rpc_config", {})
            status_cfg = config.get("custom_status", {})
            statuses = status_cfg.get("data", []) if isinstance(status_cfg, dict) else []
            token = config.get("token", "")

            if not statuses and not rpc_config:
                await asyncio.sleep(5)
                continue

            activities = []

            if statuses:
                bot.status_index = (bot.status_index + 1) % len(statuses)
                status_text = await parse_status(bot, statuses[bot.status_index])

                if hasattr(discord, 'CustomActivity'):
                    activities.append(discord.CustomActivity(name=status_text))
                else:
                    activities.append(discord.Activity(
                        type=discord.ActivityType.custom,
                        name="Custom Status",
                        state=status_text
                    ))

            rpc_data = rpc_config.get("data", [])
            rpc_item = None
            delay = 5

            if rpc_data:
                if not hasattr(bot, "rpc_index"):
                    bot.rpc_index = -1
                bot.rpc_index = (bot.rpc_index + 1) % len(rpc_data)
                rpc_item = rpc_data[bot.rpc_index]

            if rpc_item:
                rpc_type = rpc_item.get("type", "")
                app_id = rpc_item.get("app_id") or rpc_config.get("app_id", "1504319607975051294")

                large_url = rpc_item.get("large_img", "")
                small_url = rpc_item.get("small_img", "")
                cache_key = f"{large_url}|{small_url}"
                if not bot.asset_cache or bot.asset_cache.get("_key") != cache_key:
                    if token and app_id:
                        cache, _ = await asyncio.to_thread(preload_assets, token, app_id, large_url, small_url)
                        cache["_key"] = cache_key
                        bot.asset_cache = cache
                    else:
                        bot.asset_cache = {"large": large_url, "small": small_url, "_key": cache_key}

                assets = {}
                large_val = bot.asset_cache.get("large")
                if large_val:
                    assets["large_image"] = large_val

                small_val = bot.asset_cache.get("small")
                if small_val:
                    assets["small_image"] = small_val

                line3_lbl = rpc_item.get("album") if rpc_type == "Spotify" else rpc_item.get("line3", "")
                line3 = await parse_status(bot, line3_lbl) if line3_lbl else ""
                if line3:
                    assets["large_text"] = line3
                    assets["small_text"] = line3

                buttons = []
                button_urls = []
                btn1_lbl = rpc_item.get("btn1_lbl", "")
                btn1_url = rpc_item.get("btn1_url", "")
                btn2_lbl = rpc_item.get("btn2_lbl", "")
                btn2_url = rpc_item.get("btn2_url", "")

                if btn1_lbl:
                    parsed_lbl = await parse_status(bot, btn1_lbl)
                    parsed_url = await parse_status(bot, btn1_url)
                    buttons.append(parsed_lbl)
                    button_urls.append(parsed_url)
                if btn2_lbl:
                    parsed_lbl = await parse_status(bot, btn2_lbl)
                    parsed_url = await parse_status(bot, btn2_url)
                    buttons.append(parsed_lbl)
                    button_urls.append(parsed_url)

                if rpc_type == "Spotify":
                    line1 = await parse_status(bot, rpc_item.get("title", ""))
                    line2 = await parse_status(bot, rpc_item.get("artist", ""))

                    try:
                        duration = int(rpc_item.get("duration", 220))
                    except (ValueError, TypeError):
                        duration = 220

                    try:
                        elapsed = int(rpc_item.get("elapsed", 0))
                    except (ValueError, TypeError):
                        elapsed = 0

                    start_time_ms = int(time.time() - elapsed) * 1000
                    end_time_ms = start_time_ms + int(duration * 1000)
                    timestamps = {"start": start_time_ms, "end": end_time_ms}

                    activities.append(RichActivity(
                        type=discord.ActivityType.listening,
                        name="Spotify",
                        details=line1,
                        state=line2,
                        assets=assets,
                        buttons=buttons,
                        metadata={"button_urls": button_urls} if button_urls else {},
                        timestamps=timestamps,
                        application_id=app_id,
                        force_type=2
                    ))

                elif rpc_type == "Playing":
                    line1 = await parse_status(bot, rpc_item.get("title", ""))
                    line2 = await parse_status(bot, rpc_item.get("line2", ""))

                    playing_minutes = rpc_item.get("playing_time", 0)
                    if playing_minutes:
                        play_start = int(time.time()) - (int(playing_minutes) * 60)
                    else:
                        play_start = bot.start_time

                    activities.append(RichActivity(
                        type=discord.ActivityType.playing,
                        name=line1 if line1 else "Game",
                        details=line1,
                        state=line2,
                        assets=assets,
                        buttons=buttons,
                        metadata={"button_urls": button_urls} if button_urls else {},
                        application_id=app_id,
                        force_type=0,
                        timestamps={"start": play_start}
                    ))

                elif rpc_type in ["Twitch", "Youtube"]:
                    line1 = await parse_status(bot, rpc_item.get("title", ""))
                    line2 = await parse_status(bot, rpc_item.get("line2", ""))

                    if rpc_type == "Youtube":
                        stream_url = "https://www.youtube.com/channel/UCIW369dnbnmf2YqIF3U6XMQ"
                        stream_name = "YouTube"
                    else:
                        stream_url = "https://www.twitch.tv/tuanhaidz"
                        stream_name = "Twitch"

                    activities.append(RichActivity(
                        type=discord.ActivityType.streaming,
                        name=stream_name,
                        url=stream_url,
                        details=line1,
                        state=line2,
                        assets=assets,
                        buttons=buttons,
                        metadata={"button_urls": button_urls} if button_urls else {},
                        application_id=app_id,
                        force_type=1,
                        stream_url=stream_url,
                        timestamps={"start": bot.start_time}
                    ))


                delay_val = rpc_item.get("delay") or rpc_config.get("delay") or status_cfg.get("delay") or 5
                try:
                    delay = float(delay_val)
                    if delay <= 0:
                        delay = 5
                except (ValueError, TypeError):
                    delay = 5
            else:
                delay_val = status_cfg.get("delay") or 5
                try:
                    delay = float(delay_val)
                    if delay <= 0:
                        delay = 5
                except (ValueError, TypeError):
                    delay = 5

            if activities:
                await bot.change_presence(status=discord.Status.online, activities=activities)

            await asyncio.sleep(delay)

        except Exception as e:
            print_log(f"\n[!] Error updating status: {e}\n", Colors.red_to_yellow, interval=0)
            await asyncio.sleep(5)


if __name__ == "__main__":
    print("[</>] This is a modular handler and should be run via bot.py, not directly.")
