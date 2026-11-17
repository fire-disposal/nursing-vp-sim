#!/usr/bin/env python3
"""台本：虚拟患者训练系统的病史采集演示。

目标不是把每个按钮点一遍，而是让看的人**看懂问诊这件事**：主诉 → 时间线 →
伴随症状 → 情绪与自责 → 危险筛查，右侧清单随对话自动勾选。

    demovid record --flow demo/flows/vpsim.py --segment demo \
        -- --url http://localhost:3300 --record 760 \
           --user student1 --password ******** --out-dir /tmp/rec-vpsim

`--record` 是训练记录 id：先在界面里开一场训练，地址栏 `/training/<id>` 里那串数字。
台本默认会先登录；已经能直接进训练页时加 `--skip-login`。
"""

import argparse

from playwright.sync_api import Page

from record import Recorder  # noqa: E402

FLOW = "vpsim"

# 演示用的问诊五问。措辞按真实采集顺序：主诉 → 时间线 → 睡眠食欲 → 情绪与自责 → 危险筛查。
QUESTIONS = [
    ("开场先落到主诉上。", "您今天来，是哪里不舒服？能具体说说吗？"),
    ("接着把时间线问清：什么时候开始、怎么变的。", "这种情绪是从什么时候开始的？最近有没有越来越重？"),
    ("再问具体表现，睡眠和食欲是最容易拉开差距的两项。", "晚上一般能睡几个小时？白天有没有没力气、吃不下饭？"),
    ("问到对宝宝的态度和自责——这一段往往决定共情做得好不好。", "照顾宝宝的时候，您心里是什么感觉？会不会觉得自己没做好？"),
    ("病史采集要收口在危险筛查上：自伤与既往史。", "有没有出现过伤害自己或宝宝的念头？以前有过类似的情况吗？"),
]


def add_arguments(p: argparse.ArgumentParser) -> None:
    p.add_argument("--record", required=True, help="训练记录 id（/training/<id> 里的数字）")
    p.add_argument("--user", default="", help="登录用户名")
    p.add_argument("--password", default="", help="登录口令")
    p.add_argument("--skip-login", action="store_true", help="跳过登录（已登录态或本地免登录）")


# ── 页面小工具：只依赖「输入框、患者气泡、状态提示」三样，不认具体组件 ──

def _composer(page: Page):
    return page.locator("textarea").first


def _wait_idle(page: Page, timeout: int = 120_000) -> None:
    """等到「该你说话了」且输入框可用：上一轮回答真的收尾了。"""
    page.wait_for_function(
        """() => {
            const t = document.querySelector('textarea');
            const h = document.querySelector('.stu-hint');
            return !!t && !t.disabled && !!h && h.textContent.includes('该你说话了');
        }""",
        timeout=timeout,
    )


def _patient_count(page: Page) -> int:
    return page.locator("[data-role='patient']").count()


def _ask(page: Page, rec: Recorder, question: str) -> None:
    """问一句、等患者答完：动作和等待都在这里，台本那边只写「问什么」。"""
    _wait_idle(page)
    before = _patient_count(page)
    rec.type_into(_composer(page), question, label="问诊")
    page.keyboard.press("Enter")
    # 等新气泡出现（system 消息不算），再等状态回到可说话
    page.wait_for_function(
        "(prev) => document.querySelectorAll(\"[data-role='patient']\").length > prev",
        arg=before,
        timeout=120_000,
    )
    _wait_idle(page)


def _login(page: Page, args: argparse.Namespace) -> None:
    page.goto(f"{args.url.rstrip('/')}/login", wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_timeout(800)
    user_input = page.locator("input[placeholder='输入用户名']")
    if user_input.count() == 0:
        return  # 已经是登录态 / 该系统免登录
    if not args.user:
        raise SystemExit("需要登录：给 --user 与 --password，或用 --skip-login")
    user_input.first.fill(args.user)
    page.locator("input[placeholder='输入密码']").first.fill(args.password)
    page.locator("button[type=submit]").first.click()
    page.wait_for_timeout(2500)


def initial_navigation(page: Page, args: argparse.Namespace) -> None:
    """录屏开始后的第一跳：登录（必要时）→ 直接进训练页。"""
    if not args.skip_login:
        _login(page, args)
    page.goto(f"{args.url.rstrip('/')}/training/{args.record}", wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_timeout(1200)
    _wait_idle(page)


# ── 两个段 ──

def tour(page: Page, rec: Recorder, shots, args: argparse.Namespace) -> None:
    """只讲界面，不提问：适合当片头，或单独录一段贴到别处。"""
    rec.cue("这是学生视角的训练页。左边是患者档案与主诉，中间是问诊对话，右边是问诊清单。")
    rec.shot(shots, "训练页概览")
    rec.cue("清单把一次完整的病史采集拆成了可勾选的条目；每问到一点，它就自动亮一项。")
    rec.cue("右下角是对话输入框，学生的每一句话都会进入同一套问诊流程。")
    rec.shot(shots, "输入区")


def demo(page: Page, rec: Recorder, shots, args: argparse.Namespace) -> None:
    """完整病史采集：五问，每问都等患者答完再落下一句。"""
    rec.cue("先看一眼整体界面：左边患者卡，中间对话，右边清单。")
    rec.shot(shots, "开场")

    for narration, question in QUESTIONS:
        rec.beat(narration, lambda q=question: _ask(page, rec, q))
        rec.shot(shots, "问诊")

    rec.cue("问过的点会自动勾到右侧清单上；没勾的，就是这场采集还没覆盖的部分。")
    rec.cue("采集完成就可以结束训练交卷，评分在后台生成。这里停在交卷前，保留这一场。")
    rec.shot(shots, "清单进度")


SEGMENTS = {"demo": demo, "tour": tour}
