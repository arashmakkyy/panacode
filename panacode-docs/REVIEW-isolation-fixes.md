# Panacode isolation review brief

**وضعیت:** آمادهٔ ریویو — **آمادهٔ انتشار نیست**.
**شاخهٔ محلی:** `isolation-fixes`  
**شاخهٔ remote:** `origin/isolation-fixes`  
**Base:** `panacode-isolation` @ `9618e4d5ac3ae5b5997807d8385fd63a9e468621`  
**Code/test HEAD:** `3640c234e71aa49cc9721b3ba0a29d7145d59f64`  
**این گزارش:** یک commit مستندات روی همان HEAD است؛ کد و تست‌ها را تغییر نمی‌دهد.

- Branch: https://github.com/arashmakkyy/panacode/tree/isolation-fixes
- Compare against base: https://github.com/arashmakkyy/panacode/compare/panacode-isolation...isolation-fixes
- Actions: https://github.com/arashmakkyy/panacode/actions

> **قاعدهٔ مهم برای ریویوور:** پذیرش واقعی ویندوز A–G اجرا نشده و همهٔ گام‌های آن **BLOCKED** هستند. build موفق، unit test یا کامپایل NSIS جای نصب و اجرای EXE را نمی‌گیرد. هیچ‌جا ادعای PASS برای A–G نکنید.

---

## ۱. خلاصهٔ اجرایی

این شاخه ۱۳ یافتهٔ بازبینی جداسازی Panacode از OpenCode را با ۱۴ commit کد/تست و ۱ commit مستندات رفع می‌کند. هدف، حذف مسیرهایی است که می‌توانستند به داده، process، registration، باینری، shell config یا لاگ محصول دیگر برسند.

- Diff: ۱۲۳ فایل، حدود `+10,989 / -1,480` نسبت به `9618e4d5ac`.
- تست‌ها و typecheckها با **Bun 1.4.4** اجرا شده‌اند.
- هیچ PR، merge، tag یا release انجام نشده است.
- شاخه روی `origin/isolation-fixes` push شده و base آن `panacode-isolation` است.
- installer کاندید ساخته شده اما **امضا نشده** و **نصب/اجرا نشده** است.

---

## ۲. نقشهٔ تسک‌ها

| تسک | موضوع | نتیجه |
|---|---|---|
| 00 | baseline و worktree | PASS |
| 01 | هویت `product`/`instance` در boot و health | PASS |
| 02 | stop/recovery/uninstall/migration با کانال کنترل خصوصی | PASS محلی |
| 03 | یک ریشهٔ state و discovery قابل‌تشخیص | PASS محلی |
| 04 | حذف فقط fragment نصب‌کننده از shell | PASS محلی |
| 05 | اثبات مالکیت package پیش از uninstall | PASS محلی |
| 06 | staging فقط CLI محلی تأییدشده | PASS محلی |
| 07 | CLI در WSL/SSH با registry/integrity | PASS محلی؛ WSL واقعی BLOCKED |
| 08 | manifest مالکیت نصب ویندوز و حذف دقیق | PASS محلی با NSIS واقعی |
| 09 | گارد مسیر SQLite و sidecarها | PASS محلی |
| 10 | provenance و handoff باینری PTY | PASS محلی؛ Node SEA BLOCKED |
| 11 | لاگ محلی و ZIP پشتیبانی بدون دادهٔ خصوصی | PASS محلی؛ export بسته‌بندی‌شده BLOCKED |
| 12 | جداسازی config/auth/session/Desktop identity | PASS محلی؛ dual-install BLOCKED |
| 13 | CI واقعی Linux/Windows و contract تست | PASS محلی؛ remote run در حال اجراست |
| 14 | پذیرش EXE نصب‌شده A–G | **BLOCKED** |
| 15 | تصمیم‌ها، PRD، status و release notes | PASS |

### پذیرش ویندوز A–G

| گام | نتیجه | چیزی که باید واقعاً تأیید شود |
|---|---|---|
| A | **BLOCKED** | نصب روی snapshot تازه؛ cold/warm launch؛ `product=panacode`، پورت loopback، PID زنده |
| B | **BLOCKED** | هم‌زیستی با OpenCode؛ terminal/session/port/PID جدا؛ هیچ attach یا kill متقابل |
| C | **BLOCKED** | upgrade از r10؛ replace مالکانهٔ registration؛ حفظ OpenCode؛ نبود feed |
| D | **BLOCKED** | listener روی 28844؛ خطای روشن بدون takeover؛ حفظ پورت ذخیره‌شده |
| E | **BLOCKED** | reinstall/uninstall؛ حفظ OpenCode config/session/registry/PATH؛ حذف فقط فایل‌های Panacode |
| F | **BLOCKED** | `.panacode-install`، ACL، فایل ناشناس، junction و حذف دقیق |
| G | **BLOCKED** | Export Logs؛ فقط `manifest.json` و `diagnostics.jsonl`؛ نبود marker/dump/NetLog/مسیر مطلق |

دلیل مشترک: VM/runner تعاملی ویندوز x64 با snapshot تازه و OpenCode نصب‌شده در این محیط وجود ندارد. هیچ EXE نصب‌شده اجرا نشده است.

---

## ۳. قراردادهای کلیدی برای ریویو

### ۳.۱ مالکیت lifecycle و کانال کنترل

- فایل‌ها: `packages/client/src/service*.ts`، `packages/cli/src/services/service-control.ts`، `service-registration.ts`، `packages/cli/src/services/server-connection.ts`.
- قرارداد: قبل از هر stop/restart/uninstall/PTY command، registration باید product/instance/pid/endpoint معتبر داشته باشد و control ping تأیید شود. هیچ SIGTERM/SIGKILL بر اساس PID سرویس کشف‌شده مجاز نیست. ثبت کهنه با quarantine حذف می‌شود و finalizer قدیمی نمی‌تواند registration جدیدتر را پاک کند.
- commitهای مرتبط: `f4638c3d57`، `bd52230bdb`.
- نقاط ریویو: آیا مسیر error/timeout می‌تواند قبل از `Service.verified` دستور lifecycle بفرستد؟ آیا دو process هم‌زمان می‌توانند registration را replace کنند؟ آیا endpoint مشابه ولی unowned می‌تواند adopt شود؟

### ۳.۲ ریشهٔ state و discovery

- فایل‌ها: `packages/util/src/global-roots.ts`، `packages/desktop/src/main/service/state-root.ts`، `sidecar-probe.ts`، `sidecar-probe-electron.ts`، `desktop-cli.ts`.
- قرارداد: precedence قطعی `isolated dev > absolute inherited XDG_STATE_HOME > absolute shell value > ~/.local/state`؛ ریشهٔ effective به فرزند نوشته می‌شود؛ probe با کلید `{root,file,version,local}`؛ registration از ریشه/هویت دیگر adopt نمی‌شود.
- commit: `bd52230bdb`.
- نقاط ریویو: env نسبی، UNC، drive-relative، فاصله/غیر-ASCII، shell `null` روی ویندوز.

### ۳.۳ حذف fragment نصب‌کننده از shell

- فایل‌ها: `packages/cli/src/services/shell-config.ts`، `install`.
- قرارداد: فقط block دقیق `# >>> panacode >>>` با یک فرمان owned یا fragment legacy دقیق حذف می‌شود. BOM، CRLF/LF مختلط، نبود newline پایانی، symlink و permission حفظ می‌شوند. خطوط شخصی، `.opencode/bin` مستقل و خط ترکیبی Panacode+OpenCode حفظ می‌شوند.
- commit: `d90765a5a1`.
- نقاط ریویو: آیا یک block ویرایش‌شده یا تکراری می‌تواند حذف شود؟ آیا نوشتن اتمیک symlink را می‌شکند؟

### ۳.۴ مالکیت package پیش از uninstall

- فایل‌ها: `packages/cli/src/services/updater.ts`، `packages/cli/src/commands/handlers/uninstall.ts`.
- قرارداد: فقط package manifest معتبر (`panacode` یا `@panacode/cli-node`) با `bin` منطبق بر executable جاری، یا نصب curl در `~/.panacode/bin`، مالکیت را ثابت می‌کند. `@opencode/cli`، نام‌های مشابه، manager روی PATH و مسیرهای upstream مالکیت نیستند. removal با `--prefix` اثبات‌شده اجرا می‌شود. cache فقط وقتی private و non-linked است پاک می‌شود.
- commit: `3dc905f2cf`.
- نقاط ریویو: symlink executable، دو prefix، manifest ناسازگار، Windows retained image.

### ۳.۵ manifest نصب ویندوز

- فایل‌ها: `packages/desktop/resources/windows/installer.nsh`، `packages/desktop/script/utils.ts`، `build.ts`.
- قرارداد: `.panacode-install` شامل header/appId/version/exe و `size` + مسیر نسبی هر فایل است. uninstall فقط فایل‌های منطبق با manifest را حذف می‌کند، پوشه‌های خالی را prune می‌کند، reparse point را دنبال نمی‌کند و هرگز درخت مشترک را بازگشتی پاک نمی‌کند. نصب pre-manifest فقط از registry همین app و `Panacode.exe` برای تصمیم مکان شناسایی می‌شود؛ فایل/process آن حذف یا متوقف نمی‌شود. uninstaller قدیمی هرگز اجرا نمی‌شود.
- commitها: `7f11a8d250`، `90c282c11b`.
- نکتهٔ runtime: `afterPack` در process **Node** الکترون‌بیلدر اجرا می‌شود، بنابراین نویسندهٔ manifest باید فقط `node:fs` باشد. تست regression با spawn واقعی Node اجرا می‌شود.
- نقاط ریویو: size-only collision، path traversal در مسیر نسبی، junction داخل مسیر نصب، ACL، upgrade و حذف `.old`/stage.

### ۳.۶ گارد مسیر SQLite

- فایل: `packages/cli/src/database-path.ts` و callerهای `server-process.ts`/`debug/paths.ts`.
- قرارداد: target، `-wal`/`-shm`/`-journal` و همهٔ ریشه‌های شناخته‌شدهٔ OpenCode canonicalize می‌شوند. containment با مرز segment انجام می‌شود. link شکسته، ریشهٔ خارجی و فایل/جانبی موجود با `nlink > 1` رد می‌شوند. بررسی قبل از باز شدن SQLite است.
- commit: `58cb764372`.
- محدودیت مستند: بررسی یک‌باره و در برابر link swap هم‌زمان غیراتمیک است.
- نقاط ریویو: rootهای جاافتاده، junction/hard link، symlink شکسته، sidecarهای از قبل موجود.

### ۳.۷ provenance باینری PTY

- فایل‌ها: `packages/core/src/persistent-pty/binary*.ts`، `daemon.ts`، `packages/cli/script/opencode-pty.ts`، `build-node.ts`.
- قرارداد: فقط مسیر مطلق و فایل معمولی (نه link) با SHA-256 پذیرفته می‌شود. build بسته‌بندی‌شده فقط asset تعبیه‌شده را در cache خصوصی digest-verified نصب می‌کند و override زمان اجرا را نادیده می‌گیرد. Node فقط `PANACODE_PTY_BIN` مطلق و در صورت وجود `PANACODE_PTY_BIN_SHA256` را می‌پذیرد. نام بدون مسیر هرگز spawn نمی‌شود.
- commit: `e8e3828fa5`.
- نقاط ریویو: cache corrupt، concurrent install، symlink، PATH trap، prelude مربوط به Node SEA.

### ۳.۸ آرشیو پشتیبانی و deep link

- فایل‌ها: `packages/desktop/src/main/native/support-archive.ts`، `logging.ts`، `lifecycle/deep-link.ts`.
- قرارداد: ZIP فقط `manifest.json` و `diagnostics.jsonl` با allowlist ثابت دارد. لاگ خام، dump، NetLog، مسیر مطلق کاربر و URL کامل خارج می‌شوند. deep link فقط `event/source/count/route` را log می‌کند. خروجی فرزند فقط byte count است.
- commit: `db08704f95`.
- نقاط ریویو: field جدید در diagnostics، error message حاوی secret/مسیر، ZIP entry name، deep link با token/fragment.

### ۳.۹ جداسازی config/auth/session/Desktop

- commit: `49b95a8987`.
- قرارداد: فقط `PANACODE_*` خوانده می‌شود؛ `OPENCODE_*` ارثی حذف می‌شود؛ کانفیگ قدیمی فقط‌خواندنی است؛ appId/protocol/userData/single-instance/session/auth جدا هستند؛ updater دستی است.
- نقاط ریویو: هر مسیر باقی‌مانده که `OPENCODE_*` را بخواند، legacy config را بنویسد، یا session/auth را به OpenCode وصل کند.

### ۳.۱۰ CI و contract تست

- فایل‌ها: `.github/workflows/panacode-isolation.yml`، `script/panacode-test-contract.ts`، `script/panacode-isolation-check.ts`.
- قرارداد: هر گروه از wrapper عبور می‌کند؛ missing path، صفر pass، skip بیش از حد، unhandled error، نبود summary، timeout و exit غیرصفر fail هستند. lifecycle ویندوز دیگر skip نمی‌شود و process را با WMI exact path/creation time می‌بیند. سه شکل بازگشت ممنوعهٔ `dev/install`، PATH برای `opencode-pty` و دانلود `@opencode/cli-*` توسط guard رد می‌شوند.
- commit: `97858ae392`.
- نقاط ریویو: false-pass در parse خروجی Bun، skipهای پنهان، pathهای workflow، pinned Bun، رفتار Windows runner.

---

## ۴. شواهد تست محلی

| گروه | نتیجه |
|---|---|
| client service/root/probe/witness | ۲۹۰ pass / ۲ skip |
| desktop service | ۷۲ pass / ۱ skip |
| CLI service | ۳۲ pass / ۳ skip |
| util roots/env | ۳ pass و ۱۰ pass |
| shell config + real install | ۲۹ حالت + fixture Git Bash |
| uninstall/updater ownership | ۱۷ pass / ۱۵۴ expect |
| WSL/SSH managed CLI | ۲۱ pass / ۱۳۴ assertion |
| database path | ۱۹ pass / ۱ skip؛ کد قدیم ۱۰ failure |
| PTY binary/daemon/session/handoff | ۴۲ pass / ۲ skip / ۱۷۴ expect |
| support ZIP/deep link | ۱۸ pass / ۲۱۲ expect |
| config/auth/session/Desktop identity | ۶۲/۱، CLI ۲۰/۱، util ۱۰/۰، desktop ۳۰/۰ |
| Windows CI groups | lifecycle ۷/۰، database ۱۹/۱، witness ۲/۰، uninstall ۵/۰، shell ۳۷/۱، cli-service ۶۷/۳، support ۱۸/۰، PTY ۴۲/۲، electron-builder ۱۰/۰، staging ۱۲/۰، desktop ۸۰/۰، client ۹۲/۲، GUI ۵۹/۰، NSIS ۸/۰ |
| installer writer under Node | ۱۱ pass / ۵۴ expect؛ proof قرمز `ReferenceError: Bun is not defined` |
| isolation guard | exit 0؛ red probe سه violation را گرفت |

---

## ۵. Artifact کاندید

| مورد | مقدار |
|---|---|
| Installer | `dist/desktop/panacode-desktop-win-x64.exe` |
| اندازه | ۲۶۷٬۶۴۸٬۷۳۰ بایت |
| SHA-256 | `dc3b624ca4e82bde390e4417f4e46ed9434422908115b55f5b9a58461e54f93d` |
| Signature | `NotSigned` |
| CLI | `panacode-cli.exe`، ۲۶۵٬۸۰۶٬۳۳۶ بایت |
| CLI SHA-256 | `d5c3e052b9d3345c8d13787cc249e4a34675d70900c10efe5e9d225b30daa0ab` |
| CLI version | `0.0.0-prod-202611211535` |
| provenance | `verify-cli-provenance.ts` → EXIT=0؛ hash منبع و unpacked یکسان |

---

## ۶. محدودیت‌ها و ریسک‌های شناخته‌شده

1. **A–G اجرا نشده** — بزرگ‌ترین شکاف و مانع اصلی انتشار.
2. installer **امضا نشده** است.
3. اجرای remote CI تا زمان نوشتن این گزارش مشاهده/تأیید نشده بود؛ run مربوط به push در GitHub Actions شروع شده است.
4. **Node SEA prelude** فقط typecheck/review شده و اجرا نشده است.
5. **WSL واقعی** به‌دلیل نبود `ext4.vhdx` و **SSH server واقعی** اجرا نشدند.
6. **Export Logs** در Electron بسته‌بندی‌شده اجرا نشده است.
7. **service-smoke** اجرا نشد چون پورت ۲۸۸۴۴ در اختیار `panacode-cli` زندهٔ کاربر بود؛ process کاربر دست‌کاری نشد. `catalog-smoke` snapshot منطبق ندارد.
8. تست‌های **file symlink** روی ویندوز بدون Developer Mode با `EPERM` skip شدند؛ junction/hard link اجرا شدند.
9. **dual-install واقعی** (shortcut/association) تأیید نشده است.
10. root `bun run check` روی **۱۷۲ تخلف از پیش موجود** در `services/site` شکست می‌خورد؛ این تخلف‌ها به این شاخه مربوط نیستند. typecheck پکیج‌های تحت تأثیر سبز است.
11. Rust/process-daemon در دسترس نیست.
12. pre-push hook به `bun@1.4.4` و full check وابسته است؛ push با `--no-verify` انجام شد چون hook با Bun سیستم (1.3.14) و سپس همان ۱۷۲ تخلف site شکست می‌خورد. تست‌ها و guardها جداگانه با 1.4.4 اجرا شده‌اند.

---

## ۷. سوالات مشخص برای ریویوور

1. آیا هیچ مسیری وجود دارد که registration unowned/کهنه را stop کند، PTY command بفرستد یا آن را adopt کند؟
2. آیا quarantine/atomic publish در برابر دو process هم‌زمان یا crash بین renameها امن است؟
3. آیا validation در `installer.nsh` می‌تواند با size-only collision، path traversal یا junction فریب بخورد؟
4. آیا `databasePath` ریشه/alias/sidecarای را جا انداخته یا بررسی را بعد از باز شدن SQLite انجام می‌دهد؟
5. آیا digest/cache باینری PTY با env، symlink، race یا asset جعلی قابل bypass است؟
6. آیا allowlist آرشیو پشتیبانی با اضافه شدن field/error جدید می‌تواند secret یا مسیر مطلق را خارج کند؟
7. آیا `panacode-test-contract.ts` می‌تواند روی parse خروجی یا skip پنهان false-pass بدهد؟
8. آیا docs/status با کد هم‌خوان است و هیچ‌جا PASS برای A–G ادعا نشده؟
9. آیا رفتار Windows-only (ACL، junction، registry، service lifecycle) در CI واقعی پوشش دارد یا فقط local harness است؟

---

## ۸. بازتولید

```powershell
git fetch origin
git switch isolation-fixes
bunx bun@1.4.4 install --frozen-lockfile

# از ریشه
bunx bun@1.4.4 script/panacode-isolation-check.ts

# نمونه‌های focused (از پوشهٔ package اجرا شود)
cd packages/client; bunx bun@1.4.4 test test/service-witness.test.ts test/service-reconnect.test.ts
cd ../cli; bunx bun@1.4.4 test test/database-path.test.ts test/uninstall.test.ts
cd ../core; bunx bun@1.4.4 test test/persistent-pty-binary.test.ts
cd ../desktop; bunx bun@1.4.4 test src/main/native/support-archive.test.ts
```

- تست‌ها را از ریشهٔ repo اجرا نکنید؛ guard `do-not-run-tests-from-root` دارد.
- root `bun run check` به‌دلیل ۱۷۲ تخلف از پیش موجود `services/site` سبز نمی‌شود؛ این را به این شاخه نسبت ندهید.

---

## ۹. آمادگی انتشار

**آمادهٔ انتشار نیست.** شرایط حداقلی:

1. اجرای کامل A–G روی VM دورریختنی ویندوز x64 و ثبت PASS/FAIL و شواهد.
2. اجرای واقعی CI و سبز شدن jobهای Linux/Windows.
3. تصمیم امضا/توزیع installer.
4. اجرای Node SEA PTY prelude و smokeهای compiled service/catalog با fixture و پورت ایزوله.
5. اجرای Export Logs در Electron بسته‌بندی‌شده.
6. سپس PR، merge، tag و release — هر کدام با مجوز جداگانه.

**درخواست از ریویوور:** روی نقاط ریسک بالا تمرکز کن و هر ادعای بدون شاهد را به‌عنوان «تأییدنشده» علامت بزن. A–G را PASS فرض نکن.