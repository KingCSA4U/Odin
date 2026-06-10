import httpx

def get_brawlhalla_ranked_stats(brawlhalla_id: str) -> dict:
    """Fetches ranked stats for a given Brawlhalla ID."""

    url = f"https://api.brawlhalla.com/v1/player/stats?brawlhalla_id={brawlhalla_id}&mode=ranked_1v1"
    
    try:

        response = httpx.get(url, timeout=5.0) 
        
 
        if response.status_code == 404:
            return {"error": "Player not found. Check the ID."}
            
        response.raise_for_status()
        return response.json()
        
    except httpx.TimeoutException:
        return {"error": "Request timed out. Try again."}
    except httpx.RequestError:
        return {"error": "Could not reach Brawlhalla servers."}
