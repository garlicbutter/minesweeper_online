use crate::game::{Room, Settings, now};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

pub struct AppState {
    rooms: Mutex<HashMap<String, Room>>,
    dirty: AtomicBool,
    data_dir: PathBuf,
    flush_lock: tokio::sync::Mutex<()>,
}
impl AppState {
    pub async fn load(data_dir: PathBuf) -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        tokio::fs::create_dir_all(&data_dir).await?;
        let saved: Vec<Room> = match tokio::fs::read(data_dir.join("rooms.json")).await {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(e) => return Err(e.into()),
        };
        let rooms = saved
            .into_iter()
            .filter(|r| now().saturating_sub(r.created_at) < 86_400_000)
            .map(|r| (r.code.clone(), r))
            .collect();
        Ok(Arc::new(Self {
            rooms: Mutex::new(rooms),
            dirty: AtomicBool::new(false),
            data_dir,
            flush_lock: tokio::sync::Mutex::new(()),
        }))
    }
    pub async fn flush(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let _guard = self.flush_lock.lock().await;
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return Ok(());
        }
        let snapshot: Vec<_> = self
            .rooms
            .lock()
            .unwrap()
            .values()
            .filter(|r| now().saturating_sub(r.created_at) < 86_400_000)
            .cloned()
            .collect();
        let result = async {
            let bytes = serde_json::to_vec(&snapshot)?;
            tokio::fs::write(self.data_dir.join("rooms.tmp"), bytes).await?;
            tokio::fs::rename(
                self.data_dir.join("rooms.tmp"),
                self.data_dir.join("rooms.json"),
            )
            .await?;
            Ok::<_, Box<dyn std::error::Error + Send + Sync>>(())
        }
        .await;
        if result.is_err() {
            self.dirty.store(true, Ordering::Release);
        }
        result
    }
}
#[derive(Debug)]
struct ApiError(String);
impl From<String> for ApiError {
    fn from(error: String) -> Self {
        Self(error)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, Json(json!({ "error": self.0 }))).into_response()
    }
}
fn token(headers: &HeaderMap) -> Result<&str, ApiError> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError("Room session expired. Rejoin with the room code.".into()))
}
fn with_room<T>(
    state: &AppState,
    code: &str,
    f: impl FnOnce(&mut Room) -> Result<T, String>,
) -> Result<T, ApiError> {
    let code = code.to_ascii_uppercase();
    if code.len() != 6
        || !code
            .bytes()
            .all(|c| c.is_ascii_uppercase() || (b'2'..=b'9').contains(&c))
    {
        return Err(ApiError("Enter a valid six-character room code.".into()));
    }
    let mut rooms = state.rooms.lock().unwrap();
    let room = rooms
        .get_mut(&code)
        .filter(|r| now().saturating_sub(r.created_at) < 86_400_000)
        .ok_or_else(|| ApiError("Room not found or expired. Create a new room.".into()))?;
    f(room).map_err(ApiError)
}
async fn create_room(
    State(state): State<Arc<AppState>>,
    Json(input): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let mut rooms = state.rooms.lock().unwrap();
    for _ in 0..10 {
        let room = Room::new(&input)?;
        if rooms.contains_key(&room.code) {
            continue;
        }
        let id = room.players[0].id.clone();
        let response = json!({ "token": id, "room": room.view(&id)? });
        rooms.insert(room.code.clone(), room);
        state.dirty.store(true, Ordering::Release);
        return Ok((StatusCode::CREATED, Json(response)));
    }
    Err(ApiError("Could not allocate a room. Try again.".into()))
}
async fn join_room(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
    Json(input): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let result = with_room(&state, &code, |r| {
        let settings = if ["difficulty", "width", "height", "mines"]
            .iter()
            .any(|key| !input[key].is_null())
        {
            Settings::from_input(&input)?
        } else {
            r.settings
        };
        let id = r.join_with_settings(input["name"].as_str().unwrap_or("Player"), settings)?;
        Ok(json!({ "token": id, "room": r.view(&id)? }))
    })?;
    state.dirty.store(true, Ordering::Release);
    Ok(Json(result))
}
async fn get_room(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let id = token(&headers)?;
    Ok(Json(with_room(&state, &code, |r| {
        Ok(json!({ "room": r.view(id)? }))
    })?))
}
async fn action(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
    headers: HeaderMap,
    Json(input): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let id = token(&headers)?;
    let result = with_room(&state, &code, |r| {
        r.act(id, &input)?;
        Ok(json!({ "room": if input["type"] == "leave" { Value::Null } else { r.view(id)? } }))
    })?;
    if input["type"] != "ping" {
        state.dirty.store(true, Ordering::Release);
    }
    Ok(Json(result))
}
fn asset(body: impl Into<Body>, content_type: &'static str) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body.into(),
    )
        .into_response()
}
async fn wasm_asset() -> Response {
    let public = std::env::var("PUBLIC_DIR").unwrap_or_else(|_| "public".into());
    match tokio::fs::read(PathBuf::from(public).join("minefield.wasm")).await {
        Ok(bytes) => asset(bytes, "application/wasm"),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Build the browser engine first: ./scripts/build.sh",
        )
            .into_response(),
    }
}
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route(
            "/",
            get(|| async {
                asset(
                    include_str!("../public/index.html"),
                    "text/html; charset=utf-8",
                )
            }),
        )
        .route(
            "/style.css",
            get(|| async {
                asset(
                    include_str!("../public/style.css"),
                    "text/css; charset=utf-8",
                )
            }),
        )
        .route(
            "/app.js",
            get(|| async {
                asset(
                    include_str!("../public/app.js"),
                    "text/javascript; charset=utf-8",
                )
            }),
        )
        .route(
            "/game.js",
            get(|| async {
                asset(
                    include_str!("../public/game.js"),
                    "text/javascript; charset=utf-8",
                )
            }),
        )
        .route("/minefield.wasm", get(wasm_asset))
        .route("/health", get(|| async { "ok" }))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/{code}", get(get_room))
        .route("/api/rooms/{code}/join", post(join_room))
        .route("/api/rooms/{code}/action", post(action))
        .layer(DefaultBodyLimit::max(10_000))
        .with_state(state)
}
