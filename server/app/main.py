from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from bson import ObjectId
from pymongo import MongoClient
import os
import jsonpatch

# ---- Setup ----
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/appdb")
client = MongoClient(MONGO_URI)
db = client.get_default_database()  # "appdb" in compose

app = FastAPI(title="MVP Server", version="0.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev-only
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Models ----
class TemplateIn(BaseModel):
    yaml: str
    name: Optional[str] = None

class TemplateOut(BaseModel):
    id: str
    yaml: str
    name: Optional[str] = None

class ObjectIn(BaseModel):
    doc: Any

class PatchIn(BaseModel):
    patch: List[Dict[str, Any]]

# ---- Helpers ----
def oid(s: str) -> ObjectId:
    try:
        return ObjectId(s)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_id")

# ---- Health ----
@app.get("/health")
def health():
    return {"ok": True}

@app.get("/health/db")
def health_db():
    try:
        db.command("ping")
        return {"mongo": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"mongo_error: {e}")

# ---- Templates (raw store/fetch) ----
@app.post("/templates", response_model=TemplateOut)
def create_template(t: TemplateIn):
    res = db.templates.insert_one({"yaml": t.yaml, "name": t.name})
    return {"id": str(res.inserted_id), "yaml": t.yaml, "name": t.name}

@app.get("/templates/{template_id}", response_model=TemplateOut)
def get_template(template_id: str):
    doc = db.templates.find_one({"_id": oid(template_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="not_found")
    return {"id": str(doc["_id"]), "yaml": doc["yaml"], "name": doc.get("name")}

# ---- Objects (raw store/fetch) ----
@app.post("/objects")
def create_object(obj: ObjectIn):
    res = db.objects.insert_one({"doc": obj.doc})
    return {"id": str(res.inserted_id)}

@app.get("/objects/{object_id}")
def get_object(object_id: str):
    doc = db.objects.find_one({"_id": oid(object_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="not_found")
    return {"id": str(doc["_id"]), "doc": doc["doc"]}

# ---- Apply Patch (blind JSON Patch: add/replace/remove) ----
@app.post("/objects/{object_id}/applyPatch")
def apply_patch(object_id: str, body: PatchIn):
    obj = db.objects.find_one({"_id": oid(object_id)})
    if not obj:
        raise HTTPException(status_code=404, detail="not_found")

    try:
        patch = jsonpatch.JsonPatch(body.patch)
        updated = patch.apply(obj["doc"], in_place=False)
    except jsonpatch.JsonPatchException as e:
        raise HTTPException(status_code=400, detail=f"patch_error: {e}")

    db.objects.update_one({"_id": obj["_id"]}, {"$set": {"doc": updated}})
    return {"id": str(obj["_id"]), "doc": updated}
