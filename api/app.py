from flask import Flask, jsonify, request
from models import User, Warning, Base
from flask_sqlalchemy_lite import SQLAlchemy
from sqlalchemy import select, delete
from datetime import datetime, timezone, timedelta
from brawlhalla import get_brawlhalla_ranked_stats as fetch_live_ranked_data

db = SQLAlchemy()

def create_app():
    app = Flask(__name__)
    app.config['SQLALCHEMY_ENGINES'] = {
        'default': 'sqlite:///test.db'
    }
    db.init_app(app)
    with app.app_context():
        engines = app.extensions['flask_sqlalchemy_lite'].engines
        Base.metadata.create_all(engines['default'])
    return app

app = create_app()
@app.route('/api/commands/ping', methods=['GET'])
def ping():
    """Simple endpoint to test if the API is responsive."""
    return jsonify({'message': 'Pong!'})

def get_or_create_user(whatsapp_id: str) -> User:
    """
    Finds a user by WhatsApp ID. 
    If they do not exist, lazily creates and commits them to the database.
    """
    user = db.session.scalar(select(User).where(User.whatsapp_id == whatsapp_id))
    
    if not user:
        user = User(whatsapp_id=whatsapp_id)
        db.session.add(user)
        db.session.commit()
        
    return user


def clean_expired_warnings(user_id: int):
    """Deletes warnings older than 30 days using an internal database user ID."""
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)    
    delete_stmt = delete(Warning).where(
        Warning.user_id == user_id,
        Warning.timestamp < thirty_days_ago
    )
    db.session.execute(delete_stmt)
    db.session.commit()
    db.session.expire_all()


@app.route('/api/commands/warn', methods=['POST'])
def warn():
    """Issues a warning to a user."""
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

def get_warnings():
    """Retrieves active warnings for a user."""
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
def register():
    """Links a user's WhatsApp ID to their Brawlhalla ID."""
    data = request.get_json() or {}
    whatsapp_id = data.get('whatsapp_id')
    brawlhalla_id = data.get('brawlhalla_id')

    if not whatsapp_id or not brawlhalla_id:
        return jsonify({'message': 'Usage: .register [brawlhalla_id]'}), 400


    user = get_or_create_user(whatsapp_id)
    

    user.brawlhalla_id = str(brawlhalla_id)
    db.session.commit()

    clean_tag = whatsapp_id.split("@")[0]
    return jsonify({
        'message': f'✅ @{clean_tag} is now linked to Brawlhalla ID: {brawlhalla_id}'
    })


@app.route('/api/commands/stats', methods=['POST'])
def get_stats():
    """Fetches live ranked statistics for a user."""
    data = request.get_json() or {}
    whatsapp_id = data.get('whatsapp_id')

    if not whatsapp_id:
        return jsonify({'message': 'Missing parameter: whatsapp_id'}), 400
    
    user = get_or_create_user(whatsapp_id)

    if not user.brawlhalla_id:
        return jsonify({'message': '❌ You are not registered!'}), 404

    stats = fetch_live_ranked_data(user.brawlhalla_id)
    
    if "error" in stats:
        return jsonify({'message': f"⚠️ {stats['error']}"}), 502

    name = stats.get('name', 'Unknown')
    tier = stats.get('tier', 'Unranked')
    rating = stats.get('rating', 'N/A')
    peak = stats.get('peak_rating', 'N/A')
    wins = stats.get('wins', 0)
    
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
def get_leaderboard():
    """Shows top 10 players in the group by cached Elo rating."""
    # Placeholder implementation - replace with actual leaderboard logic
    return jsonify({'message': 'Top 10 players by Elo rating: WIP ...'})

if __name__ == '__main__':
    app.run(debug=True)
