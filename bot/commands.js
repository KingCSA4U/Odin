const fetch = require('node-fetch')


// ─────────────────────────────────────────
// Flask API helper
// ─────────────────────────────────────────

/**
 * Makes a request to the Flask backend.
 * Returns the parsed JSON response, or a fallback error message on failure.
 */
async function callFlask(flaskBase, method, endpoint, body = null) {
    try {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        }
        if (body) options.body = JSON.stringify(body)

        const res = await fetch(`${flaskBase}${endpoint}`, options)
        return await res.json()
    } catch (err) {
        console.error(`[flask] ${method} ${endpoint} failed:`, err.message)
        return { message: '❌ Bot backend is unreachable. Try again later.' }
    }
}


// ─────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────

/**
 * Sends a quoted reply into the same chat the command came from.
 * Quoting keeps the bot's response visually tied to the trigger message.
 */
async function reply(sock, msg, text) {
    await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}


/**
 * Extracts the first @mentioned JID from a Baileys message.
 * Returns null if no mention is present.
 */
function getMentionedId(msg) {
    const mentioned =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
    return mentioned?.[0] || null
}


// ─────────────────────────────────────────
// Command handlers
// ─────────────────────────────────────────

/**
 * .register [brawlhalla_id]
 * Links the sender's WhatsApp ID to their Brawlhalla account.
 */
async function handleRegister({ sock, msg, args, senderId, flaskBase }) {
    const brawlhallaId = args[0]

    if (!brawlhallaId) {
        return reply(sock, msg, '❌ Usage: .register [brawlhalla_id]')
    }

    const data = await callFlask(flaskBase, 'POST', '/api/commands/register', {
        whatsapp_id: senderId,
        brawlhalla_id: brawlhallaId,
    })

    await reply(sock, msg, data.message)
}


/**
 * .stats
 * Fetches live ranked stats for the sender.
 */
async function handleStats({ sock, msg, senderId, flaskBase }) {
    const data = await callFlask(flaskBase, 'POST', '/api/commands/stats', {
        whatsapp_id: senderId,
    })

    await reply(sock, msg, data.message)
}


/**
 * .warn @user [reason]   (admin only)
 * Issues a warning. Kicks the user automatically on their 3rd.
 */
async function handleWarn({ sock, msg, args, chatId, isAdmin, flaskBase }) {
    if (!isAdmin) {
        return reply(sock, msg, '🚫 Only admins can warn members.')
    }

    const targetId = getMentionedId(msg)

    if (!targetId) {
        return reply(sock, msg, '❌ Usage: .warn @user [reason]')
    }

    // args[0] is the raw @mention text; everything after is the reason
    const reason = args.slice(1).join(' ').trim() || 'Breaking rules'

    const data = await callFlask(flaskBase, 'POST', '/api/commands/warn', {
        whatsapp_id: targetId,
        reason,
    })

    await reply(sock, msg, data.message)

    // Flask returns action: 'kick' when the user hits 3 warnings
    if (data.action === 'kick') {
        try {
            await sock.groupParticipantsUpdate(chatId, [targetId], 'remove')
        } catch (err) {
            console.error(`[warn] Auto-kick failed for ${targetId}:`, err.message)
            await reply(sock, msg, '⚠️ Auto-kick failed — please remove them manually.')
        }
    }
}


/**
 * .warnings          — check your own warnings
 * .warnings @user    — admins can check anyone
 */
async function handleWarnings({ sock, msg, senderId, isAdmin, flaskBase }) {
    let targetId = senderId

    if (isAdmin) {
        const mentioned = getMentionedId(msg)
        if (mentioned) targetId = mentioned
    }

    const data = await callFlask(
        flaskBase,
        'GET',
        `/api/commands/warnings?whatsapp_id=${encodeURIComponent(targetId)}`
    )

    await reply(sock, msg, data.message)
}


/**
 * .leaderboard
 * Shows top 10 players in the group by cached Elo rating.
 */
async function handleLeaderboard({ sock, msg, flaskBase }) {
    const data = await callFlask(flaskBase, 'GET', '/api/commands/leaderboard')
    await reply(sock, msg, data.message)
}


/**
 * .help
 * Lists available commands. Admins see the extra moderation commands.
 */
async function handleHelp({ sock, msg, isAdmin }) {
    const lines = [
        '🎮 *BrawlBot Commands*\n',
        '`.register [id]`  — Link your Brawlhalla ID',
        '`.stats`          — Your live ranked stats',
        '`.leaderboard`    — Top 10 in this group',
        '`.warnings`       — Check your warning count',
    ]

    if (isAdmin) {
        lines.push(
            '\n🛡️ *Admin Commands*',
            '`.warn @user [reason]`  — Warn a member (3 = kick)',
            '`.warnings @user`       — Check any member\'s warnings',
        )
    }

    await reply(sock, msg, lines.join('\n'))
}


// ─────────────────────────────────────────
// Command router
// ─────────────────────────────────────────

const COMMAND_MAP = {
    '.register':    handleRegister,
    '.stats':       handleStats,
    '.warn':        handleWarn,
    '.warnings':    handleWarnings,
    '.leaderboard': handleLeaderboard,
    '.help':        handleHelp,
}

/**
 * Entry point called by index.js for every dot-command message.
 * Parses the command + args, looks up the handler, and calls it.
 * Wraps everything in a try/catch so a broken handler can't kill the bot.
 */
async function handleCommand({ sock, msg, text, senderId, chatId, isAdmin, flaskBase }) {
    const parts   = text.trim().split(/\s+/)
    const command = parts[0].toLowerCase()
    const args    = parts.slice(1)

    const handler = COMMAND_MAP[command]
    if (!handler) return     // unknown command — ignore silently

    try {
        await handler({ sock, msg, args, senderId, chatId, isAdmin, flaskBase })
    } catch (err) {
        console.error(`[commands] Unhandled error in "${command}":`, err.message)
        await reply(sock, msg, '❌ Something went wrong. Try again.')
    }
}

module.exports = { handleCommand }