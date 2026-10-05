"""Takumi FastAPI application entrypoint."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from . import config, db, jobs, seed
from .routers import health, lessons, recordings, trainee


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    db.init_db()
    with db.conn() as c:
        interrupted = jobs.mark_orphaned_jobs_failed(c)
    if interrupted:
        print(f"[takumi] marked {interrupted} interrupted job(s) as failed")
    seed.seed_if_needed()
    yield


app = FastAPI(title="Takumi", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)

app.include_router(recordings.router)
app.include_router(lessons.router)
app.include_router(trainee.router)
app.include_router(health.router)


@app.get("/api")
def api_root():
    return {"app": "Takumi", "docs": "/docs"}


# Serve the built frontend (npm run build) from the same origin for offline demos.
if config.FRONTEND_DIST.is_dir() and (config.FRONTEND_DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIST), html=True), name="frontend")
else:  # pragma: no cover - dev convenience
    @app.get("/")
    def root_redirect():
        return {"message": "frontend not built yet; run npm run build in ../frontend or use the Vite dev server on :5173"}
