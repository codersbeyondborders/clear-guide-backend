import os
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import storage

# Initialize Firebase
if not firebase_admin._apps:
    firebase_admin.initialize_app()


security = HTTPBearer(auto_error=False)

async def verify_agent_secret(credentials: HTTPAuthorizationCredentials = Depends(security), request: Request = None):
    """
    Middleware to verify that the request comes from an authorized caller 
    (like the API Gateway or Cloud Tasks) by checking the shared AGENT_MESH_SECRET.
    """
    secret = os.getenv("AGENT_MESH_SECRET")
    is_dev = os.getenv("ENVIRONMENT") == "development" or os.getenv("NODE_ENV") != "production"
    
    if secret:
        if not credentials or credentials.scheme.lower() != "bearer" or credentials.credentials != secret:
            raise HTTPException(status_code=403, detail="Unauthorized task request: Invalid or missing Agent Mesh Secret")
    elif not is_dev:
        # Require secret in production
        raise HTTPException(status_code=500, detail="AGENT_MESH_SECRET is not configured in production")
        
    return True
