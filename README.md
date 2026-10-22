# dsh-wander

用户一段时间没有说话时，dsh-wander 会挑一个**公开、有授权**的路边摄像头，取一张快照，写成一篇短的第一人称旅行日记。下次对话开始时，这段日记会出现在系统提示里，模型可以自然地提一句，例如「刚才我去看了冰岛的海边」。

插件可以单独使用。它不依赖 [dsh-companion](https://github.com/lishan85/dsh-companion)。如果那个插件以后要收集体验，可以听下面定义的事件，或读取同一份 JSONL。

针对 DeepSeek Harness **0.2.1-rc.2** 编写。运行时只依赖 `@deepseek-ai/schemastery`，不会把第二份 cordis 或 dsh 打进插件里。

## 安装

需要 Node.js `^22.19.0` 或 `>=24`，以及已经能启动的 dsh。交互式 profile（web / tui）里要有 `tools`、`systemPrompt`、`timer`、`commands`、`agents`。没有 `commands` 的 headless profile 不会加载本插件。

```bash
git clone https://github.com/lishan85/dsh-wander.git
cd dsh-wander
npm install
npm run build
dsh plugin --profile <profile> add /absolute/path/to/dsh-wander
```

安装补丁会把数据目录设成 `dshHomePath('wander')`。改完配置后重启 dsh。

## 它什么时候出门

- 用户发出一条真正的消息（`source.kind === 'user'`）之后，会话进入空闲，先等 `idleSeconds`（默认 20 分钟）。
- 仍然空闲时，之后每次间隔 `travelIntervalSeconds`（默认 3 小时）。
- 每天最多 `dailyCap` 次（默认 4）。`0` 表示除非命令里写了 `force`，否则不旅行。
- `quietHoursStart` 到 `quietHoursEnd` 是安静时段（默认 23:00–07:00，可跨夜）。两者相同则关闭安静时段。时区用 `timezone`，留空则用本机时区。
- 进程刚启动时，已经空闲的会话至少再等 `startupGraceSeconds`（默认 15 秒），避免一重启就去拉摄像头。
- 子代理（`session.header.origin === 'subagent'`）不触发。
- 用户回来（会话变为 running）会取消正在进行的空闲旅行。
- 同一时刻只有一次旅行。手动命令如果撞上它，会得到「正在看另一处风景」。

日记**不会**在空闲时主动插入会话，也不会为此叫醒模型。下一轮组装系统提示时，最近 `mentionWithinHours`（默认 36 小时）内、还没被提过的日记会放进 `wander:diary`。用户这条消息之前已经写好的日记，会在该轮结束、会话再次空闲时标成已提及，避免下一轮重复。

## 命令和工具

| 入口 | 作用 |
| --- | --- |
| `/wander` | 立刻去一个自动挑选的地点。忽略安静时段和旅行间隔，仍受每日上限约束。 |
| `/wander hanko` | 只去这个地点，失败不会偷偷改去别的国家。 |
| `/wander force` | 忽略每日上限。**不会**忽略视觉调用上限；超限就改用元数据日记。 |
| `wander_recall` | 模型用来回忆最近的日记。参数 `limit`（1–20，默认 5）和 `query`。 |

地点 id 见下文，大小写不敏感。

## 画面和日记

默认 `visionProvider` 是 `metadata`：**不需要任何密钥**。日记只根据地点、来源和当地时段来写，并明确说画面没有交给视觉模型。它不会编造天气、行人，或画面里有什么。

要看图，把 `visionProvider` 设为 `openai`，并填写任何 OpenAI 兼容的视觉接口：

```yaml
visionProvider: openai
visionBaseUrl: https://example.com/v1
visionApiKey: ${WANDER_VISION_KEY}
visionModel: your-vision-model
maxVisionCallsPerDay: 4
```

`visionBaseUrl` 必须以 `https` 开头。如果它已经以 `/chat/completions` 结尾，就原样使用，否则自动补上。请求先带 `max_tokens`；若对方返回 400 并提到 `max_completion_tokens`，会重试一次。每次发出的视觉 HTTP 请求都计入 `maxVisionCallsPerDay`，失败也计数。`0` 表示永远用元数据日记。没填地址、密钥或模型时，不会发请求，原因记为 `vision-unconfigured`。

视觉提示要求只描述看得见的内容，不要识别人脸或车牌。

## 摄像头从哪来

只使用书面上允许再分发、并且在 **2026-10-22** 用 HTTPS 实际取到 JPEG 的地址。不登录，不抓私有或不安全的摄像头，不使用带第三方署名的镜头（例如 Banff 的 Parks Canada 画面）。

请求带 `User-Agent: dsh-wander/0.1`。Digitraffic 额外带 `Digitraffic-User`。同一主机默认至少间隔 1.5 秒，失败的网络错误会有限重试。只接受 https，拒绝内网、链路本地、CGNAT 和 localhost，并在重定向上保持同一允许主机。文件必须是 JPEG、PNG、GIF 或 WebP，且不小于 256 字节。

| id | 地点 | 授权 |
| --- | --- | --- |
| `hanko` `helsinki-ruoholahti` `rovaniemi` `kilpisjarvi` `inari` `vaasa` | 芬兰 Fintraffic Digitraffic 路况摄像机 | [CC BY 4.0](https://www.digitraffic.fi/en/terms-of-service/)。署名：Source: Fintraffic / digitraffic.fi, license CC BY 4.0 |
| `reykjanes` `kleifarvatn` `olafsvik` `gautavik` `myvatn` | 冰岛公路和海岸管理局 Vegagerðin | [CC BY 4.0](https://www.vegagerdin.is/vegagerdin/gagnasafn/vefthjonustur/terms-and-conditions) |
| `furry-creek` `tofino` `revelstoke` `whistler-bayshore` | 加拿大不列颠哥伦比亚 DriveBC HighwayCams | [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc)。只用 `credit` 为空且标记为 DriveBC.ca 的镜头 |

`enabledPlaceIds` 非空时只使用这些 id，并且不混入 Windy。`disabledPlaceIds` 会去掉对应地点。未知 id 会在加载时失败。

`extraPlaces` 可以再加一台**你确认有权使用**的 https 快照。必须写 `attribution`、`license`、`tosUrl`。重定向不能离开这张快照自己的主机。

### Windy（可选，需要你自己的密钥）

```yaml
windyEnabled: true
windyApiKey: ${WINDY_API_KEY}
windyWeight: 0.35
```

没有密钥时只是跳过，不会阻止插件加载。有密钥且允许列表为空时，大约 35% 的旅行会先向 Windy Webcams API 要一页公开摄像头；失败再退回上面的清单。图片主机限制在 Windy 自己的域名。请遵守 [Windy Webcams API](https://api.windy.com/webcams/docs) 的条款，并在日记的署名里保留 Windy。本仓库的测试只用了本地样例，**没有**用真实密钥调用 Windy。

## 存在哪里

SQLite 文件是 `dataDir/wander.sqlite`。每次旅行还会追加：

- `trips.jsonl`：完整记录
- `experiences.jsonl`：给同伴插件的体验
- `images/`：快照，可用 `saveImages: false` 关掉

JSONL 写失败只记一条警告，不会让同一次旅行再写一条 SQLite 记录。

## 接到 dsh-companion

不导入对方的包。旅行写入成功后发出 Cordis 事件 `wander/trip`，载荷是版本为 1 的体验：

```ts
import type { } from 'dsh-wander'

ctx.on('wander/trip', (experience) => {
  // experience.schemaVersion === 1
  // experience.source === 'dsh-wander'
  // experience.kind === 'travel'
  // experience.text 是日记
  // experience.emotionHint 是心情，元数据模式下为空字符串
  // experience.place、attribution、license、imageUrl、descriptionMode
})
```

也可以尾随 `experiences.jsonl`。`descriptionMode` 为 `metadata` 时，不要把日记当成「她看见了什么」。

## 配置一览

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 关掉后空闲旅行和 `/wander` 都停 |
| `dataDir` | `DSH_HOME/wander` | 数据目录 |
| `idleSeconds` | `1200` | 第一次出门前的空闲时间 |
| `travelIntervalSeconds` | `10800` | 仍空闲时的下一次间隔，至少 60 |
| `dailyCap` | `4` | 当地日历日内的旅行次数 |
| `quietHoursStart` / `quietHoursEnd` | `23:00` / `07:00` | 安静时段 |
| `timezone` | 空 | IANA 时区，空则用本机 |
| `mentionWithinHours` | `36` | 日记留在提示里的时间 |
| `promptTripCount` | `3` | 提示里最多几篇 |
| `saveImages` | `true` | 是否保存快照 |
| `maxImageBytes` | `8000000` | 单张上限 |
| `fetchTimeoutMs` | `20000` | 拉图超时 |
| `fetchRetries` | `2` | 网络错误、429、5xx 的额外次数 |
| `maxPlaceAttempts` | `3` | 一次旅行最多换几个镜头 |
| `minHostIntervalMs` | `1500` | 同一主机的最小间隔 |
| `sourceCooldownSeconds` | `21600` | 刚看过的镜头先避开；若全部都在冷却，仍会出门 |
| `visionProvider` | `metadata` | `metadata` 或 `openai` |
| `maxVisionCallsPerDay` | `4` | 视觉 HTTP 次数 |
| `diaryLanguage` | `zh-CN` | `zh-CN` 或 `en` |
| `windyEnabled` | `false` | 是否尝试 Windy |

其余数值（超时、重复地点窗口等）都有默认值，写错类型或未知地点 id 时插件拒绝加载。

## 隐私和边界

这些是公路和海岸的公共摄像机，画面里可能出现路人、车辆。元数据模式不描述人。视觉模式只把图片发给**你配置的**那个接口，并要求模型不要辨认身份。日记、快照和视觉次数都留在本机 `dataDir`，插件自己不上传到别的服务。

不要把需要登录、指向私人场所、或条款禁止抓取的地址填进 `extraPlaces`。请保留每篇日记里的署名和来源页。

## 测试

```bash
npm test
npm run typecheck
npm run build
```

单元测试覆盖安静时段、每日上限、选点、SSRF 拒绝、重试、元数据日记、本地假视觉接口、Windy 响应样例、SQLite、空闲调度，以及用 Cordis 桩服务把插件装进去。另外有一条网络测试，会真实请求 Hanko 的 Digitraffic 快照并走元数据日记。

在 dsh 0.2.1-rc.2 上，把构建好的目录 `dsh plugin add` 进一个临时 profile 后，`dsh web --no-open` 能完成加载并创建 `wander.sqlite`。这一步不需要模型密钥。

## 还需要真实密钥的部分

下面这些事这个仓库**做不到**，也不该空等密钥：

- 用真实的 OpenAI 兼容视觉模型看图。测试用的是本机假接口和元数据回退。
- 调用 Windy Webcams API。测试只用了响应样例。
- 在一次真实的 dsh 对话里，让模型亲口说出日记。那需要可用的模型账号和密钥。

没有这些密钥时，插件仍然可以安装、空闲触发、拉取上面列出的公开快照、写元数据日记、保存、回忆，并响应 `/wander`。

## 限制和后续

摄像头地址和条款会变，清单需要以后再核验。配置在加载时读取，修改后要重启。dsh 若升级插件 API，需要再对一次 0.2.1-rc.2 之后的版本。

以后可以加更多已核验的公开来源，并在 dsh-companion 有正式写入接口时把体验送进去。当前不要假设那个仓库已经提供了情绪或记忆 API。

## 许可

MIT，版权 2026 LiShan。摄像头画面各自遵守上表中的许可，不属于本仓库的代码许可。
