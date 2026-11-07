/**
 * dsh-agent-hub —— 浏览器半端
 * ============================================================================
 * 在输入栏右侧（模型选择器旁边）挂一个 agent 选择器：
 *   · 显示当前会话实际用的 agent
 *   · 点开列出所有 preset，点一下切
 *   · 切换走 DSH 原生 agentPresets.select —— 只在「会话还没开始第一轮」时有效
 *   · 会话已开始：按钮置灰并说明原因，不再弹那个关不掉的报错
 *   · 开关由工作台控制（/api/agent-hub/ui），关掉后整个不渲染
 *
 * 位置：conversation.input.right（输入栏右侧插槽，session scope）。
 * 宿主没有这个插槽时注册会一直等待，不影响别的功能。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-hub',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/api/agent-hub'

    async function readVisible() {
      try {
        const r = await fetch(API + '/ui', { credentials: 'same-origin' })
        if (!r.ok) return true
        const d = await r.json()
        return d.selectorVisible !== false
      } catch { return true }
    }

    /** 外壳：安全地用 useSession（宿主没给这个 hook 就退化为 undefined） */
    function PickerShell(props) {
      // useSession 的存在性在整个组件生命周期内不变，所以这里的条件调用
      // 不会引发「hook 数量变化」。不要把它包进 try —— 异常路径会让 hook
      // 计数错乱，React 直接报 Rendered more hooks than during the previous render。
      const useSession = typeof props.useSession === 'function' ? props.useSession : null
      const blank = useSession ? useSession((s) => (s ? s.blank === true : undefined)) : undefined
      const recorded = useSession
        ? useSession((s) => (s && s.projectionValues ? s.projectionValues.agentPreset : undefined))
        : undefined
      return h(Picker, { ...props, blank, recorded })
    }

    function Picker({ remote, sessionId, blank, recorded }) {
      const [visible, setVisible] = useState(true)
      const [presets, setPresets] = useState([])
      const [current, setCurrent] = useState('')
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const [locked, setLocked] = useState(false)
      const boxRef = useRef(null)

      // 开关：每 5 秒对一次（本地请求，不消耗 token）
      useEffect(() => {
        let alive = true
        const tick = async () => {
          const v = await readVisible()
          if (alive) setVisible(v)
        }
        tick()
        const id = setInterval(tick, 5000)
        return () => { alive = false; clearInterval(id) }
      }, [])

      const load = useCallback(async () => {
        if (!remote) return
        try {
          const r = await remote.list()
          if (r && r.ok) {
            const list = (r.value && r.value.presets) || []
            setPresets(list)
          } else if (r && r.error) {
            setErr(r.error.message || '读不到预设列表')
          }
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [remote])

      useEffect(() => { load() }, [load])

      // 记录当前会话实际使用的 preset
      useEffect(() => {
        if (typeof recorded === 'string' && recorded) setCurrent(recorded)
      }, [recorded])

      // 会话已开始：blank === false 直接锁定，避免点了才报错
      useEffect(() => {
        if (blank === false) setLocked(true)
        else if (blank === true) setLocked(false)
      }, [blank])

      // 错误提示 8 秒自动消失，也可点掉
      useEffect(() => {
        if (!err) return
        const t = setTimeout(() => setErr(''), 8000)
        return () => clearTimeout(t)
      }, [err])

      useEffect(() => {
        if (!open) return
        const onDown = (e) => {
          if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [open])

      const pick = async (id) => {
        if (!id || !sessionId || !remote) return
        if (locked) { setErr('这个会话已经开始，换 agent 要新开一个会话'); setOpen(false); return }
        setBusy(true)
        setErr('')
        try {
          const r = await remote.select(sessionId, id)
          if (r && r.ok) { setCurrent(id); setOpen(false) }
          else {
            const msg = (r && r.error && (r.error.message || (r.error.details && r.error.details.reason))) || '切换失败'
            setErr(String(msg))
            if (/already started|locked/i.test(String(msg))) setLocked(true)
            setOpen(false)
          }
        } catch (e) {
          setErr(String((e && e.message) || e))
          setOpen(false)
        } finally {
          setBusy(false)
        }
      }

      if (!visible) return null

      const shown = presets.find((p) => p.id === current)
      const label = shown ? (shown.name || shown.id) : (current || '默认')
      const disabled = busy || locked

      const base = {
        height: '26px', padding: '0 8px', borderRadius: '6px', fontSize: '12px',
        border: '1px solid rgba(127,127,127,0.28)', background: 'rgba(127,127,127,0.10)',
        color: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex',
        alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', userSelect: 'none',
        opacity: disabled ? 0.55 : 1,
      }

      return h('div', { ref: boxRef, style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button',
          title: locked
            ? '这个会话已经开始，换 agent 要新开一个会话'
            : '切换这个对话使用的 Agent（只在会话开始前有效）',
          style: base,
          onClick: () => {
            if (locked) { setErr('这个会话已经开始，换 agent 要新开一个会话'); return }
            setOpen((v) => !v)
          },
        },
          h('span', { style: { opacity: 0.65 } }, '◈'),
          h('span', null, busy ? '切换中…' : label),
          h('span', { style: { opacity: 0.55, fontSize: '10px' } }, locked ? '🔒' : '▾'),
        ),
        open ? h('div', {
          style: {
            position: 'absolute', bottom: '32px', right: 0, minWidth: '220px',
            maxHeight: '320px', overflowY: 'auto', borderRadius: '8px',
            border: '1px solid rgba(127,127,127,0.28)',
            background: 'var(--dsh-surface, #1b1d21)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            padding: '4px', zIndex: 60,
          },
        },
          presets.length === 0
            ? h('div', { style: { padding: '8px 10px', fontSize: '12px', opacity: 0.6 } }, '没有可选的 Agent')
            : presets.map((p) => h('button', {
              key: p.id,
              type: 'button',
              disabled: busy,
              onClick: () => pick(p.id),
              style: {
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                borderRadius: '6px', fontSize: '12px', border: 'none', cursor: busy ? 'wait' : 'pointer',
                background: p.id === current ? 'rgba(127,127,127,0.18)' : 'transparent',
                color: 'inherit',
              },
            },
              h('div', { style: { fontWeight: 600 } },
                (p.name || p.id),
                p.isDefault ? h('span', { style: { marginLeft: '6px', fontSize: '10px', opacity: 0.6 } }, '默认') : null,
                p.broken ? h('span', { style: { marginLeft: '6px', fontSize: '10px', color: '#ff7b72' } }, '不可用') : null,
              ),
              p.description ? h('div', { style: { fontSize: '11px', opacity: 0.6, marginTop: '2px' } }, p.description) : null,
            )),
        ) : null,
        err ? h('div', {
          onClick: () => setErr(''),
          title: '点击关闭',
          style: {
            position: 'absolute', bottom: '34px', right: 0, maxWidth: '260px',
            padding: '6px 10px', borderRadius: '6px', fontSize: '11px', lineHeight: 1.5,
            background: 'rgba(255,80,80,0.16)', border: '1px solid rgba(255,80,80,0.45)',
            color: '#ff9b94', zIndex: 61, cursor: 'pointer',
          },
        }, err) : null,
      )
    }

    return {
      inject: ['slots', 'sessions', 'remote.agentPresets'],
      apply(ctx) {
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        const remote = (typeof ctx.get === 'function' ? ctx.get('remote.agentPresets') : undefined)
          || (ctx.remote && ctx.remote.agentPresets)
        if (!slots) return
        try {
          slots.inject('conversation.input.right', () => slots.register(
            { name: 'conversation.input.right', id: 'agent-hub-picker', order: 10 },
            (props) => h(PickerShell, { ...props, remote }),
          ))
        } catch (_e) { /* 宿主没有这个插槽就不挂 */ }
      },
    }
  },
})