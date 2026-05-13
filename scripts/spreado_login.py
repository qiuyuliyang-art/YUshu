#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Spreado 登录助手
改进的登录流程，增加等待时间，避免误判
"""

import sys
import json
import asyncio
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "Spreado"))

from spreado.core.browser import StealthBrowser
from spreado.core.uploader import BaseUploader
from spreado.conf import COOKIES_DIR
from playwright.async_api import Page, Error


class DouyinLoginHelper(BaseUploader):
    """抖音登录助手"""

    @property
    def platform_name(self) -> str:
        return "douyin"

    @property
    def display_name(self) -> str:
        return "抖音"

    @property
    def login_url(self) -> str:
        return "https://creator.douyin.com/"

    @property
    def publish_url(self) -> str:
        return "https://creator.douyin.com/creator-micro/content/upload"

    @property
    def _login_selectors(self) -> List[str]:
        return ['text="手机号登录"', 'text="扫码登录"', 'text="登录"', ".login-btn"]

    @property
    def _authed_selectors(self) -> List[str]:
        # 使用更精确的选择器，避免误判
        return [
            "input[placeholder*='作品标题']",
            "div.semi-upload",
        ]

    async def _upload_video(self, page: Page, file_path, title="", content="", tags=None, publish_date=None, thumbnail_path=None) -> bool:
        return False


class XiaohongshuLoginHelper(BaseUploader):
    """小红书登录助手"""

    @property
    def platform_name(self) -> str:
        return "xiaohongshu"

    @property
    def display_name(self) -> str:
        return "小红书"

    @property
    def login_url(self) -> str:
        return "https://creator.xiaohongshu.com/"

    @property
    def publish_url(self) -> str:
        return "https://creator.xiaohongshu.com/publish/publish"

    @property
    def _login_selectors(self) -> List[str]:
        return ['text="短信登录"', 'text="扫码登录"', 'button:has-text("登")', ".login-btn"]

    @property
    def _authed_selectors(self) -> List[str]:
        # 使用更精确的选择器
        return [
            "input.upload-input",
            'button:has-text("上传图片")',
            'button:has-text("上传视频")',
        ]

    async def _upload_video(self, page: Page, file_path, title="", content="", tags=None, publish_date=None, thumbnail_path=None) -> bool:
        return False


async def login_with_wait(platform: str, timeout: int = 300) -> dict:
    """改进的登录流程，增加等待时间"""
    helpers = {
        "douyin": DouyinLoginHelper,
        "xiaohongshu": XiaohongshuLoginHelper,
    }

    if platform not in helpers:
        return {"success": False, "error": f"不支持的平台: {platform}"}

    helper = helpers[platform]()

    try:
        # 打开浏览器，让用户登录
        async with await StealthBrowser.create(headless=False) as browser:
            page = await browser.new_page()
            await page.goto(helper.login_url)

            print(f"[INFO] 请在浏览器中登录 {helper.display_name}...", flush=True)
            print(f"[INFO] 等待最长 {timeout} 秒...", flush=True)

            # 等待用户登录完成
            start = asyncio.get_event_loop().time()
            logged_in = False

            while (asyncio.get_event_loop().time() - start) < timeout:
                await page.wait_for_timeout(2000)

                # 检查是否离开登录页面
                current_url = page.url
                if "login" not in current_url and "passport" not in current_url:
                    # 可能已登录，再等几秒确认
                    await page.wait_for_timeout(5000)

                    # 检查是否有认证元素出现
                    for selector in helper._authed_selectors:
                        try:
                            el = page.locator(selector)
                            if await el.count() > 0 and await el.first.is_visible():
                                logged_in = True
                                break
                        except:
                            continue

                    if logged_in:
                        break

                    # 检查是否还需要登录
                    need_login = False
                    for selector in helper._login_selectors:
                        try:
                            el = page.locator(selector)
                            if await el.count() > 0 and await el.first.is_visible():
                                need_login = True
                                break
                        except:
                            continue

                    if not need_login:
                        # 没有登录表单，可能已登录
                        logged_in = True
                        break

            if not logged_in:
                return {"success": False, "error": "登录超时"}

            # 登录成功，保存 cookie
            helper.cookie_file_path.parent.mkdir(parents=True, exist_ok=True)

            # 先导航到发布页，获取完整的 cookie
            await page.goto(helper.publish_url)
            await page.wait_for_timeout(5000)

            # 保存 cookie
            await page.context.storage_state(path=helper.cookie_file_path)

            print(f"[INFO] 登录成功，Cookie 已保存到: {helper.cookie_file_path}", flush=True)

            return {
                "success": True,
                "platform": platform,
                "message": f"{helper.display_name}登录成功",
                "cookie_path": str(helper.cookie_file_path),
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法: python spreado_login.py <platform> [--timeout 300]"}))
        sys.exit(1)

    platform = sys.argv[1]
    timeout = 300

    # 解析参数
    if "--timeout" in sys.argv:
        idx = sys.argv.index("--timeout")
        if idx + 1 < len(sys.argv):
            timeout = int(sys.argv[idx + 1])

    result = await login_with_wait(platform, timeout)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
