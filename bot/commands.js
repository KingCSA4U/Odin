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
            headers: { 
                'Content-Type': 'application/json',
                'X-API-KEY': process.env.API_SECRET_KEY || 'default-secret-key'
            },
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
 * !register [brawlhalla_id]
 * Links the sender's WhatsApp ID to their Brawlhalla account.
 */
async function handleRegister({ sock, msg, args, senderId, flaskBase }) {
    const brawlhallaId = args[0]

    if (!brawlhallaId) {
        return reply(sock, msg, '❌ Usage: !register [brawlhalla_id]')
    }

    const data = await callFlask(flaskBase, 'POST', '/api/commands/register', {
        whatsapp_id: senderId,
        brawlhalla_id: brawlhallaId,
    })

    await reply(sock, msg, data.message)
}

/**
 * !unregister
 * Removes the link between the sender's WhatsApp ID and Brawlhalla account.
 */
async function handleUnregister({ sock, msg, senderId, flaskBase }) {
    const data = await callFlask(flaskBase, 'POST', '/api/commands/unregister', {
        whatsapp_id: senderId,
    })

    await reply(sock, msg, data.message)
}


/**
 * !stats [@user]
 * Fetches live ranked stats for the sender or a mentioned user.
 */
async function handleStats({ sock, msg, senderId, isAdmin, flaskBase }) {
    let targetId = senderId
    
    // Allow checking others if mentioned
    const mentioned = getMentionedId(msg)
    if (mentioned) {
        targetId = mentioned
    }

    const data = await callFlask(flaskBase, 'POST', '/api/commands/stats', {
        whatsapp_id: targetId,
    })

    await reply(sock, msg, data.message)
}


/**
 * !warn @user [reason]   (admin only)
 * Issues a warning. Kicks the user automatically on their 3rd.
 */
async function handleWarn({ sock, msg, args, chatId, isAdmin, flaskBase }) {
    if (!isAdmin) {
        return reply(sock, msg, '🚫 Only admins can warn members.')
    }

    const targetId = getMentionedId(msg)

    if (!targetId) {
        return reply(sock, msg, '❌ Usage: !warn @user [reason]')
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
 * !kick @user   (admin only)
 * Kicks a user from the group.
 */
async function handleKick({ sock, msg, chatId, isAdmin, flaskBase }) {
    if (!isAdmin) {
        return reply(sock, msg, '🚫 Only admins can kick members.')
    }

    const targetId = getMentionedId(msg)

    if (!targetId) {
        return reply(sock, msg, '❌ Usage: !kick @user')
    }

    const data = await callFlask(flaskBase, 'POST', '/api/commands/kick', {
        whatsapp_id: targetId,
    })

    await reply(sock, msg, data.message)

    if (data.action === 'kick') {
        try {
            await sock.groupParticipantsUpdate(chatId, [targetId], 'remove')
        } catch (err) {
            console.error(`[kick] failed for ${targetId}:`, err.message)
            await reply(sock, msg, '⚠️ Kick failed — please remove them manually.')
        }
    }
}


/**
 * !warnings          — check your own warnings
 * !warnings @user    — admins can check anyone
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
 * !leaderboard
 * Shows top 10 players in the group by cached Elo rating.
 */
async function handleLeaderboard({ sock, msg, flaskBase }) {
    const data = await callFlask(flaskBase, 'GET', '/api/commands/leaderboard')
    await reply(sock, msg, data.message)
}

/**
 * !refresh (admin only)
 * Triggers a full leaderboard refresh.
 */
async function handleRefresh({ sock, msg, isAdmin, flaskBase }) {
    if (!isAdmin) {
        return reply(sock, msg, '🚫 Only admins can refresh the leaderboard.')
    }

    await reply(sock, msg, '⏳ Refreshing leaderboard... this may take a moment.')
    const data = await callFlask(flaskBase, 'POST', '/api/commands/leaderboard/refresh')
    await reply(sock, msg, data.message)
}


/**
 * !whois [@user]
 * Shows basic info about a user (IGN, warnings, etc.)
 */
async function handleWhois({ sock, msg, senderId, flaskBase }) {
    let targetId = senderId
    const mentioned = getMentionedId(msg)
    if (mentioned) targetId = mentioned

    const data = await callFlask(flaskBase, 'POST', '/api/commands/whois', {
        whatsapp_id: targetId,
    })

    await reply(sock, msg, data.message)
}


/**
 * !help
 * Lists available commands. Admins see the extra moderation commands.
 */
async function handleHelp({ sock, msg, isAdmin }) {
    const lines = [
        '⚔️ *Odin Bot Commands*\n',
        '`!register [id]`  — Link your Brawlhalla ID',
        '`!unregister`     — Unlink your Brawlhalla ID',
        '`!stats [@user]`  — Live ranked stats',
        '`!whois [@user]`  — Check a profile',
        '`!leaderboard`    — Top 10 in this group',
        '`!warnings`       — Check your warning count',
    ]

    if (isAdmin) {
        lines.push(
            '\n🛡️ *Admin Commands*',
            '`!warn @user [reason]`  — Warn a member (3 = kick)',
            '`!kick @user`           — Kick a member immediately',
            '`!warnings @user`       — Check any member\'s warnings',
            '`!refresh`              — Update the leaderboard cache',
        )
    }

    await reply(sock, msg, lines.join('\n'))
}


// ─────────────────────────────────────────
// Command router
// ─────────────────────────────────────────

const COMMAND_MAP = {
    '!register':    handleRegister,
    '!unregister':  handleUnregister,
    '!stats':       handleStats,
    '!whois':       handleWhois,
    '!warn':        handleWarn,
    '!kick':        handleKick,
    '!warnings':    handleWarnings,
    '!leaderboard': handleLeaderboard,
    '!refresh':     handleRefresh,
    '!help':        handleHelp,
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