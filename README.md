# 生产日报系统（PDR）

车间生产过程数据记录系统 —— 单一 Windows 窗口程序，Node.js 承载业务逻辑，WebView2 承载界面渲染，数据以 CSV 文件保存在可执行程序同级的 `data/` 目录，全程无 HTTP 服务、无监听端口、可离线运行。

实现依据：《生产日报系统需求规格说明书》V1.4 与《生产日报系统软件开发详细设计书》V1.0。

---

## 一、技术栈与设计书差异说明

| 项 | 设计书 | 实际实现 | 说明 |
|---|---|---|---|
| 窗口/界面容器 | Microsoft Edge WebView2 | 同左 | 保持不变 |
| 桥接库 | `@webview/webview`（Node 官方绑定） | **`@webviewjs/webview`** | `@webview/webview` 在 npm 上不存在（已核实 registry 返回 404）。`@webviewjs/webview` 是 tao + wry 的 N-API 绑定，Windows 下封装 WebView2，随包提供预编译原生模块，**无需本地 C++ 编译链**，能力等价（单窗口、无端口、无 HTTP 服务） |
| Node 版本 | 推荐 LTS 22.x | **要求 ≥ 24** | `@webviewjs/webview` 通过 `engines` 强制 ≥ 24 |
| 打包 | `pkg` / `@yao-pkg/pkg` | `@yao-pkg/pkg` 或 WebviewJS 自带 CLI（Node SEA） | `pkg` 无法内联 `.node` 原生模块，建议使用 WebviewJS CLI（见第四节） |
| 其余依赖 | csv-parse / csv-stringify / bcryptjs / exceljs / pdfkit / dpapi | 同左 | `dpapi` 为可选依赖，缺失时自动降级 AES-256-GCM |

窗口层被收敛在 `src/window/host.js` 一个文件内，桥接层、服务层、存储层与宿主实现完全解耦：若后续确需更换绑定库，只需重写该文件。

---

## 二、目录结构

```
ProductionDailyRecordSystem-Demo/
├── main.js                        # 进程入口：初始化 → 建目录 → 建窗口 → 挂桥接
├── package.json
├── scripts/check.js               # 静态校验（语法 + 相对模块引用可解析性）
├── src/
│   ├── config.js                  # data/ 定位规则、应用/认证/界面常量
│   ├── constants.js               # 角色、实体、操作类型、错误码、长度限制
│   ├── seed.js                    # 首次启动初始化与演示数据
│   ├── window/host.js             # WebView2 窗口宿主（自定义协议静态资源服务）
│   ├── bridge/index.js            # 路由表、鉴权装饰、结果封装、事件推送
│   ├── services/                  # auth / report / stats / export / audit / user
│   │                              # product / template / operationType
│   ├── validators/reportValidator.js  # R1–R7、sanitizeHeader/Detail、computeWarn
│   ├── store/                     # csvStore（原子写 + 串行写队列）与各领域存储
│   └── utils/                     # id / time(GMT+8) / number / crypto / error / logger
└── ui/
    ├── index.html
    ├── css/app.css
    └── js/  api.js · util.js · charts.js · router.js · pages/{login,report,stats,system,audit}.js
```

运行期数据目录（首次启动自动创建）：

```
data/
├── users.csv  products.csv  templates.csv  operation_types.csv  audit.csv
├── session.dat                    # "记住账号"凭据（DPAPI 或 AES-256-GCM 加密）
├── exports/                       # "另存为"不可用时的导出兜底目录
└── reports/YYYY/YYYY-MM-DD.csv            # 日报头部（一天一行）
              YYYY-MM-DD.details.csv      # 生产记录明细（0–15 行）
```

---

## 三、运行

前提：Windows 10/11；已安装 WebView2 Evergreen Runtime（Win11 自带）；Node.js ≥ 24。

```bash
npm install
npm start                 # 启动桌面程序
npm run start:devtools    # 启动并打开开发者工具
npm run check             # 静态校验：语法 + 相对模块引用
```

默认账号（初始密码均为 `123456`，登录后建议修改）：

| 账号 | 姓名 | 角色 | 权限 |
|---|---|---|---|
| `admin` | 张伟 | 系统管理员 | 全部功能 + 当日填报 |
| `leader` | 李强 | 班组长 | 查看 + 统计看板（只读） |
| `qa` | 王敏 | 质量管理员 | 查看 + 统计 + 导出 + 审计（只读） |
| `operator` | 赵磊 | 操作工 | 当日填报 + 查看历史（当日可写） |

另有 `operator2`（陈晨）、`operator3`（刘洋）用于演示多操作员填报。

环境变量：

| 变量 | 作用 |
|---|---|
| `PDR_DATA_DIR` | 重定向 `data/` 目录（备份恢复、测试隔离） |
| `PDR_WEBVIEW_DATA_DIR` | 指定 WebView2 浏览器数据目录（默认 `%LOCALAPPDATA%\PdrDesktop\WebView2`） |
| `PDR_SEED_DEMO=0` | 关闭首次启动的演示历史日报生成 |
| `PDR_FONT` | 指定 PDF 导出使用的中文字体文件 |
| `PDR_NO_DIALOG=1` | 导出时不弹系统"另存为"对话框，直接写入 `data/exports/` |
| `PDR_DEVTOOLS=1` | 强制打开开发者工具 |

---

## 四、打包为单文件 exe

`pkg` 无法把 `.node` 原生模块打进单文件，因此推荐 WebviewJS 自带的 CLI（基于 Node SEA）：

```bash
npm run build:sea -- --out dist        # 产出 dist/ 下的可执行文件
```

若坚持使用 `pkg`，需把 `@webviewjs/webview` 的原生模块与 `ui/` 一并作为外部资源随包分发：

```bash
npm run build                          # pkg 目标 node22-win-x64
```

打包后 `process.execPath` 指向 exe，`data/` 自动落在 exe 同级目录。

---

## 五、部署要点

1. 首次启动自动创建 `data/` 及各 CSV（含表头）、默认账号、字典与演示数据。
2. 数据备份 = 复制整个 `data/` 目录；系统不提供自动归档。
3. PDF 导出中文字体解析顺序：`PDR_FONT` → `ui/assets/fonts/NotoSansSC-Regular.ttf` → `C:\Windows\Fonts\msyh.ttf` → `simhei.ttf` → `simsun.ttc`；均不可用时告警并降级。
4. 生产环境（打包态）自动关闭 WebView2 开发者工具。

---

## 六、核心规则实现对照

| 规则 | 实现位置 |
|---|---|
| R1 批号全局唯一 | `reportService.saveHeader` + `reportStore.findBatchOwner`（跨 `reports/` 全量扫描，排除自身、跳过空值，冲突 409） |
| R2 超限必填原因 | `reportValidator.assertWarnReason`（`warn=1` 且原因为空 → 400） |
| R3 EO 累计量单调不减 | `reportValidator.assertEoMonotonic`（同日报按记录时间排序比较） |
| R4 EO 累计量 ≤ EO 净重 | `reportValidator.assertEoWithinWeight` |
| R5 记录时间日报内唯一 | `reportValidator.assertRecordTimeUnique`（精确到分钟，冲突 409） |
| R6 仅当日可编辑 | 桥接角色白名单 + `reportService.assertEditable`（服务层二次校验，跨日 403） |
| R7 备注 ≤200 / 小结 ≤1000 | 界面 `maxlength` + `reportValidator.sanitizeText` |

其他关键实现：

- **懒创建**：`report.ensureToday` 仅创建表头，未点击"今日日报"的日期不产生任何数据文件。
- **自动保存**：头部字段 300ms 防抖、明细行 400ms 防抖，保存后仅同步该行，不整表刷新。
- **超限重算**：头部品名变更导致模板变化时，重算该日报全部明细的 `warn` 并逐条留痕。
- **审计留痕**：所有写操作成功后追加 `audit.csv`，仅追加、无修改/删除入口；不记录密码等敏感字段；写入失败仅告警不阻断业务。
- **凭据加密**：优先 Windows DPAPI，不可用时降级 AES-256-GCM（密钥由主机名 + 用户名经 scrypt 派生）。
- **记住账号**：7 天有效；未勾选时仅进程内会话有效，关闭程序即失效。

---

## 七、已知限制

1. **单机单实例**：不做多实例并发写同一文件的互斥控制。
2. **CSV 全量扫描**：批号唯一性校验与报告库列表为全量扫描，数据规模增长后需引入索引文件或迁移 SQLite（设计书 10、12 章已预留）。
3. **"另存为"对话框**：通过 PowerShell 调用 `System.Windows.Forms.SaveFileDialog`；不可用时回退到 `data/exports/`。
4. **原生依赖**：WebView2 Runtime 与中文字体为系统前提。
5. **演示数据**：首次启动会生成最近 25 天的历史日报（每 7 天留空一天，约 1/5 的日报含超限记录），便于演示统计看板与追溯；生产部署请设置 `PDR_SEED_DEMO=0`。
6. **验证状态**：静态校验通过（40 个文件语法 + 全部相对模块引用）。运行态已验证启动初始化链（数据目录解析、默认账号/字典/演示数据写入、凭据加密、桥接方法注册）；窗口创建曾因 WebView2 用户数据目录不可写而失败，已修复（见第八节），**修复后尚待复测**；导出与 CSV 读写效果仍未实机验证。

---

## 八、故障排查

### 8.1 `创建 WebView2 窗口失败：HRESULT(0x80070005) 拒绝访问`

**现象**：`npm start` 时数据初始化全部正常，但在创建窗口阶段抛出 `Failed to create webview: WebView2 error: WindowsError(Error { code: HRESULT(0x80070005), message: "拒绝访问。" })`。

**根因**：WebView2 需要写入"用户数据目录（User Data Folder）"，其默认值为可执行文件同级目录。开发态 `process.execPath` 指向 `C:\Program Files\nodejs\node.exe`，向 `Program Files` 写入会被系统拒绝，因此返回 `E_ACCESSDENIED`。

**已实施的修复**（`src/window/host.js`）：在创建窗口之前显式把浏览器数据目录固定到可写位置，并按优先级解析：

1. 环境变量 `PDR_WEBVIEW_DATA_DIR`
2. `%LOCALAPPDATA%\PdrDesktop\WebView2`
3. 系统临时目录 `<tmp>\PdrDesktop-WebView2`

同时设置进程环境变量 `WEBVIEW2_USER_DATA_FOLDER` 作为兜底（当绑定库未透传目录时，WebView2 加载器会读取该变量）。该目录专门存放 WebView2 自身的缓存与配置，**不含业务数据**，因此不放在 `data/` 内，以免污染"复制 data/ 即备份"的运维约定。启动日志会打印实际使用的目录路径。

**若仍失败**，按以下顺序排查：

1. 手工确认启动日志中打印的"WebView2 浏览器数据目录"是否存在且可写；或指定一个确定可写的目录后重试：
   ```bat
   set PDR_WEBVIEW_DATA_DIR=D:\temp\pdr-webview
   npm start
   ```
2. 换用普通 `cmd` / `PowerShell` 窗口运行，排除受管终端、受限令牌或安全软件拦截子进程的可能。
3. 删除上述数据目录后重试，排除历史运行（曾以管理员或其他用户身份）造成的目录归属冲突。
4. 确认 WebView2 Evergreen Runtime 完整：错误信息中会打印运行时版本，显示"未检测到"时需重新安装 Evergreen Runtime。

### 8.2 界面显示"桥接通道不可用"

说明页面未通过桌面宿主加载（例如直接用浏览器打开 `ui/index.html`）。本系统界面依赖宿主注入的桥接通道，必须通过 `npm start` 启动桌面程序使用。

### 8.3 报表库为空 / 品名下拉为空

- 品名与操作类型字典首次启动已预置（各 4 项、8 项）；若曾被清空，需以 `admin` 在"系统管理"中维护。
- 设置 `PDR_SEED_DEMO=0` 时不会生成演示历史日报，"报告库"仅显示实际填报过的日期。
