import os
from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from dotenv import load_dotenv
from sqlalchemy import select, delete
from datetime import datetime, timezone, timedelta
from brawlhalla import get_brawlhalla_ranked_stats as fetch_live_ranked_data

# Load environment variables
load_dotenv()

from models import db, User, Warning

def create_app():
    app = Flask(__name__)
    
    # Configuration
    database_url = os.getenv('DATABASE_URL', 'sqlite:///test.db')
    # Fix for Heroku/older postgres URLs starting with postgres://
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
        
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['API_SECRET_KEY'] = os.getenv('API_SECRET_KEY', 'default-secret-key')

    db.init_app(app)
    Migrate(app, db)
    
    return app

app = create_app()

def require_api_key(f):
    """Decorator to secure API endpoints."""
    def decorated_function(*args, **kwargs):
        api_key = request.headers.get('X-API-KEY')
        if api_key != app.config['API_SECRET_KEY']:
            return jsonify({'message': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

@app.route('/api/commands/ping', methods=['GET'])
def ping():
    return jsonify({'message': 'Pong!'})

def get_or_create_user(whatsapp_id: str) -> User:
    user = db.session.scalar(select(User).where(User.whatsapp_id == whatsapp_id))
    
    if not user:
        user = User(whatsapp_id=whatsapp_id)
        db.session.add(user)
        db.session.commit()
        
    return user

def clean_expired_warnings(user_id: int):
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)    
    delete_stmt = delete(Warning).where(
        Warning.user_id == user_id,
        Warning.timestamp < thirty_days_ago
    )
    db.session.execute(delete_stmt)
    db.session.commit()

@app.route('/api/commands/warn', methods=['POST'])
@require_api_key
def warn():
    data = request.get_json() or {}
    target_id = data.get('whatsapp_id')
    reason = data.get('reason', 'Breaking rules')

    if not target_id:
        return jsonify({'action': 'none', 'message': 'NO TARGET.'}), 400

    user = get_or_create_user(target_id)
    clean_expired_warnings(user.id)

    new_warning = Warning(reason=reason)
    user.warnings.append(new_warning)
    db.session.commit()
    
    total = len(user.warnings)
    clean_tag = target_id.split("@")[0]

    if total >= 3:
        return jsonify({
            'action': 'kick',
            'message': f'❌ @{clean_tag} hit {total}/3 warnings. Goodbye!',
            'target': target_id
        })

    return jsonify({
        'action': 'none',
        'message': f'⚠️ Warning added! (@{clean_tag} now has {total}/3 warnings)'
    })

@app.route('/api/commands/warnings', methods=['GET'])
@require_api_key
def get_warnings():
    target_id = request.args.get('whatsapp_id')
    if not target_id:
        return jsonify({'message': 'Provide a user to check.'}), 400

    user = get_or_create_user(target_id)
    clean_expired_warnings(user.id)
    
    warnings = user.warnings
    
    if not warnings:
        return jsonify({'message': 'This user has a completely clean record! ✅'})

    summary = f"Total Active Warnings: {len(warnings)}/3\n\n"
    for i, w in enumerate(warnings, 1):
        date_str = w.timestamp.strftime('%d-%b')
        summary += f"{i}. [{date_str}] Reason: {w.reason}\n"

    return jsonify({'message': summary.strip()})

@app.route('/api/commands/register', methods=['POST'])
@require_api_key
def register():
    data = request.get_json() or {}
    whatsapp_id = data.get('whatsapp_id')
    brawlhalla_id = data.get('brawlhalla_id')

    if not whatsapp_id or not brawlhalla_id:
        return jsonify({'message': 'Usage: !register [brawlhalla_id]'}), 400

    user = get_or_create_user(whatsapp_id)
    user.brawlhalla_id = str(brawlhalla_id)
    db.session.commit()

    clean_tag = whatsapp_id.split("@")[0]
    return jsonify({
        'message': f'✅ @{clean_tag} is now linked to Brawlhalla ID: {brawlhalla_id}'
    })

@app.route('/api/commands/unregister', methods=['POST'])
@require_api_key
def unregister():
    data = request.get_json() or {}
    whatsapp_id = data.get('whatsapp_id')

    if not whatsapp_id:
        return jsonify({'message': 'Missing parameter: whatsapp_id'}), 400

    user = db.session.scalar(select(User).where(User.whatsapp_id == whatsapp_id))
    if not user or not user.brawlhalla_id:
        return jsonify({'message': '❌ You are not registered!'}), 404

    user.brawlhalla_id = None
    db.session.commit()

    clean_tag = whatsapp_id.split("@")[0]
    return jsonify({'message': f'✅ @{clean_tag} has been unregistered.'})

@app.route('/api/commands/stats', methods=['POST'])
@require_api_key
def get_stats():
    data = request.get_json() or {}
    whatsapp_id = data.get('whatsapp_id')

    if not whatsapp_id:
        return jsonify({'message': 'Missing parameter: whatsapp_id'}), 400
    
    user = get_or_create_user(whatsapp_id)

    if not user.brawlhalla_id:
        return jsonify({'message': '❌ This user is not registered!'}), 404

    stats = fetch_live_ranked_data(user.brawlhalla_id)
    
    if "error" in stats:
        return jsonify({'message': f"⚠️ {stats['error']}"}), 502

    name = stats.get('name', 'Unknown')
    tier = stats.get('tier', 'Unranked')
    rating = stats.get('rating', 0)
    peak = stats.get('peak_rating', 'N/A')
    wins = stats.get('wins', 0)
    
    # Silently update cache whenever someone checks their own stats
    user.last_elo = int(rating)
    user.last_tier = tier
    user.stats_updated_at = datetime.utcnow()
    db.session.commit()
    
    clean_tag = whatsapp_id.split("@")[0]
    
    response_msg = (
        f"📊 *Stats for @{clean_tag}*\n"
        f" *In-Game:* {name}\n"
        f" *Tier:* {tier}\n"
        f" *Elo:* {rating} (Peak: {peak})\n"
        f"⚔️ *Wins:* {wins}"
    )

    return jsonify({'message': response_msg})

@app.route('/api/commands/leaderboard', methods=['GET'])
@require_api_key
def get_leaderboard():
    """Shows top 10 players in the group by cached Elo rating."""
    # Simply query the DB - no external API calls here!
    users = db.session.scalars(
        select(User)
        .where(User.brawlhalla_id != None)
        .order_by(User.last_elo.desc())
        .limit(10)
    ).all()
    
    if not users:
        return jsonify({'message': 'No registered players found.'})

    summary = "🏆 *Top 10 Brawlhalla Players*\n"
    summary += "_Sorted by last known Elo_\n\n"
    
    for i, user in enumerate(users, 1):
        clean_tag = user.whatsapp_id.split("@")[0]
        summary += f"{i}. @{clean_tag}: {user.last_elo} ({user.last_tier})\n"

    return jsonify({'message': summary.strip()})

@app.route('/api/commands/leaderboard/refresh', methods=['POST'])
@require_api_key
def refresh_leaderboard():
    """
    Manually triggers a fresh pull for all users. 
    Best run once a day to keep the leaderboard relevant.
    """
    users = db.session.scalars(select(User).where(User.brawlhalla_id != None)).all()
    updated_count = 0
    
    for user in users:
        stats = fetch_live_ranked_data(user.brawlhalla_id)
        if "error" not in stats:
            try:
                user.last_elo = int(stats.get('rating', 0))
            except (ValueError, TypeError):
                pass
            user.last_tier = stats.get('tier', 'Unranked')
            user.stats_updated_at = datetime.utcnow()
            updated_count += 1
            
            # Small delay to be polite to the Brawlhalla API
            time.sleep(0.5)
            
    db.session.commit()
    return jsonify({'message': f'✅ Leaderboard refreshed. Updated {updated_count} players.'})

@app.route('/api/commands/kick', methods=['POST'])
@require_api_key
def kick_user():
    """Endpoint to trigger a kick action from the bot."""
    data = request.get_json() or {}
    target_id = data.get('whatsapp_id')

    if not target_id:
        return jsonify({'message': 'Missing parameter: whatsapp_id'}), 400

    clean_tag = target_id.split("@")[0]
    return jsonify({
        'action': 'kick',
        'message': f'👢 @{clean_tag} has been removed by an admin.',
        'target': target_id
    })

@app.route('/api/commands/whois', methods=['POST'])
@require_api_key
def whois():
    """Fetches basic info about a user."""
    data = request.get_json() or {}
    target_id = data.get('whatsapp_id')

    if not target_id:
        return jsonify({'message': 'Missing parameter: whatsapp_id'}), 400

    user = db.session.scalar(select(User).where(User.whatsapp_id == target_id))
    
    if not user:
        return jsonify({'message': 'User not found.'}), 404

    clean_tag = target_id.split("@")[0]
    if user.brawlhalla_id:
        ign = fetch_live_ranked_data(user.brawlhalla_id).get('name', 'Unknown')
    else:
        return jsonify({'message': f'👤 @{clean_tag} is not registered with a Brawlhalla ID.'})
    warnings_count = len(user.warnings)
    
    response_msg = (
        f"👤 *Whois @{clean_tag}*\n"
        f"{ign}\n"
        f"Active Warnings: {warnings_count}/3"
    )

    return jsonify({'message': response_msg})

if __name__ == '__main__':
    app.run(debug=False)
