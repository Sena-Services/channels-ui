<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'

// ── Agent from URL param ──
// Pass ?agent=Sales+Agent+External when embedding the iframe.
// Falls back to showing all std:wa:* instances when no agent is specified.
const agentName = new URLSearchParams(window.location.search).get('agent') || null

// ── Mobile detection ──
const isMobile = ref(window.innerWidth <= 768)
const mobileShowChat = ref(false)

function onResize() {
  isMobile.value = window.innerWidth <= 768
}

// ── State ──
const activePlatforms = ref(new Set(['whatsapp']))
const selectedContactId = ref(null)
const messageInput = ref('')
const messageListRef = ref(null)
const showTyping = ref(false)
const loading = ref(true)
const loadingMessages = ref(false)
const error = ref(null)
const sending = ref(false)
const fileInputRef = ref(null)
const isRecording = ref(false)
const recordingDuration = ref(0)
const showNewChatModal = ref(false)
const newChatPhone = ref('')
const newChatLoading = ref(false)
const newChatError = ref('')
const newChatAgents = ref([])       // list of {name, default, phones}
const newChatSelectedAgent = ref('') // selected agent name
const searchQuery = ref('')
const sendMode = ref('customer') // 'customer' | 'agent'
const messageFilter = ref('all') // 'all' | 'customer' | 'internal'
let _mediaRecorder = null
let _audioChunks = []
let _recordingTimer = null
let _uiAgents = null // cached list of agent names sharing this UI

// ── Data ──
const contacts = ref([])
const messagesCache = ref({}) // instanceName → array of UI message objects
const agentThinking = ref(false) // true when agent is actively processing
let _thinkingTimeout = null

const avatarColors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#EF4444', '#6366F1']

const channels = [
  { id: 'whatsapp', label: 'WhatsApp', color: '#25D366', icon: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z' },
  { id: 'instagram', label: 'Instagram', color: '#E4405F', icon: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z' },
  { id: 'telegram', label: 'Telegram', color: '#26A5E4', icon: 'M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z' },
  { id: 'slack', label: 'Slack', color: '#4A154B', icon: 'M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.163 0a2.528 2.528 0 012.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.163 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 01-2.52-2.523 2.527 2.527 0 012.52-2.52h6.315A2.528 2.528 0 0124 15.163a2.528 2.528 0 01-2.522 2.523h-6.315z' },
  { id: 'twitter', label: 'X / Twitter', color: '#000000', icon: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  { id: 'email', label: 'Email', color: '#EA4335', icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z' },
  { id: 'teams', label: 'Teams', color: '#6264A7', icon: 'M19.098 7.753h-3.82v9.537c0 2.379-1.932 4.31-4.312 4.31a4.278 4.278 0 01-2.26-.641A6.46 6.46 0 0014.363 24c3.569 0 6.46-2.892 6.46-6.46V9.478a1.725 1.725 0 00-1.725-1.725zM16.5 6a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm-5.5.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm4.076 2.253H5.424A1.424 1.424 0 004 10.177v6.345a5 5 0 0010 0v-6.345a1.424 1.424 0 00-1.424-1.424z' },
]

function togglePlatform(id) {
  const s = new Set(activePlatforms.value)
  if (s.has(id)) {
    s.delete(id)
  } else {
    s.add(id)
  }
  activePlatforms.value = s
}

function toggleAllPlatforms() {
  if (activePlatforms.value.size === channels.length) {
    activePlatforms.value = new Set()
  } else {
    activePlatforms.value = new Set(channels.map(c => c.id))
  }
}

const allSelected = computed(() => activePlatforms.value.size === channels.length)

const statusConfig = {
  default: { color: '#64748B', bg: 'rgba(100,116,139,0.08)' },
}

// ── API helpers ──
// In iframe contexts browsers block third-party cookies (SameSite=Lax + cross-origin).
// Strategy: extract sid from the login response's x-frappe-sid header (exposed by vite
// proxy), store it in a JS variable, and pass it as `sid` in every POST body.
// Frappe reads `sid` from form_dict before falling back to cookies (sessions.py:220).
let _sid = null
let _csrfToken = null

async function frappeCall(method, params = {}) {
  // Inject sid + csrf into every request body so we don't rely on browser cookies
  const body = { ...params }
  if (_sid) body.sid = _sid
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (_csrfToken) headers['X-Frappe-CSRF-Token'] = _csrfToken

  const resp = await fetch(`/api/method/${method}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  if (data.session_expired || (data.exc_type === 'PermissionError' && data.exception?.includes('Login to access'))) {
    throw Object.assign(new Error('session_expired'), { sessionExpired: true })
  }
  if (data.exc) throw new Error(Array.isArray(data.exc) ? data.exc[0] : data.exc)
  return data.message
}

async function frappe(method, params = {}) {
  try {
    return await frappeCall(method, params)
  } catch (e) {
    if (e.sessionExpired) {
      await ensureAuth()
      return await frappeCall(method, params)
    }
    throw e
  }
}

async function ensureAuth() {
  console.log('[channels-ui] ensureAuth: start, _sid =', _sid ? _sid.slice(0, 12) + '...' : null)

  // Same-origin iframe shares cookies with the parent app.
  // Use GET to avoid CSRF chicken-and-egg — browser sends the session cookie automatically.
  try {
    const url = '/api/method/sena_agents_backend.sena_agents_backend.api.auth.get_csrf_token'
      + (_sid ? `?sid=${encodeURIComponent(_sid)}` : '')
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    })
    if (resp.ok) {
      const data = await resp.json()
      if (data.message?.user && data.message.user !== 'Guest') {
        if (data.message?.csrf_token) _csrfToken = data.message.csrf_token
        console.log('[channels-ui] ensureAuth: authed via cookie, user =', data.message.user)
        return
      }
    }
  } catch (e) {
    console.warn('[channels-ui] ensureAuth: csrf fetch failed', e)
  }

  // Dev mode fallback: auto-login with dev credentials when running standalone
  if (window.location.port === '5174') {
    console.log('[channels-ui] ensureAuth: dev mode — attempting auto-login')
    try {
      // Use form-encoded POST to avoid CSRF requirement
      const loginResp = await fetch('/api/method/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        credentials: 'include',
        body: 'usr=Administrator&pwd=Admin123',
      })
      if (loginResp.ok) {
        // Extract sid from x-frappe-sid header (exposed by vite proxy)
        const sid = loginResp.headers.get('x-frappe-sid')
        if (sid) _sid = sid
        // Get CSRF from the HTML page (Frappe embeds it as frappe.csrf_token)
        const pageResp = await fetch('/', { credentials: 'include' })
        if (pageResp.ok) {
          const html = await pageResp.text()
          const csrfMatch = html.match(/frappe\.csrf_token\s*=\s*"([^"]+)"/)
          if (csrfMatch && csrfMatch[1] !== 'None') _csrfToken = csrfMatch[1]
        }
        console.log('[channels-ui] ensureAuth: dev auto-login success, sid =', _sid ? _sid.slice(0, 12) + '...' : null)
        return
      } else {
        console.warn('[channels-ui] ensureAuth: dev login failed with status', loginResp.status)
      }
    } catch (e) {
      console.warn('[channels-ui] ensureAuth: dev auto-login failed', e)
    }
  }

  console.warn('[channels-ui] ensureAuth: no valid session — user must log in via the main app')
}

// ── Format helpers ──
function formatPhone(instanceId) {
  // std:wa:+919841055201 → +91 98410 55201 (best-effort)
  const raw = instanceId.replace(/^std:wa:/, '')
  if (raw.startsWith('+91') && raw.length >= 13) {
    return `+91 ${raw.slice(3, 8)} ${raw.slice(8)}`
  }
  return raw
}

function formatTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(isoStr) {
  if (!isoStr) return 'Today'
  const d = new Date(isoStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function avatarColor(str, idx) {
  // Use index-based color for consistency
  return avatarColors[idx % avatarColors.length]
}

// ── Load instances (sidebar contacts) ──
async function loadInstances(silent = false) {
  if (!silent) loading.value = true
  if (!silent) error.value = null
  console.log('[channels-ui] loadInstances: start, agentName =', agentName, 'silent =', silent)
  try {
    // Find all agents sharing this UI, then show all their WhatsApp instances
    if (!_uiAgents) {
      try {
        // First get the current agent's UI name, then find all agents sharing it
        let uiName = null
        if (agentName) {
          const cur = await frappe('frappe.client.get_value', {
            doctype: 'Runtime Agent', filters: { agent_name: agentName }, fieldname: 'ui',
          })
          uiName = cur?.ui
        }
        if (uiName) {
          const agents = await frappe('frappe.client.get_list', {
            doctype: 'Runtime Agent',
            filters: [['ui', '=', uiName], ['enabled', '=', 1]],
            fields: ['agent_name'],
            limit_page_length: 100,
          })
          _uiAgents = (agents || []).map(a => a.agent_name)
        } else {
          _uiAgents = agentName ? [agentName] : []
        }
      } catch (e) {
        _uiAgents = agentName ? [agentName] : []
      }
    }
    const filters = [['instance_id', 'like', 'std:wa:%']]
    if (_uiAgents.length > 0) filters.push(['agent_name', 'in', _uiAgents])

    const rows = await frappe('frappe.client.get_list', {
      doctype: 'Runtime Instance',
      filters,
      fields: ['name', 'instance_id', 'agent_name', 'last_activity', 'message_count', 'title', 'status'],
      order_by: 'last_activity desc',
      limit_page_length: 50,
    })

    // Fetch the latest sender_name for each instance (skip during silent poll — too expensive)
    const senderNames = {}
    if (!silent) {
      for (const row of (rows || [])) {
        try {
          const userMsgs = await frappe('frappe.client.get_list', {
            doctype: 'Runtime Message',
            filters: [['instance', '=', row.name], ['role', '=', 'user'], ['sender_name', 'is', 'set'], ['sender_name', '!=', 'Operator']],
            fields: ['sender_name'],
            order_by: 'creation desc',
            limit_page_length: 1,
          })
          if (userMsgs && userMsgs.length > 0 && userMsgs[0].sender_name) {
            senderNames[row.name] = userMsgs[0].sender_name
          }
        } catch (e) {
          console.warn('[channels-ui] Failed to fetch sender_name for', row.name, e)
        }
      }
    }
    if (!silent) console.log('[channels-ui] senderNames:', senderNames)

    // During silent poll, preserve existing contact names
    const existingNames = {}
    if (silent) {
      for (const c of contacts.value) existingNames[c.id] = c.name
    }

    contacts.value = (rows || []).map((row, idx) => {
      const phone = formatPhone(row.instance_id)
      // Prefer sender_name from messages, then instance title (updated by webhook), then phone
      const titleName = (row.title && !row.title.startsWith('WhatsApp: +') && row.title !== phone) ? row.title : ''
      const displayName = senderNames[row.name] || existingNames[row.name] || titleName || phone
      return {
        id: row.name,           // instance name (doc id)
        instanceId: row.instance_id,
        name: displayName,
        phone,
        lastMsg: `${row.message_count || 0} messages`,
        time: formatTime(row.last_activity),
        unread: 0,
        company: row.agent_name || '',
        status: row.status || 'Active',
        online: false,
        color: avatarColor(row.name, idx),
        agentName: row.agent_name || '',
        lastActivity: row.last_activity,
        messageCount: row.message_count || 0,
      }
    })

    console.log('[channels-ui] loadInstances: loaded', contacts.value.length, 'contacts')
    if (contacts.value.length > 0 && !selectedContactId.value && !isMobile.value) {
      selectedContactId.value = contacts.value[0].id
    }
  } catch (e) {
    if (!silent) console.error('[channels-ui] loadInstances FAILED:', e?.message || e)
    if (!silent) error.value = 'Could not load conversations. Make sure you are logged into Sena.'
  } finally {
    if (!silent) loading.value = false
  }
}

// ── Load messages for selected instance ──
async function loadMessages(instanceName, silent = false) {
  if (!silent && messagesCache.value[instanceName]) {
    // Already have data — still refresh in background but don't show spinner
  }
  if (!silent) loadingMessages.value = true
  try {
    const contact = contacts.value.find(c => c.id === instanceName)
    // Use the memory API which decrypts encrypted content server-side
    const result = await frappe('sena_agents_backend.sena_agents_backend.api.memory.get_messages', {
      agent_name: contact?.agentName || agentName || '',
      instance_id: contact?.instanceId || instanceName,
      limit: 200,
    })
    const rows = (result?.messages || []).map(m => ({
      ...m,
      creation: m.timestamp,
      tool_calls: m.tool_calls ? JSON.stringify(m.tool_calls) : null,
      attachments: m.attachments ? JSON.stringify(m.attachments) : null,
    }))
    const displayAgentName = contact?.agentName || 'Agent'

    // Build map of tool_call_id → approval info from tool-result messages
    const approvalMap = {} // tool_call_id → { approvalId, tool }
    for (const row of rows) {
      if (row.role !== 'tool') continue
      try {
        const parsed = JSON.parse(row.content || '{}')
        if (parsed.status === 'awaiting_approval' && parsed.approval_id) {
          approvalMap[row.tool_call_id] = {
            approvalId: parsed.approval_id,
            tool: parsed.tool || null,
          }
        }
      } catch {}
    }

    // Also fetch pending approvals for this instance to get tool + args details
    let pendingApprovals = {} // approval_id → { tool, tool_args, creation }
    try {
      const agentNames = _uiAgents || [contact?.agentName || agentName]
      for (const an of agentNames) {
        const pending = await frappe('sena_agents_backend.sena_agents_backend.api.approvals.list_pending', { agent_name: an })
        for (const a of (pending || [])) {
          pendingApprovals[a.name] = a
        }
      }
    } catch {}

    const uiMsgs = []
    let lastDateLabel = null

    for (const row of (rows || [])) {
      // Skip tool-result rows (role=tool) — they're internal
      if (row.role === 'tool' || row.role === 'system') continue

      const dateLabel = formatDateLabel(row.creation)
      if (dateLabel !== lastDateLabel) {
        uiMsgs.push({ id: `date-${row.name}`, type: 'date', label: dateLabel })
        lastDateLabel = dateLabel
      }

      const timeStr = formatTime(row.creation)

      if (row.role === 'user') {
        // Strip WhatsApp system instructions appended by the agent layer:
        // "actual message\n---\n[WhatsApp from name] IMPORTANT: ..."
        const rawText = row.content || ''
        const cleanText = rawText.split('\n---\n')[0].replace(/\s*\[WhatsApp from[^\]]*\].*$/s, '').trim()
        const isOperatorInstruction = row.sender_name === 'Operator' || (!rawText.includes('[WhatsApp from'))
        uiMsgs.push({
          id: row.name,
          type: 'text',
          text: cleanText,
          sender: 'user',
          time: timeStr,
          read: true,
          senderName: row.sender_name || '',
          msgType: isOperatorInstruction ? 'operator_instruction' : 'customer_in',
        })
      } else if (row.role === 'assistant') {
        let toolLabel = null
        let sentText = null
        let sentVoice = null

        try {
          const tc = row.tool_calls ? JSON.parse(row.tool_calls) : null
          if (tc && tc.length > 0) {
            toolLabel = tc.map(t => t.function?.name || t.name || '').filter(Boolean).join(', ')
            for (const t of tc) {
              const name = t.function?.name || t.name || ''
              const args = typeof t.function?.arguments === 'string'
                ? JSON.parse(t.function.arguments)
                : (t.function?.arguments || t.arguments || {})
              if (name === 'whatsapp_send') {
                sentText = args.message || args.text || null
              } else if (name === 'whatsapp_send_voice_note') {
                sentVoice = args.text || args.message || null
              }
            }
          }
        } catch {}

        // Parse attachments if present
        let attachments = null
        try {
          if (row.attachments) attachments = JSON.parse(row.attachments)
        } catch {}

        // Show the actual message sent to the user (from tool call args)
        // null = pre-tracking message (assume delivered), otherwise use DB value
        const deliveryStatus = row.message_status || 'delivered'

        // Determine operator vs agent sender
        const isOperatorSender = row.sender_name === 'Operator'

        // If message has attachments, render as media
        if (attachments && attachments.length > 0) {
          const att = attachments[0]
          const mime = att.file_type || ''
          const caption = (row.content || '').replace(/^\[.*?\]\s*/, '').trim()
          if (mime.startsWith('image/')) {
            uiMsgs.push({
              id: row.name,
              type: 'image',
              imageUrl: att.file_url,
              caption: caption || null,
              sender: 'agent',
              time: timeStr,
              senderName: row.sender_name || displayAgentName,
              delivered: deliveryStatus,
              msgType: isOperatorSender ? 'operator_to_customer' : 'agent_to_customer',
            })
          } else if (mime.startsWith('audio/')) {
            uiMsgs.push({
              id: row.name,
              type: 'voice',
              audioUrl: att.file_url,
              text: caption || null,
              sender: 'agent',
              time: timeStr,
              senderName: row.sender_name || displayAgentName,
              delivered: deliveryStatus,
              msgType: isOperatorSender ? 'operator_to_customer' : 'agent_to_customer',
            })
          } else {
            uiMsgs.push({
              id: row.name,
              type: 'document',
              filename: att.file_name || 'file',
              fileUrl: att.file_url,
              sender: 'agent',
              time: timeStr,
              senderName: row.sender_name || displayAgentName,
              delivered: deliveryStatus,
              msgType: isOperatorSender ? 'operator_to_customer' : 'agent_to_customer',
            })
          }
          continue
        }

        if (sentText) {
          // Check if this whatsapp_send is pending approval
          let sentApprovalId = null
          let sentApprovalDetail = null
          try {
            const tc = row.tool_calls ? JSON.parse(row.tool_calls) : null
            if (tc) {
              for (const t of tc) {
                const callId = t.id || ''
                if (approvalMap[callId]) {
                  sentApprovalId = approvalMap[callId].approvalId
                  sentApprovalDetail = pendingApprovals[sentApprovalId] || null
                  break
                }
              }
            }
          } catch {}

          uiMsgs.push({
            id: row.name,
            type: 'agent',
            text: sentText,
            sender: 'agent',
            time: timeStr,
            isAI: true,
            agentName: displayAgentName,
            agentTool: toolLabel || null,
            senderName: row.sender_name || displayAgentName,
            delivered: sentApprovalId ? 'pending_approval' : deliveryStatus,
            msgType: isOperatorSender ? 'operator_to_customer' : 'agent_to_customer',
            approvalId: sentApprovalId || null,
            approvalStatus: sentApprovalId ? (pendingApprovals[sentApprovalId] ? 'pending' : 'resolved') : null,
            approvalDetail: sentApprovalDetail || null,
            approvalNote: '',
            _expanded: !!sentApprovalId,
          })
        } else if (sentVoice) {
          // Check if this whatsapp_send_voice_note is pending approval
          let voiceApprovalId = null
          let voiceApprovalDetail = null
          try {
            const tc = row.tool_calls ? JSON.parse(row.tool_calls) : null
            if (tc) {
              for (const t of tc) {
                const callId = t.id || ''
                if (approvalMap[callId]) {
                  voiceApprovalId = approvalMap[callId].approvalId
                  voiceApprovalDetail = pendingApprovals[voiceApprovalId] || null
                  break
                }
              }
            }
          } catch {}

          uiMsgs.push({
            id: row.name,
            type: 'voice',
            text: sentVoice,
            sender: 'agent',
            time: timeStr,
            isAI: true,
            agentName: displayAgentName,
            senderName: row.sender_name || displayAgentName,
            delivered: voiceApprovalId ? 'pending_approval' : deliveryStatus,
            msgType: isOperatorSender ? 'operator_to_customer' : 'agent_to_customer',
            approvalId: voiceApprovalId || null,
            approvalStatus: voiceApprovalId ? (pendingApprovals[voiceApprovalId] ? 'pending' : 'resolved') : null,
            approvalDetail: voiceApprovalDetail || null,
            approvalNote: '',
            _expanded: !!voiceApprovalId,
          })
        } else if (row.content) {
          // Fallback: show agent content if no WA send tool was called — this is an agent note
          // Check for pending approval via tool_call_id map (robust) or regex fallback
          let approvalId = null
          let approvalDetail = null
          try {
            const tc = row.tool_calls ? JSON.parse(row.tool_calls) : null
            if (tc) {
              for (const t of tc) {
                const callId = t.id || ''
                if (approvalMap[callId]) {
                  approvalId = approvalMap[callId].approvalId
                  approvalDetail = pendingApprovals[approvalId] || null
                  break
                }
              }
            }
          } catch {}
          // Regex fallback if tool_call_id didn't match
          if (!approvalId) {
            const approvalMatch = row.content.match(/(?:awaiting\s+(?:human\s+)?approval|approval\s+(?:id|ID))[^a-z0-9]*\(?(?:ID:\s*)?([a-z0-9]+)\)?/i)
            if (approvalMatch) {
              approvalId = approvalMatch[1]
              approvalDetail = pendingApprovals[approvalId] || null
            }
          }
          const isPending = approvalId && (pendingApprovals[approvalId] || !approvalDetail)
          uiMsgs.push({
            id: row.name,
            type: 'agent',
            text: row.content,
            sender: 'agent',
            time: timeStr,
            isAI: true,
            agentName: displayAgentName,
            agentTool: toolLabel || null,
            senderName: row.sender_name || displayAgentName,
            delivered: deliveryStatus,
            msgType: isOperatorSender ? 'operator_to_customer' : 'agent_note',
            approvalId: approvalId || null,
            approvalStatus: approvalId ? (pendingApprovals[approvalId] ? 'pending' : 'resolved') : null,
            approvalDetail: approvalDetail || null,
            approvalNote: '',
            _expanded: !!approvalId,
          })
        }
      }
    }

    // ── Group consecutive internal messages into single dashed boxes ──
    // Internal = agent_note OR system/approval messages (operator_instruction with [System]/[Approval prefix)
    const isInternal = (m) => {
      if (m.type === 'date') return false
      if (m.msgType === 'agent_note') return true
      if (m.msgType === 'operator_instruction' && /^\[System\]|\[Approval/.test(m.text)) return true
      return false
    }
    const grouped = []
    for (let i = 0; i < uiMsgs.length; i++) {
      const msg = uiMsgs[i]
      if (!isInternal(msg)) { grouped.push(msg); continue }
      // Start a group — collect consecutive internal messages
      const parts = [msg]
      while (i + 1 < uiMsgs.length && isInternal(uiMsgs[i + 1])) {
        i++
        parts.push(uiMsgs[i])
      }
      if (parts.length === 1) { grouped.push(msg); continue }
      // Merge into one message: store parts array for stepped rendering
      const approvalPart = parts.find(p => p.approvalId)
      const agentPart = parts.find(p => p.msgType === 'agent_note')
      grouped.push({
        ...parts[0],
        text: parts[0].text, // fallback for renderText
        _parts: parts.map(p => p.text), // individual step texts
        time: parts[parts.length - 1].time,
        approvalId: approvalPart?.approvalId || null,
        approvalStatus: approvalPart?.approvalStatus || null,
        approvalDetail: approvalPart?.approvalDetail || null,
        approvalNote: approvalPart?.approvalNote || '',
        agentName: agentPart?.agentName || parts[0].agentName,
        msgType: 'agent_note', // grouped internals render as agent note (left dashed)
      })
    }

    // Update contact's lastMsg with last meaningful message (skip [System] noise)
    const reversed = [...(rows || [])].reverse()
    const lastMeaningful = reversed.find(r => {
      const txt = (r.content || '').trim()
      if (!txt) return false
      if (txt.startsWith('[System]')) return false
      if (txt.startsWith('[Approval')) return false
      return true
    })
    if (lastMeaningful && contact) {
      const preview = (lastMeaningful.content || '').slice(0, 60)
      const prefix = ''
      contact.lastMsg = prefix + preview
    }
    // Update contact display name from sender_name if available (skip Operator — that's internal)
    const lastUserMsg = reversed.find(r => r.role === 'user' && r.sender_name && r.sender_name !== 'Operator')
    if (lastUserMsg?.sender_name && contact) {
      contact.name = lastUserMsg.sender_name
    }

    const prevCount = messagesCache.value[instanceName]?.length || 0
    messagesCache.value[instanceName] = grouped
    // Auto-scroll if new messages arrived
    if (grouped.length > prevCount && instanceName === selectedContactId.value) {
      scrollToBottom()
    }
  } catch (e) {
    if (!silent) console.error('Failed to load messages:', e)
  } finally {
    if (!silent) loadingMessages.value = false
  }
}

// ── Computed ──
const selectedContact = computed(() => contacts.value.find(c => c.id === selectedContactId.value))
const allSelectedMessages = computed(() => messagesCache.value[selectedContactId.value] || [])
const selectedMessages = computed(() => {
  const msgs = allSelectedMessages.value
  if (messageFilter.value === 'all') return msgs
  if (messageFilter.value === 'customer') {
    // Show customer inbound + agent-to-customer + operator-to-customer + date separators
    const customerTypes = new Set(['customer_in', 'agent_to_customer', 'operator_to_customer'])
    return msgs.filter(m => m.type === 'date' || customerTypes.has(m.msgType))
  }
  if (messageFilter.value === 'internal') {
    // Show operator instructions + agent notes + date separators
    const internalTypes = new Set(['operator_instruction', 'agent_note'])
    return msgs.filter(m => m.type === 'date' || internalTypes.has(m.msgType))
  }
  return msgs
})
const badgeConfig = computed(() => statusConfig.default)
const filteredContacts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return contacts.value
  return contacts.value.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.phone.toLowerCase().includes(q) ||
    c.instanceId.toLowerCase().includes(q)
  )
})

// ── Message type label helper (removed — layout makes types obvious) ──

// ── Render helpers ──
const renderText = (text) => {
  if (!text) return ''
  return text
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
}

const scrollToBottom = () => {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight
    }
  })
}

// ── Actions ──
const selectContact = async (id) => {
  selectedContactId.value = id
  showTyping.value = false
  if (isMobile.value) mobileShowChat.value = true
  await loadMessages(id)
  scrollToBottom()
}

const mobileBack = () => {
  mobileShowChat.value = false
}

const openNewChat = async () => {
  newChatPhone.value = ''
  newChatError.value = ''
  newChatSelectedAgent.value = ''
  showNewChatModal.value = true
  // Fetch agents with WhatsApp routing
  try {
    const res = await frappe('sena_agents_backend.sena_agents_backend.services.hook_evaluation_service.resolve_channel_routing_agents')
    const waAgents = res?.whatsapp || res?.message?.whatsapp || {}
    newChatAgents.value = Object.entries(waAgents).map(([name, info]) => ({
      name,
      default: info.default,
      phones: info.phones || [],
    }))
    // Auto-select default agent if there is one
    const defaultAgent = newChatAgents.value.find(a => a.default)
    if (defaultAgent) newChatSelectedAgent.value = defaultAgent.name
  } catch (e) {
    console.error('Failed to load WhatsApp agents:', e)
    newChatAgents.value = []
  }
}

const startNewChat = async () => {
  const agent = newChatSelectedAgent.value
  if (!agent) {
    newChatError.value = 'Please select an agent'
    return
  }
  const raw = newChatPhone.value.trim().replace(/[+\s\-()]/g, '')
  if (!raw || !/^\d{7,15}$/.test(raw)) {
    newChatError.value = 'Enter a valid phone number with country code (e.g. 919876543210)'
    return
  }
  newChatLoading.value = true
  newChatError.value = ''
  try {
    const res = await frappe('sena_whatsapp.api.whatsapp.find_or_create_chat', { phone: raw, agent_name: agent })
    const instanceId = res.instance_id
    showNewChatModal.value = false

    // Reload sidebar to include the new/existing contact
    await loadInstances()

    // Select the contact
    const existing = contacts.value.find(c => c.id === instanceId)
    if (existing) {
      selectedContactId.value = instanceId
      await loadMessages(instanceId)
      scrollToBottom()
    } else {
      // If not in list (e.g. agent filter), add it manually
      contacts.value.unshift({
        id: instanceId,
        instanceId,
        name: raw,
        phone: raw,
        lastMsg: 'New conversation',
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        unread: 0,
        company: '',
        status: 'Active',
        online: false,
        color: avatarColors[contacts.value.length % avatarColors.length],
        agentName: '',
        lastActivity: new Date().toISOString(),
        messageCount: 0,
      })
      selectedContactId.value = instanceId
    }
  } catch (e) {
    newChatError.value = e.message || 'Failed to start chat'
  } finally {
    newChatLoading.value = false
  }
}

const pendingDeleteId = ref(null)

function deleteChat(instanceId) {
  // First call → show confirmation; second call (from confirm button) → execute
  pendingDeleteId.value = instanceId
}

async function confirmDeleteChat() {
  const instanceId = pendingDeleteId.value
  pendingDeleteId.value = null
  if (!instanceId) return
  try {
    await frappe('frappe.client.delete', { doctype: 'Runtime Instance', name: instanceId })
    // Remove from local state
    contacts.value = contacts.value.filter(c => c.id !== instanceId)
    delete messagesCache.value[instanceId]
    if (selectedContactId.value === instanceId) {
      selectedContactId.value = contacts.value.length ? contacts.value[0].id : null
      if (selectedContactId.value) loadMessages(selectedContactId.value)
    }
  } catch (e) {
    console.error('[channels-ui] deleteChat failed:', e)
  }
}

const sendMessage = async () => {
  if (!messageInput.value.trim() || !selectedContactId.value || sending.value) return
  const id = selectedContactId.value
  const text = messageInput.value.trim()
  messageInput.value = ''
  sending.value = true

  // Optimistically add to cache
  if (!messagesCache.value[id]) messagesCache.value[id] = []
  const optimisticId = `temp-${Date.now()}`
  messagesCache.value[id].push({
    id: optimisticId,
    type: 'agent',
    text,
    sender: 'agent',
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    isAI: false,
    agentName: 'Operator',
    senderName: 'Operator',
    delivered: 'sent',
    msgType: 'operator_to_customer',
  })
  scrollToBottom()

  try {
    await frappe('sena_whatsapp.api.whatsapp.send_direct_message', {
      instance_id: id,
      message: text,
    })
    // Reload to get the real persisted message
    await loadMessages(id, true)
    scrollToBottom()
  } catch (e) {
    console.error('[channels-ui] sendMessage failed:', e)
    // Remove optimistic message on failure
    const msgs = messagesCache.value[id]
    const idx = msgs.findIndex(m => m.id === optimisticId)
    if (idx !== -1) msgs.splice(idx, 1)
    // Restore text so user can retry
    messageInput.value = text
  } finally {
    sending.value = false
  }
}

const sendToAgent = async () => {
  if (!messageInput.value.trim() || !selectedContactId.value || sending.value) return
  const id = selectedContactId.value
  const contact = selectedContact.value
  const text = messageInput.value.trim()
  messageInput.value = ''
  sending.value = true

  // Optimistically add to cache as operator instruction
  if (!messagesCache.value[id]) messagesCache.value[id] = []
  const optimisticId = `temp-agent-${Date.now()}`
  messagesCache.value[id].push({
    id: optimisticId,
    type: 'text',
    text,
    sender: 'user',
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    isAI: false,
    senderName: 'Operator',
    msgType: 'operator_instruction',
  })
  scrollToBottom()

  try {
    const targetAgent = contact?.agentName || agentName || 'Channels'
    const instanceId = contact?.instanceId || id
    await frappe('sena_agents_backend.sena_agents_backend.api.chat.send_message_stream', {
      agent_name: targetAgent,
      instance_id: instanceId,
      message: text,
      sender_name: 'Operator',
    })
    // Reload to get persisted state
    await loadMessages(id, true)
    scrollToBottom()
  } catch (e) {
    console.error('[channels-ui] sendToAgent failed:', e)
    // Remove optimistic message on failure
    const msgs = messagesCache.value[id]
    const idx = msgs.findIndex(m => m.id === optimisticId)
    if (idx !== -1) msgs.splice(idx, 1)
    messageInput.value = text
  } finally {
    sending.value = false
  }
}

function parseArgs(toolArgs) {
  try {
    const parsed = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch { return {} }
}

// ── Inline approval actions ──
async function handleApprove(msg) {
  if (!msg.approvalId || msg.approvalStatus !== 'pending') return
  msg.approvalStatus = 'approving'
  const note = (msg.approvalNote || '').trim()
  try {
    const params = { request_name: msg.approvalId }
    if (note) params.note = note
    await frappeCall('sena_agents_backend.sena_agents_backend.api.approvals.approve', params)
    msg.approvalStatus = 'approved'
    // Reload messages after a short delay to get updated state
    setTimeout(() => {
      if (selectedContactId.value) loadMessages(selectedContactId.value, true)
    }, 1500)
  } catch (e) {
    console.error('[channels-ui] approve failed:', e)
    msg.approvalStatus = 'pending'
  }
}

async function handleReject(msg) {
  if (!msg.approvalId || msg.approvalStatus !== 'pending') return
  msg.approvalStatus = 'rejecting'
  const reason = (msg.approvalNote || '').trim()
  try {
    await frappeCall('sena_agents_backend.sena_agents_backend.api.approvals.reject', {
      request_name: msg.approvalId,
      reason,
    })
    msg.approvalStatus = 'rejected'
    setTimeout(() => {
      if (selectedContactId.value) loadMessages(selectedContactId.value, true)
    }, 1500)
  } catch (e) {
    console.error('[channels-ui] reject failed:', e)
    msg.approvalStatus = 'pending'
  }
}

function openApprovalInPanel(approvalId) {
  // Tell the parent Sena frontend to open the approvals sidebar and highlight this one
  window.parent.postMessage({
    type: 'sena:open-approval',
    approvalId,
  }, '*')
}

const handleSend = () => {
  if (sendMode.value === 'agent') {
    sendToAgent()
  } else {
    sendMessage()
  }
}

const triggerFileUpload = () => {
  if (fileInputRef.value) fileInputRef.value.click()
}

const handleFileUpload = async (event) => {
  const file = event.target.files?.[0]
  if (!file || !selectedContactId.value) return
  const id = selectedContactId.value
  sending.value = true

  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('instance_id', id)
    // Inject sid for auth (cookies may not work in iframe context)
    if (_sid) formData.append('sid', _sid)

    const headers = { Accept: 'application/json' }
    if (_csrfToken) headers['X-Frappe-CSRF-Token'] = _csrfToken

    console.log('[channels-ui] Uploading file:', file.name, file.type, file.size, 'to', id)

    const resp = await fetch('/api/method/sena_whatsapp.api.whatsapp.send_direct_media', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: formData,
    })
    const data = await resp.json()
    console.log('[channels-ui] Upload response:', resp.status, data)
    if (!resp.ok) throw new Error(data.exception || data.exc || `HTTP ${resp.status}`)
    if (data.message?.status === 'error') throw new Error(data.message.error)
    await loadMessages(id, true)
    scrollToBottom()
  } catch (e) {
    console.error('[channels-ui] File upload failed:', e)
    alert('File upload failed: ' + (e.message || e))
  } finally {
    sending.value = false
    if (fileInputRef.value) fileInputRef.value.value = ''
  }
}

const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    _audioChunks = []
    _mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    _mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _audioChunks.push(e.data) }
    _mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      clearInterval(_recordingTimer)
      isRecording.value = false
      recordingDuration.value = 0

      if (_audioChunks.length === 0) return
      const blob = new Blob(_audioChunks, { type: 'audio/ogg' })
      await sendVoiceNote(blob)
    }
    _mediaRecorder.start()
    isRecording.value = true
    recordingDuration.value = 0
    _recordingTimer = setInterval(() => { recordingDuration.value++ }, 1000)
  } catch (e) {
    console.error('[channels-ui] Microphone access denied:', e)
  }
}

const stopRecording = () => {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop()
  }
}

const cancelRecording = () => {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.ondataavailable = null
    _mediaRecorder.onstop = () => {
      _mediaRecorder.stream?.getTracks().forEach(t => t.stop())
      clearInterval(_recordingTimer)
      isRecording.value = false
      recordingDuration.value = 0
    }
    _mediaRecorder.stop()
  }
}

const sendVoiceNote = async (blob) => {
  if (!selectedContactId.value) return
  const id = selectedContactId.value
  sending.value = true
  try {
    const formData = new FormData()
    formData.append('file', blob, 'voice-note.ogg')
    formData.append('instance_id', id)
    if (_sid) formData.append('sid', _sid)

    const headers = { Accept: 'application/json' }
    if (_csrfToken) headers['X-Frappe-CSRF-Token'] = _csrfToken

    const resp = await fetch('/api/method/sena_whatsapp.api.whatsapp.send_direct_media', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: formData,
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.exception || data.exc || `HTTP ${resp.status}`)
    await loadMessages(id, true)
    scrollToBottom()
  } catch (e) {
    console.error('[channels-ui] Voice note send failed:', e)
  } finally {
    sending.value = false
  }
}

const toggleAudio = (msg) => {
  const audio = msg._audio
  if (!audio) return
  if (msg.playing) {
    audio.pause()
    msg.playing = false
  } else {
    audio.play()
    msg.playing = true
    audio.onended = () => { msg.playing = false }
  }
}

const formatRecordingTime = (seconds) => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Lifecycle ──
let _pollInterval = null

onMounted(async () => {
  window.addEventListener('resize', onResize)
  await ensureAuth()
  await loadInstances()
  if (selectedContactId.value) {
    await loadMessages(selectedContactId.value)
    scrollToBottom()
  }
  // Real-time updates: iframe mode uses postMessage from parent (which has Socket.IO).
  // No polling — updates are event-driven only.
  const isIframed = window.parent !== window
  if (isIframed) {
    window.addEventListener('message', _handleParentMessage)
  }
})

async function _handleParentMessage(event) {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return
  // Parent sends: { type: 'wa_new_message', instance_id: '...' }
  // or: { type: 'wa_instance_update' }
  if (msg.type === 'wa_new_message') {
    await loadInstances(true)
    if (msg.instance_id && selectedContactId.value === msg.instance_id) {
      await loadMessages(msg.instance_id, true)
    }
  } else if (msg.type === 'wa_instance_update') {
    await loadInstances(true)
  } else if (msg.type === 'agent_token' || msg.type === 'agent_tool_call') {
    // Agent is actively streaming/working — show thinking indicator
    const agentNames = _uiAgents || [agentName]
    if (agentNames.includes(msg.agent_name)) {
      agentThinking.value = true
      clearTimeout(_thinkingTimeout)
      _thinkingTimeout = setTimeout(() => { agentThinking.value = false }, 8000)
    }
  } else if (msg.type === 'agent_done') {
    const agentNames = _uiAgents || [agentName]
    if (agentNames.includes(msg.agent_name)) {
      agentThinking.value = false
      clearTimeout(_thinkingTimeout)
      // Reload messages after agent finishes
      if (selectedContactId.value) {
        setTimeout(() => loadMessages(selectedContactId.value, true), 500)
      }
      await loadInstances(true)
    }
  }
}

onUnmounted(() => {
  if (_pollInterval) clearInterval(_pollInterval)
  window.removeEventListener('message', _handleParentMessage)
  window.removeEventListener('resize', onResize)
})

watch(selectedContactId, async (id) => {
  if (id) {
    await loadMessages(id)
    scrollToBottom()
  }
})
</script>

<template>
  <div class="app" :class="{ 'app--mobile': isMobile }">

    <!-- ===== SIDEBAR ===== -->
    <aside class="sidebar" :class="{ 'sidebar--hidden': isMobile && mobileShowChat }">
      <!-- Header -->
      <div class="sidebar__header">
        <div class="channel-selector">
          <div
            v-for="ch in channels"
            :key="ch.id"
            class="channel-selector__icon"
            :class="{
              'channel-selector__icon--active': activePlatforms.has(ch.id),
              'channel-selector__icon--disabled': ch.id !== 'whatsapp'
            }"
            :style="[
              activePlatforms.has(ch.id)
                ? { background: ch.color, color: ch.textColor || '#fff', boxShadow: '0 0 0 1.5px #fff, 0 0 0 3px ' + ch.color }
                : { background: '#CBD5E1', color: '#fff' }
            ]"
            :data-tooltip="ch.id !== 'whatsapp' ? ch.label + ' (coming soon)' : ch.label"
            @click="ch.id === 'whatsapp' ? null : undefined"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path :d="ch.icon"/></svg>
          </div>
          <!-- Select all toggle — hidden until more channels are active
          <button
            class="channel-selector__toggle"
            :class="{ 'channel-selector__toggle--all': allSelected }"
            :data-tooltip="allSelected ? 'Deselect all' : 'Select all'"
            @click="toggleAllPlatforms"
          >
            <svg v-if="!allSelected" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
            <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/></svg>
          </button>
          -->
        </div>
      </div>

      <!-- Search + New chat -->
      <div class="sidebar__search">
        <div class="sidebar__search-field">
          <svg class="sidebar__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input v-model="searchQuery" type="text" class="sidebar__search-input" placeholder="Search or start new chat" />
        </div>
        <button class="sidebar__icon-btn sidebar__search-action" @click="openNewChat" title="New chat">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      <!-- Contact list -->
      <div class="sidebar__contacts">
        <!-- Loading state -->
        <div v-if="loading" class="sidebar__loading">
          <div v-for="n in 5" :key="n" class="skeleton-contact">
            <div class="skeleton skeleton--avatar"></div>
            <div class="skeleton-body">
              <div class="skeleton skeleton--line skeleton--short"></div>
              <div class="skeleton skeleton--line"></div>
            </div>
          </div>
        </div>

        <!-- Error state -->
        <div v-else-if="error" class="sidebar__error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>{{ error }}</span>
        </div>

        <!-- Empty state -->
        <div v-else-if="contacts.length === 0" class="sidebar__empty">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <span>No WhatsApp conversations yet</span>
        </div>

        <!-- Contact rows -->
        <div
          v-else
          v-for="contact in filteredContacts"
          :key="contact.id"
          :class="['contact', { 'contact--active': selectedContactId === contact.id }]"
          @click="selectContact(contact.id)"
        >
          <div class="contact__avatar" :style="{ background: contact.color }">
            {{ contact.name[0] }}
            <div v-if="contact.online" class="contact__online"></div>
          </div>
          <div class="contact__body">
            <div class="contact__row1">
              <span class="contact__name">{{ contact.name }}</span>
              <span :class="['contact__time', { 'contact__time--unread': contact.unread > 0 }]">{{ contact.time }}</span>
            </div>
            <div class="contact__row2">
              <span class="contact__preview">{{ contact.lastMsg }}</span>
              <span v-if="contact.unread" class="contact__unread">{{ contact.unread }}</span>
            </div>
            <div v-if="contact.name !== contact.phone" class="contact__row2">
              <span class="contact__preview" style="font-size: 10px; color: #94A3B8;">{{ contact.phone }}</span>
            </div>
            <div class="contact__row3">
              <span class="contact__agent-tag">
                <svg class="contact__agent-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a5 5 0 0 0-5 5v1h18v-1a5 5 0 0 0-5-5z"/></svg>
                {{ contact.company }}
              </span>
              <span class="contact__status" :style="{ color: statusConfig.default.color, background: statusConfig.default.bg }">{{ contact.status }}</span>
            </div>
          </div>
          <button
            class="contact__delete"
            title="Delete conversation"
            @click.stop="deleteChat(contact.id)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Delete confirmation overlay -->
    <div v-if="pendingDeleteId" class="confirm-overlay" @click="pendingDeleteId = null">
      <div class="confirm-dialog" @click.stop>
        <p class="confirm-dialog__text">Delete this conversation? This cannot be undone.</p>
        <div class="confirm-dialog__btns">
          <button class="confirm-dialog__btn confirm-dialog__btn--cancel" @click="pendingDeleteId = null">Cancel</button>
          <button class="confirm-dialog__btn confirm-dialog__btn--delete" @click="confirmDeleteChat">Delete</button>
        </div>
      </div>
    </div>

    <!-- ===== CHAT ===== -->
    <main class="chat" :class="{ 'chat--visible': !isMobile || mobileShowChat }" v-if="selectedContact || (isMobile && mobileShowChat)">

      <!-- Chat header -->
      <div class="chat__header">
        <div class="chat__header-left">
          <button v-if="isMobile" class="chat__back-btn" @click="mobileBack">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div class="chat__avatar" :style="{ background: selectedContact?.color }">
            {{ selectedContact.name[0] }}
            <div v-if="selectedContact.online" class="chat__avatar-online"></div>
          </div>
          <div class="chat__header-info">
            <div class="chat__header-name">{{ selectedContact.name }}</div>
            <div class="chat__header-sub">
              <span class="chat__header-company">{{ selectedContact.company }}</span>
              <span class="chat__header-dot">·</span>
              <span class="chat__header-status" v-if="selectedContact.online">online</span>
              <span class="chat__header-status" v-else>last seen recently</span>
            </div>
          </div>
        </div>
        <div class="chat__header-actions">
          <span class="chat__status-dot" :class="{ 'chat__status-dot--active': selectedContact.status === 'Active' }"></span>
          <button class="chat__header-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          </button>
        </div>
      </div>

      <!-- Message filter bar -->
      <div class="chat__filter-bar">
        <button
          v-for="f in [{ id: 'all', label: 'All' }, { id: 'customer', label: 'Customer' }, { id: 'internal', label: 'Internal' }]"
          :key="f.id"
          class="filter-pill"
          :class="{ 'filter-pill--active': messageFilter === f.id }"
          @click="messageFilter = f.id; if (f.id === 'customer') sendMode = 'customer'; else if (f.id === 'internal') sendMode = 'agent'"
        >{{ f.label }}</button>
      </div>

      <!-- Messages -->
      <div ref="messageListRef" class="chat__messages">

        <!-- Messages loading -->
        <div v-if="loadingMessages" class="messages-loading">
          <div v-for="n in 4" :key="n" class="skeleton-bubble" :class="n % 2 === 0 ? 'skeleton-bubble--out' : 'skeleton-bubble--in'">
            <div class="skeleton skeleton--bubble"></div>
          </div>
        </div>

        <!-- Empty conversation -->
        <div v-else-if="!loadingMessages && selectedMessages.length === 0" class="messages-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <span>No messages yet</span>
        </div>

        <template v-else v-for="msg in selectedMessages" :key="msg.id">

          <!-- Date separator -->
          <div v-if="msg.type === 'date'" class="msg-date">
            <span>{{ msg.label }}</span>
          </div>

          <!-- Customer message (left) -->
          <div v-else-if="msg.type === 'text' && msg.sender === 'user' && msg.msgType !== 'operator_instruction'" class="msg msg--in">
            <div class="msg__wrapper">
              <span v-if="msg.senderName" class="bubble__sender-label">{{ msg.senderName }}</span>
              <div class="bubble bubble--customer">
                <div class="bubble__text" v-html="renderText(msg.text)"></div>
                <div class="bubble__meta">
                  <span class="bubble__time">{{ msg.time }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Internal message (dashed) — operator instructions right, agent notes left -->
          <div v-else-if="(msg.type === 'text' && msg.msgType === 'operator_instruction') || (msg.type === 'agent' && msg.msgType === 'agent_note')" class="msg" :class="msg.msgType === 'operator_instruction' ? 'msg--out' : 'msg--in'">
            <div class="msg__wrapper">
              <span class="msg__sender-label" :class="msg.msgType === 'operator_instruction' ? 'msg__sender-label--agent' : ''">{{ msg.msgType === 'operator_instruction' ? 'You' : msg.agentName || 'Agent' }}</span>
              <div class="internal-msg">
                <!-- Grouped steps -->
                <ol v-if="msg._parts && msg._parts.length > 1" class="internal-msg__steps">
                  <li v-for="(part, idx) in msg._parts" :key="idx" class="internal-msg__step" v-html="renderText(part)"></li>
                </ol>
                <!-- Single message -->
                <div v-else class="internal-msg__text" v-html="renderText(msg.text)"></div>
                <div class="internal-msg__meta">
                  <span class="internal-msg__time">{{ msg.time }}</span>
                </div>
              <!-- Approval actions if present -->
              <div v-if="msg.approvalId && msg.approvalStatus === 'pending'" class="internal-msg__approval">
                <div class="approval-detail" v-if="msg.approvalDetail">
                  <div class="approval-detail__header">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    <span class="approval-detail__tool">{{ msg.approvalDetail.tool }}</span>
                    <span class="approval-detail__badge">Pending</span>
                  </div>
                  <div class="approval-detail__args" v-if="msg.approvalDetail.tool_args">
                    <div v-for="(val, key) in parseArgs(msg.approvalDetail.tool_args)" :key="key" class="approval-detail__arg">
                      <span class="approval-detail__arg-key">{{ key }}:</span>
                      <span class="approval-detail__arg-val">{{ typeof val === 'string' ? val.slice(0, 120) : JSON.stringify(val).slice(0, 120) }}</span>
                    </div>
                  </div>
                </div>
                <input v-model="msg.approvalNote" class="approval-note-input" type="text" placeholder="Note (optional)..." @click.stop @keydown.enter.stop="handleApprove(msg)" />
                <div class="internal-msg__approval-btns">
                  <button class="approval-btn approval-btn--approve" @click.stop="handleApprove(msg)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Approve
                  </button>
                  <button class="approval-btn approval-btn--reject" @click.stop="handleReject(msg)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Reject
                  </button>
                </div>
                <button class="approval-link" @click.stop="openApprovalInPanel(msg.approvalId)">View in approvals →</button>
              </div>
              <div v-else-if="msg.approvalId && msg.approvalStatus === 'approved'" class="internal-msg__approval-resolved">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span class="internal-msg__approval-status internal-msg__approval-status--approved">Approved</span>
                <button class="approval-link" @click.stop="openApprovalInPanel(msg.approvalId)">View →</button>
              </div>
              <div v-else-if="msg.approvalId && msg.approvalStatus === 'rejected'" class="internal-msg__approval-resolved">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                <span class="internal-msg__approval-status internal-msg__approval-status--rejected">Rejected</span>
                <button class="approval-link" @click.stop="openApprovalInPanel(msg.approvalId)">View →</button>
              </div>
              <div v-else-if="msg.approvalId && (msg.approvalStatus === 'approving' || msg.approvalStatus === 'rejecting')" class="internal-msg__approval-resolving">
                <div class="approval-spinner"></div>
                <span>{{ msg.approvalStatus === 'approving' ? 'Approving' : 'Rejecting' }}...</span>
              </div>
              </div>
            </div>
          </div>

          <!-- Agent → Customer bubble (sent — right side) -->
          <div v-else-if="msg.type === 'agent' && (msg.msgType === 'agent_to_customer' || msg.msgType === 'operator_to_customer')" class="msg msg--out">
            <div class="msg__wrapper">
              <span class="msg__sender-label msg__sender-label--agent">{{ msg.msgType === 'operator_to_customer' ? 'You' : msg.agentName }}</span>
              <div class="bubble bubble--agent-to-customer" :class="{ 'bubble--pending-approval': msg.approvalId && msg.approvalStatus === 'pending' }">
                <div class="bubble__text" v-html="renderText(msg.text)"></div>
                <div class="bubble__meta">
                  <span class="bubble__time">{{ msg.time }}</span>
                  <!-- Pending approval: show clock icon + badge instead of delivery ticks -->
                  <template v-if="msg.approvalId && (msg.approvalStatus === 'pending' || msg.approvalStatus === 'approving' || msg.approvalStatus === 'rejecting')">
                    <span class="bubble__approval-badge">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      Pending
                    </span>
                  </template>
                  <!-- Normal delivery: WA icon + ticks -->
                  <template v-else>
                    <svg class="bubble__wa-icon" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    <span class="bubble__ticks" :class="{ 'bubble__ticks--read': msg.delivered === 'read', 'bubble__ticks--delivered': msg.delivered === 'delivered' }">
                      <svg v-if="msg.delivered === 'sent'" width="14" height="10" viewBox="0 0 14 10" fill="none">
                        <path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                      <svg v-else width="14" height="10" viewBox="0 0 14 10" fill="none">
                        <path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M5 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </span>
                  </template>
                </div>
              </div>
              <!-- Approval card below the bubble -->
              <div v-if="msg.approvalId && msg.approvalStatus === 'pending'" class="bubble-approval-card">
                <div class="approval-detail" v-if="msg.approvalDetail">
                  <div class="approval-detail__header">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    <span class="approval-detail__tool">{{ msg.approvalDetail.tool }}</span>
                    <span class="approval-detail__badge">Pending</span>
                  </div>
                  <div class="approval-detail__args" v-if="msg.approvalDetail.tool_args">
                    <div v-for="(val, key) in parseArgs(msg.approvalDetail.tool_args)" :key="key" class="approval-detail__arg">
                      <span class="approval-detail__arg-key">{{ key }}:</span>
                      <span class="approval-detail__arg-val">{{ typeof val === 'string' ? val.slice(0, 120) : JSON.stringify(val).slice(0, 120) }}</span>
                    </div>
                  </div>
                </div>
                <input v-model="msg.approvalNote" class="approval-note-input" type="text" placeholder="Note (optional)..." @click.stop @keydown.enter.stop="handleApprove(msg)" />
                <div class="internal-msg__approval-btns">
                  <button class="approval-btn approval-btn--approve" @click.stop="handleApprove(msg)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Approve
                  </button>
                  <button class="approval-btn approval-btn--reject" @click.stop="handleReject(msg)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Reject
                  </button>
                </div>
                <button class="approval-link" @click.stop="openApprovalInPanel(msg.approvalId)">View in approvals &#8594;</button>
              </div>
              <!-- Approved/Rejected resolved state -->
              <div v-else-if="msg.approvalId && msg.approvalStatus === 'approved'" class="bubble-approval-card bubble-approval-card--resolved">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span style="color: #10B981; font-weight: 500; font-size: 11px;">Approved</span>
              </div>
              <div v-else-if="msg.approvalId && msg.approvalStatus === 'rejected'" class="bubble-approval-card bubble-approval-card--resolved">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                <span style="color: #EF4444; font-weight: 500; font-size: 11px;">Rejected</span>
              </div>
              <div v-else-if="msg.approvalId && (msg.approvalStatus === 'approving' || msg.approvalStatus === 'rejecting')" class="bubble-approval-card bubble-approval-card--resolved">
                <div class="approval-spinner"></div>
                <span style="font-size: 11px;">{{ msg.approvalStatus === 'approving' ? 'Approving' : 'Rejecting' }}...</span>
              </div>
            </div>
          </div>

          <!-- Voice note -->
          <div v-else-if="msg.type === 'voice'" class="msg" :class="msg.sender === 'user' ? 'msg--in' : 'msg--out'">
            <div class="bubble" :class="msg.sender === 'user' ? 'bubble--in' : 'bubble--out'">
              <div class="voice">
                <audio v-if="msg.audioUrl" :src="msg.audioUrl" :ref="el => { if (el) msg._audio = el }" preload="metadata"></audio>
                <div class="voice__play" @click="toggleAudio(msg)" style="cursor:pointer">
                  <svg v-if="!msg.playing" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                  <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
                </div>
                <div class="voice__track">
                  <div class="voice__bars">
                    <span v-for="n in 30" :key="n" class="voice__bar" :style="{ height: Math.max(20, Math.min(100, 20 + Math.sin(n * 0.9 + 1) * 35 + Math.sin(n * 0.3) * 25)) + '%', opacity: n < 13 ? 1 : 0.4 }"></span>
                  </div>
                </div>
                <div class="voice__info">
                  <span class="voice__dur">{{ msg.duration || '🎙' }}</span>
                </div>
              </div>
              <div v-if="msg.text" class="voice__transcript">{{ msg.text }}</div>
              <div class="bubble__meta">
                <span class="bubble__time">{{ msg.time }}</span>
                <span v-if="msg.sender === 'agent'" class="bubble__ticks" :class="{ 'bubble__ticks--read': msg.delivered === 'read', 'bubble__ticks--delivered': msg.delivered === 'delivered' }">
                  <svg v-if="msg.delivered === 'sent'" width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <svg v-else width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
              </div>
            </div>
          </div>

          <!-- Image -->
          <div v-else-if="msg.type === 'image'" class="msg" :class="msg.sender === 'user' ? 'msg--in' : 'msg--out'">
            <div class="bubble bubble--media" :class="msg.sender === 'user' ? 'bubble--in' : 'bubble--out'">
              <a :href="msg.imageUrl" target="_blank"><img v-if="msg.imageUrl" :src="msg.imageUrl" class="img-actual" /></a>
              <div v-if="msg.caption" class="img-caption">{{ msg.caption }}</div>
              <div class="bubble__meta">
                <span class="bubble__time">{{ msg.time }}</span>
                <span v-if="msg.sender === 'agent'" class="bubble__ticks" :class="{ 'bubble__ticks--read': msg.delivered === 'read', 'bubble__ticks--delivered': msg.delivered === 'delivered' }">
                  <svg v-if="msg.delivered === 'sent'" width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <svg v-else width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
              </div>
            </div>
          </div>

          <!-- Document -->
          <div v-else-if="msg.type === 'document'" class="msg" :class="msg.sender === 'user' ? 'msg--in' : 'msg--out'">
            <div class="bubble" :class="msg.sender === 'user' ? 'bubble--in' : 'bubble--out'">
              <div class="doc">
                <div class="doc__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </div>
                <div class="doc__body">
                  <div class="doc__name">{{ msg.filename }}</div>
                </div>
                <a v-if="msg.fileUrl" :href="msg.fileUrl" target="_blank" class="doc__dl">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
              </div>
              <div class="bubble__meta">
                <span class="bubble__time">{{ msg.time }}</span>
                <span v-if="msg.sender === 'agent'" class="bubble__ticks" :class="{ 'bubble__ticks--read': msg.delivered === 'read', 'bubble__ticks--delivered': msg.delivered === 'delivered' }">
                  <svg v-if="msg.delivered === 'sent'" width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <svg v-else width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
              </div>
            </div>
          </div>

        </template>

        <!-- Typing indicator -->
        <div v-if="showTyping" class="msg msg--in">
          <div class="bubble bubble--in bubble--typing">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>

      <!-- Agent thinking indicator -->
      <div v-if="agentThinking" class="chat__thinking">
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
        <span class="thinking-label">{{ selectedContact?.agentName || 'Agent' }} is thinking...</span>
      </div>

      <!-- Input bar -->
      <input type="file" ref="fileInputRef" style="display:none" @change="handleFileUpload" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" />

      <!-- Recording overlay -->
      <div v-if="isRecording" class="chat__input-bar chat__input-bar--recording">
        <button class="input-btn input-btn--cancel" @click="cancelRecording">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="recording-indicator">
          <span class="recording-dot"></span>
          <span class="recording-time">{{ formatRecordingTime(recordingDuration) }}</span>
        </div>
        <button class="input-btn input-btn--send" @click="stopRecording">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>

      <!-- Normal input bar -->
      <div v-else class="chat__input-bar" :class="sendMode === 'agent' ? 'chat__input-bar--agent' : ''">
        <!-- Send mode toggle pill -->
        <button
          class="mode-pill"
          :class="sendMode === 'agent' ? 'mode-pill--agent' : 'mode-pill--customer'"
          :title="sendMode === 'customer' ? 'Sending to customer — click to switch to agent' : 'Sending to agent — click to switch to customer'"
          @click="sendMode = sendMode === 'customer' ? 'agent' : 'customer'"
        >
          <!-- WhatsApp icon when customer mode -->
          <svg v-if="sendMode === 'customer'" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          <!-- Robot icon when agent mode -->
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M12 11V5"/><circle cx="12" cy="4" r="2"/></svg>
        </button>
        <button v-if="sendMode === 'customer'" class="input-btn" @click="triggerFileUpload" :disabled="sending">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <div class="input-wrap">
          <input
            v-model="messageInput"
            type="text"
            class="input-field"
            :placeholder="sending ? 'Sending...' : (sendMode === 'agent' ? 'Instruct agent...' : 'Message customer...')"
            :disabled="sending"
            @keyup.enter="handleSend"
          />
        </div>
        <!-- Show send button when there's text, mic button when empty (customer mode only) -->
        <button v-if="messageInput.trim()" class="input-btn input-btn--send" @click="handleSend" :disabled="sending">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
        <button v-else-if="sendMode === 'customer'" class="input-btn input-btn--mic" @click="startRecording" :disabled="sending">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
      </div>

    </main>

    <!-- New Chat Modal -->
    <div v-if="showNewChatModal" class="modal-overlay" @click.self="showNewChatModal = false">
      <div class="modal">
        <div class="modal__header">
          <span class="modal__title">New Chat</span>
          <button class="modal__close" @click="showNewChatModal = false">&times;</button>
        </div>
        <div class="modal__body">
          <div style="margin-bottom:12px">
            <label style="display:block;margin-bottom:4px;font-size:13px;color:#64748b">Agent</label>
            <select v-model="newChatSelectedAgent" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;background:#fff" :disabled="newChatLoading">
              <option value="" disabled>Select an agent…</option>
              <option v-for="a in newChatAgents" :key="a.name" :value="a.name">
                {{ a.name }}{{ a.default ? ' (default)' : '' }}
              </option>
            </select>
          </div>
          <label class="modal__label">Phone number (with country code)</label>
          <input
            v-model="newChatPhone"
            type="tel"
            class="modal__input"
            placeholder="e.g. 919876543210"
            :disabled="newChatLoading"
            @keyup.enter="startNewChat"
            autofocus
          />
          <div v-if="newChatError" class="modal__error">{{ newChatError }}</div>
        </div>
        <div class="modal__footer">
          <button class="modal__btn modal__btn--cancel" @click="showNewChatModal = false">Cancel</button>
          <button class="modal__btn modal__btn--start" @click="startNewChat" :disabled="newChatLoading">
            {{ newChatLoading ? 'Starting...' : 'Start Chat' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ===== LOADING / EMPTY STATES ===== */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.07) 50%, rgba(0,0,0,0.04) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 4px;
}

.skeleton--avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; }
.skeleton--line { height: 10px; width: 100%; margin: 3px 0; }
.skeleton--short { width: 55%; }
.skeleton--bubble { height: 52px; border-radius: 8px; width: 220px; }

.skeleton-contact {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0,0,0,0.04);
}

.skeleton-body { flex: 1; }

.skeleton-bubble {
  display: flex;
  margin: 5px 0;
}
.skeleton-bubble--out { justify-content: flex-end; }
.skeleton-bubble--in { justify-content: flex-start; }

.sidebar__loading { padding: 4px 0; }

.sidebar__error,
.sidebar__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  color: #94A3B8;
  font-size: 12px;
  text-align: center;
}

.messages-loading {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}

.messages-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 60px 20px;
  color: #94A3B8;
  font-size: 13px;
  opacity: 0.6;
}

.app {
  display: flex;
  height: 100vh;
  background: #FAF9F5;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1E293B;
  overflow: hidden;
}

/* ===== SIDEBAR ===== */
.sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #FAF9F5;
  border-right: 1px solid rgba(0,0,0,0.08);
}

.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #F8F7F4;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  overflow: visible;
  position: relative;
  z-index: 2;
}

.channel-selector {
  display: flex;
  align-items: center;
  column-gap: 6px;
  row-gap: 8px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
  overflow: visible;
}

.channel-selector__icon {
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0.45;
}

.channel-selector__icon::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: -24px;
  left: 50%;
  transform: translateX(-50%) scale(0.8);
  background: #1E293B;
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: all 0.15s ease;
  z-index: 10;
}

.channel-selector__icon:hover::after {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}

.channel-selector__icon--active {
  opacity: 1;
}

.channel-selector__icon--disabled {
  cursor: not-allowed;
}

.channel-selector__icon:hover:not(.channel-selector__icon--active):not(.channel-selector__icon--disabled) {
  opacity: 0.85;
  filter: saturate(1.5);
}

.channel-selector__toggle {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1.5px dashed #CBD5E1;
  background: transparent;
  color: #94A3B8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
  position: relative;
}

.channel-selector__toggle:hover {
  border-color: #64748B;
  color: #475569;
  background: rgba(0,0,0,0.03);
}

.channel-selector__toggle--all {
  border-style: solid;
  border-color: #94A3B8;
}

.channel-selector__toggle::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: -24px;
  left: 50%;
  transform: translateX(-50%) scale(0.8);
  background: #1E293B;
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: all 0.15s ease;
  z-index: 10;
}

.channel-selector__toggle:hover::after {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}

.sidebar__header-actions {
  display: flex;
  gap: 2px;
}

.sidebar__icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94A3B8;
  cursor: pointer;
  transition: background 0.15s;
}

.sidebar__icon-btn:hover {
  background: rgba(0,0,0,0.04);
  color: #64748B;
}

.sidebar__tabs {
  display: flex;
  padding: 0 12px;
  background: #F8F7F4;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.sidebar__tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 7px 0;
  border: none;
  background: transparent;
  color: #94A3B8;
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}

.sidebar__tab:hover {
  color: #64748B;
}

.sidebar__tab--active {
  color: #3B82F6;
  border-bottom-color: #3B82F6;
  font-weight: 600;
}

.sidebar__tab-icon {
  opacity: 0.8;
}

.sidebar__search {
  padding: 6px 10px;
  background: #FAF9F5;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sidebar__search-field {
  flex: 1;
  min-width: 0;
  position: relative;
}

.sidebar__search-action {
  flex-shrink: 0;
}

.sidebar__search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #94A3B8;
  pointer-events: none;
}

.sidebar__search-input {
  width: 100%;
  padding: 6px 10px 6px 30px;
  background: #F0EFE9;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 6px;
  font-size: 12px;
  color: #1E293B;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}

.sidebar__search-input::placeholder {
  color: #94A3B8;
}

.sidebar__search-input:focus {
  background: #ECEAE3;
  border-color: rgba(59,130,246,0.3);
}

.sidebar__contacts {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.08) transparent;
}

/* ===== CONTACT ROW ===== */
.contact {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 12px;
  cursor: pointer;
  border-bottom: 1px solid rgba(0,0,0,0.04);
  transition: background 0.1s;
  position: relative;
}

.contact:hover {
  background: rgba(0,0,0,0.02);
}

.contact:hover .contact__delete {
  opacity: 1;
}

.contact--active {
  background: rgba(59,130,246,0.06);
}

.contact__delete {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(239, 68, 68, 0.08);
  color: #EF4444;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}

.contact__delete:hover {
  background: rgba(239, 68, 68, 0.15);
}

.contact__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
  position: relative;
}

.contact__online {
  position: absolute;
  width: 9px;
  height: 9px;
  background: #10B981;
  border: 2px solid #FAF9F5;
  border-radius: 50%;
  bottom: 0;
  right: 0;
}

.contact--active .contact__online {
  border-color: rgba(59,130,246,0.06);
}

.contact__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.contact__row1,
.contact__row2,
.contact__row3 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.contact__name {
  font-size: 13px;
  font-weight: 500;
  color: #1E293B;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact__time {
  font-size: 10px;
  color: #94A3B8;
  flex-shrink: 0;
}

.contact__time--unread {
  color: #3B82F6;
}

.contact__preview {
  font-size: 12px;
  color: #64748B;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.contact__unread {
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: #3B82F6;
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  flex-shrink: 0;
}

.contact__agent-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9.5px;
  font-weight: 500;
  color: #6366F1;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.15);
  padding: 1px 6px 1px 4px;
  border-radius: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 50%;
}

.contact__agent-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

.contact__status {
  font-size: 8.5px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* ===== CHAT AREA ===== */
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #F5F4EF;
  position: relative;
}

.chat::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, rgba(0,0,0,0.02) 1px, transparent 1px);
  background-size: 20px 20px;
  pointer-events: none;
  z-index: 0;
}

/* ===== CHAT HEADER ===== */
.chat__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: #F8F7F4;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
  z-index: 1;
}

.chat__header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chat__avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
  position: relative;
}

.chat__avatar-online {
  position: absolute;
  width: 9px;
  height: 9px;
  background: #10B981;
  border: 2px solid #F8F7F4;
  border-radius: 50%;
  bottom: 0;
  right: 0;
}

.chat__header-name {
  font-size: 13.5px;
  font-weight: 500;
  color: #1E293B;
  line-height: 1.2;
}

.chat__header-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
}

.chat__header-company {
  font-size: 11px;
  color: #64748B;
}

.chat__header-dot {
  color: #94A3B8;
  font-size: 11px;
}

.chat__header-status {
  font-size: 11px;
  color: #10B981;
}

.chat__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat__header-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94A3B8;
  cursor: pointer;
  transition: background 0.15s;
}

.chat__header-btn:hover {
  background: rgba(0,0,0,0.04);
  color: #64748B;
}

/* Status dot in header */
.chat__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #CBD5E1;
  flex-shrink: 0;
}

.chat__status-dot--active {
  background: #10B981;
}

/* ===== MESSAGES ===== */
.chat__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.08) transparent;
  position: relative;
  z-index: 1;
}

.msg {
  display: flex;
  margin-bottom: 1px;
}

.msg--out { justify-content: flex-end; }
.msg--in  { justify-content: flex-start; }

/* ===== DATE SEPARATOR ===== */
.msg-date {
  display: flex;
  justify-content: center;
  margin: 12px 0 8px;
}

.msg-date span {
  background: #EAE8E1;
  color: #64748B;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}

/* ===== BUBBLES ===== */
.bubble {
  max-width: 65%;
  padding: 6px 10px 4px;
  border-radius: 8px;
  position: relative;
  word-break: break-word;
}

/* Customer inbound (left) */
.bubble--customer {
  background: #FAFAF8;
  border: 1px solid rgba(30, 41, 59, 0.12);
  border-radius: 2px 12px 12px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

/* Agent → Customer (right) */
.bubble--agent-to-customer {
  background: linear-gradient(135deg, rgba(37, 211, 102, 0.06) 0%, rgba(59, 130, 246, 0.06) 100%);
  border: 1px solid rgba(37, 211, 102, 0.15);
  border-radius: 12px 2px 12px 12px;
}

.bubble--pending-approval {
  opacity: 0.85;
  border: 1px dashed #F59E0B;
}

.bubble__approval-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: #F59E0B;
  font-size: 10px;
  font-weight: 500;
}

.bubble-approval-card {
  background: rgba(245, 158, 11, 0.08);
  border: 1px dashed rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 4px;
  max-width: 340px;
  margin-left: auto;
}

.bubble-approval-card--resolved {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: transparent;
  border: none;
}

/* Agent note — internal (right) */
.bubble--agent-note {
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-left: 3px solid rgba(59, 130, 246, 0.4);
  border-radius: 0 8px 8px 0;
}

.bubble--agent-note .bubble__text {
  font-size: 12px;
}

/* Operator instruction (right) */
.bubble--operator-instruction {
  background: transparent;
  border: 1px dashed rgba(0, 0, 0, 0.12);
  border-radius: 8px;
}

.bubble--operator-instruction .bubble__text {
  font-style: italic;
  color: #64748B;
}

/* Sender label above customer bubble */
.bubble__sender-label {
  font-size: 11px;
  font-weight: 500;
  color: #94A3B8;
  margin-bottom: 2px;
  padding-left: 2px;
}

/* Sender label above agent/operator bubble (right-aligned) */
.msg__sender-label {
  font-size: 11px;
  font-weight: 500;
  color: #94A3B8;
  margin-bottom: 2px;
  padding-right: 2px;
}

.msg__sender-label--agent {
  text-align: right;
}

/* Operator "you" label inside instruction */
.bubble__operator-label {
  font-size: 10px;
  font-weight: 500;
  color: #94A3B8;
  margin-bottom: 2px;
}

/* Legacy compat */
.bubble--out {
  background: linear-gradient(135deg, rgba(37, 211, 102, 0.06) 0%, rgba(59, 130, 246, 0.06) 100%);
  border: 1px solid rgba(37, 211, 102, 0.15);
  border-radius: 12px 2px 12px 12px;
}

.bubble--in {
  background: #FAFAF8;
  border: 1px solid rgba(30, 41, 59, 0.12);
  border-radius: 2px 12px 12px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.bubble--media {
  padding: 3px 3px 4px;
}

.bubble--typing {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 10px 14px;
  min-width: 52px;
}

.bubble--typing span {
  width: 6px;
  height: 6px;
  background: #94A3B8;
  border-radius: 50%;
  animation: typing-bounce 1.4s infinite;
}

.bubble--typing span:nth-child(2) { animation-delay: 0.2s; }
.bubble--typing span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-5px); opacity: 1; }
}

/* Agent header inside bubble */
.bubble__agent-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.bubble__agent-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #25D366;
  flex-shrink: 0;
}

.bubble__agent-dot--blue {
  background: #3B82F6;
}

.bubble__agent-name {
  font-size: 10px;
  font-weight: 500;
  color: #94A3B8;
}

.bubble__agent-sep {
  color: #CBD5E1;
  font-size: 10px;
}

.bubble__agent-tool {
  font-size: 9px;
  color: #94A3B8;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

/* WhatsApp send indicator icon */
.bubble__wa-icon {
  color: #94A3B8;
  opacity: 0.6;
  flex-shrink: 0;
}

/* Bubble text */
.bubble__text {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
  color: #1E293B;
  white-space: pre-wrap;
}

.bubble__text :deep(strong) { font-weight: 600; }
.bubble__text :deep(em) { font-style: italic; }

/* Meta row */
.bubble__meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 3px;
}

.bubble__time {
  font-size: 10px;
  color: #94A3B8;
}

.bubble__ticks {
  color: #CBD5E1;
  display: flex;
  align-items: center;
}

.bubble__ticks--delivered {
  color: #94A3B8;
}

.bubble__ticks--read {
  color: #3B82F6;
}

/* ===== VOICE ===== */
.voice {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
}

.voice__play {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #3B82F6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  padding-left: 2px;
  transition: background 0.15s;
}

.voice__play:hover { background: #2563EB; }

.voice__track { flex: 1; }

.voice__bars {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 2px;
}

.voice__bar {
  flex: 1;
  min-width: 2px;
  max-width: 3px;
  background: #3B82F6;
  border-radius: 1px;
  opacity: 0.5;
}

.voice__info { flex-shrink: 0; }

.voice__dur {
  font-size: 10.5px;
  color: #64748B;
}

.voice__transcript {
  font-size: 12px;
  color: #334155;
  line-height: 1.5;
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid rgba(0,0,0,0.06);
  white-space: pre-wrap;
}

/* ===== IMAGE ===== */
.img-frame {
  width: 220px;
  aspect-ratio: 4/3;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
}

.img-icon { opacity: 0.5; }

.img-meta {
  position: absolute;
  bottom: 6px;
  right: 8px;
}

.img-actual {
  width: 100%;
  max-width: 280px;
  border-radius: 6px;
  display: block;
  cursor: pointer;
}

.img-caption {
  padding: 5px 8px 2px;
  font-size: 12.5px;
  color: #334155;
  line-height: 1.4;
}

/* ===== DOCUMENT ===== */
.doc {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 200px;
}

.doc__icon {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  background: rgba(239,68,68,0.07);
  color: #DC2626;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.doc__body {
  flex: 1;
  min-width: 0;
}

.doc__name {
  font-size: 12.5px;
  font-weight: 500;
  color: #1E293B;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc__meta {
  font-size: 10.5px;
  color: #94A3B8;
  margin-top: 1px;
}

.doc__dl {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #94A3B8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.doc__dl:hover {
  background: rgba(0,0,0,0.04);
  color: #64748B;
}

/* ===== THINKING INDICATOR ===== */
.chat__thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: rgba(99, 102, 241, 0.04);
  border-top: 1px solid rgba(99, 102, 241, 0.08);
}

.thinking-label {
  font-size: 11px;
  color: #6366F1;
  font-weight: 500;
}

.thinking-dots {
  display: flex;
  gap: 3px;
  align-items: center;
}

.thinking-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #6366F1;
  animation: thinking-bounce 1.2s ease-in-out infinite;
}

.thinking-dots span:nth-child(2) { animation-delay: 0.15s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.3s; }

@keyframes thinking-bounce {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
  30% { opacity: 1; transform: scale(1); }
}

/* ===== INPUT BAR — Sena ChatInput elevated ===== */
.chat__input-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 8px 12px 12px;
  border: 1.5px solid rgba(30, 41, 59, 0.25);
  background: linear-gradient(135deg, #FFFEFB 0%, #FBF9F5 100%);
  box-shadow:
    0 4px 12px -2px rgba(0, 0, 0, 0.08),
    0 2px 6px -1px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.9);
  border-radius: 14px;
  padding: 6px 8px;
  flex-shrink: 0;
  z-index: 1;
  transition: all 0.15s ease;
}

.chat__input-bar:focus-within {
  border-color: rgba(30, 41, 59, 0.4);
  box-shadow:
    0 4px 12px -2px rgba(0, 0, 0, 0.1),
    0 2px 6px -1px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.9),
    0 0 0 3px rgba(30, 41, 59, 0.06);
  transform: translateY(-0.5px);
}

.chat__input-bar--agent {
  border-color: rgba(139, 92, 246, 0.3);
  background: linear-gradient(135deg, #FEFBFF 0%, #F9F5FB 100%);
}

.chat__input-bar--agent:focus-within {
  border-color: rgba(139, 92, 246, 0.5);
  box-shadow:
    0 4px 12px -2px rgba(0, 0, 0, 0.1),
    0 2px 6px -1px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.9),
    0 0 0 3px rgba(139, 92, 246, 0.06);
}

/* Mode toggle pill */
.mode-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.mode-pill--customer {
  background: rgba(37, 211, 102, 0.1);
  color: #25D366;
}

.mode-pill--customer:hover {
  background: rgba(37, 211, 102, 0.18);
}

.mode-pill--agent {
  background: rgba(139, 92, 246, 0.1);
  color: #8B5CF6;
}

.mode-pill--agent:hover {
  background: rgba(139, 92, 246, 0.18);
}

.input-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94A3B8;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.input-btn:hover {
  background: rgba(0,0,0,0.04);
  color: #64748B;
}

.input-wrap {
  flex: 1;
  position: relative;
}

.input-field {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  font-size: 13px;
  color: #1E293B;
  outline: none;
  font-family: inherit;
}

.input-field::placeholder {
  color: #94A3B8;
}

.input-btn--send {
  background: #1E293B;
  color: white;
  border-radius: 50%;
  width: 28px;
  height: 28px;
}

.input-btn--send:hover {
  background: #334155;
  color: white;
}

.input-btn--send:disabled,
.input-btn--mic:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-btn--mic {
  color: #64748B;
  border-radius: 50%;
}

.input-btn--mic:hover {
  color: #3B82F6;
  background: rgba(59,130,246,0.08);
}

.input-btn--cancel {
  color: #EF4444;
  border-radius: 50%;
}

.input-btn--cancel:hover {
  background: rgba(239,68,68,0.08);
}

/* Recording state */
.chat__input-bar--recording {
  background: linear-gradient(135deg, #FEF2F2 0%, #FFF5F5 100%);
  border-color: rgba(239, 68, 68, 0.25);
}

.recording-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: center;
}

.recording-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #EF4444;
  animation: recording-pulse 1s infinite;
}

@keyframes recording-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.recording-time {
  font-size: 14px;
  font-weight: 500;
  color: #EF4444;
  font-variant-numeric: tabular-nums;
}

/* ===== NEW CHAT MODAL ===== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: #fff;
  border-radius: 12px;
  width: 380px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  overflow: hidden;
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #F0EFE9;
}

.modal__title {
  font-size: 15px;
  font-weight: 600;
  color: #1E293B;
}

.modal__close {
  background: none;
  border: none;
  font-size: 22px;
  color: #94A3B8;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.modal__close:hover { color: #475569; }

.modal__body {
  padding: 20px;
}

.modal__label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #64748B;
  margin-bottom: 6px;
}

.modal__input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 14px;
  color: #1E293B;
  outline: none;
  transition: border-color 0.15s;
}
.modal__input:focus {
  border-color: #3B82F6;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}
.modal__input:disabled {
  opacity: 0.6;
}

.modal__error {
  margin-top: 8px;
  font-size: 12px;
  color: #EF4444;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
}

.modal__btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background 0.15s;
}

.modal__btn--cancel {
  background: #F1F5F9;
  color: #475569;
}
.modal__btn--cancel:hover { background: #E2E8F0; }

.modal__btn--start {
  background: #25D366;
  color: #fff;
}
.modal__btn--start:hover { background: #20bd5a; }
.modal__btn--start:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ===== MOBILE RESPONSIVENESS ===== */

.chat__back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: #64748B;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.chat__back-btn:hover {
  background: rgba(0,0,0,0.04);
}

/* On mobile the chat panel is hidden by default, visible when a contact is tapped */
.chat--visible {
  /* only used for mobile logic via JS class binding */
}

/* ===== MESSAGE FILTER BAR ===== */
.chat__filter-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: #F8F7F4;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
  z-index: 1;
}

.filter-pill {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #94A3B8;
  cursor: pointer;
  transition: all 0.15s ease;
}

.filter-pill:hover {
  background: rgba(30, 41, 59, 0.04);
  color: #64748B;
}

.filter-pill--active {
  background: rgba(30, 41, 59, 0.06);
  color: #334155;
  border-color: rgba(30, 41, 59, 0.1);
}

/* ===== MESSAGE WRAPPER ===== */
.msg__wrapper {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 65%;
}

.msg--in .msg__wrapper {
  align-items: flex-start;
}

.msg--out .msg__wrapper {
  align-items: flex-end;
}

.msg--in .msg__wrapper .bubble,
.msg--out .msg__wrapper .bubble {
  max-width: 100%;
}

/* ===== INLINE APPROVAL ===== */
.approval-note-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 6px;
  font-size: 10px;
  font-family: inherit;
  color: #334155;
  background: rgba(255, 255, 255, 0.6);
  outline: none;
  transition: border-color 0.15s;
}

.approval-note-input::placeholder {
  color: #94a3b8;
}

.approval-note-input:focus {
  border-color: rgba(139, 92, 246, 0.5);
  background: #fff;
}

.bubble__approval {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(139, 92, 246, 0.15);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bubble__approval--resolving {
  opacity: 0.7;
}

.bubble__approval-actions {
  display: flex;
  gap: 6px;
}

.approval-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.approval-btn--approve {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.3);
  color: #16a34a;
}

.approval-btn--approve:hover {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.5);
}

.approval-btn--reject {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.2);
  color: #dc2626;
}

.approval-btn--reject:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.4);
}

.approval-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: none;
  border: none;
  font-size: 10px;
  color: #8b5cf6;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.approval-link:hover {
  opacity: 1;
}

.approval-status {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
}

.approval-status--approved {
  color: #16a34a;
}

.approval-status--rejected {
  color: #dc2626;
}


/* ===== AGENT NOTES (collapsed) ===== */
.msg--note {
  display: flex;
  justify-content: center;
  padding: 2px 40px;
}

.agent-note {
  max-width: 80%;
  cursor: pointer;
  user-select: none;
}

.agent-note__indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.05);
  transition: background 0.15s ease;
}

.agent-note__indicator:hover {
  background: rgba(0, 0, 0, 0.05);
}

.agent-note__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3B82F6;
  flex-shrink: 0;
}

.agent-note__label {
  font-size: 11px;
  color: #64748B;
  font-weight: 500;
}

.agent-note__time {
  font-size: 10px;
  color: #94A3B8;
}

.agent-note__chevron {
  color: #94A3B8;
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.agent-note__chevron--open {
  transform: rotate(180deg);
}

.agent-note__content {
  margin-top: 6px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  font-size: 12px;
  color: #64748B;
  line-height: 1.5;
}

.agent-note__icon {
  color: #94A3B8;
  flex-shrink: 0;
}

.agent-note__text {
  word-break: break-word;
}

/* Approval action card */
.msg--approval-card {
  display: flex;
  justify-content: center;
  padding: 4px 24px;
}

.approval-card {
  max-width: 88%;
  width: 100%;
  background: rgba(245, 158, 11, 0.04);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 10px;
  padding: 10px 14px;
  transition: all 0.15s ease;
}

.approval-card--resolved {
  background: rgba(0, 0, 0, 0.02);
  border-color: rgba(0, 0, 0, 0.06);
}

.approval-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: #D97706;
}

.approval-card--resolved .approval-card__header {
  color: #94A3B8;
}

.approval-card__title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #D97706;
}

.approval-card__title--approved {
  color: #10B981;
}

.approval-card__title--rejected {
  color: #EF4444;
}

.approval-card__time {
  font-size: 10px;
  color: #94A3B8;
  margin-left: auto;
}

.approval-card__body {
  font-size: 12px;
  color: #64748B;
  line-height: 1.5;
  margin-bottom: 8px;
  word-break: break-word;
}

.approval-card__actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Internal messages (dashed) — agent notes + operator instructions */
.internal-msg {
  max-width: 75%;
  border: 1px dashed rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  padding: 8px 12px;
  background: transparent;
}

.internal-msg__text {
  font-size: 12px;
  color: #64748B;
  line-height: 1.5;
  word-break: break-word;
}

.internal-msg__steps {
  margin: 0;
  padding: 0 0 0 18px;
  font-size: 12px;
  color: #64748B;
  line-height: 1.5;
  word-break: break-word;
}

.internal-msg__step {
  padding: 2px 0;
}

.internal-msg__step + .internal-msg__step {
  border-top: 1px dashed rgba(0, 0, 0, 0.06);
  margin-top: 4px;
  padding-top: 6px;
}

.internal-msg__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.internal-msg__who {
  font-size: 10px;
  font-weight: 600;
  color: #94A3B8;
  text-transform: lowercase;
}

.internal-msg__time {
  font-size: 10px;
  color: #94A3B8;
}

.internal-msg__approval {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(139, 92, 246, 0.12);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.approval-detail {
  background: rgba(139, 92, 246, 0.04);
  border: 1px solid rgba(139, 92, 246, 0.12);
  border-radius: 8px;
  padding: 8px 10px;
}

.approval-detail__header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #7C3AED;
}

.approval-detail__tool {
  font-size: 11px;
  font-weight: 600;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.approval-detail__badge {
  margin-left: auto;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.1);
  color: #D97706;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.approval-detail__args {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.approval-detail__arg {
  display: flex;
  gap: 4px;
  font-size: 10px;
  line-height: 1.4;
}

.approval-detail__arg-key {
  color: #7C3AED;
  font-weight: 500;
  flex-shrink: 0;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.approval-detail__arg-val {
  color: #475569;
  word-break: break-word;
}

.internal-msg__approval-btns {
  display: flex;
  gap: 6px;
}

.internal-msg__approval-status {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.internal-msg__approval-status--approved {
  color: #10B981;
}

.internal-msg__approval-status--rejected {
  color: #EF4444;
}

.internal-msg__approval-resolved {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.internal-msg__approval-resolving {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #94A3B8;
}

.approval-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(139, 92, 246, 0.2);
  border-top-color: #8B5CF6;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .app {
    flex-direction: column;
    position: relative;
  }

  .sidebar {
    width: 100%;
    height: 100vh;
    flex-shrink: 0;
    border-right: none;
  }

  .sidebar--hidden {
    display: none;
  }

  .chat {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100vh;
    z-index: 10;
    display: none;
  }

  .chat--visible {
    display: flex;
  }

  .chat__messages {
    padding: 12px 4%;
  }

  .bubble {
    max-width: 80%;
  }

  .chat__input-bar {
    margin: 6px 8px 8px;
    padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
  }

  .chat__header {
    padding-top: env(safe-area-inset-top, 0px);
  }

  .sidebar__header {
    padding-top: env(safe-area-inset-top, 0px);
  }
}

/* ===== DELETE CONFIRMATION ===== */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-dialog {
  background: #fff;
  border-radius: 12px;
  padding: 20px 24px;
  max-width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.confirm-dialog__text {
  margin: 0 0 16px;
  font-size: 13px;
  color: #1E293B;
  line-height: 1.5;
}

.confirm-dialog__btns {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.confirm-dialog__btn {
  padding: 6px 16px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.confirm-dialog__btn--cancel {
  background: #F1F5F9;
  color: #64748B;
}

.confirm-dialog__btn--cancel:hover {
  background: #E2E8F0;
}

.confirm-dialog__btn--delete {
  background: #EF4444;
  color: #fff;
}

.confirm-dialog__btn--delete:hover {
  background: #DC2626;
}
</style>
