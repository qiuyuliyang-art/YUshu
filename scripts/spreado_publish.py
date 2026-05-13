#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Spreado 发布助手
支持视频和图文发布，使用 Spreado 的浏览器和 Cookie 管理
"""

import sys
import json
import asyncio
from pathlib import Path
from typing import List, Optional

# 添加 Spreado 到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "Spreado"))

from spreado.core.browser import StealthBrowser
from spreado.core.uploader import BaseUploader
from spreado.conf import COOKIES_DIR
from playwright.async_api import Page


class ImageTextPublisher(BaseUploader):
    """图文发布器基类"""

    @property
    def platform_name(self) -> str:
        return self._platform

    @property
    def display_name(self) -> str:
        return self._display_name

    @property
    def login_url(self) -> str:
        return self._login_url

    @property
    def publish_url(self) -> str:
        return self._publish_url

    @property
    def _login_selectors(self) -> List[str]:
        return [
            'text="短信登录"',
            'text="扫码登录"',
            'button:has-text("登")',
            ".login-btn",
        ]

    @property
    def _authed_selectors(self) -> List[str]:
        return self._authed_sels

    def __init__(self, platform: str, display_name: str, login_url: str, publish_url: str, authed_selectors: List[str]):
        self._platform = platform
        self._display_name = display_name
        self._login_url = login_url
        self._publish_url = publish_url
        self._authed_sels = authed_selectors
        super().__init__()

    async def _upload_video(self, page: Page, file_path, title="", content="", tags=None, publish_date=None, thumbnail_path=None) -> bool:
        raise NotImplementedError("Use publish_image_text instead")


class DouyinImageTextPublisher(ImageTextPublisher):
    """抖音图文发布器"""

    def __init__(self):
        super().__init__(
            platform="douyin",
            display_name="抖音",
            login_url="https://creator.douyin.com/",
            publish_url="https://creator.douyin.com/creator-micro/content/upload",
            authed_selectors=[
                "div[class^='container']",
                "div[class*='upload']",
                "input[placeholder*='作品标题']",
            ],
        )

    async def publish_image_text(self, images: List[str], title: str, content: str, tags: List[str] = None) -> bool:
        try:
            with self.logger.step("publish_image_text", title=title):
                # 验证 cookie
                if not await self.verify_cookie_flow(auto_login=False):
                    raise RuntimeError("Cookie 无效，请先登录")

                async with await StealthBrowser.create(headless=False) as browser:
                    await browser.load_cookies_from_file(self.cookie_file_path)
                    page = await browser.new_page()

                    # 导航到发布页
                    await page.goto(self.publish_url)
                    await page.wait_for_timeout(3000)

                    # 切换到图文模式
                    image_tab = page.locator('text="图文"')
                    if await image_tab.count() > 0:
                        await image_tab.click()
                        await page.wait_for_timeout(2000)

                    # 上传图片
                    for img_path in images:
                        await page.locator('input[type="file"]').set_input_files(img_path)
                        await page.wait_for_timeout(2000)

                    # 填写标题
                    title_input = page.locator('input[placeholder*="标题"]')
                    if await title_input.count() > 0:
                        await title_input.fill(title)

                    # 填写描述
                    desc_input = page.locator('div[contenteditable="true"]')
                    if await desc_input.count() > 0:
                        full_text = content
                        if tags:
                            full_text += "\n\n" + " ".join([f"#{t}" for t in tags])
                        await desc_input.fill(full_text)

                    self.logger.info("图文已填入，请在浏览器中检查并发布")
                    # 等待用户操作
                    await page.wait_for_timeout(300000)  # 5 分钟
                    return True

        except Exception as e:
            self.logger.error("图文发布失败", reason=str(e)[:200])
            return False


class XiaohongshuImageTextPublisher(ImageTextPublisher):
    """小红书图文发布器"""

    def __init__(self):
        super().__init__(
            platform="xiaohongshu",
            display_name="小红书",
            login_url="https://creator.xiaohongshu.com/",
            publish_url="https://creator.xiaohongshu.com/publish/publish",
            authed_selectors=[
                "input.upload-input",
                'button:has-text("上传图片")',
                'button:has-text("上传视频")',
            ],
        )

    async def publish_image_text(self, images: List[str], title: str, content: str, tags: List[str] = None) -> bool:
        try:
            with self.logger.step("publish_image_text", title=title):
                # 验证 cookie
                if not await self.verify_cookie_flow(auto_login=False):
                    raise RuntimeError("Cookie 无效，请先登录")

                async with await StealthBrowser.create(headless=False) as browser:
                    await browser.load_cookies_from_file(self.cookie_file_path)
                    page = await browser.new_page()

                    # 导航到发布页
                    await page.goto(self.publish_url)
                    await page.wait_for_timeout(3000)

                    # 上传图片
                    for img_path in images:
                        await page.locator('input[type="file"]').set_input_files(img_path)
                        await page.wait_for_timeout(2000)

                    # 填写标题
                    title_input = page.locator('#title-textarea, input[placeholder*="标题"]')
                    if await title_input.count() > 0:
                        await title_input.fill(title[:20])  # 小红书标题限制

                    # 填写描述
                    desc_input = page.locator('#post-textarea, div[contenteditable="true"]')
                    if await desc_input.count() > 0:
                        full_text = content
                        if tags:
                            full_text += "\n\n" + " ".join([f"#{t}" for t in tags])
                        await desc_input.fill(full_text)

                    self.logger.info("图文已填入，请在浏览器中检查并发布")
                    # 等待用户操作
                    await page.wait_for_timeout(300000)  # 5 分钟
                    return True

        except Exception as e:
            self.logger.error("图文发布失败", reason=str(e)[:200])
            return False


async def publish_image_text(platform: str, images: List[str], title: str, content: str, tags: List[str] = None) -> dict:
    """发布图文"""
    publishers = {
        "douyin": DouyinImageTextPublisher,
        "xiaohongshu": XiaohongshuImageTextPublisher,
    }

    if platform not in publishers:
        return {"success": False, "error": f"不支持的平台: {platform}"}

    publisher = publishers[platform]()
    result = await publisher.publish_image_text(images, title, content, tags)

    return {
        "success": result,
        "platform": platform,
        "message": "图文已填入浏览器" if result else "发布失败",
    }


async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法: python spreado_publish.py <platform> --images img1 img2 --title 标题 --content 描述 [--tags tag1,tag2]"}))
        sys.exit(1)

    platform = sys.argv[1]

    # 解析参数
    args = sys.argv[2:]
    images = []
    title = ""
    content = ""
    tags = []

    i = 0
    while i < len(args):
        if args[i] == "--images":
            i += 1
            while i < len(args) and not args[i].startswith("--"):
                images.append(args[i])
                i += 1
        elif args[i] == "--title":
            i += 1
            if i < len(args):
                title = args[i]
                i += 1
        elif args[i] == "--content":
            i += 1
            if i < len(args):
                content = args[i]
                i += 1
        elif args[i] == "--tags":
            i += 1
            if i < len(args):
                tags = args[i].split(",")
                i += 1
        else:
            i += 1

    if not images:
        print(json.dumps({"error": "缺少图片文件"}))
        sys.exit(1)

    if not title:
        print(json.dumps({"error": "缺少标题"}))
        sys.exit(1)

    result = await publish_image_text(platform, images, title, content, tags)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
