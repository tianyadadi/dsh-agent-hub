# dsh-agent-hub

把插件和技能分类成不同功能的 **Agent**，基于 DSH 原生 agent preset 机制。

## 它做了什么

- 读 `~/.dsh/agents/agents.json`，把每个启用的 agent 注册成一个 DSH agent preset
- 每个 agent = 一套 persona + 工具子集（从 standard 预设派生，可摘掉不需要的工具）
- 浏览器端在输入栏右侧挂一个选择器，点一下就能切 agent
- 工作台可以通过 `/api/agent-hub/*` 管理：开关选择器、增删改 agent

## 三个文件（都在 `~/.dsh/agents/`）

| 文件 | 内容 |
|---|---|
| `agents.json` | agent 定义，可手改，工作台也写这里 |
| `ui.json` | `{ "selectorVisible": true }`，控制输入栏选择器显不显示 |

## agent 定义格式

```json
{
  "id": "douyin",
  "name": "抖音助手",
  "icon": "📱",
  "order": 10,
  "enabled": true,
  "description": "刷推荐流、写日报、看评论私信",
  "persona": "你是抖音内容助手……",
  "skills": ["douyin"],
  "disabledTools": []
}
```

- `id` 必填、唯一；不能和内置的 `standard` / `cordis` / `ptc` / `minimal` 重名
- `persona` 会替换掉 standard 模板里的 persona 提示词
- `disabledTools` 里的行 id（如 `tool-web`）会从该 agent 的组合里摘掉
- `enabled: false` 的 agent 不注册，选择器里也看不到

## 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/agent-hub/status` | 一次性读 ui + agents |
| GET/POST | `/api/agent-hub/ui` | 读/写选择器开关 |
| GET | `/api/agent-hub/agents` | agent 列表（精简） |
| POST | `/api/agent-hub/agents` | 整体保存 agents |
| POST | `/api/agent-hub/reload` | 重载插件，让新定义生效 |

只接受本机请求；确实要远程管理时设 `DSH_AGENT_HUB_ALLOW_REMOTE=1`。

## 工具

- `agent_hub_list` — 列出所有 agent
- `agent_hub_toggle` — 启用/禁用
- `agent_hub_reload` — 重载

## 上游同步（重要）

`index.js` 里的 `standardPlugins()` 是从 DSH **0.2.x** 的
`packages/bundle/web-app/presets/standard.patch.yml` 复制的。
DSH 升级后如果 standard 的插件列表变了，这里要跟着改，否则自定义 agent
会缺工具或少插件。核对方法：

```
对照 GitHub 上 packages/bundle/web-app/presets/standard.patch.yml
```

## 已知限制

- 切换只在**会话第一轮开始前**有效（DSH 的硬限制，返回 `agent-preset/locked`）
- 正在进行的会话保持原有组合，改配置只影响新会话
- 重载（`/reload`）会重建 preset，但已开始的会话不受影响
- 不是所有插件都适合放进 preset：只有 agent 级插件（工具、提示词）能这样组合；
  带面板/路由的 Host 插件（如 douyin-lite）仍全局生效，agent 只是「知道它存在 + persona 指向它」