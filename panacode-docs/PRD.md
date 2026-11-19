# PRD — Panacode

**وضعیت سند:** پیش‌نویس بازسازی‌شده؛ نیازمند تأیید صاحب محصول (Arash Makki). بخش ۲ تا ۷ از درخواست‌ها و تأییدهای صریح Arash گرفته شده‌اند؛ مواردی که فقط «رفتار مشاهده‌شده» یا «استنباط» هستند، همان‌جا علامت خورده‌اند.
**تاریخ بازسازی:** 2026-11-18
**مبنای بررسی:** شاخهٔ `panacode/redesign-v2` در `arashmakkyy/panacode` @ `07b4ccaa8a`؛ `PANACODE.md`؛ `panacode-docs/redesign/PROMPT.md` (مشخصات اصلی بازطراحی)؛ `panacode-docs/UPSTREAM-MERGE.md`؛ `panacode-docs/redesign/AUDIT-2026-11-18.md`؛ `packages/panacode-ui/src/brand/README.md`؛ بررسی پک Arc (فایل‌های Pro در `uiarc-pro-markdowns/` و کدهای Free در `uiarc-free-code/` روی box)؛ گفت‌وگوهای Arash با Agent تا 2026-11-18.
**محدودیت شناخت:** PRD رسمیِ جداگانه‌ای برای Panacode پیدا نشد؛ این سند از شواهد بالا بازسازی شده است. مشخصات کامل و تأییدشدهٔ بازطراحی UI در `redesign/PROMPT.md` است و این‌جا تکرار نمی‌شود. پک Arc و پروژه‌های مرجع React فقط روی box ایجنت (و کپی مرجع‌ها در `panacode-docs/redesign/reference/`) هستند.

> اسناد پشتیبان این پوشه (جزء چهار فایل اصلی نیستند و جابه‌جا نشده‌اند، چون اسکریپت‌ها و اسناد دیگر به مسیرشان ارجاع می‌دهند):
> - `redesign/PROMPT.md` — مشخصات اصلی و تأییدشدهٔ بازطراحی (بخش‌های ۱ تا ۱۶). **مرجع نیازمندی‌های UI.**
> - `UPSTREAM-MERGE.md` — راهنمای اجباری نگهداری fork و merge با upstream (بخش‌های A تا L). اسکریپت `script/panacode-ui-ownership-check.ts` وجودش را چک می‌کند.
> - `redesign/RUNNING.md` — اجرای اپ برای QA بصری (آن هم توسط ownership check الزامی است).
> - `redesign/AUDIT-2026-11-18.md` — ممیزی r8 پیش از بازطراحی v2 (سند تاریخی).
> - `redesign/reference/` — ۸ پروژهٔ مرجع React (کامپوننت‌های Arc) که Arash داده است.
> - `../PANACODE.md` (ریشهٔ مخزن) — پیش‌فرض‌های محصول، جداسازی مسیرها و نصب.

## ۱. هویت و تعریف محصول

- **Panacode** یک IDE کدنویسی با هوش مصنوعی (CLI + اپ دسکتاپ Electron، اولویت با Windows x64) است. از نظر فنی fork پروژهٔ متن‌باز OpenCode (`anomalyco/opencode`) است، اما باید **یک محصول کاملاً مستقل** دیده شود: «زیرش OpenCode کار کند، رویش Panacode مستقل دیده شود». کاربر نباید حس کند OpenCode با رنگ و لوگوی دیگر است. (الزام تأییدشده)
- **مخاطب:** توسعه‌دهنده‌ها و تیم‌هایی که از طریق **PanaAI** (پلتفرم اعتبار AI، https://panaai-psi.vercel.app) به مدل‌ها دسترسی دارند. PanaAI داشبورد و ارائه‌دهندهٔ مدل‌هاست؛ Panacode اپ کدنویسی است.
- **ارزش پیشنهادی:** ایجنت کدنویسی کامل OpenCode، با ورود یک‌کلیکی «Sign in with PanaAI»، همهٔ مدل‌های PanaAI، و یک UI ممتاز و مستقل ساخته‌شده بر پایهٔ پک طراحی **Arc** (uiarc.dev).
- **چشم‌انداز بلندمدت (از PROMPT §2):** اپ دسکتاپ Windows، داشبورد وب مرکزی، احراز هویت دسکتاپ از طریق مرورگر، کیف پول پیش‌پرداخت، صورت‌حساب مصرفی و مسیریابی مدل از طریق ارائه‌دهندهٔ reseller. **فاز فعلی فقط UI دسکتاپ است**؛ backend، کیف پول یا پرداخت در Panacode ساخته نمی‌شود.

## ۲. اهداف و محدوده

**فاز جاری: بازطراحی کامل UI (redesign-v2)** — مرجع کامل: `redesign/PROMPT.md`.
- فاز ۱: سیستم طراحی `@panacode/ui` (`packages/panacode-ui`) + یکپارچه‌سازی ۸ کامپوننت مرجع Arc با وفاداری کامل: AI Chat، AI Composer، Agent Run، Agent Orchestrator، Agent Approvals، Tool Call، Code Suggestion، MCP Servers.
- فاز ۲: مهاجرت بصری همهٔ صفحه‌ها (shell، خانه و سشن‌ها، تنظیمات، فایل‌ها، ترمینال، اتصال‌ها، دیالوگ‌ها، منوها، اعلان‌ها، حالت‌های بارگذاری/خطا) به زبان بصری Arc.
- **کل UI باید بر اساس پک Arc ساخته شود** (دستور Arash، 2026-11-18). هر صفحه یا یک مرجع از ۸ تا، یا یک قطعهٔ Free پک (پورت به Solid)، یا یک قطعهٔ Pro (که Arash می‌سازد) را صاحب است؛ جاهایی که Arc معادل ندارد (مثلاً ترمینال) با توکن‌ها و قواعد Arc یکدست می‌شوند.
- برنامهٔ ۵ مرحله‌ای که Agent پیشنهاد داد و در عمل دنبال شده: (۱) پایه، shell و برند؛ (۲) Chat، Composer، Tool Call؛ (۳) Agent Run، Orchestrator، Approvals، Code Suggestion؛ (۴) MCP و بقیهٔ صفحه‌ها؛ (۵) مستندات، تست بصری و بیلد Windows. (برنامهٔ کاری، نه الزام محصول)

**خارج از محدوده (فعلاً):** ارائه‌دهنده‌های غیر از PanaAI (پنهان می‌شوند، حذف نمی‌شوند)؛ backend، کیف پول و پرداخت داخل Panacode؛ تغییر مکانیک ایجنت/ابزارهای OpenCode؛ ساخت کامپوننت‌های Arc Pro توسط Agent (این‌ها را Arash می‌سازد).

## ۳. تجربه و جریان‌های کاربر

- **اولین اجرا:** اسپلش برند → اتصال به PanaAI (مرورگر باز می‌شود، ورود با OTP موبایل در PanaAI، انتخاب کلید capped/uncapped، بازگشت loopback با `code` و exchange) یا چسباندن کلید `pana-…` یا متغیر `PANAAI_API_KEY`. کاربر بدون اعتبار به صفحهٔ خرید PanaAI هدایت و پس از شارژ برگردانده می‌شود.
- **کار اصلی:** انتخاب پروژه/ورک‌اسپیس از سایدبار → سشن جدید (Composer با حالت خالی «What should we work on?» و پیشنهادها) → گفت‌وگو با ایجنت (پیام‌ها، thinking، منابع، ابزارها، دیف‌ها) → تأیید/رد مجوزها با جزئیات کامل (ابزار، مسیر فایل یا دستور، الگو) → بازبینی تغییرات با Accept/Reject برای هر hunk.
- **مدیریت:** تنظیمات (Providers با PanaAI در صدر و کلید ماسک‌شده، مدل‌ها، MCP، ظاهر، میانبرها، …)، پالت دستور، اعلان‌ها و toastها.
- **حالت‌های خالی/خطا:** بدون دادهٔ نمایشی؛ اگر داده نیست، empty state واقعی نشان داده می‌شود.

## ۴. نیازمندی‌های عملکردی

- همهٔ قابلیت‌های موجود OpenCode باید با طراحی جدید **کار کنند** (PROMPT §12).
- ارائه‌دهنده: فقط PanaAI (`panaai`)، base URL `https://panaai-psi.vercel.app/v1` (موقت)، مدل‌ها پویا از `GET /v1/models`، فعلاً `stream: false` (جزئیات در `PANACODE.md`).
- جداسازی کامل از OpenCode: مسیرهای `~/.panacode`، XDG `…/panacode`، `.panacode/`، `panacode.json(c)`، باینری `panacode`، متغیرهای `PANACODE_*`؛ app id ویندوز `ai.panacode.desktop`، پروتکل `panacode://`. نصب Panacode هرگز تنظیمات/تاریخچهٔ OpenCode را دست نمی‌زند.
- هر کامپوننت مرجع/Arc **کامل** منتقل می‌شود (مثلاً AI Chat یعنی کل چت، model picker، thinking، sources، versions، actions و motion)، و به **state واقعی** وصل است (adapterها)، نه دادهٔ نمونه.
- کامپوننت‌های Pro مورد نیاز و جای دقیقشان: `status.md` → «کامپوننت‌های Pro در انتظار ساخت».

## ۵. نیازمندی‌های غیرعملکردی

- **Upstream-safe** (PROMPT §3–4، `UPSTREAM-MERGE.md`): لایهٔ `@panacode/ui` (tokens، primitives، features، adapters، motion، brand)، adapter به‌جای بازنویسی، بدون monkey patch/DOM hack، حفظ شناسه‌های داخلی، حداقل diff روی فایل‌های upstream.
- **برند:** هیچ متن قابل‌مشاهدهٔ «OpenCode» در UI (به‌جز attribution مجوز)؛ با `script/panacode-brand-scan.ts` در CI کنترل می‌شود. برند قابل تعویض است (`packages/panacode-ui/src/brand/`) و فقط رنگ، فونت و لوگو را در اختیار دارد؛ شکل (radius 18/26/34)، قواعد تایپ (وزن 400/500، بدون uppercase)، motion و آیکون‌ها (lucide، stroke 1.75) مال Arc است.
- **زبان UI:** فقط انگلیسی. هیچ متن فارسی در Panacode.
- **محرمانگی تجاری:** نام ارائه‌دهندهٔ عمدهٔ پشت PanaAI، نرخ عمده و حاشیه هرگز در Panacode یا متن‌های آن نمی‌آید.
- **بدون دادهٔ نمایشی/دمو** در محصول.
- **دسترس‌پذیری و motion:** هر انیمیشن شاخهٔ reduced-motion دارد؛ میانبرها روی Windows «Ctrl» نشان داده شوند، نه ⌘.
- **کیفیت:** typecheck و تست‌ها سبز؛ `bun run panacode:ui-ownership` و brand-scan پاس.

## ۶. مرزها و وابستگی‌ها

- مخزن: `arashmakkyy/panacode` (همهٔ کد و ریلیزهای Panacode فقط این‌جا). شاخهٔ پیش‌فرض `dev` هنوز upstream خالص است؛ کار در `panacode/redesign-v2`.
- Monorepo با bun؛ اپ SolidJS (`packages/app`)، UI مشترک upstream (`packages/ui`، `packages/session-ui`)، لایهٔ Panacode (`packages/panacode-ui`)، پوستهٔ Electron (`packages/desktop`).
- PanaAI (مخزن جدا: `aliinreallife/panaai`) فقط داشبورد/ارائه‌دهنده است؛ تغییر production آن بخشی از کار Panacode نیست.
- پک Arc: React 19؛ Panacode SolidJS ⇒ هر قطعه «پورت» می‌شود (Radix→Kobalte، motion/react→`motion`، lucide-react→lucide-solid، CSS module بدون تغییر).
- بیلد Windows: GitHub Actions (`.github/workflows/panacode-windows.yml`).

## ۷. معیارهای پذیرش

- معیارهای کامل فاز ۱ و ۲: PROMPT §8، §12، §13 و §15.
- هر مرحله: اجرای اپ، تست end-to-end، اسکرین‌شات و ویدیو برای Arash و **تأیید صریح او** پیش از رفتن به مرحلهٔ بعد.
- در هیچ اسکرین‌شات، ویدیو یا لاگی کلید API نمایش داده نشود.
- هیچ «OpenCode» قابل‌مشاهده، هیچ متن فارسی، هیچ دادهٔ دمو.

## ۸. فرض‌ها، موارد نامعلوم و نیازمند تأیید

- برند Firouzeh **موقت** است؛ برند نهایی هنوز انتخاب نشده.
- این PRD بازسازی‌شده هنوز توسط Arash پذیرفته نشده است.
- جریان credit/top-up داخل اپ (Pro `credit-topup`) با «بدون کیف پول در Panacode» (PROMPT §2) باید هماهنگ شود: احتمالاً فقط نمایش موجودی واقعی و ارجاع به صفحهٔ خرید PanaAI — نیازمند تأیید (status → T-008).
