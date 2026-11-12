use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use minefield::{
    game::{Room, now},
    server::{AppState, router},
};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn request(
    app: &Router,
    path: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .uri(path)
        .method(if body.is_some() { "POST" } else { "GET" });
    if let Some(token) = token {
        req = req.header("authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(
            req.header("content-type", "application/json")
                .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
fn dir() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "minefield-test-{}-{}",
        std::process::id(),
        Room::new(&json!({})).unwrap().players[0].id
    ))
}
#[tokio::test]
async fn room_api_independent_difficulties_explosion_forfeit_and_rematch() {
    let path = dir();
    let state = AppState::load(path.clone()).await.unwrap();
    let app = router(state.clone());
    let (status, a) = request(
        &app,
        "/api/rooms",
        Some(json!({"difficulty":"easy","name":"Host"})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let code = a["room"]["code"].as_str().unwrap();
    let host = a["token"].as_str().unwrap();
    let base = format!("/api/rooms/{code}");
    let (_, b) = request(
        &app,
        &format!("{base}/join"),
        Some(json!({"name":"Friend","difficulty":"hard"})),
        None,
    )
    .await;
    let guest = b["token"].as_str().unwrap();
    assert_ne!(host, guest);
    assert_eq!(
        request(&app, &base, None, None).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&app, &format!("{base}/join"), Some(json!({})), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let action = format!("{base}/action");
    request(&app, &action, Some(json!({"type":"ready"})), Some(host)).await;
    let (_, ready) = request(&app, &action, Some(json!({"type":"ready"})), Some(guest)).await;
    assert_eq!(ready["room"]["phase"], "playing");
    assert_eq!(ready["room"]["startedAt"], ready["room"]["availableAt"]);
    let host_start = request(&app, &base, None, Some(host)).await.1;
    assert_eq!(host_start["room"]["startedAt"], ready["room"]["startedAt"]);
    assert!(
        ready["room"]["startedAt"].as_u64().unwrap() > ready["room"]["serverNow"].as_u64().unwrap()
    );
    assert!(
        ready["room"]["cells"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c.is_null())
    );
    tokio::time::sleep(std::time::Duration::from_millis(3050)).await;
    request(
        &app,
        &action,
        Some(json!({"type":"reveal","index":0})),
        Some(host),
    )
    .await;
    request(
        &app,
        &action,
        Some(json!({"type":"reveal","index":80})),
        Some(guest),
    )
    .await;
    state.flush().await.unwrap();
    let saved: Vec<Room> =
        serde_json::from_slice(&tokio::fs::read(path.join("rooms.json")).await.unwrap()).unwrap();
    let mine = saved[0].players[0]
        .board
        .as_ref()
        .unwrap()
        .iter()
        .position(|&v| v == -1)
        .unwrap();
    let (_, lost) = request(
        &app,
        &action,
        Some(json!({"type":"reveal","index":mine})),
        Some(host),
    )
    .await;
    assert_eq!(lost["room"]["phase"], "playing");
    assert!(lost["room"]["winner"].is_null());
    assert_eq!(lost["room"]["me"]["hits"], 1);
    assert_eq!(
        lost["room"]["me"]["explosion"]["cells"]
            .as_array()
            .unwrap()
            .len(),
        36
    );
    let guest_view = request(&app, &base, None, Some(guest)).await.1;
    assert_eq!(guest_view["room"]["settings"]["width"], 30);
    assert_eq!(
        guest_view["room"]["players"][0]["cells"]
            .as_array()
            .unwrap()
            .len(),
        81
    );
    request(&app, &action, Some(json!({"type":"leave"})), Some(host)).await;
    assert_eq!(
        request(&app, &action, Some(json!({"type":"rematch"})), Some(guest))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (_, again) = request(&app, &action, Some(json!({"type":"rematch"})), Some(host)).await;
    assert_eq!(again["room"]["phase"], "waiting");
    let (_, left) = request(&app, &action, Some(json!({"type":"leave"})), Some(guest)).await;
    assert!(left["room"].is_null());
    state.flush().await.unwrap();
    let reloaded = router(AppState::load(path.clone()).await.unwrap());
    assert_eq!(
        request(&reloaded, &base, None, Some(host)).await.1["room"]["players"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    tokio::fs::remove_dir_all(path).await.unwrap();
}
#[tokio::test]
async fn heartbeat_does_not_trigger_persistence_and_routes_serve_expected_types() {
    let path = dir();
    let state = AppState::load(path.clone()).await.unwrap();
    let app = router(state.clone());
    let (_, a) = request(&app, "/api/rooms", Some(json!({"solo":true})), None).await;
    state.flush().await.unwrap();
    let before = tokio::fs::read(path.join("rooms.json")).await.unwrap();
    let action = format!("/api/rooms/{}/action", a["room"]["code"].as_str().unwrap());
    request(
        &app,
        &action,
        Some(json!({"type":"ping"})),
        a["token"].as_str(),
    )
    .await;
    state.flush().await.unwrap();
    assert_eq!(
        before,
        tokio::fs::read(path.join("rooms.json")).await.unwrap()
    );
    for (url, content_type) in [
        ("/", "text/html"),
        ("/app.js", "text/javascript"),
        ("/game.js", "text/javascript"),
        ("/sound.js", "text/javascript"),
        ("/style.css", "text/css"),
    ] {
        let res = app
            .clone()
            .oneshot(Request::builder().uri(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert!(
            res.headers()["content-type"]
                .to_str()
                .unwrap()
                .starts_with(content_type)
        );
    }
    tokio::fs::remove_dir_all(path).await.unwrap();
}
#[tokio::test]
async fn expiration_validation_and_solo_room_restrictions() {
    let path = dir();
    tokio::fs::create_dir_all(&path).await.unwrap();
    let mut old = Room::new(&json!({})).unwrap();
    old.created_at = now() - 86_400_001;
    tokio::fs::write(
        path.join("rooms.json"),
        serde_json::to_vec(&vec![old.clone()]).unwrap(),
    )
    .await
    .unwrap();
    let app = router(AppState::load(path.clone()).await.unwrap());
    assert_eq!(
        request(
            &app,
            &format!("/api/rooms/{}", old.code),
            None,
            Some(&old.players[0].id)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&app, "/api/rooms", Some(json!({"width":-1})), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (_, a) = request(&app, "/api/rooms", Some(json!({"solo":true})), None).await;
    assert_eq!(
        request(
            &app,
            &format!("/api/rooms/{}/join", a["room"]["code"].as_str().unwrap()),
            Some(json!({})),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    tokio::fs::remove_dir_all(path).await.unwrap();
}

#[tokio::test]
async fn ai_is_scheduled_without_polling_and_survives_persistence() {
    let path = dir();
    let state = AppState::load(path.clone()).await.unwrap();
    let app = router(state.clone());
    let (status, created) = request(
        &app,
        "/api/rooms",
        Some(json!({"difficulty":"hard","bot":true})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let token = created["token"].as_str().unwrap();
    let code = created["room"]["code"].as_str().unwrap();
    let base = format!("/api/rooms/{code}");
    let action = format!("{base}/action");
    assert_eq!(created["room"]["players"][1]["bot"], true);
    request(&app, &action, Some(json!({"type":"ready"})), Some(token)).await;
    state.advance_bots();
    state.flush().await.unwrap();
    let before: Vec<Room> =
        serde_json::from_slice(&tokio::fs::read(path.join("rooms.json")).await.unwrap()).unwrap();
    assert!(before[0].players[1].board.is_none());
    tokio::time::sleep(std::time::Duration::from_millis(3050)).await;
    state.advance_bots();
    state.flush().await.unwrap(); // No browser poll or request has driven this move.
    let after: Vec<Room> =
        serde_json::from_slice(&tokio::fs::read(path.join("rooms.json")).await.unwrap()).unwrap();
    assert!(!after[0].players[1].revealed.is_empty());
    let restored = router(AppState::load(path.clone()).await.unwrap());
    let (_, view) = request(&restored, &base, None, Some(token)).await;
    assert_eq!(view["room"]["players"][1]["bot"], true);
    assert!(view["room"]["players"][1]["cleared"].as_u64().unwrap() > 0);
    request(&app, &action, Some(json!({"type":"leave"})), Some(token)).await;
    request(&app, &action, Some(json!({"type":"rematch"})), Some(token)).await;
    let (_, again) = request(&app, &base, None, Some(token)).await;
    assert_eq!(again["room"]["players"][1]["ready"], true);
    assert!(
        again["room"]["players"][1]["cells"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c.is_null())
    );
    tokio::fs::remove_dir_all(path).await.unwrap();
}
