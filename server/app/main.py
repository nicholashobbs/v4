from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from bson import ObjectId
from pymongo import MongoClient
import os
import jsonpatch

# --- add near your imports ---
from pydantic import BaseModel, Field
from typing import List, Literal, Any, Optional, Dict
from datetime import datetime

# --- conversation models ---
class OpModel(BaseModel):
    op: Literal['add','replace','remove']
    path: str
    value: Optional[Any] = None

class StepModel(BaseModel):
    templatePath: str
    mode: Literal['diff','explicit']
    ops: List[OpModel]
    at: datetime = Field(default_factory=datetime.utcnow)

class TemplateRefModel(BaseModel):
    templatePath: str
    mode: Literal['diff','explicit']

class ConversationStateModel(BaseModel):
    pendingSteps: List[TemplateRefModel] = Field(default_factory=list)
    sessionState: Dict[str, Any] = Field(default_factory=dict)

class ConversationCreate(BaseModel):
    title: Optional[str] = None
    initial: dict = Field(default_factory=dict)

class ConversationUpdateTitle(BaseModel):
    title: str

class ConversationAppend(BaseModel):
    templatePath: str
    mode: Literal['diff','explicit']
    ops: List[OpModel]


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

# --- get collection ---
def conversations():
    return db["conversations"]

# --- routes ---
@app.post("/conversations")
def create_conversation(payload: ConversationCreate):
    doc = {
        "title": payload.title or str(ObjectId()),
        "initial": payload.initial,
        "steps": [],
        "pending_steps": [],
        "session_state": {},
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    ins = conversations().insert_one(doc)
    doc["id"] = str(ins.inserted_id)
    doc.pop("_id", None)
    return doc

@app.get("/conversations")
def list_conversations():
    items = []
    for c in conversations().find({}, {"title":1, "updated_at":1}).sort("updated_at", -1):
        items.append({"id": str(c["_id"]), "title": c.get("title"), "updated_at": c.get("updated_at")})
    return {"items": items}

@app.get("/conversations/{cid}")
def get_conversation(cid: str):
    c = conversations().find_one({"_id": ObjectId(cid)})
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    c_out = {
        "id": str(c["_id"]),
        "title": c.get("title"),
        "initial": c.get("initial"),
        "steps": c.get("steps", []),
        "pendingSteps": c.get("pending_steps", []),
        "sessionState": c.get("session_state", {}),
    }
    return c_out

@app.patch("/conversations/{cid}/title")
def rename_conversation(cid: str, payload: ConversationUpdateTitle):
    res = conversations().update_one({"_id": ObjectId(cid)},
                                     {"$set": {"title": payload.title, "updated_at": datetime.utcnow()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@app.post("/conversations/{cid}/appendStep")
def append_step(cid: str, payload: ConversationAppend):
    st = {"templatePath": payload.templatePath, "mode": payload.mode, "ops": [op.model_dump() for op in payload.ops],
          "at": datetime.utcnow()}
    res = conversations().update_one({"_id": ObjectId(cid)},
                                     {"$push": {"steps": st}, "$set": {"updated_at": datetime.utcnow()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@app.post("/conversations/{cid}/undo")
def undo_last(cid: str):
    res = conversations().update_one({"_id": ObjectId(cid)},
                                     {"$pop": {"steps": 1}, "$set": {"updated_at": datetime.utcnow()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@app.post("/conversations/{cid}/reset")
def reset_steps(cid: str):
    res = conversations().update_one({"_id": ObjectId(cid)},
                                     {"$set": {"steps": [], "updated_at": datetime.utcnow()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@app.patch("/conversations/{cid}/state")
def update_state(cid: str, payload: ConversationStateModel):
    update = {
        "pending_steps": [ref.model_dump() for ref in payload.pendingSteps],
        "session_state": payload.sessionState,
        "updated_at": datetime.utcnow(),
    }
    res = conversations().update_one({"_id": ObjectId(cid)}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}
