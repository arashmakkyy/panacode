# وضعیت پروژه — Panacode
آخرین به‌روزرسانی: 2026-11-18

## تصویر فعلی
- **کدنویسی متوقف است.** آخرین commit کد: `07b4ccaa8a` (feat(shortcut-recorder)) روی `panacode/redesign-v2` در `arashmakkyy/panacode`. پورت Freeهای باقی‌مانده تمام نشده است (T-001). طبق D-015 تست جدید هم تا دستور Arash اجرا نمی‌شود.
- **هر ۸ مرجع Arc منتقل و به state واقعی وصل شده‌اند** (کد commit شده؛ تأیید نهایی Arash هنوز نگرفته): Tool Call (`bc7350a7dd`)، Agent Approvals (`64afda0f07`)، Code Suggestion (`c547400640`)، AI Chat (`836bdc2d7f`)، AI Composer (`f409be2deb`، `77039b49c7`، `935d91ff84`)، Agent Run (`e1cd0362a5`)، Agent Orchestrator (`a3edd8ba63`)، MCP Servers (`975cc3c659`).
- **پایه:** برند Firouzeh (موقت، قابل تعویض؛ `0f11cd5a05`)، shell با سایدبار ورک‌اسپیس و تاپ‌بار باریک (`c18a6764d7`، `a713a9a323`)، آیکون‌های lucide (`ca80b6487b`)، motion با springهای Arc (`8f35c335a2`)، PanaAI spotlight در Providers (`153f43a020`)، اصلاح dark mode و brand-scan در CI.
- **Freeهای پورت‌شده (commit شده):** command-palette، dropdown/context menu، toast-stack، tooltip، dialog، search-field، tabs، theme-switch، card، select، resizable-panels، hover-card، shortcut-recorder. switch و segmented-control از قبل primitive دارند (وفاداری به Free پک بازبینی نشده).
- **کامپوننت‌های Pro:** ۱۷ مورد در انتظار ساخت توسط Arash — بخش «کامپوننت‌های Pro در انتظار ساخت» در پایین (T-008).
- مبنای بررسی: `origin/panacode/redesign-v2` @ `07b4ccaa8a`؛ در worktree کدنویس (`/workspace/pc-audit` روی box) یک تغییر commit‌نشده هست: `packages/gui-plugins/src/context/tab.tsx` (محتوا بررسی نشده).
- سطح بررسی: این بازسازی از Git، کد، اسناد و گفت‌وگوها انجام شد؛ هیچ تستی در آن اجرا نشد. آخرین QA خودکار ثبت‌شده (harness روی box: Electron + Playwright + ffmpeg، بک‌اند واقعی) در 2026-11-18 حدود 08:35 PT روی `6b1d24a9ec`: ۸۹ گام، ۰ خطا، thinking و پاسخ چت دیده شد. commitهای بعد از آن (`d3274184b5` تا `07b4ccaa8a`) تست نشده‌اند؛ هیچ نسخه‌ای هنوز تأیید Arash را ندارد.

## کارهای باز
| تسک | هدف و شرط پایان | وضعیت | پیشرفت / مانع / اقدام باقی‌مانده |
|---|---|---|---|
| T-001 | پورت Freeهای باقی‌ماندهٔ انتخاب‌شده به Solid، هرکدام کامل و به state واقعی وصل | متوقف | باقی‌مانده: user-menu، inline-edit (rename)، confirm-morph (حذف)، tree-view، code-block، json-viewer، file-dropzone، morph-select، radio-cards، notification-center، alert، empty-state، skeleton، text-shimmer، usage-meter، animated-counter، badge، changelog-feed، icon-morph، onboarding-checklist؛ و بازبینی switch/segmented-control با نسخهٔ Free. کد پک روی box: `/workspace/arc-pack/arc-ui/uiarc-free-code/`. |
| T-002 | رفع خطاهای باز تست (۶ مورد طبق گزارش پیشرفت 2026-11-18) و سبز ماندن typecheck/تست‌ها | متوقف | گزارش‌شده؛ اینجا بررسی نشده. فهرست دقیق در خروجی QA روی box است. |
| T-003 | بررسی کامل حالت روشن (light) همهٔ صفحه‌های جدید | متوقف | — |
| T-004 | QA نهایی end-to-end + ویدیو و اسکرین‌شات برای تأیید Arash | منتظر بررسی | فقط با دستور Arash (D-015). باید شامل: Providers (PanaAI اول، کلید ماسک‌شده، لیست Popular خالی نباشد)، پنجرهٔ مجوز با فایل/الگو/دستور، thinking با مدل thinking‌دار، چت/ابزار/دیف، صفر خطای کنسول، صفر «OpenCode»، بدون نمایش کلید. |
| T-005 | ریلیز Windows r9 از طریق `panacode-windows.yml` | در حال انجام | اجرای `44453296373` در 2026-11-18 حدود 19:42 PT شروع شده و هنگام این بازسازی in_progress بود؛ نتیجه اینجا بررسی نشده. |
| T-006 | حذف متن فارسی از داده‌های برند | در صف | `packages/panacode-ui/src/brand/packs/firouzeh/brand.ts` فیلد `taglineFa` دارد و `index.tsx` آن را export می‌کند (D-009). رندر شدنش بررسی نشده؛ باید حذف یا تأیید شود که هیچ‌جا نمایش داده نمی‌شود. |
| T-007 | ادغام کار در `dev` و همگام‌سازی با upstream | مسدود | نیازمند تأیید Arash. `dev` در 2026-11-18 هنوز upstream خالص و ۱۶۹ commit عقب‌تر از `anomalyco/opencode:dev` بود. روال: `UPSTREAM-MERGE.md` §E. |
| T-008 | دریافت و یکپارچه‌سازی ۱۷ کامپوننت Arc Pro | منتظر بررسی | منتظر ساخت توسط Arash؛ جزئیات کامل در بخش بعدی. |
| T-009 | مراحل ۳ تا ۵ برنامه: بقیهٔ صفحه‌ها (فاز ۲)، تست بصری خودکار، به‌روزرسانی `UPSTREAM-MERGE.md` و ریلیز | در صف | پس از تأیید مرحلهٔ فعلی. |
| T-010 | بررسی دوبارهٔ پک Arc و پیشنهاد جایگزینی‌های بیشتر | در صف | Arash گفته پس از تأیید این فاز اعلام می‌کند. |
| T-011 | تأیید PRD بازسازی‌شده توسط Arash | منتظر بررسی | `PRD.md` پیش‌نویس است. |

## ادامه از اینجا
- قدم بعدی: منتظر دستور Arash بمان. اگر کدنویسی ادامه یافت → T-001 از `07b4ccaa8a`، بعد T-002/T-003، و فقط با دستور او T-004.
- اطلاعات لازم: `redesign/PROMPT.md`، `UPSTREAM-MERGE.md`، `packages/panacode-ui/src/brand/README.md`، `redesign/RUNNING.md`؛ روی box: `/workspace/arc-pack-review.md` (نقشهٔ صفحه→Arc و پیشنهادها)، `/workspace/arc-pack/arc-ui/`، `/workspace/panacode-qa/run-qa.sh panacode/redesign-v2` (با `QA_PERMISSION=1`).

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
#### T-012 — بازسازی اولیهٔ مستندات طبق how_to_update_docs.md | تکمیل
- انجام‌شده: پوشهٔ موجود `panacode-docs/` حفظ شد؛ `PRD.md` (بازسازی‌شده، پیش‌نویس)، `decisions.md` (D-001…D-015)، `status.md` و کپی `how_to_update_docs.md` اضافه شدند. فهرست Proهای در انتظار در همین فایل آمد (به دستور Arash، نه فایل جدا). اسناد پشتیبان (`UPSTREAM-MERGE.md`، `redesign/*`) جابه‌جا نشدند چون `script/panacode-ui-ownership-check.ts` و `packages/panacode-ui/README.md` به مسیرشان ارجاع می‌دهند.
- بررسی: Git log `panacode/redesign-v2` تا `07b4ccaa8a`، کد `packages/app` و `packages/panacode-ui`، `PANACODE.md`، `redesign/*`، پک Arc و بررسی آن روی box، گزارش QA روی box. تست اجرا نشد.
- باقی‌مانده / ارجاع: T-011 (تأیید PRD). تاریخچهٔ قبل از این بازسازی فقط به‌صورت خلاصه در decisions و «تصویر فعلی» آمده است.
#### کارهای قبلی (بازیابی‌شده از Git، خلاصه)
- 2026-11-14 تا 11-15: overlay فقط PanaAI (`76e9350b80`)، Sign in with PanaAI (`a296aec3dc`)، جداسازی مسیرها (`8734f2cd09`).
- 2026-11-17 تا 11-18: نسخهٔ اول بازطراحی و ریلیزهای Windows r5–r8 (r8 از `4f3a17ba1a`؛ r7 ناقص). سپس مرحلهٔ ۱ دوباره (redesign-v2) از `43d0cc803e` تا `07b4ccaa8a`: برند، shell، آیکون، motion، ۸ مرجع، Freeهای فهرست‌شده در «تصویر فعلی»، workflow ویندوز و حذف `release.yml`.
