use minefield::game::{Phase, Player, Room, Settings, Status, generate, now};
use serde_json::json;

fn solo() -> (Room, String) {
    let mut room = Room::new(&json!({"difficulty":"easy", "solo":true})).unwrap();
    let id = room.players[0].id.clone();
    room.act(&id, &json!({"type":"ready"})).unwrap();
    (room, id)
}
#[test]
fn generation_preserves_counts_clues_and_openings() {
    for difficulty in ["easy", "medium", "hard"] {
        let settings = Settings::from_input(&json!({"difficulty":difficulty})).unwrap();
        for opening in [
            0,
            settings.width - 1,
            settings.len() / 2,
            settings.len() - 1,
        ] {
            for _ in 0..20 {
                let board = generate(settings, &[opening]);
                assert_eq!(board.iter().filter(|&&n| n == -1).count(), settings.mines);
                for i in settings.neighbors(opening).into_iter().chain([opening]) {
                    assert_ne!(board[i], -1);
                }
                for i in 0..board.len() {
                    if board[i] != -1 {
                        assert_eq!(
                            board[i] as usize,
                            settings
                                .neighbors(i)
                                .into_iter()
                                .filter(|&j| board[j] == -1)
                                .count()
                        );
                    }
                }
            }
        }
    }
}
#[test]
fn settings_reject_invalid_or_fractional_inputs() {
    for input in [
        json!({"width":4}),
        json!({"height":31}),
        json!({"mines":0}),
        json!({"width":9.5}),
        json!({"width":-1}),
        json!({"width":9,"height":9,"mines":73}),
        json!({"width":u64::MAX}),
    ] {
        assert!(Settings::from_input(&input).is_err(), "accepted {input}");
    }
}
#[test]
fn solo_is_fully_covered_and_clock_waits_for_first_unflagged_click() {
    for first in [0, 8, 40, 72, 80] {
        let (mut r, id) = solo();
        assert!(r.board.is_none());
        assert!(r.started_at.is_none());
        assert!(
            r.view(&id).unwrap()["cells"]
                .as_array()
                .unwrap()
                .iter()
                .all(|v| v.is_null())
        );
        r.act(&id, &json!({"type":"flag","index":first})).unwrap();
        r.act(&id, &json!({"type":"reveal","index":first})).unwrap();
        assert!(r.board.is_none());
        r.act(&id, &json!({"type":"flag","index":first})).unwrap();
        r.act(&id, &json!({"type":"reveal","index":first})).unwrap();
        assert_eq!(r.board.as_ref().unwrap()[first], 0);
        assert!(r.players[0].revealed.contains(&first));
        assert!(r.started_at.unwrap() <= now());
    }
}
#[test]
fn multiplayer_shares_one_board_and_guarantees_both_first_clicks_even_when_dense() {
    for mines in [10, 72] {
        let mut r = Room::new(&json!({"width":9,"height":9,"mines":mines})).unwrap();
        let p = r.players[0].id.clone();
        let q = r.join("Friend").unwrap();
        r.act(&p, &json!({"type":"ready"})).unwrap();
        assert_eq!(r.phase, Phase::Waiting);
        r.act(&q, &json!({"type":"ready"})).unwrap();
        assert_eq!(r.phase, Phase::Playing);
        assert!(r.act(&p, &json!({"type":"reveal","index":0})).is_err());
        r.available_at = Some(now() - 1);
        r.act(&p, &json!({"type":"reveal","index":0})).unwrap();
        assert!(r.board.is_none());
        r.act(&p, &json!({"type":"reveal","index":1})).unwrap();
        assert_eq!(r.players[0].opening, Some(0));
        r.act(&q, &json!({"type":"reveal","index":80})).unwrap();
        let board = r.board.as_ref().unwrap();
        assert_eq!(board.iter().filter(|&&n| n == -1).count(), mines);
        assert_ne!(board[0], -1);
        assert_ne!(board[80], -1);
        assert!(r.players[0].revealed.contains(&0));
        assert!(r.players[1].revealed.contains(&80));
    }
}
fn fixture() -> Room {
    let mut r = Room::new(&json!({"width":5,"height":5,"mines":1})).unwrap();
    let mut board = vec![0; 25];
    board[0] = -1;
    for i in [1, 5, 6] {
        board[i] = 1;
    }
    r.board = Some(board);
    r.phase = Phase::Playing;
    r.started_at = Some(now() - 5000);
    r.players[0].revealed = vec![6];
    r
}
#[test]
fn left_click_chords_only_with_matching_flags_and_wins() {
    let mut r = fixture();
    let id = r.players[0].id.clone();
    r.act(&id, &json!({"type":"reveal","index":6})).unwrap();
    assert_eq!(r.players[0].revealed, vec![6]);
    r.act(&id, &json!({"type":"flag","index":0})).unwrap();
    r.act(&id, &json!({"type":"reveal","index":6})).unwrap();
    assert_eq!(r.players[0].status, Status::Won);
    assert_eq!(r.players[0].revealed.len(), 24);
    assert_eq!(r.winner, Some(id));
}
#[test]
fn incorrect_chord_forfeit_and_rematch() {
    let mut r = fixture();
    let id = r.players[0].id.clone();
    let q = Player::new("Friend");
    let qid = q.id.clone();
    r.players.push(q);
    r.act(&id, &json!({"type":"flag","index":1})).unwrap();
    r.act(&id, &json!({"type":"reveal","index":6})).unwrap();
    assert_eq!(r.players[0].status, Status::Lost);
    assert_eq!(r.winner, Some(qid.clone()));
    assert!(r.act(&qid, &json!({"type":"rematch"})).is_err());
    r.act(&id, &json!({"type":"rematch"})).unwrap();
    assert!(r.board.is_none());
    assert!(r.started_at.is_none());
    assert!(
        r.players
            .iter()
            .all(|p| p.opening.is_none() && p.revealed.is_empty() && !p.ready)
    );
    r.act(&id, &json!({"type":"ready"})).unwrap();
    r.act(&qid, &json!({"type":"ready"})).unwrap();
    r.act(&id, &json!({"type":"leave"})).unwrap();
    assert_eq!(r.winner, Some(qid));
}
#[test]
fn public_views_hide_mines_tokens_and_opponent_flags() {
    let mut r = fixture();
    let id = r.players[0].id.clone();
    let q = Player::new("Friend");
    let qid = q.id.clone();
    r.players.push(q);
    r.players[1].revealed = vec![1, 6];
    r.players[1].flags = vec![0];
    let v = r.view(&id).unwrap();
    let encoded = v.to_string();
    assert!(!encoded.contains(&id));
    assert!(!encoded.contains(&qid));
    assert!(v.get("board").is_none());
    assert!(v["cells"][0].is_null());
    assert_eq!(v["players"][1]["clearedCells"], json!([1, 6]));
    assert_eq!(v["players"][1]["flags"], 1);
    assert!(r.view("unknown").is_err());
}
#[test]
fn rejects_invalid_cells_and_preserves_saved_room_format() {
    let (mut r, id) = solo();
    for index in [json!(-1), json!(1.5), json!(81), json!("0")] {
        assert!(r.act(&id, &json!({"type":"reveal","index":index})).is_err());
    }
    let saved = serde_json::to_value(&r).unwrap();
    assert!(saved.get("createdAt").is_some());
    let restored: Room = serde_json::from_value(saved).unwrap();
    assert_eq!(restored.view(&id).unwrap(), r.view(&id).unwrap());
}

#[test]
fn loads_legacy_node_snapshot_without_losing_game_state() {
    let saved = json!({
        "code": "ABC234", "settings": {"width": 5, "height": 5, "mines": 1},
        "players": [{"id": "legacy-session", "name": "Player", "ready": true,
            "revealed": [], "flags": [0], "status": "playing", "lastSeen": now()}],
        "phase": "playing", "solo": true, "board": null, "opening": 12,
        "startedAt": null, "winner": null, "round": 1, "createdAt": now(), "version": 3
    });
    let mut r: Room = serde_json::from_value(saved).unwrap();
    assert_eq!(r.players[0].flags, vec![0]);
    assert_eq!(r.players[0].opening, None);
    r.act("legacy-session", &json!({"type":"reveal","index":12}))
        .unwrap();
    assert_ne!(r.board.unwrap()[12], -1);
}
