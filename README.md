# ⚔️ Odin - Brawlhalla WhatsApp Bot

Odin is a specialized WhatsApp bot designed for Brawlhalla communities. It allows players to link their in-game IDs, track their ranked statistics, and compete on a community leaderboard. It also features a robust moderation system for group admins.

## 🚀 Features

- **Ranked Stats**: Fetch live 1v1 ranked Elo and tier directly from Brawlhalla.
- **Community Leaderboard**: A daily-cached leaderboard showing the top 10 players in the group.
- **Auto-Moderation**: A warning system that automatically kicks users after 3 violations.
- **Secure API**: Bot-to-backend communication secured with an API key.
- **Database Migrations**: Built with Flask-Migrate for easy schema updates and database transitions (SQLite to PostgreSQL).

---

## 🛠️ Technology Stack

- **Bot**: Node.js, [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web API).
- **Backend**: Python, Flask, SQLAlchemy.
- **Database**: SQLite (Development) / PostgreSQL (Production ready).

---

## 📋 Commands

### User Commands
- `!register [ID]` — Link your WhatsApp account to your Brawlhalla ID.
- `!unregister` — Unlink your account.
- `!stats [@user]` — View live ranked stats for yourself or a mentioned user.
- `!leaderboard` — View the top 10 players in the community (Cached).
- `!warnings` — Check your current warning count.
- `!help` — List all available commands.

### Admin Commands
- `!warn @user [reason]` — Issue a warning to a member.
- `!kick @user` — Immediately remove a user from the group.
- `!warnings @user` — Check the warning history of any member.
- `!refresh` — Manually trigger a refresh of the leaderboard stats.

---

## ⚙️ Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- [Python](https://www.python.org/) (v3.10+)
- A WhatsApp account to use as the bot.

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
API_SECRET_KEY=your_secure_secret_key
DATABASE_URL=sqlite:///test.db
FLASK_BASE_URL=http://localhost:5000
```

### 3. Backend Setup (API)
```bash
cd api
python -m venv .venv
# Activate venv: .venv\Scripts\activate (Windows) or source .venv/bin/activate (Linux/Mac)
pip install -r ../requirements.txt
flask db upgrade
python app.py
```

### 4. Bot Setup
```bash
cd bot
npm install
node index.js
```
*On first run, scan the QR code in your terminal with WhatsApp to log in.*

---

## 🛡️ Security & Caching

- **Caching**: To avoid Brawlhalla API rate limits, the leaderboard uses a cached Elo system. It is updated passively when users check their stats and can be updated in bulk via `!refresh`.
- **API Security**: The Flask backend requires a valid `X-API-KEY` header, which must match the `API_SECRET_KEY` in your `.env`.

---

## 📜 License
This project is licensed under the ISC License.
