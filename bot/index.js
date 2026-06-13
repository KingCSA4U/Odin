require('dotenv').config()
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys')

const pino = require('pino')
const { handleCommand } = require('./commands')

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────
const FLASK_BASE = process.env.FLASK_BASE_URL || 'http://localhost:5000'
const PHONE = process.env.PHONE


// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

/**
 * Extracts the plain text content from a Baileys message object.
 * Handles standard messages and replies (extendedTextMessage).
 */
function getMessageText(msg) {
    return (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ''
    ).trim()
}


/**
 * Checks whether a sender is an admin in the given group.
 * Returns false on any failure rather than crashing the handler.
 */
async function checkIsAdmin(sock, chatId, senderId) {
    try {
        const meta = await sock.groupMetadata(chatId)
        const participant = meta.participants.find(p => p.id === senderId)
        return participant?.admin != null
    } catch (err) {
        console.error(`[admin-check] Failed for ${senderId}:`, err.message)
        return false
    }
}


// ─────────────────────────────────────────
// Connection
// ─────────────────────────────────────────

async function connectToWhatsApp() {
    console.log('🚀 Initializing Odin...')
    
    console.log('📂 Loading auth state...')
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    
    console.log('🌐 Fetching latest WhatsApp version...')
    const { version } = await fetchLatestBaileysVersion()
    console.log(`✅ Using version: ${version.join('.')}`)

    console.log('🔌 Connecting to WhatsApp...')
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),   // suppress Baileys noise
        printQRInTerminal: true,              // show QR code for pairing
    })

    // Persist auth credentials whenever they change
    sock.ev.on('creds.update', saveCreds)

    // if (!sock.authState.creds.registered) {
    //     try {
    //         console.log('📱 Requesting pairing code...')
    //         const code = await sock.requestPairingCode(process.env.PHONE)
    //         console.log(`Pairing code: ${code}`)
    //     } catch (err) {
    //         console.error('Pairing code error:', err.message)
    //     }
    // }

    // ── Connection lifecycle ──────────────────
    
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('✅ Odin is online!')
            return
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode

            if (statusCode === DisconnectReason.loggedOut) {
                console.log('🔴 Logged out. Delete auth_info and restart.')
                return  // stop — do not reconnect
            }

            if (statusCode === DisconnectReason.connectionClosed) {
                console.log('🔴 Connection closed by WhatsApp. Waiting before retry...')
                return  // stop — do not reconnect
            }

            console.log(`⚠️ Disconnected (code ${statusCode}). Reconnecting...`)
            connectToWhatsApp()
        }
    })
    // ── Incoming messages ─────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // 'notify' = new messages pushed to us; ignore history syncs
        if (type !== 'notify') return

        const msg = messages[0]

        // Skip empty messages and messages sent by the bot itself
        if (!msg?.message || msg.key.fromMe) return

        const chatId = msg.key.remoteJid

        // Group chats only — individual JIDs end in @s.whatsapp.net
        if (!chatId?.endsWith('@g.us')) return

        const text = getMessageText(msg)

        // Commands must start with !
        if (!text.startsWith('!')) return

        // Participant is always present in group messages
        const senderId = msg.key.participant

        const isAdmin = await checkIsAdmin(sock, chatId, senderId)

        console.log(`[cmd] ${senderId} → "${text}" | admin: ${isAdmin}`)

        await handleCommand({
            sock,
            msg,
            text,
            senderId,
            chatId,
            isAdmin,
            flaskBase: FLASK_BASE,
        })
    })
}

// Boot
connectToWhatsApp()