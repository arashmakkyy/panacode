# تصمیم‌های پروژه — Panacode

> بازسازی اولیه در 2026-11-18 از گفت‌وگوهای Arash با Agent، `PANACODE.md`، `redesign/PROMPT.md` و تاریخچهٔ Git. تاریخ‌ها PT (UTC-8) هستند؛ تاریخ دقیق جایی که معلوم نبود، «تاریخ نامشخص» آمده است.

## فهرست تصمیم‌های جاری
| شناسه | موضوع / محدودهٔ اثر فعلی |
|---|---|
| D-019 | جداسازی کامل زمان اجرا از OpenCode: فقط `PANACODE_*`، sidecarهای `panacode-cli`، سرویس/پورت مستقل، پیکربندی محلی قدیمی فقط‌خواندنی، آرشیو پشتیبانی `panacode-debug-*`، deep link فقط `panacode://` و به‌روزرسانی دستی |
| D-018 | کانال `prod` (بیلد workflow ویندوز) کانال ریلیز است: ثبت سرویس در `service.json` و پورت 28844 |
| D-017 | updater و What's New دسکتاپ OpenCode در Panacode خاموش است (`PANACODE_UPSTREAM_UPDATES`) |
| D-016 | پورت سرویس Panacode جدا از OpenCode: 28844 روی Windows، 49324 در macOS/Linux |
| D-015 | تا اطلاع بعدی تست جدید اجرا نمی‌شود؛ پایان کار فقط اعلام می‌شود |
| D-014 | بیلد Windows با GitHub Actions؛ فقط `release.yml` upstream حذف شد |
| D-013 | کدنویسی، بیلد و تست روی box خود Agent؛ Agentهای ابری فعلاً نه |
| D-012 | کامپوننت‌های Arc Pro را Arash می‌سازد؛ Agent فقط Free و ۸ مرجع را پورت می‌کند |
| D-011 | کل UI بر اساس پک Arc؛ کامپوننت‌ها کامل و بدون گزینش‌چینی |
| D-010 | برند Firouzeh (موقت)؛ برند فقط رنگ، فونت و لوگو |
| D-009 | UI فقط انگلیسی؛ هیچ متن فارسی در Panacode |
| D-008 | هیچ «OpenCode» قابل‌مشاهده در UI؛ کنترل در CI |
| D-007 | هر مرحله با ویدیو و اسکرین‌شات به تأیید Arash می‌رسد |
| D-006 | بازطراحی کامل UI طبق `redesign/PROMPT.md` با معماری upstream-safe |
| D-005 | همهٔ کد و ریلیزهای Panacode فقط روی `arashmakkyy/panacode` |
| D-004 | جداسازی کامل نصب، مسیرها و env از OpenCode |
| D-003 | بدون دادهٔ دمو؛ نام ارائه‌دهندهٔ عمدهٔ پشت PanaAI هرگز نمایش داده نمی‌شود |
| D-002 | فقط PanaAI به‌عنوان provider؛ مدل‌ها از `/v1/models`؛ فعلاً `stream:false` |
| D-001 | Panacode = fork سبک و همگام‌پذیر با upstream OpenCode |

## D-019 — جداسازی کنار‌به‌کنار از OpenCode
- تاریخ و وضعیت: 2026-11-20 | اجراشده در شاخه `panacode-isolation` با پایه `82d54281e79f33fb08e3d7db7adb166436857c43`
- انگیزه: نصب و اجرای Panacode نباید به متغیر محیطی، فایل، سرویس، پورت، sidecar، آرشیو پشتیبانی یا کانال به‌روزرسانی OpenCode وابسته باشد.
- تصمیم:
  - `productEnv` فقط `PANACODE_*` را می‌خواند و هیچ fallback یا کپی `PANACODE_*` → `OPENCODE_*` وجود ندارد. `sanitizeProductEnv()` در شروع CLI و Desktop تمام `OPENCODE_*`های زمان اجرا را حذف می‌کند؛ حتی وقتی هر دو تنظیم شده باشند، مقدار Panacode ملاک است.
  - sidecarها `panacode-cli` / `panacode-cli.exe` و `panacode-cli.version` هستند؛ در dev از `panacode-cli-dev` و `panacode-cli-wsl` استفاده می‌شود. Desktop دیگر `opencode-cli` را probe نمی‌کند.
  - ثبت سرویس با `product: "panacode"` نوشته می‌شود؛ کلاینت محصول ناهمخوان را رد می‌کند. پورت پیش‌فرض Windows `28844` و macOS/Linux `49324` است و مقدار ذخیره‌شده `panacode service set port` بر `--port 0x70ac` اولویت دارد.
  - `opencode.json`، `opencode.jsonc` و `.opencode/` فقط‌خواندنی‌اند. تنها `tool_output.max_lines` و `tool_output.max_bytes` به‌صورت `legacy: true` زیر مقادیر Panacode وارد می‌شوند؛ هیچ plugin قدیمی فعال نمی‌شود و هیچ فایلی نوشته نمی‌شود.
  - آرشیو پشتیبانی `panacode-debug-*.zip` است، فقط ریشه‌های log پن‌کد را جمع می‌کند و markerهای OpenCode و فایل‌های حساس مانند `.env`، `auth.json`، فایل‌های config و `service*.json` را کنار می‌گذارد.
  - فقط `panacode://` dispatch می‌شود؛ `opencode://` پیش از routing نادیده گرفته می‌شود و `oc://renderer` داخلی می‌ماند.
  - updater دسکتاپ خاموش است (`PANACODE_UPSTREAM_UPDATES = false`) و CLI هیچ feed یا installer متعلق به OpenCode را صدا نمی‌زند. `check` به `https://github.com/arashmakkyy/panacode/releases` اشاره می‌کند و `apply`/`latest`/`upgrade`/`managed` با خطای «Panacode updates are manual» متوقف می‌شوند.
- اجرا: `.github/workflows/panacode-isolation.yml` برای PR به `panacode/redesign-v2` و dispatch دستی؛ بدون انتشار یا publish. گارد `script/panacode-isolation-check.ts` هر خواندن محیطی `OPENCODE_*` در کد محصول را رد می‌کند.
- مرجع: `PANACODE.md`، `panacode-docs/UPSTREAM-MERGE.md` (بخش M) و `panacode-docs/status.md`.

## D-018 — کانال prod کانال ریلیز است
- تاریخ و وضعیت: 2026-11-18 | معتبر
- زمینه: workflow `panacode-windows` CLI را با `OPENCODE_CHANNEL=prod` می‌سازد (نسخه `0.0.0-prod-<run>`). `ServiceConfig.filename()` فقط latest/dev/beta/next را کانال ریلیز می‌دانست، پس CLI در `~/.local/state/panacode/service-prod.json` ثبت می‌شد ولی دسکتاپ `service.json` را poll می‌کرد. سرور بالا می‌آمد ولی پیدا نمی‌شد و هر اجرای r10 بعد از ۴ دقیقه «Timed out waiting for the background service to start» می‌داد. r9 همین باگ را داشت ولی زودتر با تداخل پورت 28894 شکست می‌خورد.
- تصمیم: `ServiceConfig.releaseChannel()` شامل `prod` است (نام فایل ثبت و پورت پیش‌فرض). CLI کانال prod یک `service-prod.json` جامانده را به `service.json` منتقل می‌کند تا سرور یتیم r9/r10 پیدا و با نسخهٔ جدید جایگزین شود. `cliServiceRegistrationFile` دسکتاپ هم prod را ریلیز می‌داند و نسخه‌های preview با شمارهٔ run را می‌شناسد. خطای timeout حالا مسیر فایل ثبت و تعداد سرورهای در حال اجرا (با stderr) را می‌گوید. commit `21058b3855`.
- مبنا و منشأ: لاگ‌های export‌شدهٔ Arash از r10 (2026-11-18) و پیام او.

## D-017 — حذف updater دسکتاپ OpenCode
- تاریخ و وضعیت: 2026-11-18 | معتبر
- زمینه: صفحهٔ خطا و اپ دکمهٔ «Update to 2.3.2» نشان می‌دادند. updater دسکتاپ (`packages/gui-plugins/src/updater`) از فید OpenCode (`opencode.ai/update/api/.../desktop/opencode`) و What's New از `opencode.ai/changelog.json` می‌خواند؛ یعنی نسخهٔ OpenCode پیشنهاد می‌شد، نه Panacode. Panacode فید آپدیت ندارد و از GitHub Releases (workflow `panacode-windows`) منتشر می‌شود.
- تصمیم: پرچم `PANACODE_UPSTREAM_UPDATES = false` در `packages/gui-plugins/src/updater/panacode.ts`. با آن، main نه Ipc `Updater` را فراهم می‌کند نه آیتم منوی Check for Updates را؛ renderer هم What's New، بخش Updates تنظیمات، دکمهٔ تایتل‌بار و (چون Ipc وجود ندارد) دکمه‌های آپدیت صفحهٔ خطا را نشان نمی‌دهد. به‌روزرسانی service-worker نسخهٔ وب می‌ماند چون build خود سرور Panacode را بارگذاری می‌کند. روشن‌کردن پرچم فقط وقتی Panacode فید و changelog خودش را داشته باشد. commit `31d5c44587`.
- دامنه: فقط اپ دسکتاپ. updater ترمینالی CLI (`packages/cli/src/services/updater.ts`) دست نخورده و سرویس دسکتاپ آن را اجرا نمی‌کند.
- مبنا و منشأ: پیام Arash، 2026-11-18 («آره اینکار رو بکن و پوش کن»).

## D-016 — پورت سرویس جدا از OpenCode
- تاریخ و وضعیت: 2026-11-18 | معتبر
- زمینه: Panacode روی Windows همان پورت سرویس OpenCode را می‌گرفت (`0x70de` = 28894، از commit upstream `e441dafb09` / #57428). با باز بودن OpenCode، Panacode با خطای «Managed service port 28894 ... already in use» بالا نمی‌آمد. در macOS/Linux هم هر دو 49374 (`0xc0de`) بودند.
- بررسی و دلیل: همان طرح upstream حفظ شد (پورت پایه در 0xC000+، و روی Windows نگاشت به بلوک 0x7000 با حفظ ۱۲ بیت پایین) تا دلایل upstream برقرار بماند: زیر 32768، بیرون از بازهٔ پویای Windows (49152+) و رزروهای Hyper-V/WinNAT، و بیرون از بلوک WSL mirrored (معمولاً 44620–48715). فقط بایت پایین عوض شد: `0xC0AC` (49324) و روی Windows `0x70AC` (28844)؛ کانال `local` یکی بیشتر (49325 / 28845). با `0x0c0c` (پورت isolated) و پورت‌های OpenCode تداخل ندارد. fallback خودکار به پورت آزاد انتخاب نشد: upstream عمداً پورت ثابت را قفل انتخاب یک سرویس روی یک دیتابیس کرده است.
- تصمیم: `ServiceConfig.PANACODE_SERVICE_PORT = 0xc0ac` در CLI و `--port 0x70ac` در دسکتاپ Windows. اگر پورت را پروسهٔ دیگری گرفته باشد، پیام خطا روی Windows هم نام و PID آن را می‌گوید (`netstat` + `tasklist`). commit `afae032e9a`.
- مبنا و منشأ: پیام Arash، 2026-11-18.

## D-015 — توقف تست تا اعلام Arash
- تاریخ و وضعیت: 2026-11-18 | معتبر
- زمینه: کار بازطراحی تقریباً به پایان مرحلهٔ فعلی رسیده بود و تست نهایی در برنامه بود.
- تصمیم: «فعلاً تست را استارت نزن؛ تمام شد فقط بگو.» اجرای QA/تست نهایی تا دستور Arash انجام نمی‌شود؛ وقتی کار تمام شد فقط اطلاع داده می‌شود. کدنویسی هم در همین تاریخ متوقف شده است (status).
- مبنا و منشأ: پیام Arash، 2026-11-18.
- جایگزینی / بازنگری: با دستور بعدی Arash برای شروع تست.

## D-014 — بیلد Windows با GitHub Actions
- تاریخ و وضعیت: 2026-11-18 | معتبر
- زمینه: r5 تا r8 دستی روی Linux با Wine + NSIS ساخته شدند. `release.yml` upstream به runnerها، کلیدهای امضا و حساب‌های ابری OpenCode وابسته است و روی fork اجرا نمی‌شود.
- بررسی و دلیل: Arash نخواست Agent بیلد را خودش بگیرد و اکشن گیت‌هاب خواست.
- تصمیم: workflow اختصاصی `.github/workflows/panacode-windows.yml` (commit `4bab490237`) روی runner ویندوز گیت‌هاب installer x64 را می‌سازد و ریلیز می‌دهد. **فقط** `release.yml` upstream حذف شد (`6ce838bbbf`)؛ بقیهٔ workflowها دست نخوردند.
- مبنا و منشأ: پیام‌های Arash، 2026-11-18 («همشو پاک نکن فقط همینو که گفتی»).

## D-013 — کدنویسی محلی توسط Agent
- تاریخ و وضعیت: 2026-11-18 | معتبر
- زمینه: سهمیهٔ Cursor cloud agent تمام شد.
- تصمیم: Agent (pnc-new-bot) علاوه بر نقش tech lead و product owner، کدنویس هم هست؛ کد روی box خودش نوشته، بیلد و تست می‌شود و با هویت `arashmakkyy` commit و push می‌شود. اگر بعداً Agent ابری استفاده شد، مدل `grok-4.7` با reasoning effort بالا و fast=false؛ هرگز Auto/default.
- مبنا و منشأ: پیام‌های Arash، 2026-11-18.

## D-012 — کامپوننت‌های Arc Pro را Arash می‌سازد
- تاریخ و وضعیت: 2026-11-18 | معتبر
- زمینه: پک Arc دو بخش دارد: Free (کد React کامل) و Pro (فقط مشخصات markdown).
- تصمیم: Agent کامپوننت‌های Pro را نمی‌سازد. Arash آن‌ها را می‌سازد و تحویل می‌دهد؛ Agent پورت/یکپارچه می‌کند. فعلاً اولویت با استفادهٔ کامل از ۸ مرجع و پورت Free‌های انتخاب‌شده است؛ پس از پایان این کار، Arash Proها را می‌سازد. فهرست و جای هر Pro: `status.md` → «کامپوننت‌های Pro در انتظار ساخت».
- مبنا و منشأ: پیام‌های Arash، 2026-11-18؛ بررسی پک (`arc-pack-review.md` روی box).

## D-011 — کل UI بر اساس Arc، با وفاداری کامل
- تاریخ و وضعیت: 2026-11-18 | معتبر
- زمینه: نسخهٔ اول مرحلهٔ ۱ رد شد چون OpenCode رنگ‌عوض‌شده دیده می‌شد و از مرجع‌ها فقط تکه‌هایی برداشته شده بود.
- تصمیم: مرجع رابط کاربری Panacode پک Arc است و **کل** UI طبق آن ساخته می‌شود. هر کامپوننتی که Arash داده کامل منتقل می‌شود (مثلاً چت: کل چت، model picker، thinking و …)؛ تغییر جزئیات ریز برای تطبیق مجاز است، گزینش‌چینی نه. آیکون‌ها lucide (stroke 1.75)، motion با springهای Arc.
- مبنا و منشأ: پیام Arash، 2026-11-18؛ PROMPT §6–7.

## D-010 — برند Firouzeh (موقت) و مرز برند/Arc
- تاریخ و وضعیت: 2026-11-18 | معتبر (برند موقت)
- زمینه: سه جهت برند ارائه شد: Taq (پیشنهاد Agent)، Lazhvard، Firouzeh.
- تصمیم: Arash فعلاً Firouzeh را انتخاب کرد و گفت موقت است. برند به‌صورت pack قابل تعویض در `packages/panacode-ui/src/brand/packs/<id>` پیاده شده و با `bun script/panacode-brand-apply.ts <id>` عوض می‌شود. pack فقط رنگ، فونت و لوگو را دارد؛ radius، وزن فونت، حروف بزرگ، motion و آیکون مال Arc است.
- مبنا و منشأ: پیام Arash، 2026-11-18؛ `packages/panacode-ui/src/brand/README.md`.
- جایگزینی / بازنگری: وقتی Arash برند نهایی را تعیین کند.

## D-009 — UI فقط انگلیسی
- تاریخ و وضعیت: 2026-11-18 | معتبر
- تصمیم: «هیچ متنی و چیزی نباید فارسی بشه توی پاناکد.» برنامهٔ فارسی‌کردن متن‌های Tool Call لغو شد. (این مستندات طبق `how_to_update_docs.md` فارسی‌اند؛ قانون مربوط به محصول است.)
- مبنا و منشأ: پیام Arash، 2026-11-18.

## D-008 — بدون «OpenCode» قابل‌مشاهده
- تاریخ و وضعیت: تاریخ نامشخص (از 2026-11-15 مکرر)؛ بازسازی در 2026-11-18 | معتبر
- تصمیم: هیچ متن یا لوگوی OpenCode در UI، اسپلش، installer و منوها نمی‌آید (به‌جز attribution مجوز). شناسه‌های داخلی (`@opencode/*`، کلیدهای storage) برای upstream-safety حفظ می‌شوند. CI با `script/panacode-brand-scan.ts` و allowlist آن کنترل می‌کند.
- مبنا و منشأ: پیام‌های Arash («just say panacode, don't say opencode»؛ «Nobody should sense OpenCode underneath»).

## D-007 — تأیید مرحله‌ای با ویدیو و اسکرین‌شات
- تاریخ و وضعیت: 2026-11-18 | معتبر (اجرای تست فعلاً طبق D-015 معلق)
- تصمیم: پس از هر مرحله، Agent خروجی را روی box اجرا، end-to-end تست، و ویدیو و اسکرین‌شات‌ها را برای تأیید Arash می‌فرستد؛ بدون تأیید به مرحلهٔ بعد نمی‌رود. کلید API نباید در هیچ تصویر/ویدیو/لاگی دیده شود.
- مبنا و منشأ: پیام‌های Arash، 2026-11-18.

## D-006 — بازطراحی کامل UI با معماری upstream-safe
- تاریخ و وضعیت: 2026-11-17 | معتبر
- تصمیم: اجرای `redesign/PROMPT.md`: لایهٔ `@panacode/ui` (tokens، primitives، features، adapters، motion)، adapter به state واقعی OpenCode، بدون monkey patch یا بازنویسی کلی، حفظ شناسه‌های داخلی؛ فاز ۱ (سیستم طراحی + ۸ مرجع) و فاز ۲ (مهاجرت همهٔ صفحه‌ها)؛ سند اجباری `UPSTREAM-MERGE.md` (A–L). فقط UI دسکتاپ؛ بدون backend/کیف پول.
- مبنا و منشأ: پرامپت Arash، 2026-11-17 (کپی در `redesign/PROMPT.md`).

## D-005 — مخزن واحد Panacode
- تاریخ و وضعیت: 2026-11-17 | معتبر
- تصمیم: «همهٔ تغییرات، ریلیزها و همه‌چیز باید روی `arashmakkyy/panacode` باشد؛ panaai فقط داشبورد ماست.» ریلیزهای Windows روی همین مخزن (r5 به بعد).
- مبنا و منشأ: پیام Arash، 2026-11-17.

## D-004 — جداسازی کامل از OpenCode
- تاریخ و وضعیت: 2026-11-14 | معتبر
- تصمیم: Panacode نباید با OpenCode تداخل کند: مسیرهای داده/کانفیگ/کش، فایل‌های کانفیگ، باینری و env جدا (`PANACODE_*` با fallback به `OPENCODE_*`). جزئیات در `PANACODE.md`.
- مبنا و منشأ: پیام Arash؛ commit `8734f2cd09`.

## D-003 — بدون دادهٔ دمو؛ محرمانگی ارائه‌دهندهٔ عمده
- تاریخ و وضعیت: 2026-11-13 | معتبر
- تصمیم: هیچ دادهٔ دمو/تست در محصول زنده نیست. نام ارائه‌دهندهٔ عمدهٔ پشت PanaAI، نرخ و حاشیه هرگز به کاربر نشان داده نمی‌شود («ما ارائه‌دهنده‌ایم»). نمونه‌دادهٔ کامپوننت‌های Arc هم باید با دادهٔ واقعی یا empty state جایگزین شود.
- مبنا و منشأ: قوانین Arash در PanaAI که به Panacode هم تعمیم داده شده‌اند.

## D-002 — فقط provider PanaAI
- تاریخ و وضعیت: 2026-11-13 | معتبر
- تصمیم: فعلاً فقط PanaAI (`panaai`)؛ بقیهٔ providerها پنهان، نه حذف. همهٔ مدل‌ها از `/v1/models`. `stream:false` تا PanaAI از SSE پشتیبانی کند. فعلاً دامنهٔ Vercel؛ دامنهٔ اختصاصی بعداً. اتصال با «Sign in with PanaAI» (loopback مرورگر).
- مبنا و منشأ: پیام‌های Arash، 2026-11-13؛ commitهای `76e9350b80`، `a296aec3dc`.

## D-001 — fork سبک و همگام با upstream
- تاریخ و وضعیت: 2026-11-13 | معتبر (دامنهٔ بصری با D-006 گسترده شد)
- تصمیم: Panacode fork از `anomalyco/opencode` است؛ مکانیک هسته دست نمی‌خورد، همگام‌سازی با upstream تا حد ممکن ساده می‌ماند، و پیش از تغییر OpenCode از Arash پرسیده می‌شود. نام «Panacode» بعداً قابل تغییر است.
- مبنا و منشأ: پیام Arash، 2026-11-13.
- جایگزینی / بازنگری: D-006 لایهٔ بصری را به بازطراحی کامل گسترش داد؛ اصل «مکانیک دست نخورد، upstream-safe بماند» همچنان معتبر است.
