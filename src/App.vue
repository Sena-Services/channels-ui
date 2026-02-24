<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'

// ── Agent from URL param ──
// Pass ?agent=Sales+Agent+External when embedding the iframe.
// Falls back to showing all std:wa:* instances when no agent is specified.
const agentName = new URLSearchParams(window.location.search).get('agent') || null

// ── State ──
const activePlatform = ref('whatsapp')
const selectedContactId = ref(null)
const messageInput = ref('')
const messageListRef = ref(null)
const showTyping = ref(false)
const loading = ref(true)
const loadingMessages = ref(false)
const error = ref(null)

// ── Data ──
const contacts = ref([])
const messagesCache = ref({}) // instanceName → array of UI message objects

const avatarColors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#EF4444', '#6366F1']

const platforms = [
  { id: 'whatsapp', label: 'WhatsApp', icon: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347' },
  { id: 'instagram', label: 'Instagram', icon: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z' },
  { id: 'email', label: 'Email', icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z' },
]

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

  // Step 1: if we already have a sid, verify it's still valid
  if (_sid) {
    try {
      const resp = await fetch('/api/method/sena_agents_backend.sena_agents_backend.api.auth.get_csrf_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sid: _sid }),
      })
      if (resp.ok) {
        const data = await resp.json()
        if (data.message?.user && data.message.user !== 'Guest') {
          if (data.message?.csrf_token) _csrfToken = data.message.csrf_token
          console.log('[channels-ui] ensureAuth: existing sid valid, user =', data.message.user)
          return
        }
      }
    } catch {}
    _sid = null
  }

  // Step 2: login — proxy exposes sid via x-frappe-sid response header
  console.log('[channels-ui] ensureAuth: logging in...')
  try {
    const loginResp = await fetch('/api/method/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ usr: 'Administrator', pwd: 'Admin123' }),
    })
    const loginData = await loginResp.json()
    console.log('[channels-ui] ensureAuth: login', loginResp.status, loginData?.message)

    // The vite proxy sets x-frappe-sid so JS can read it (bypasses HttpOnly + cookie blocking)
    const sid = loginResp.headers.get('x-frappe-sid')
    console.log('[channels-ui] ensureAuth: x-frappe-sid =', sid ? sid.slice(0, 12) + '...' : null)
    if (sid) _sid = sid

    // Step 3: get CSRF token with the new sid
    const csrfResp = await fetch('/api/method/sena_agents_backend.sena_agents_backend.api.auth.get_csrf_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sid: _sid }),
    })
    if (csrfResp.ok) {
      const data = await csrfResp.json()
      console.log('[channels-ui] ensureAuth: user after login =', data.message?.user)
      if (data.message?.csrf_token) _csrfToken = data.message.csrf_token
    }
  } catch (e) {
    console.warn('[channels-ui] ensureAuth: login failed', e)
  }
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
async function loadInstances() {
  loading.value = true
  error.value = null
  console.log('[channels-ui] loadInstances: start, agentName =', agentName)
  try {
    const filters = [['instance_id', 'like', 'std:wa:%']]
    if (agentName) filters.push(['agent_name', '=', agentName])

    const rows = await frappe('frappe.client.get_list', {
      doctype: 'Runtime Instance',
      filters,
      fields: ['name', 'instance_id', 'agent_name', 'last_activity', 'message_count', 'title', 'status'],
      order_by: 'last_activity desc',
      limit: 50,
    })

    contacts.value = (rows || []).map((row, idx) => {
      const phone = formatPhone(row.instance_id)
      return {
        id: row.name,           // instance name (doc id)
        instanceId: row.instance_id,
        name: phone,
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
    if (contacts.value.length > 0 && !selectedContactId.value) {
      selectedContactId.value = contacts.value[0].id
    }
  } catch (e) {
    console.error('[channels-ui] loadInstances FAILED:', e?.message || e)
    error.value = 'Could not load conversations. Make sure you are logged into Sena.'
  } finally {
    loading.value = false
  }
}

// ── Load messages for selected instance ──
async function loadMessages(instanceName, silent = false) {
  if (!silent && messagesCache.value[instanceName]) {
    // Already have data — still refresh in background but don't show spinner
  }
  if (!silent) loadingMessages.value = true
  try {
    const rows = await frappe('frappe.client.get_list', {
      doctype: 'Runtime Message',
      filters: [['instance', '=', instanceName]],
      fields: ['name', 'role', 'content', 'tool_calls', 'creation'],
      order_by: 'creation asc',
      limit: 200,
    })

    const contact = contacts.value.find(c => c.id === instanceName)
    const agentName = contact?.agentName || 'Agent'

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
        uiMsgs.push({
          id: row.name,
          type: 'text',
          text: cleanText,
          sender: 'user',
          time: timeStr,
          read: true,
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

        // Show the actual message sent to the user (from tool call args)
        if (sentText) {
          uiMsgs.push({
            id: row.name,
            type: 'agent',
            text: sentText,
            sender: 'agent',
            time: timeStr,
            isAI: true,
            agentName,
            agentTool: toolLabel || null,
          })
        } else if (sentVoice) {
          uiMsgs.push({
            id: row.name,
            type: 'voice',
            text: sentVoice,
            sender: 'agent',
            time: timeStr,
            isAI: true,
            agentName,
          })
        } else if (row.content) {
          // Fallback: show agent content if no WA send tool was called
          uiMsgs.push({
            id: row.name,
            type: 'agent',
            text: row.content,
            sender: 'agent',
            time: timeStr,
            isAI: true,
            agentName,
            agentTool: toolLabel || null,
          })
        }
      }
    }

    // Update contact's lastMsg with the last user message
    const lastUserMsg = [...(rows || [])].reverse().find(r => r.role === 'user')
    if (lastUserMsg && contact) {
      contact.lastMsg = (lastUserMsg.content || '').slice(0, 60)
    }

    const prevCount = messagesCache.value[instanceName]?.length || 0
    messagesCache.value[instanceName] = uiMsgs
    // Auto-scroll if new messages arrived
    if (uiMsgs.length > prevCount && instanceName === selectedContactId.value) {
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
const selectedMessages = computed(() => messagesCache.value[selectedContactId.value] || [])
const badgeConfig = computed(() => statusConfig.default)

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
  await loadMessages(id)
  scrollToBottom()
}

const sendMessage = () => {
  if (!messageInput.value.trim() || !selectedContactId.value) return
  const id = selectedContactId.value
  if (!messagesCache.value[id]) messagesCache.value[id] = []
  messagesCache.value[id].push({
    id: Date.now(),
    type: 'text',
    text: messageInput.value,
    sender: 'user',
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    read: false,
  })
  messageInput.value = ''
  showTyping.value = true
  setTimeout(() => { showTyping.value = false }, 2200)
  scrollToBottom()
}

// ── Lifecycle ──
let _pollInterval = null

onMounted(async () => {
  await ensureAuth()
  await loadInstances()
  if (selectedContactId.value) {
    await loadMessages(selectedContactId.value)
    scrollToBottom()
  }
  // Poll active conversation every 3 seconds for real-time updates
  _pollInterval = setInterval(async () => {
    if (selectedContactId.value) {
      await loadMessages(selectedContactId.value, true) // silent = no spinner
    }
  }, 3000)
})

onUnmounted(() => {
  if (_pollInterval) clearInterval(_pollInterval)
})

watch(selectedContactId, async (id) => {
  if (id) {
    await loadMessages(id)
    scrollToBottom()
  }
})
</script>

<template>
  <div class="app">

    <!-- ===== SIDEBAR ===== -->
    <aside class="sidebar">
      <!-- Header -->
      <div class="sidebar__header">
        <div class="sidebar__brand">
          <div class="sidebar__brand-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421-12.421a9.965 9.965 0 00-5.384 1.562L3.6 3.6l-.563 3.067A9.965 9.965 0 002 12c0 5.523 4.477 10 10 10s10-4.477 10-10S17.523 2 12 2c-.018 0-.036.001-.054.001a9.99 9.99 0 00-.895-.04z"/></svg>
          </div>
          <span class="sidebar__brand-name">Channels</span>
        </div>
        <div class="sidebar__header-actions">
          <button class="sidebar__icon-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </button>
          <button class="sidebar__icon-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>
      </div>

      <!-- Platform tabs -->
      <div class="sidebar__tabs">
        <button
          v-for="p in platforms"
          :key="p.id"
          :class="['sidebar__tab', { 'sidebar__tab--active': activePlatform === p.id }]"
          @click="activePlatform = p.id"
        >
          <svg class="sidebar__tab-icon" width="13" height="13" viewBox="0 0 24 24" :fill="p.id === 'email' ? 'currentColor' : 'none'" :stroke="p.id === 'email' ? 'none' : 'currentColor'" stroke-width="1.5"><path :d="p.icon"/></svg>
          {{ p.label }}
        </button>
      </div>

      <!-- Search -->
      <div class="sidebar__search">
        <svg class="sidebar__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="text" class="sidebar__search-input" placeholder="Search or start new chat" />
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
          v-for="contact in contacts"
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
            <div class="contact__row3">
              <span class="contact__company">{{ contact.company }}</span>
              <span class="contact__status" :style="{ color: statusConfig.default.color, background: statusConfig.default.bg }">{{ contact.status }}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- ===== CHAT ===== -->
    <main class="chat" v-if="selectedContact">

      <!-- Chat header -->
      <div class="chat__header">
        <div class="chat__header-left">
          <div class="chat__avatar" :style="{ background: selectedContact.color }">
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
          <button class="chat__header-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.13 2.18 2 2 0 012.11 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          </button>
          <button class="chat__header-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          </button>
          <span class="chat__pipeline-badge" :style="{ color: statusConfig.default.color, background: statusConfig.default.bg }">
            {{ selectedContact.status }}
          </span>
        </div>
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

          <!-- User text bubble -->
          <div v-else-if="msg.type === 'text' && msg.sender === 'user'" class="msg msg--out">
            <div class="bubble bubble--out">
              <div class="bubble__text" v-html="renderText(msg.text)"></div>
              <div class="bubble__meta">
                <span class="bubble__time">{{ msg.time }}</span>
                <span class="bubble__ticks" :class="{ 'bubble__ticks--read': msg.read }">
                  <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                    <path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M5 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </div>
            </div>
          </div>

          <!-- Agent AI bubble -->
          <div v-else-if="msg.type === 'agent'" class="msg msg--in">
            <div class="bubble bubble--in">
              <div class="bubble__agent-header">
                <span class="bubble__agent-dot"></span>
                <span class="bubble__agent-name">{{ msg.agentName }}</span>
                <template v-if="msg.agentTool">
                  <span class="bubble__agent-sep">·</span>
                  <span class="bubble__agent-tool">{{ msg.agentTool }}</span>
                </template>
              </div>
              <div class="bubble__text" v-html="renderText(msg.text)"></div>
              <div class="bubble__meta">
                <span class="bubble__time">{{ msg.time }}</span>
              </div>
            </div>
          </div>

          <!-- Voice note -->
          <div v-else-if="msg.type === 'voice'" class="msg" :class="msg.sender === 'user' ? 'msg--out' : 'msg--in'">
            <div class="bubble" :class="msg.sender === 'user' ? 'bubble--out' : 'bubble--in'">
              <div class="voice">
                <div class="voice__play">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
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
                <span v-if="msg.sender === 'user'" class="bubble__ticks" :class="{ 'bubble__ticks--read': msg.read }">
                  <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5l3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
              </div>
            </div>
          </div>

          <!-- Image -->
          <div v-else-if="msg.type === 'image'" class="msg" :class="msg.sender === 'user' ? 'msg--out' : 'msg--in'">
            <div class="bubble bubble--media" :class="msg.sender === 'user' ? 'bubble--out' : 'bubble--in'">
              <div class="img-frame" :style="{ background: msg.gradient }">
                <svg class="img-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                <div class="img-meta">
                  <span class="bubble__time" style="color:rgba(255,255,255,0.9);">{{ msg.time }}</span>
                </div>
              </div>
              <div v-if="msg.caption" class="img-caption">{{ msg.caption }}</div>
            </div>
          </div>

          <!-- Document -->
          <div v-else-if="msg.type === 'document'" class="msg" :class="msg.sender === 'user' ? 'msg--out' : 'msg--in'">
            <div class="bubble" :class="msg.sender === 'user' ? 'bubble--out' : 'bubble--in'">
              <div class="doc">
                <div class="doc__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </div>
                <div class="doc__body">
                  <div class="doc__name">{{ msg.filename }}</div>
                  <div class="doc__meta">{{ msg.filesize }} · PDF</div>
                </div>
                <button class="doc__dl">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
              </div>
              <div class="bubble__meta">
                <span class="bubble__time">{{ msg.time }}</span>
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

      <!-- Input bar -->
      <div class="chat__input-bar">
        <button class="input-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>
        <button class="input-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <div class="input-wrap">
          <input
            v-model="messageInput"
            type="text"
            class="input-field"
            placeholder="Type a message"
            @keyup.enter="sendMessage"
          />
        </div>
        <button class="input-btn input-btn--send" @click="sendMessage">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>

    </main>
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
  padding: 8px 12px;
  background: #F8F7F4;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar__brand-icon {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #3B82F6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sidebar__brand-name {
  font-size: 13px;
  font-weight: 600;
  color: #1E293B;
  letter-spacing: -0.01em;
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
}

.sidebar__search-icon {
  position: absolute;
  left: 22px;
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

.contact--active {
  background: rgba(59,130,246,0.06);
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

.contact__company {
  font-size: 10px;
  color: #94A3B8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
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

.chat__pipeline-badge {
  font-size: 8.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
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
  box-shadow: 0 1px 2px rgba(0,0,0,0.07);
  word-break: break-word;
}

.bubble--out {
  background: #EEF2FF;
  border: 1px solid rgba(59,130,246,0.12);
  border-radius: 8px 0 8px 8px;
}

.bubble--in {
  background: #FFFFFF;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 0 8px 8px 8px;
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
  gap: 5px;
  margin-bottom: 5px;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.bubble__agent-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #3B82F6;
  flex-shrink: 0;
}

.bubble__agent-name {
  font-size: 10.5px;
  font-weight: 600;
  color: #3B82F6;
}

.bubble__agent-sep {
  color: #CBD5E1;
  font-size: 10.5px;
}

.bubble__agent-tool {
  font-size: 10px;
  color: #94A3B8;
  font-family: 'SF Mono', 'Fira Code', monospace;
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

/* ===== INPUT BAR — matches Sena ChatInput ===== */
.chat__input-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px 12px;
  background: #F5F4EF;
  flex-shrink: 0;
  z-index: 1;
}

.input-btn {
  width: 34px;
  height: 34px;
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
  padding: 10px 14px;
  background: linear-gradient(135deg, #FFFEFB 0%, #FBF9F5 100%);
  border: 1.5px solid rgba(30,41,59,0.18);
  border-radius: 1rem;
  font-size: 13.5px;
  color: #1E293B;
  outline: none;
  font-family: inherit;
  box-shadow: 0 2px 8px -2px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-field::placeholder {
  color: #94A3B8;
}

.input-field:focus {
  border-color: rgba(30,41,59,0.35);
  box-shadow: 0 4px 12px -2px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,1), 0 0 0 3px rgba(30,41,59,0.06);
}

.input-btn--send {
  background: #3B82F6;
  color: white;
  border-radius: 50%;
}

.input-btn--send:hover {
  background: #2563EB;
  color: white;
}
</style>
