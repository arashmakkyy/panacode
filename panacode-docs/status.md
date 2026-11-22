# وضعیت پروژه — Panacode
آخرین به‌روزرسانی در ۲۰۲۶-۱۱-۲۱

## وضعیت شاخهٔ `isolation-fixes`

دور اصلاح پس از `5cbce5da67` شامل مسیر startup ویندوز، احراز سرویس و PTY، مالکیت فایل‌های NSIS، کش و داده، و قراردادهای CI است. نتایج runهای قدیمی این صفحه به snapshot قبلی تعلق دارند. برای شواهد خودکار، هر دو workflow با نام‌های `panacode-isolation` و `panacode-windows` را روی SHA مورد بررسی ببینید. EXE ساخته‌شده از `90c282c11b` برای پذیرش این تغییرات مناسب نیست. Gate پذیرش تعاملی A–G همچنان باز است. [شرح تغییرات](./REVIEW-isolation-fixes.md)

## وضعیت ثبت‌شده پیش از این دور

- **بازبینی جداسازی (شاخهٔ `isolation-fixes`):** ۲۷ commit از `9618e4d5ac` تا code/test HEAD `eccc31771e` (۲ commit فقط مستندات) و یک commit مستندات روی آن در همین worktree؛ شاخه به `origin/isolation-fixes` push شده و base آن `panacode-isolation` است؛ PR، merge و انتشار انجام نشده. remote CI روی code/test HEAD `eccc31771e` در run [`44936316557`](https://github.com/arashmakkyy/panacode/actions/runs/44936316557) با هر ۶ job سبز است. هر یافتهٔ P0/P1/P2 با تست رفتاری که روی کد قدیم شکست می‌خورد، نوع واقعی فراخوان و اصلاح حداقلی پوشش داده شد. تست‌ها با Bun `1.4.4` از پوشهٔ هر package اجرا شدند. artifact کاندید (CLI + installer) از working tree معادل `90c282c11b` ساخته شد و رفع‌های بعدی را ندارد، و پذیرش A–G روی EXE نصب‌شده اجرا نشده است (T-019).
- **کدنویسی بازطراحی متوقف است.** آخرین commit بازطراحی: `07b4ccaa8a` (feat(shortcut-recorder)) روی `panacode/redesign-v2` در `arashmakkyy/panacode`. رفع‌های D-016، D-017 و D-018 و بازبینی جداسازی هنوز در هیچ exe منتشرشده‌ای نیستند؛ بیلد بعدی (r11) باید پس از merge یا از همین شاخه ساخته شود (T-013). پورت Freeهای باقی‌مانده تمام نشده است (T-001).
- **هر ۸ مرجع Arc منتقل و به state واقعی وصل شده‌اند** (کد commit شده؛ تأیید نهایی Arash هنوز نگرفته): Tool Call (`bc7350a7dd`)، Agent Approvals (`64afda0f07`)، Code Suggestion (`c547400640`)، AI Chat (`836bdc2d7f`)، AI Composer (`f409be2deb`، `77039b49c7`، `935d91ff84`)، Agent Run (`e1cd0362a5`)، Agent Orchestrator (`a3edd8ba63`)، MCP Servers (`975cc3c659`).
- **پایه:** برند Firouzeh (موقت، قابل تعویض؛ `0f11cd5a05`)، shell با سایدبار ورک‌اسپیس و تاپ‌بار باریک (`c18a6764d7`، `a713a9a323`)، آیکون‌های lucide (`ca80b6487b`)، motion با springهای Arc (`8f35c335a2`)، PanaAI spotlight در Providers (`153f43a020`)، اصلاح dark mode و brand-scan در CI.
- **Freeهای پورت‌شده (commit شده):** command-palette، dropdown/context menu، toast-stack، tooltip، dialog، search-field، tabs، theme-switch، card، select، resizable-panels، hover-card، shortcut-recorder. switch و segmented-control از قبل primitive دارند (وفاداری به Free پک بازبینی نشده).
- **کامپوننت‌های Pro:** ۱۷ مورد در انتظار ساخت توسط Arash — بخش «کامپوننت‌های Pro در انتظار ساخت» در پایین (T-008).
- مبنای بررسی: `isolation-fixes` (پایه `9618e4d5ac`، code/test HEAD `eccc31771e`، مستندات commit بعد از آن) و `origin/panacode/redesign-v2` @ `07b4ccaa8a`. artifact کاندید از working tree معادل `90c282c11b` ساخته شد و رفع‌های بعدی (به‌ویژه manifest separator در `2f0897afc1`، رقابت contender در `5021af9b48`، discovery فرآیند lifecycle در `5b57d27fe4` و کنترل سوکت در `4e2bc7ea81`/`9b01dca9e7`) را ندارد؛ برای A–G باید از `eccc31771e` دوباره ساخته شود. CLI `0.0.0-prod-202611211535` از `97858ae392`.
- سطح بررسی: این بازبینی تست‌های واقعی Bun 1.4.4، typecheck، oxlint، AST/SDK docs، harness واقعی NSIS و remote CI (شش job روی Linux و Windows) را اجرا کرد؛ نصب واقعی EXE اجرا نشد. آخرین QA خودکار ثبت‌شده (Electron + Playwright + ffmpeg، بک‌اند واقعی) در 2026-11-18 حدود 08:35 PT روی `6b1d24a9ec` بود: ۸۹ گام، ۰ خطا؛ commitهای بعدی هنوز تأیید بصری Arash را ندارند.

## کارهای باز
| تسک | هدف و شرط پایان | وضعیت | پیشرفت / مانع / اقدام باقی‌مانده |
|---|---|---|---|
| T-001 | پورت Freeهای باقی‌ماندهٔ انتخاب‌شده به Solid، هرکدام کامل و به state واقعی وصل | متوقف | باقی‌مانده: user-menu، inline-edit (rename)، confirm-morph (حذف)، tree-view، code-block، json-viewer، file-dropzone، morph-select، radio-cards، notification-center، alert، empty-state، skeleton، text-shimmer، usage-meter، animated-counter، badge، changelog-feed، icon-morph، onboarding-checklist؛ و بازبینی switch/segmented-control با نسخهٔ Free. کد پک روی box: `/workspace/arc-pack/arc-ui/uiarc-free-code/`. |
| T-002 | رفع خطاهای باز تست (۶ مورد طبق گزارش پیشرفت 2026-11-18) و سبز ماندن typecheck/تست‌ها | متوقف | گزارش‌شده؛ اینجا بررسی نشده. فهرست دقیق در خروجی QA روی box است. |
| T-003 | بررسی کامل حالت روشن (light) همهٔ صفحه‌های جدید | متوقف | — |
| T-004 | QA نهایی end-to-end + ویدیو و اسکرین‌شات برای تأیید Arash | منتظر بررسی | فقط با دستور Arash (D-015). باید شامل: Providers (PanaAI اول، کلید ماسک‌شده، لیست Popular خالی نباشد)، پنجرهٔ مجوز با فایل/الگو/دستور، thinking با مدل thinking‌دار، چت/ابزار/دیف، صفر خطای کنسول، صفر «OpenCode»، بدون نمایش کلید. |
| T-005 | ریلیز Windows r9 از طریق `panacode-windows.yml` | تکمیل | اجرای `44453296373` موفق؛ ریلیز `panacode-desktop-win-x64-r9` (Latest). r9 هنوز پورت 28894 و updater OpenCode را دارد. |
| T-006 | حذف متن فارسی از داده‌های برند | در صف | `packages/panacode-ui/src/brand/packs/firouzeh/brand.ts` فیلد `taglineFa` دارد و `index.tsx` آن را export می‌کند (D-009). رندر شدنش بررسی نشده؛ باید حذف یا تأیید شود که هیچ‌جا نمایش داده نمی‌شود. |
| T-007 | ادغام کار در `dev` و همگام‌سازی با upstream | مسدود | نیازمند تأیید Arash. `dev` در 2026-11-18 هنوز upstream خالص و ۱۶۹ commit عقب‌تر از `anomalyco/opencode:dev` بود. روال: `UPSTREAM-MERGE.md` §E. |
| T-008 | دریافت و یکپارچه‌سازی ۱۷ کامپوننت Arc Pro | منتظر بررسی | منتظر ساخت توسط Arash؛ جزئیات کامل در بخش بعدی. |
| T-009 | مراحل ۳ تا ۵ برنامه: بقیهٔ صفحه‌ها (فاز ۲)، تست بصری خودکار، به‌روزرسانی `UPSTREAM-MERGE.md` و ریلیز | در صف | پس از تأیید مرحلهٔ فعلی. |
| T-010 | بررسی دوبارهٔ پک Arc و پیشنهاد جایگزینی‌های بیشتر | در صف | Arash گفته پس از تأیید این فاز اعلام می‌کند. |
| T-011 | تأیید PRD بازسازی‌شده توسط Arash | منتظر بررسی | `PRD.md` پیش‌نویس است. |
| T-013 | بیلد Windows با رفع‌های D-016، D-017 و D-018 | منتظر بررسی | r10 (`44461403354`، از `be0ba6cbd1`) ساخته شد ولی بعد از ۴ دقیقه timeout سرویس داد (علت: D-018). رفع در `21058b3855`؛ بیلد بعدی (مثلاً r11) را باید اجرا کرد. Agent بیلد/QA نمی‌زند (D-015). بعد از نصب: Panacode کنار OpenCode باز شود و هیچ‌جا «Update to …» دیده نشود. اگر سرور یتیم r10 (`opencode-cli.exe`) هنوز در Task Manager باشد، نسخهٔ جدید باید خودش آن را جایگزین کند. |
| T-014 | نمایش نسخهٔ خود Panacode | در صف | صفحهٔ خطا «Version: 2.3.0» نشان می‌دهد: نسخهٔ `package.json` upstream (OpenCode 2.3.0). Panacode شمارهٔ نسخهٔ جدا ندارد و ریلیزها فقط برچسب rN دارند. رفع ساده و امن پیدا نشد: نسخه با نسخهٔ CLI سرویس مقایسه می‌شود (`cli-version.ts`) و workflow از `dev` اجرا می‌شود. پیشنهاد: یک ثابت build-time مثل `PANACODE_RELEASE` که workflow تزریق کند و فقط در UI نمایش داده شود. نیازمند تصمیم Arash. |
| T-018 | رفع ۱۳ یافتهٔ بازبینی جداسازی و اثبات رفتاری هرکدام | منتظر بررسی | ۲۵ commit کد/تست/CI روی `isolation-fixes` (شامل رفع باگ واقعی packaging در `90c282c11b` و رفع‌های نهایی CI تا `eccc31771e`)؛ remote CI در run `44936316557` روی `eccc31771e` با هر ۶ job سبز؛ تست‌های هدفمند، typecheck، oxlint، AST/SDK docs و NSIS واقعی سبز؛ installer واقعی ساخته و hash شد. جزئیات و محدودیت‌ها در تاریخچهٔ 2026-11-21. |
| T-019 | پذیرش ویندوز نصب‌شده A–G روی VM تعاملی | مسدود | VM/runner تعاملی ویندوز x64 با snapshot تازه و OpenCode نصب‌شده در دسترس نیست. دستور اجرا، شناسهٔ کاندید و شواهد لازم در بخش «پذیرش ویندوز نصب‌شده (A–G)» آمده است. |

## پذیرش ویندوز نصب‌شده (A–G)

**وضعیت:** مسدود — این محیط VM/runner تعاملی ویندوز x64 با snapshot تازه ندارد. هیچ نتیجه‌ای از A–G ادعا نمی‌شود؛ فقط دستور اجرا و شناسهٔ کاندید ثبت شده است. **build موفق یا unit test جای این بخش را نمی‌گیرد.**

**کاندید:** commit `90c282c11b` (working tree هنگام ساخت؛ **رفع‌های بعدی از جمله `2f0897afc1`، `5021af9b48` و `5b57d27fe4` را ندارد؛ برای A–G ابتدا artifact را از `eccc31771e` دوباره بسازید**)؛ CLI `0.0.0-prod-202611211535`؛ CLI SHA-256 `D5C3E052B9D3345C8D13787CC249E4A34675D70900C10EFE5E9D225B30DAA0AB`؛ installer `panacode-desktop-win-x64.exe` با SHA-256 `DC3B624CA4E82BDE390E4417F4E46ED9434422908115B55F5B9A58461E54F93D` (۲۶۷٬۶۴۸٬۷۳۰ بایت، `NotSigned`).

**قاعدهٔ ایمنی:** فقط روی VM دورریختنی با snapshot پایه؛ پروفایل، registry، shell config و processهای میزبان واقعی دست‌کاری نشوند. پس از هر گام، snapshot یا فایل fixture پاک شود.

1. **A — نصب و راه‌اندازی در محیط تازه:** در snapshot با OpenCode نصب‌شده (اما بسته) candidate را نصب کن. `Get-FileHash .\panacode-desktop-win-x64.exe -Algorithm SHA256` را ثبت کن. زمان تا پنجرهٔ آماده را با stopwatch بگیر (cold)، از منو خارج و دوباره باز کن (warm). سپس:
   ```powershell
   Invoke-RestMethod http://127.0.0.1:28844/api/info | ConvertTo-Json -Depth 4
   Get-ChildItem "$env:USERPROFILE\.local\state\panacode\service*.json" | ForEach-Object {
     $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
     [pscustomobject]@{ file=$_.Name; product=$j.product; version=$j.version; url=$j.url; pid=$j.pid }
   }
   Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*ai.panacode.desktop*' } |
     Select-Object ProcessId,Name,ExecutablePath,CreationDate
   ```
   شرط PASS: `product=panacode`، `url` روی loopback/پورت Panacode، PID زنده، و restart یک instance جدید بدهد؛ هیچ credential در خروجی چاپ نشود (فقط فیلدهای بالا).
2. **B — هم‌زیستی با OpenCode:** OpenCode را باز و یک session/terminal با marker (`echo PANACODE_MARKER`) بساز. Panacode را باز کن، همان marker را در terminal خودش بساز، برنامه را ببند/باز کن و اتصال/restart را ببین. سپس `panacode service restart` را اجرا و marker را دوباره بخوان. همین را از سمت OpenCode تکرار کن. شرط PASS: دو محصول هم‌زمان، پورت/PID جدا، هیچ terminal یا session به محصول دیگر attach نشود، و هیچ process OpenCode متوقف/جایگزین نشود. PID/port هر دو در جدول شواهد ثبت شود.
3. **C — upgrade از r10:** snapshot با r10 و service ثبت‌شده (از جمله registration کهنه). candidate را روی آن نصب کن. شرط PASS: registration قدیمی Panacode به‌صورت مالکانه replace شود، UI برند Panacode را نشان دهد (نمایش شمارهٔ نسخه هنوز T-014 است) و هیچ «Update to …» یا feed OpenCode دیده نشود؛ فایل‌ها/processهای OpenCode دست‌نخورده بمانند و sessionهای Panacode مطابق انتظار باقی بمانند. اگر registration 404/incompatible باشد، candidate باید خطای روشن بدهد و contender جدید نسازد.
4. **D — تداخل پورت:** Panacode را ببند؛ یک listener fixture روی 28844 بگیر:
   ```powershell
   $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 28844); $l.Start()
   ```
   candidate را باز کن و خطای روشن (نام/پورت/PID دارنده) را ثبت کن؛ هیچ takeover خاموشی نباید رخ دهد. listener را ببند، برنامه را باز کن، سپس:
   ```powershell
   panacode service set port 28845
   panacode service restart
   Invoke-RestMethod http://127.0.0.1:28845/api/info | ConvertTo-Json -Depth 4
   ```
   برنامه را ببند/باز کن و ببین پورت ذخیره‌شده حفظ می‌شود. در پایان در صورت نیاز پورت را برگردان.
5. **E — reinstall/uninstall:** همان نسخه را دوباره نصب کن. سپس `panacode uninstall --dry-run` و بعد uninstall واقعی (یا از Settings) را اجرا کن. شرط PASS: OpenCode همچنان اجرا می‌شود و config/session/registry/PATH آن بایت‌به‌بایت سالم است؛ فقط فایل‌های Panacode حذف می‌شوند؛ session/config/state پن‌کد باقی می‌مانند و cache پاک می‌شود؛ reinstall داده‌ها را برمی‌گرداند. هیچ uninstaller قدیمی اجرا نمی‌شود.
6. **F — نصب کامل، ACL، marker و junction:** در `%LOCALAPPDATA%\Programs\ai.panacode.desktop` وجود `.panacode-install` و محتوای آن (`header`، `appId`، `version`، `exe` و لیست فایل‌ها) را ثبت کن. `icacls` دسترسی RX app-container را نشان دهد. یک فایل ناشناس و یک junction کنار/داخل مسیر نصب بساز؛ uninstall باید فقط فایل‌های manifest را حذف کند، فایل ناشناس/junction را دست نزند و در نبود مالکیت متوقف شود. نصب upgrade باید `.old`/stage را پاک کند و هیچ پوشهٔ نیمه‌کاره باقی نگذارد. hash فایل‌های نصب‌شده (`Panacode.exe`، `resources\panacode-cli.exe`) ثبت شود.
7. **G — Export Logs و ZIP:** در command palette (`Ctrl+K`) «Export Logs…» را اجرا کن، در حالی که یک marker ساختگی در `main.log`/`server.log`، یک `dump.dmp` و یک deep link با `token=AUTH_MARKER#COOKIE_MARKER` وجود دارد. ZIP را با `Expand-Archive` باز کن. شرط PASS: فقط `manifest.json` و `diagnostics.jsonl`؛ هیچ marker، URL کامل، مسیر `C:\Users\...`، dump یا NetLog در هیچ member نیست؛ فیلدهای diagnostics فقط allowlist باشند. SHA-256 ZIP و اندازهٔ آن ثبت شود.

**شواهد لازم برای هر گام:** تاریخ/ساعت PT، فرمان یا فایل شاهد، خروجی کوتاه، PID/port، و PASS/FAIL/BLOCKED. اگر گامی اجرا نشد، همان BLOCKED با دلیل واقعی ثبت شود؛ نتیجهٔ گام دیگر به آن تعمیم داده نشود.

## ادامه از اینجا
- قدم بعدی: T-019 (پذیرش A–G روی VM تعاملی ویندوز)؛ پس از آن T-013 (بیلد r11 از شاخهٔ تأییدشده) و T-011 (تأیید PRD).
- اطلاعات لازم: `panacode-docs/UPSTREAM-MERGE.md` §C، `panacode-docs/decisions.md` D-020، `redesign/PROMPT.md`، `UPSTREAM-MERGE.md`، `packages/panacode-ui/src/brand/README.md`، `redesign/RUNNING.md`؛ روی box (در صورت دسترسی): `/workspace/arc-pack-review.md`، `/workspace/arc-pack/arc-ui/`، `/workspace/panacode-qa/run-qa.sh panacode/redesign-v2` (با `QA_PERMISSION=1`).

## کامپوننت‌های Pro در انتظار ساخت (Arash)

**وضعیت همهٔ موارد: Waiting — to be built by Arash.** Agent این‌ها را نمی‌سازد (D-012). مشخصات هر مورد (فقط markdown، بدون کد) در پک Arc روی box است: `/workspace/arc-pack/arc-ui/uiarc-pro-markdowns/<path>` (نسخهٔ آنلاین: `https://uiarc.dev/components/<id>`). مسیرهای «فایل‌های فعلی» نسبت به ریشهٔ مخزن و مربوط به commit `07b4ccaa8a` هستند.

**نیازی به ساخت Pro ندارند:** ai-chat، ai-composer، agent-run، agent-orchestrator، agent-approvals، tool-call، code-suggestion، mcp-servers — این ۸ مرجع را Arash قبلاً ساخته و پورت شده‌اند (`panacode-docs/redesign/reference/` و `packages/panacode-ui/src/features/*`). مشخصات Pro آن‌ها فقط چک‌لیست وفاداری است. `reasoning-block` و `source-cards` هم داخل مرجع AI Chat پوشش داده شده‌اند.

### الگوی مشترک یکپارچه‌سازی (برای همهٔ موارد)
- **ورودی:** سورس React 19 هر قطعه از رجیستری Arc Pro (`.tsx` + `.module.css` + زیرقطعه‌های لازم).
- **پورت به Solid:** hookها → signal/`createMemo`/`createEffect`؛ Radix → `@kobalte/core` (Dialog، DropdownMenu، Popover، Tabs، Tooltip، Switch معادل یک‌به‌یک دارند)؛ `motion/react` → `animate()` پکیج `motion` از طریق `packages/panacode-ui/src/motion` (`arcSpring`، `springTo`، `Collapse`، `glideHighlight`، `menuGlide`، `prefersReducedMotion`) با همان springها و شاخهٔ reduced-motion؛ `lucide-react` → lucide-solid از طریق `packages/panacode-ui/src/icons` (stroke 1.75).
- **CSS:** `.module.css` بایت‌به‌بایت کپی شود (قاعدهٔ Arc: «internals را restyle نکن»)؛ فقط TSX تغییر کند. فقط متغیرهای `packages/panacode-ui/src/theme/tokens.css` و رنگ/فونت برند (`brand/active.css`). بدون override روی radius (18/26/34)، وزن فقط 400/500، بدون uppercase/eyebrow.
- **ساختار فایل:** نمای خالص در `packages/panacode-ui/src/features/<id>/index.tsx` + `<id>.css` (props-only، بدون import از `packages/app`)؛ تبدیل state واقعی به props در `packages/panacode-ui/src/adapters/<id>.ts` با تست `<id>.test.ts` و export از `adapters/index.ts`؛ چسب اپ در `packages/app/src/<area>/panacode-<id>.tsx` که از contextهای واقعی (sync/sdk/server/settings) می‌خواند. مثال‌های موجود: `session/panacode-agent-run.tsx` + `adapters/agent-run.ts` + `features/agent-run/`.
- **Upstream-safety:** فایل upstream فقط در حد یک نقطهٔ mount کوچک عوض شود؛ شناسه‌ها/کلیدهای داخلی حفظ شوند؛ بدون monkey patch و DOM hack؛ هر فایل جدید/تغییر یافته در `UPSTREAM-MERGE.md` §C (ownership) و §D (replacement map) ثبت شود.
- **محتوا:** متن فقط انگلیسی؛ بدون «OpenCode»؛ بدون نام ارائه‌دهندهٔ عمده؛ **بدون دادهٔ نمونه** — دادهٔ دموی Arc (لوگوی Anthropic/OpenAI، workspaceهای ساختگی، کارت Visa، …) با دادهٔ واقعی یا empty state جایگزین شود؛ اگر منبع داده وجود ندارد، آن بخش پنهان شود و در status ثبت شود. میانبرها روی Windows «Ctrl».
- **پذیرش مشترک:** پاس شدن `bun script/panacode-brand-scan.ts`، `bun run panacode:ui-ownership`، `bun run typecheck` و `bun test` در `packages/panacode-ui` و `packages/app`؛ چک‌لیست Arc (`/workspace/arc-pack/arc-ui/uiarc-free-code/shared/arc-skill/checklist.md` روی box) در هر دو تم و عرض‌های 1024 و 1440؛ گام QA جدید در harness؛ صفر خطای کنسول؛ تأیید بصری Arash.

### ۱. sidebar — نسخهٔ workspace-sidebar (اولویت ۱، بحرانی)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `blocks/sidebar.md` → بخش «Variant: Workspace» (registry id `workspace-sidebar`). سایدبار محصول با سوییچر ورک‌اسپیس، جست‌وجوی زنده، favorites قابل کشیدن و پروژه‌های inline.
- جا در Panacode: قاب اصلی اپ، ستون چپ (لیست پروژه‌ها/ورک‌اسپیس‌ها، سشن‌ها با خط وضعیت مثل «Running tests…» یا «Needs approval»، چیپ حساب پایین چپ).
- فایل‌های فعلی: `packages/app/src/shell/shell.tsx`، `packages/panacode-ui/src/shell/frame.tsx` و `shell/arc-shell.css`، `packages/app/src/shell/titlebar/sidebar-customized.tsx`، `sidebar-organized.tsx`، `project-session-row.tsx`، `sidebar-sessions.ts`، `packages/app/src/home/projects/*`، `packages/app/src/home/sessions/view.tsx`، `packages/app/src/shell/layout/project-icon(s).tsx`.
- state/adapter: پروژه‌ها و ورک‌اسپیس‌های واقعی سرور (home/projects controller، `workspaces/*`)، سشن‌ها (`sidebar-sessions.ts`، `recent-sessions-model.ts`)، وضعیت زندهٔ سشن (`shell/titlebar/inbox-working.ts`، permission/question pending). adapter جدید: `adapters/workspace-sidebar.ts`.
- جایگزین فعلی: سایدبار upstream با استایل Arc (commit `c18a6764d7`، `a713a9a323`) + resizable-panels.
- پذیرش: سوییچ پروژه/ورک‌اسپیس واقعی، جست‌وجوی زندهٔ سشن‌ها، favorites ماندگار، rename با inline-edit و حذف با confirm-morph/undo، خط وضعیت هر سشن از state واقعی، fold با `[`، بدون تب‌های مرورگرمانند.

### ۲. team-switcher (اولویت ۲)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/team-switcher.md`. سوییچر ورک‌اسپیس به سبک Linear/Vercel: لوگو و پلن در trigger، منو با جست‌وجو، نقش، میانبر Ctrl+1…9، ساخت/پیوستن inline، highlight لغزان و crossfade هنگام سوییچ.
- جا: بالای سایدبار؛ برای Panacode معنای «پروژه / ورک‌اسپیس (شاخه)» دارد، مثل «panaai / fix/credit-rounding».
- فایل‌های فعلی: `packages/app/src/home/projects/menu.tsx`، `home/projects/controller.tsx`، `shell/layout/project-icon.tsx`، `packages/app/src/workspaces/selection/*`.
- state/adapter: لیست پروژه‌ها و ورک‌اسپیس‌های سرور؛ «ساخت» = افزودن پروژه (`home/projects/add.ts`) / ساخت ورک‌اسپیس (`workspaces/create.ts`). «plan/role» در Panacode معادل ندارد → حذف یا جایگزینی با شاخه/مسیر (بدون دادهٔ ساختگی).
- جایگزین فعلی: منوی پروژهٔ upstream با dropdown-menu آرک.
- پذیرش: سوییچ واقعی با Ctrl+1…9، جست‌وجو، افزودن پروژه بدون ترک صفحه، کار با کیبورد.

### ۳. model-picker (اولویت ۳)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `blocks/model-picker.md`. یک pill آرام؛ مدل‌های featured با یادداشت یک‌خطی، تنظیم reasoning effort، مرور همهٔ مدل‌ها بر اساس provider.
- جا: pill مدل در Composer (و ChatModelMenu در تاپ‌بار چت)؛ ردیف مدل پیش‌فرض در Settings → Models.
- فایل‌های فعلی: `packages/app/src/composer/composer.tsx` (هنوز `DialogSelectModel`/`ModelSelectorDrawer` از `providers/models/select-dialog.tsx`)، `composer/model-chip-machine.ts`، `composer/model.ts`، `composer/editor/editor.tsx` (`EffortMenu`)، `packages/panacode-ui/src/features/ai-composer/parts.tsx`، `features/ai-chat/index.tsx` (`ChatModelMenu`)، `packages/app/src/settings/models/models.tsx`، `providers/models/*`.
- state/adapter: کاتالوگ واقعی مدل‌های PanaAI از `/v1/models` (provider `panaai`)، variant/effort از `providers/models/variant.ts`، انتخاب سشن. «Featured» باید از دادهٔ واقعی یا قاعدهٔ مستند بیاید، نه لیست سخت‌کد Arc.
- جایگزین فعلی: popover مدل/effort مرجع Composer (anchored به pill) + دیالوگ upstream برای مرور کامل.
- پذیرش: انتخاب در جا، effort فقط برای مدل‌های reasoning، مرور همه با جست‌وجو، بدون دیالوگ وسط صفحه.

### ۴. provider-keys (اولویت ۴)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/provider-keys.md`. کارت کلیدها: ردیف هر provider با mark، کلید ماسک‌شده، وضعیت، آخرین استفاده؛ reveal پنج‌ثانیه‌ای، copy، rotate، حذف با undo؛ فرم inline با اعتبارسنجی فرمت و تست اتصال.
- جا: Settings → Providers، ردیف PanaAI (کلید `pana-…`).
- فایل‌های فعلی: `packages/app/src/settings/providers/providers.tsx`، `settings/providers/panacode-spotlight.tsx`، `packages/panacode-ui/src/features/providers/index.tsx` (`ProviderSpotlight`)، `packages/app/src/providers/connect/dialog.tsx` (فیلد apiKey با reveal)، `packages/core/src/panacode/product.ts`.
- state/adapter: auth ذخیره‌شدهٔ provider `panaai` (oauth یا key یا env `PANAAI_API_KEY`)؛ تست اتصال با `GET /v1/models`. «rotate» = چسباندن کلید جدید یا اجرای دوبارهٔ Sign in with PanaAI (ساخت کلید سمت داشبورد PanaAI است). اگر «last used» منبع واقعی ندارد، نشان داده نشود.
- جایگزین فعلی: spotlight PanaAI + فیلد کلید connect dialog.
- پذیرش: کلید هرگز کامل نمایش داده نشود جز reveal پنج‌ثانیه‌ای؛ کلید در هیچ اسکرین‌شات/لاگ QA نیاید؛ فرمت `pana-` چک شود؛ تست اتصال واقعی؛ undo حذف.

### ۵. context-window (اولویت ۵)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/context-window.md`. شبکهٔ ۲۰۰ خانه از system prompt، ابزارها، فایل‌ها، خلاصه و پیام‌ها؛ خط آستانهٔ compaction؛ نمایش فضای باقی‌مانده.
- جا: فوتر Composer کنار model pill (متر مصرف context)، با باز شدن به نمای کامل.
- فایل‌های فعلی: سطح اختصاصی وجود ندارد؛ نقطهٔ mount: `packages/app/src/composer/composer.tsx` / `composer/editor/editor.tsx` و `features/ai-composer`. compaction در `packages/session-ui/src/timeline-next/compaction.tsx`.
- state/adapter: tokens پیام‌های assistant سشن (input/output/cache) و `limit.context` مدل (نمونهٔ خواندن: `providers/models/details.tsx`)؛ دستهٔ ابزارها/MCP اگر شمارش واقعی ندارد، تجمیعی نشان داده شود. adapter جدید: `adapters/context-window.ts`.
- جایگزین فعلی: هیچ (free `usage-meter` هنوز پورت نشده).
- پذیرش: درصد و تعداد توکن با دادهٔ واقعی سشن هم‌خوان؛ هنگام compaction به‌روز شود؛ بدون عدد ساختگی.

### ۶. agent-plan (اولویت ۶)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/agent-plan.md`. پلن ایجنت پیش از اجرا: ویرایش، ترتیب، افزودن مرحله در حالت draft، سپس چک‌لیست زنده.
- جا: کنار Agent Run در ریل راست سشن و/یا داک Composer.
- فایل‌های فعلی: `packages/app/src/session/composer/todo-pill.tsx`، `todo-pill.css`، `todos.ts`، `session/composer/region.tsx`، `session/panacode-agent-run.tsx`.
- state/adapter: todoهای واقعی OpenCode (ابزار todowrite/todoread، `todos.ts`)؛ حالت Plan agent. ویرایش پلن فقط اگر API واقعی دارد؛ وگرنه فقط خواندنی (در status ثبت شود).
- جایگزین فعلی: todo pill upstream.
- پذیرش: مرحلهٔ جاری زنده، شکست‌ها و خلاصهٔ نهایی از state واقعی؛ reduced-motion.

### ۷. agent-status (اولویت ۷)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/agent-status.md`. pill وضعیت زنده: mark ایجنت در حلقهٔ زنده، فعالیت جاری و تایمر، باز شدن به مراحل.
- جا: ردیف سشن‌های در حال اجرا در سایدبار و تاپ‌بار سشن.
- فایل‌های فعلی: `packages/app/src/session/header/session-working-indicator.tsx`، `session/header/session-header.tsx`، `shell/titlebar/project-session-row.tsx`، `shell/titlebar/inbox-working.ts`.
- state/adapter: status سشن (busy/idle/retry)، آخرین tool part در حال اجرا (`adapters/tool-call.ts`، `adapters/agent-run.ts`)، زمان شروع.
- جایگزین فعلی: working indicator upstream با استایل Arc.
- پذیرش: فعالیت و تایمر دقیق، باز شدن به مراحل واقعی، توقف تایمر پس از پایان.

### ۸. settings-page (اولویت ۸)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `blocks/settings-page.md`. تنظیمات با nav بخش‌ها و highlight لغزان و نوار Save که هنگام ویرایش morph می‌شود.
- جا: کل Settings (حدود ۱۵ صفحه: Providers، Models، Extensions/MCP، Projects، Workspaces، General، Appearance، Notifications، Shortcuts، Servers، Experimental، About).
- فایل‌های فعلی: `packages/app/src/settings/shell.tsx`، `navigation.tsx`، `pages.ts`، `row.tsx`، `surface.tsx`، `settings.css`، `packages/panacode-ui/src/shell/arc-settings.css`.
- state/adapter: صفحه‌ها و تنظیمات واقعی (`settings/model.tsx`). بیشتر تنظیمات upstream فوراً ذخیره می‌شوند؛ نوار Save فقط برای فرم‌هایی که ذخیرهٔ صریح دارند.
- جایگزین فعلی: shell تنظیمات upstream + free `tabs` و switch/select/card آرک.
- پذیرش: همهٔ صفحه‌ها در قاب جدید، ناوبری کیبورد، بدون از دست رفتن تنظیمی.

### ۹. ai-command (اولویت ۹)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/ai-command.md`. پالت Ctrl+K با حالت AI: Tab برای پرسش؛ پاسخ با منابع شماره‌دار در خود پالت و اقدام‌های پیشنهادی.
- جا: پالت دستور سراسری.
- فایل‌های فعلی: `packages/app/src/home/start/command-palette.tsx`، `shell/commands/dialog.tsx`، `shell/palette-menu.css`، `packages/panacode-ui/src/shell/arc-palette.css`.
- state/adapter: دستورها و سشن‌های واقعی؛ حالت «ask» = ساخت سشن/پیام واقعی به ایجنت با مدل انتخاب‌شدهٔ PanaAI. اقدام‌های نمونهٔ Arc (Linear/Notion) فقط اگر یکپارچه‌سازی واقعی وجود دارد.
- جایگزین فعلی: free `command-palette` پورت‌شده (`f03efe4578`).
- پذیرش: Tab پاسخ واقعی را stream/نمایش می‌دهد، Esc برمی‌گرداند، بدون پاسخ ساختگی.

### ۱۰. undo-toast (اولویت ۱۰)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/undo-toast.md`. آرشیو/حذف ردیف با فرصت دوم: بستن فاصله، toast شمارش معکوس که تکرارها را ادغام می‌کند، Undo یا Ctrl+Z.
- جا: آرشیو/حذف سشن‌ها در سایدبار و خانه.
- فایل‌های فعلی: `packages/app/src/home/sessions/archive.ts`، `home/sessions/row-machine.ts`، `session/delete-machine.ts`، `shell/notifications/toast.tsx`.
- state/adapter: API واقعی آرشیو/حذف سشن. undo حذف فقط اگر حذف تا پایان شمارش به تعویق بیفتد؛ این رفتار باید upstream-safe و صادق باشد.
- جایگزین فعلی: free `toast-stack` (`07b8d72a3a`) + دیالوگ تأیید.
- پذیرش: Undo دقیقاً همان جای قبلی را برمی‌گرداند؛ Ctrl+Z کار کند؛ قانون Arc: برای اقدام foreground toast نزن.

### ۱۱. agent-timeline (اولویت ۱۱)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/agent-timeline.md`. timeline یک اجرای orchestrated: orchestrator و subagentها روی یک محور زمانی، handoffها، playhead بازپخش، شمارش زمان/توکن/هزینه.
- جا: نمای replay کنار Agent Orchestrator در سشن.
- فایل‌های فعلی: `packages/app/src/session/panacode-orchestrator.tsx`، `packages/panacode-ui/src/features/agent-orchestrator/*`، `adapters/agent-orchestrator.ts`، `session/composer/subagent-bar.tsx`.
- state/adapter: سشن‌های فرزند (subagent) و پیام‌ها/partهایشان با زمان‌ها و tokens/cost واقعی (`toOrchestratorLanes`).
- جایگزین فعلی: مرجع Agent Orchestrator (`a3edd8ba63`).
- پذیرش: span‌ها با زمان واقعی، hover/click برای جزئیات، بدون داده برای subagentهای بدون timestamp ساخته نشود.

### ۱۲. provider-status (اولویت ۱۲)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/provider-status.md`. کارت سلامت providerها: mark، وضعیت، latency p50، نوار uptime سی‌روزه، رخدادها، شمارش معکوس بررسی بعدی.
- جا: Settings → Providers (زیر ردیف PanaAI).
- فایل‌های فعلی: `packages/app/src/settings/providers/providers.tsx`، `panacode-spotlight.tsx`.
- state/adapter: فقط دادهٔ واقعی: health PanaAI (endpoint سلامت سایت PanaAI — مسیر دقیق بررسی شود — یا پاسخ `/v1/models`) و latency اندازه‌گیری‌شدهٔ محلی. تاریخچهٔ uptime سی‌روزه و incidentها منبع واقعی ندارند → پنهان، تا PanaAI endpoint بدهد (سؤال باز).
- جایگزین فعلی: هیچ.
- پذیرش: وضعیت و latency واقعی؛ بدون نوار uptime ساختگی.

### ۱۳. credit-topup (اولویت ۱۳)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `blocks/credit-topup.md`. کارت خرید اعتبار: موجودی با نمودار مصرف ۱۴ روزه، بسته‌ها، slider مبلغ، auto top-up، کارت ذخیره‌شده، odometer.
- جا: سطح اعتبار PanaAI (چیپ موجودی پایین سایدبار و صفحهٔ usage).
- فایل‌های فعلی: `packages/app/src/usage/dialog.tsx`، `usage/model.tsx`، `packages/app/src/providers/connect/usage-exceeded.tsx`.
- state/adapter: موجودی و مصرف واقعی از PanaAI (endpoint عمومی برای دسکتاپ هنوز مشخص نیست). PROMPT §2 ساخت کیف پول/پرداخت در Panacode را منع کرده و پرداخت PanaAI کارت‌به‌کارت در داشبورد است ⇒ احتمالاً فقط نمایش + دکمهٔ رفتن به صفحهٔ خرید PanaAI؛ بخش‌های کارت/auto top-up حذف. **نیازمند تأیید Arash.** متن هرگز نام ارائه‌دهندهٔ عمده را نیاورد.
- جایگزین فعلی: دیالوگ usage upstream (free `usage-meter`/`animated-counter` هنوز پورت نشده).
- پذیرش: موجودی واقعی، هدایت درست به خرید و بازگشت، بدون عدد دمو.

### ۱۴. settings-command (اولویت ۱۴)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `blocks/settings-command.md`. فیلد جست‌وجوی تنظیمات که به پالت تبدیل می‌شود و به هر تنظیم پرواز می‌کند.
- جا: بالای Settings.
- فایل‌های فعلی: `packages/app/src/settings/search.tsx`، `search-field.tsx`، `search-index.ts`، `search-catalog.ts`، `search-reveal.ts`، `search-empty.tsx`، `search.css`.
- state/adapter: ایندکس واقعی تنظیمات (`search-index.ts`) و reveal موجود.
- جایگزین فعلی: free `search-field` (`ee0c19d65c`) + جست‌وجوی upstream.
- پذیرش: پیدا کردن هر تنظیم، اسکرول و highlight روی آن، کیبورد کامل.

### ۱۵. generation-stats (اولویت ۱۵)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/generation-stats.md`. نوار آمار پاسخ: TTFT، سرعت با sparkline، توکن خروجی، هزینه؛ باز شدن به تفکیک latency و هزینه.
- جا: زیر هر پاسخ assistant در چت (کنار reply actions).
- فایل‌های فعلی: `packages/panacode-ui/src/features/ai-chat/index.tsx` (`ChatReplyActions`)، `packages/app/src/session/panacode-chat.tsx`، `session/panacode-timeline.tsx`.
- state/adapter: زمان‌ها، tokens و cost پیام assistant. چون `stream:false` است، TTFT و sparkline سرعت معنای واقعی ندارند → فقط زمان کل، توکن و هزینه (به اعتبار PanaAI) تا streaming فعال شود.
- جایگزین فعلی: هیچ.
- پذیرش: اعداد با metadata پیام برابرند؛ هیچ معیار ساختگی.

### ۱۶. ai-setup-wizard (اولویت ۱۶)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `blocks/ai-setup-wizard.md` (جایگزین: `blocks/onboarding-survey.md`). کارت سه‌مرحله‌ای راه‌اندازی.
- جا: اولین اجرا: Connect PanaAI → باز کردن پروژه → (اختیاری) افزودن MCP → اولین سشن.
- فایل‌های فعلی: `packages/app/src/servers/connect/screen.tsx`، `packages/app/src/new-session/panacode-hero.tsx`، `packages/app/src/providers/connect/dialog.tsx`.
- state/adapter: جریان واقعی Sign in with PanaAI (loopback + exchange)، افزودن پروژه، MCP واقعی. منابع نمونهٔ Arc (Notion، Drive، …) جایگزین شوند.
- جایگزین فعلی: free `onboarding-checklist` (هنوز پورت نشده، T-001) + صفحهٔ connect upstream.
- پذیرش: کاربر تازه بدون راهنما به اولین پاسخ واقعی می‌رسد؛ کلید روی صفحه نمایش داده نمی‌شود.

### ۱۷. dictation-button (اولویت ۱۷، پایین)
- وضعیت: Waiting — to be built by Arash
- مشخصات: `components/dictation-button.md`. میکروفون Composer که به pill ضبط با waveform، تایمر، لغو و درج تبدیل می‌شود.
- جا: دکمهٔ mic در Composer.
- فایل‌های فعلی: `packages/app/src/voice/composer.tsx`، `voice/*`، `packages/panacode-ui/src/features/ai-composer/*`.
- state/adapter: موتور voice موجود (`voice/machine.ts`، `transport.ts`) — اگر روی PanaAI قابل‌استفاده نیست، دکمه پنهان بماند.
- جایگزین فعلی: mic مرجع Composer / voice upstream.
- پذیرش: ضبط و درج واقعی متن؛ لغو بدون اثر.

**اختیاری و بعداً (هنوز درخواست نشده):** confirm-popover، skeleton-morph، morph-loader، ghost-text، agent-memory، env-variables، branch-graph، ai-spark.

### روال تحویل و یکپارچه‌سازی یک Pro
1. Arash سورس قطعه را (پوشه یا zip از رجیستری Arc Pro: `.tsx`، `.module.css`، زیرقطعه‌ها) در چت می‌فرستد.
2. Agent آن را بدون تغییر در `panacode-docs/redesign/reference/pro/<id>/` قرار می‌دهد (فقط مرجع؛ در build نیست) و وضعیت این بخش را به «Received — porting» تغییر می‌دهد.
3. پورت طبق «الگوی مشترک» بالا: feature + adapter + تست adapter + چسب اپ؛ ثبت در `UPSTREAM-MERGE.md` §C/§D.
4. بررسی‌ها: brand-scan، ui-ownership، typecheck، تست‌ها؛ QA بصری فقط با اجازهٔ Arash (D-015).
5. ارسال اسکرین‌شات/ویدیو؛ پس از تأیید Arash وضعیت «Done» و رکورد در تاریخچهٔ همین فایل.

## تاریخچهٔ کارها
### 2026-11-18
#### T-016 — timeout سرویس پس‌زمینه در r10 ویندوز | تکمیل
- انجام‌شده: علت از لاگ export‌شدهٔ Arash (`desktop/20261119T052051/main.log`) پیدا شد: CLI کانال prod در `service-prod.json` ثبت می‌شد و دسکتاپ `service.json` را می‌خواند (D-018). رفع در `21058b3855` (CLI، دسکتاپ و پیام timeout در `packages/client`).
- بررسی: typecheck سبز برای `packages/client`، `packages/cli`، `packages/desktop`. تست‌ها: `packages/desktop/src/main/service` (۴۸ پاس)، `packages/client` (۲۶۲ پاس)، `packages/cli` شامل service/service-lifecycle/server-connection (۴۱ پاس، ۱ skip، ۱ شکست قدیمی و بی‌ربط در server-connection که بدون این تغییر هم شکست می‌خورد). روی Windows واقعی تست نشد.
- باقی‌مانده / ارجاع: T-013 (بیلد بعدی).
#### T-015 — پورت سرویس جدا و حذف updater OpenCode | تکمیل
- انجام‌شده: `afae032e9a` پورت سرویس Panacode را 28844 (Windows) / 49324 (macOS، Linux) کرد و پیام تداخل پورت روی Windows نام پروسه را می‌گوید (D-016). `31d5c44587` updater، What's New و همهٔ دکمه‌های «Update to …» دسکتاپ را پشت `PANACODE_UPSTREAM_UPDATES = false` خاموش کرد (D-017). ثبت در `UPSTREAM-MERGE.md` §C، §H، §L و یادداشت در `release/desktop/INSTALL.md`.
- بررسی: typecheck سبز برای `packages/cli`، `packages/desktop`، `packages/gui-plugins`؛ تست‌ها: `packages/cli/test/service.test.ts` (۳۰ پاس، ۱ skip چون lsof روی box نیست)، `service-lifecycle.test.ts` (۷ پاس؛ یک assertion کهنه که هنوز «opencode service set port» می‌خواست در `8d2d8b29f3` اصلاح شد)، `packages/gui-plugins` updater (۷۴ پاس)، `packages/desktop` (۵۲۶ پاس، ۴ skip)، دو تست app با URL پورت جدید (۷ پاس)؛ `script/panacode-brand-scan.ts` ok. QA و بیلد exe اجرا نشد (D-015، T-013).
- باقی‌مانده / ارجاع: T-013 (بیلد r10 توسط Arash)، T-014 (نسخهٔ Panacode). کار نیمه‌تمام `tab.tsx` در `/workspace/pc-audit` دست نخورد و push نشد.
#### T-012 — بازسازی اولیهٔ مستندات طبق how_to_update_docs.md | تکمیل
- انجام‌شده: پوشهٔ موجود `panacode-docs/` حفظ شد؛ `PRD.md` (بازسازی‌شده، پیش‌نویس)، `decisions.md` (D-001…D-015)، `status.md` و کپی `how_to_update_docs.md` اضافه شدند. فهرست Proهای در انتظار در همین فایل آمد (به دستور Arash، نه فایل جدا). اسناد پشتیبان (`UPSTREAM-MERGE.md`، `redesign/*`) جابه‌جا نشدند چون `script/panacode-ui-ownership-check.ts` و `packages/panacode-ui/README.md` به مسیرشان ارجاع می‌دهند.
- بررسی: Git log `panacode/redesign-v2` تا `07b4ccaa8a`، کد `packages/app` و `packages/panacode-ui`، `PANACODE.md`، `redesign/*`، پک Arc و بررسی آن روی box، گزارش QA روی box. تست اجرا نشد.
- باقی‌مانده / ارجاع: T-011 (تأیید PRD). تاریخچهٔ قبل از این بازسازی فقط به‌صورت خلاصه در decisions و «تصویر فعلی» آمده است.
#### کارهای قبلی (بازیابی‌شده از Git، خلاصه)
- 2026-11-14 تا 11-15: overlay فقط PanaAI (`76e9350b80`)، Sign in with PanaAI (`a296aec3dc`)، جداسازی مسیرها (`8734f2cd09`).
- 2026-11-17 تا 11-18: نسخهٔ اول بازطراحی و ریلیزهای Windows r5–r8 (r8 از `4f3a17ba1a`؛ r7 ناقص). سپس مرحلهٔ ۱ دوباره (redesign-v2) از `43d0cc803e` تا `07b4ccaa8a`: برند، shell، آیکون، motion، ۸ مرجع، Freeهای فهرست‌شده در «تصویر فعلی»، workflow ویندوز و حذف `release.yml`.

### 2026-11-20
#### T-017 — جداسازی Panacode از OpenCode (شاخهٔ `panacode-isolation`) | تکمیل، پذیرش ویندوز تأیید نشد
- انجام‌شده: شاخه از `82d54281e7` (نوک `panacode/redesign-v2`) ساخته شد. `productEnv` فقط `PANACODE_*` می‌خواند و `sanitizeProductEnv()` در شروع CLI و Desktop همهٔ `OPENCODE_*`های ارثی (از جمله `OPENCODE_API_KEY`) را حذف می‌کند؛ هیچ fallback یا کپی `PANACODE_*` → `OPENCODE_*` نمانده است. ثبت سرویس اکنون `product: "panacode"` دارد و کلاینت فقط ثبت Panacode با loopback معتبر و بدون credential داخل URL را می‌پذیرد. نام sidecarها `panacode-cli(.exe)` و `panacode-cli.version` شد و پورت اجباری `0x70ac` از Desktop حذف شد تا `panacode service set port` معتبر بماند. کانفیگ قدیمی `opencode.json(c)` و `.opencode/` فقط‌خواندنی است و تنها `tool_output.max_lines` و `tool_output.max_bytes` با `legacy: true` زیر مقادیر Panacode بارگذاری می‌شود؛ هیچ plugin قدیمی فعال یا نوشته نمی‌شود. آرشیو پشتیبانی `panacode-debug-*.zip` شد و فقط ریشهٔ لاگ Panacode را می‌خواند. `opencode://` قبل از dispatch نادیده گرفته می‌شود و `panacode://` و `oc://renderer` می‌مانند. updater به مسیر دستی محدود شد (`UpgradeError` با عنوان «Panacode updates are manual»)، فیدهای به‌روزرسانی خارجی خاموش‌اند و `PANACODE_UPSTREAM_UPDATES=false` حفظ شد. نصب‌کنندهٔ ویندوز فقط وقتی پوشهٔ نصب مشترک قدیمی را بازگشتی پاک می‌کند که هیچ `*.exe` سطح‌بالایی نمانده باشد. گارد `script/panacode-isolation-check.ts` و workflow `.github/workflows/panacode-isolation.yml` اضافه شد.
- بررسی: `bunx bun@1.4.4` (مطابق `packageManager`). تست‌ها: `packages/util` ۳/۳؛ `packages/client` سرویس ۳۰ پاس و `promise-service` ۱۸ پاس + ۲ skip؛ `packages/cli` `service.test.ts` ۲۹ پاس + ۳ skip، `config/retained-image/env/updater-isolation/debug-heap-dump` ۳۰ پاس، `service-lifecycle` ۷ skip؛ `packages/core` config ۵۸ پاس + ۱ skip و logging ۲ پاس؛ `packages/tui` ۱۵۷ پاس؛ `packages/simulation` ۲ پاس؛ `packages/gui-plugins` debug/ssh ۱۳ پاس؛ `packages/server` `persistent-pty` ۱ پاس + ۶ skip؛ `packages/desktop` focused ۳۱ پاس، `electron.vite.config` ۲ پاس و `windows-installer` ۲ پاس + ۲ خطای محیطی. typecheck ریشه ۳۶/۳۶ سبز شد؛ چون `packages/app/src/custom-elements.d.ts` در این checkout ویندوزی symlink نیست (`core.symlinks=false`)، برای این اجرا موقتاً با محتوای `packages/ui/src/custom-elements.d.ts` جایگزین و سپس دقیقاً به همان فایل symlink متنی بازگردانده شد (بدون diff). `bun script/panacode-isolation-check.ts`، `bun script/panacode-ui-ownership-check.ts` و `bun script/panacode-brand-scan.ts` سبزند. `bun run check` در بخش lint فقط روی ۱۷۲ تخلف از پیش موجود `services/site` (اسکریپت `script/check-greys.ts`) شکست می‌خورد؛ فایل‌های این تغییر به آن‌ها دست نزده‌اند.
- تأیید نشده: پذیرش A–F روی ویندوز واقعی/VM تعاملی و آرتیفکت نصب‌شده اجرا نشد (D-015، T-013). تست‌های `windows-installer.test.ts` برای حالت ACL به `pwsh` و برای حالت process به ICMP/loopback سالم نیاز دارند که در این محیط نیست. `packages/cli/dist` وجود ندارد، پس `service-smoke.ts`، `catalog-smoke.ts` و بررسی باینری کامپایل‌شده اجرا نشد. Cargo/Rust نصب نیست، پس `packages/process-daemon` (نام باینری `opencode-pty` به‌عنوان مرز باینری خارجی) بازسازی/تست نشد.
- باقی‌مانده / ارجاع: T-013 (بیلد و QA آرتیفکت ویندوز)، T-014 (نسخهٔ Panacode)، D-019. مسیر به‌روزرسانی همچنان دستی است تا فید و installer اختصاصی Panacode ساخته شود.

### 2026-11-21
#### T-018 — بازبینی جداسازی ۰۰–۱۵ و رفع یافته‌ها | منتظر بررسی
- انجام‌شده: ۲۵ commit کد/تست/CI روی `isolation-fixes` از `9618e4d5ac`: تأیید مالکیت/instance پیش از stop و PTY، کنترل کانال خصوصی و ثبت atomic، ریشهٔ state مشترک و boot قابل‌تشخیص (`f4638c3d57`، `bd52230bdb`)، حذف فقط fragment نصب‌کننده از shell و مالکیت package پیش از uninstall (`d90765a5a1`، `3dc905f2cf`)، staging فقط CLI محلی تأییدشده و artifact مدیریت‌شدهٔ WSL/SSH (`99854af432`، `9ff85023bd`)، manifest مالکیت نصب و حذف دقیق (`7f11a8d250`)، گارد مسیر SQLite (`58cb764372`)، PTY مطلق/digest-verified (`e8e3828fa5`)، ZIP فقط diagnostics ساختاریافته و deep-link خلاصه (`db08704f95`)، جداسازی config/auth/session/Desktop identity (`49b95a8987`)، CI/contract/Windows acceptance (`97858ae392`)، و رفع باگ واقعی packaging (`90c282c11b`). D-020 ثبت شد و `UPSTREAM-MERGE.md` §C به‌روزرسانی شد. رفع‌های نهایی CI: کنترل سوکت (`4e2bc7ea81`، `9b01dca9e7`)، fixtureهای WSL/SSH (`49a93366a1`، `aa79a96e7b`)، رقابت contender در client (`5021af9b48`)، discovery فرآیند lifecycle (`5b57d27fe4`)، canonicalize مسیر fixture updater (`790860ba5b`)، skipهای Windows-only (`f098a2d97d`، `7e5a45179c`)، manifest separator (`2f0897afc1`) و انتظار relaunch آنینستالر NSIS (`eccc31771e`).
- remote CI: run `44936316557` روی `eccc31771e`؛ هر شش job سبز: guards، root quality، Linux client (۹۶ pass)، Linux CLI (lifecycle ۷/۰، ownership ۵۸/۰، database ۱۸/۲، service ۵۷/۰)، Windows acceptance (NSIS ۸/۰، client ۹۴/۲، GUI ۵۹/۰، lifecycle ۷/۰، desktop ۸۰/۰ و بقیهٔ گروه‌ها) و Linux core/desktop/gui.
- باگ packaging و رفع: نخستین بیلد واقعی installer نشان داد `writeInstallManifest` در hook `afterPack` با `Bun.write` نوشته شده بود، اما electron-builder آن را در runtime خودش (Node) اجرا می‌کند؛ پس هر بسته‌بندی واقعی با `ReferenceError: Bun is not defined` می‌شکست. `utils.ts` به `writeFile` منتقل شد و تست regression با spawn واقعی `node` + jiti همین تابع را بدون Bun اجرا می‌کند؛ proof قرمز قبلی همان ReferenceError را گرفت. utils suite: ۱۱ pass / ۰ fail / ۵۴ expect؛ oxlint صفر. بیلد بعدی علاوه بر NSIS، installer کامل Electron را تولید کرد.
- بررسی: Bun `1.4.4`؛ گروه‌های واقعی CI روی ویندوز در run سبز `44936316557`: lifecycle ۷/۰، database ۱۹/۱ skip، witness ۲/۰، shell profile ۵/۰، shell installer ۳۷/۱، service/updater ۶۷/۳، support ZIP ۱۸/۰، PTY ۴۲/۲، electron-builder ۱۰/۰، staging ۱۳/۰، desktop service ۸۰/۰، client ۹۴/۲، GUI ۵۹/۰، NSIS ۸/۰. typecheck پکیج‌های core/util/CLI/desktop/client/server/protocol/gui-plugins سبز؛ oxlint ۰ یافته؛ AST/SDK docs سبز؛ `script/panacode-isolation-check.ts` با سه گارد جدید و red/green probe سبز؛ harness واقعی NSIS با makensis/7za سبز. پس از رفع‌های نهایی: lifecycle ویندوز ۷ pass / ۳۰ expect (۱۰۹s)؛ NSIS ۸ pass / ۱۶۶ expect (۳۶.۵s)؛ GUI SSH+WSL ۹ pass / ۷۰ expect؛ client group ویندوز ۹۴ pass / ۲ skip / ۴۵۳ expect؛ `typecheck:tsc` پکیج‌های CLI/client/gui-plugins/desktop سبز (به‌جز artifact symlink شناخته‌شدهٔ `packages/app/src/custom-elements.d.ts`). جزئیات تست هر تسک در گزارش موقت بازبینی و تاریخچهٔ commitهاست.
- artifact: CLI `0.0.0-prod-202611211535` با SHA-256 `D5C3E052B9D3345C8D13787CC249E4A34675D70900C10EFE5E9D225B30DAA0AB`؛ installer `panacode-desktop-win-x64.exe` با SHA-256 `DC3B624CA4E82BDE390E4417F4E46ED9434422908115B55F5B9A58461E54F93D` (۲۶۷٬۶۴۸٬۷۳۰ بایت، `NotSigned`؛ ساخته‌شده از working tree معادل `90c282c11b`). این artifact رفع‌های بعدی `2f0897afc1` تا `eccc31771e` را ندارد؛ برای A–G از code/test HEAD جدید بسازید. bundled CLI داخل `win-unpacked` همان hash منبع را دارد و `verify-cli-provenance.ts` سبز است.
- محدودیت: remote CI روی code/test HEAD `eccc31771e` سبز است (run `44936316557`)، اما جای پذیرش A–G روی EXE نصب‌شده را نمی‌گیرد و A–G کماکان مسدود است (T-019)؛ artifact کاندید از `90c282c11b` است و رفع‌های بعدی را ندارد؛ Node SEA prelude فقط typecheck/review شد؛ WSL واقعی (VHDX گمشده) و Rust/process-daemon در دسترس نیستند؛ root `bun run check` فقط روی ۱۷۲ تخلف از پیش موجود `services/site` شکست می‌خورد.
- باقی‌مانده / ارجاع: T-019، T-013، T-011؛ D-020.

#### T-019 — پذیرش ویندوز نصب‌شده A–G | مسدود
- انجام‌شده: runbook دقیق A–G، دستورهای PowerShell/CLI، شناسهٔ کاندید و جدول شواهد در همین فایل ثبت شد (بخش «پذیرش ویندوز نصب‌شده (A–G)»).
- بررسی: اجرا نشد. این محیط VM/runner تعاملی ویندوز x64 با snapshot تازه و OpenCode نصب‌شده ندارد؛ هیچ PASS یا FAIL برای A–G ثبت نمی‌شود.
- باقی‌مانده / ارجاع: اجرای A–G روی VM دورریختنی؛ سپس به‌روزرسانی همین بخش با hash، PID/port، خروجی و نتیجهٔ هر گام.
