/**
 * dsh-agent-hub —— 把插件和技能分类成不同功能的 Agent
 * ============================================================================
 * 原理：DSH 原生就有 agent preset（一个 preset = 一套 agent 级插件组合）。
 * 本插件把 ~/.dsh/agents/agents.json 里的每个 agent 翻译成一个 preset，
 * 注册进 ctx.agentPresets。所以：
 *   · 会话选择 agent 走的是 DSH 官方机制，不是自造
 *   · 每个 agent 的 persona / 工具子集由 agents.json 决定
 *   · 工作台通过 /api/agent-hub/* 管理，客户端选择器通过同一接口读开关
 *
 * 文件布局（都在 ~/.dsh/agents/）：
 *   agents.json    agent 定义（可手改，工作台也写这里）
 *   ui.json        界面开关（selectorVisible：输入栏选择器显不显示）
 *
 * 注意：preset 的插件模板是从 DSH 0.2.x 的 standard 预设复制的。
 * DSH 升级后如果 standard 变了，这里要跟着更新（见 README 的「上游同步」）。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-agent-hub'
export const inject = ['agentPresets', 'tools']
export const optional = ['webServer']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'agents')
const AGENTS_FILE = join(DIR, 'agents.json')
const UI_FILE = join(DIR, 'ui.json')
const SEED_FILE = join(import.meta.dirname, 'agents.default.json')

/** 输入栏选择器的默认开关 */
const UI_DEFAULT = { selectorVisible: true }

/* ── 文件读写 ──────────────────────────────────────────────────────────── */

function ensureFiles() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
  if (!existsSync(AGENTS_FILE) && existsSync(SEED_FILE)) {
    // 首次运行：用默认 agent 定义播种
    copyFileSync(SEED_FILE, AGENTS_FILE)
  }
  if (!existsSync(UI_FILE)) writeJson(UI_FILE, UI_DEFAULT)
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

function writeJson(path, obj) {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  renameSync(tmp, path)
}

function readAgents() {
  const cfg = readJson(AGENTS_FILE, { version: 1, agents: [] })
  return { version: cfg.version || 1, agents: Array.isArray(cfg.agents) ? cfg.agents : [] }
}

function readUi() {
  return { ...UI_DEFAULT, ...readJson(UI_FILE, {}) }
}

/* ── agent → preset ────────────────────────────────────────────────────── */

/**
 * standard 预设的 agent 级插件组合（照抄 DSH 的 standard.patch.yml）。
 * persona 按 agent 替换；disabledTools 里的行会被摘掉。
 * 保持这份列表和上游一致是「上游同步」那件事。
 */
function standardPlugins(persona) {
  const win = process.platform === 'win32'
  return [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: persona } },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: win },
    { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: !win },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: { applyPatch: false } },
    { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
    { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
    {
      id: 'planning',
      name: 'cordis:group',
      group: true,
      isolate: { planMode: true },
      config: [
        {
          id: 'plan-mode',
          name: '@deepseek-ai/dsh-plan-mode',
          // section 是必填的：漏了会让整行校验失败，preset 直接变成「不可用」
          config: {
            section: [
              'You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user\'s conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.',
              '',
              'Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.',
              '',
              'The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.',
              '',
              'Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.',
              '',
              'Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.',
              '',
              'When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.',
            ].join('\n'),
          },
        },
      ],
    },
    {
      id: 'compaction',
      name: 'cordis:group',
      group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
        { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
        {
          id: 'tool-result-pruner',
          name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
          config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
        },
      ],
    },
    {
      id: 'delegation',
      name: 'cordis:group',
      group: true,
      isolate: { workflowEngine: true },
      config: [
        { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
        {
          id: 'tool-subagent',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true },
        },
        {
          id: 'tool-subagent-fork',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'fork', toolName: 'subagent_fork' },
        },
        { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
        { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
      ],
    },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
    { id: 'tool-plugin-manager', name: '@deepseek-ai/dsh-plugin-manager/tools', disabled: true },
    { id: 'tool-plugin-market', name: '@deepseek-ai/dsh-plugin-market/tools', disabled: true },
  ]
}

/** 把 agent 定义翻成 PresetDefinition */
function toPreset(agent) {
  const persona = String(agent.persona || '').trim() ||
    `你是${agent.name || agent.id}。${agent.description || ''}`
  const drop = new Set(Array.isArray(agent.disabledTools) ? agent.disabledTools : [])
  const plugins = standardPlugins(persona).filter((row) => !drop.has(row.id))
  return {
    id: String(agent.id),
    name: String(agent.name || agent.id),
    description: String(agent.description || ''),
    order: Number.isFinite(agent.order) ? agent.order : 100,
    plugins,
  }
}

/* ── 插件本体 ──────────────────────────────────────────────────────────── */

export function apply(ctx) {
  const log = (m) => { try { ctx.logger?.info?.(`[agent-hub] ${m}`) } catch { /* 没 logger 算了 */ } }

  ensureFiles()

  // 注册所有启用的 agent。restart 时 effect 会先撤销旧的 registrations。
  ctx.effect(() => {
    const disposers = []
    let cancelled = false
    const load = async () => {
      const { agents } = readAgents()
      const errors = []
      for (const agent of agents) {
        if (agent.enabled === false) continue
        try {
          const off = await ctx.agentPresets.register(toPreset(agent))
          if (cancelled) { await off(); continue }
          disposers.push(off)
          log(`已注册 agent：${agent.id}`)
          // 注册完成不代表挂载成功：立刻回读诊断，把 broken 原因落盘，
          // 免得排查时只能靠重启 + 翻控制台。
          try {
            const rows = await ctx.agentPresets.list()
            const row = rows.find((r) => r.id === agent.id)
            if (row && row.broken) errors.push({ id: agent.id, broken: row.broken })
          } catch { /* 诊断失败不干扰注册 */ }
        } catch (e) {
          const msg = String(e?.message ?? e)
          errors.push({ id: agent.id, broken: msg })
          log(`注册 agent ${agent.id} 失败：${msg}`)
        }
      }
      try { writeJson(join(DIR, 'last-error.json'), { at: new Date().toISOString(), errors }) } catch { /* 落盘失败算了 */ }
    }
    load().catch((e) => log(`加载 agents 失败：${e?.message ?? e}`))
    return async () => {
      cancelled = true
      for (const off of disposers.splice(0)) {
        try { await off() } catch { /* 撤销失败不影响卸载 */ }
      }
    }
  }, 'agent-hub: presets')

  /* HTTP 接口（面板与工作台共用） */
  const json = (res, code, obj) => {
    try {
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(obj))
    } catch { /* 头可能已发 */ }
  }

  const readBody = (req) => new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })

  const isLoopback = (req) => {
    const addr = String(req.socket?.remoteAddress || '')
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  }

  ctx.inject(['webServer'], (webCtx) => {
    try {
      webCtx.effect(() => webCtx.get('webServer').register({
        kind: 'prefix',
        path: '/api/agent-hub',
        handler: async (req, res) => {
          if (!isLoopback(req) && process.env.DSH_AGENT_HUB_ALLOW_REMOTE !== '1') {
            return json(res, 403, { ok: false, error: '管理接口只允许本机访问' })
          }
          const url = new URL(req.url, 'http://127.0.0.1')
          const p = url.pathname.replace('/api/agent-hub', '') || '/'
          try {
            if (req.method === 'GET' && p === '/status') {
              return json(res, 200, { ok: true, ui: readUi(), agents: readAgents() })
            }
            if (req.method === 'GET' && p === '/ui') return json(res, 200, { ok: true, ...readUi() })
            if (req.method === 'POST' && p === '/ui') {
              const body = await readBody(req)
              const next = { ...readUi(), ...(typeof body.selectorVisible === 'boolean' ? { selectorVisible: body.selectorVisible } : {}) }
              writeJson(UI_FILE, next)
              return json(res, 200, { ok: true, ...next })
            }
            if (req.method === 'GET' && p === '/agents') {
              const { agents } = readAgents()
              return json(res, 200, {
                ok: true,
                agents: agents.map((a) => ({
                  id: a.id, name: a.name, icon: a.icon, order: a.order,
                  enabled: a.enabled !== false, description: a.description,
                  skills: a.skills || [], persona: a.persona || '',
                })),
              })
            }
            if (req.method === 'POST' && p === '/agents') {
              const body = await readBody(req)
              if (!Array.isArray(body.agents)) return json(res, 200, { ok: false, error: 'agents 必须是数组' })
              const seen = new Set()
              for (const a of body.agents) {
                if (!a || typeof a.id !== 'string' || !a.id.trim()) {
                  return json(res, 200, { ok: false, error: '每个 agent 都要有非空 id' })
                }
                if (seen.has(a.id)) return json(res, 200, { ok: false, error: `id 重复：${a.id}` })
                seen.add(a.id)
              }
              writeJson(AGENTS_FILE, { version: 1, agents: body.agents })
              return json(res, 200, { ok: true, note: '已保存；调用 /reload 让新定义生效（进行中的会话不受影响）' })
            }
            if (req.method === 'POST' && p === '/reload') {
              // restart 会重新跑 apply，preset 随之重建；进行中的会话保持原有组合。
              Promise.resolve().then(() => ctx.fiber.restart()).catch(() => {})
              return json(res, 200, { ok: true, note: '正在重载 agent-hub' })
            }
            /* 诊断：直接读 DSH 内部的 preset 列表，broken 字段就是挂载失败的原因 */
            if (req.method === 'GET' && p === '/diagnose') {
              try {
                const rows = await ctx.agentPresets.list()
                return json(res, 200, { ok: true, presets: rows })
              } catch (e) {
                return json(res, 500, { ok: false, error: String(e?.message ?? e) })
              }
            }
            return json(res, 404, { ok: false, error: '没有这个接口：' + p })
          } catch (e) {
            return json(res, 500, { ok: false, error: String(e?.message ?? e) })
          }
        },
      }), 'agent-hub: 管理接口')
    } catch { /* 没有 webServer 就没有面板，插件其余部分照常 */ }
  })

  /* 工具：让模型也能查和管理 agent */
  const defineTool = (options) => options
  const textOutput = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_args, value) => [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  }
  const safe = (v) => {
    if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
  }
  const tool = (spec) => ctx.tools.register(defineTool({
    ...spec,
    output: textOutput,
    async execute(args) { return safe(await spec.execute(args || {})) },
  }))

  try {
    tool({
      name: 'agent_hub_list',
      description: '列出所有预置 Agent：id、名称、启用状态、绑定的技能。用来知道当前有哪些 agent 可切。',
      parameters: {},
      async execute() {
        const { agents } = readAgents()
        return {
          ok: true,
          ui: readUi(),
          agents: agents.map((a) => ({
            id: a.id, name: a.name, icon: a.icon, enabled: a.enabled !== false,
            description: a.description, skills: a.skills || [],
          })),
        }
      },
    })

    tool({
      name: 'agent_hub_toggle',
      description: '启用或禁用一个 Agent。改完需要重载（调用 agent_hub_reload 或重启 DSH）才生效。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'agent 的 id' },
          enabled: { type: 'boolean', description: 'true 启用 / false 禁用' },
        },
        required: ['id', 'enabled'],
      },
      async execute(args) {
        const { agents } = readAgents()
        const target = agents.find((a) => a.id === args.id)
        if (!target) return { ok: false, error: `没有这个 agent：${args.id}` }
        target.enabled = args.enabled === true
        writeJson(AGENTS_FILE, { version: 1, agents })
        return { ok: true, id: args.id, enabled: target.enabled, note: '需要 agent_hub_reload 或重启 DSH 生效' }
      },
    })

    tool({
      name: 'agent_hub_reload',
      description: '重新加载 agent 定义（重启 agent-hub 插件）。进行中的会话保持原有组合，新会话用新定义。',
      parameters: {},
      async execute() {
        Promise.resolve().then(() => ctx.fiber.restart()).catch(() => {})
        return { ok: true, note: '正在重载' }
      },
    })

    tool({
      name: 'agent_hub_diagnose',
      description: '诊断：列出 DSH 里的 agent preset 及其加载状态。broken 字段非空就是挂载失败的原因。',
      parameters: {},
      async execute() {
        try {
          return { ok: true, presets: await ctx.agentPresets.list() }
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) }
        }
      },
    })
  } catch (e) {
    log(`工具没注册上：${e?.message ?? e}`)
  }
}