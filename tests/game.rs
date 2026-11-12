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
        assert_eq!(r.players[0].board.as_ref().unwrap()[first], 0);
        assert!(r.players[0].revealed.contains(&first));
        assert!(r.started_at.unwrap() <= now());
    }
}
#[test]
fn multiplayer_uses_independent_settings_and_safe_first_clicks() {
    let mut r = Room::new(&json!({"difficulty":"medium"})).unwrap();
    let p = r.players[0].id.clone();
    let hard = Settings::from_input(&json!({"difficulty":"hard"})).unwrap();
    let q = r.join_with_settings("Friend", hard).unwrap();
    r.act(
        &p,
        &json!({"type":"ready","settings":{"difficulty":"easy"}}),
    )
    .unwrap();
    assert_eq!(r.phase, Phase::Waiting);
    r.act(&q, &json!({"type":"ready"})).unwrap();
    assert!(r.act(&p, &json!({"type":"reveal","index":0})).is_err());
    r.available_at = Some(now() - 1);
    r.act(&p, &json!({"type":"reveal","index":0})).unwrap();
    assert!(r.players[0].board.is_some());
    assert!(r.players[1].board.is_none());
    r.act(&q, &json!({"type":"reveal","index":479})).unwrap();
    for (player, count, first) in [(&r.players[0], 10, 0), (&r.players[1], 99, 479)] {
        let b = player.board.as_ref().unwrap();
        assert_eq!(b.iter().filter(|&&n| n == -1).count(), count);
        assert_eq!(b[first], 0);
        assert!(player.revealed.contains(&first));
    }
    assert_eq!(r.view(&p).unwrap()["settings"]["width"], 9);
    assert_eq!(r.view(&q).unwrap()["settings"]["width"], 30);
    assert!(
        r.act(&p, &json!({"type":"settings","difficulty":"hard"}))
            .is_err()
    );
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
fn incorrect_multiplayer_chord_explodes_but_forfeit_still_ends_the_round() {
    let mut r = fixture();
    let id = r.players[0].id.clone();
    let qid = r.join("Friend").err();
    assert!(qid.is_some()); // Active rooms cannot be joined.
    let q = Player::new("Friend");
    let qid = q.id.clone();
    r.players.push(q);
    r.act(&id, &json!({"type":"flag","index":1})).unwrap();
    r.act(&id, &json!({"type":"reveal","index":6})).unwrap();
    assert_eq!(r.phase, Phase::Playing);
    assert_eq!(r.players[0].status, Status::Playing);
    assert_eq!(r.players[0].hits, 1);
    assert!(r.winner.is_none());
    r.act(&id, &json!({"type":"leave"})).unwrap();
    assert_eq!(r.winner, Some(qid.clone()));
    assert!(r.act(&qid, &json!({"type":"rematch"})).is_err());
    r.act(&id, &json!({"type":"rematch"})).unwrap();
    assert!(r.players.iter().all(|p| p.board.is_none()
        && p.hits == 0
        && p.explosion.is_none()
        && p.revealed.is_empty()));
}
#[test]
fn solo_mine_hit_still_ends_the_game() {
    let mut r = fixture();
    r.solo = true;
    let id = r.players[0].id.clone();
    r.act(&id, &json!({"type":"reveal","index":0})).unwrap();
    assert_eq!(r.phase, Phase::Finished);
    assert_eq!(r.players[0].status, Status::Lost);
    assert!(r.players[0].explosion.is_none());
}
#[test]
fn public_views_mirror_only_revealed_opponent_cells_and_placed_flags() {
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
    assert!(v["players"][1]["cells"][0].is_null());
    assert_eq!(v["players"][1]["flaggedCells"], json!([0]));
    assert!(v["players"][1]["cells"][2].is_null());
    assert_eq!(v["players"][1]["cells"][6], 1);
    assert!(v["players"][0]["cells"].is_null());
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
    let mut restored_view = restored.view(&id).unwrap();
    let mut original_view = r.view(&id).unwrap();
    restored_view.as_object_mut().unwrap().remove("serverNow");
    original_view.as_object_mut().unwrap().remove("serverNow");
    assert_eq!(restored_view, original_view);
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
    assert_ne!(r.players[0].board.as_ref().unwrap()[12], -1);
}

fn clues(settings: Settings, mines: &[usize]) -> Vec<i8> {
    let mut b = vec![0; settings.len()];
    for &i in mines {
        b[i] = -1;
    }
    for i in 0..b.len() {
        if b[i] != -1 {
            b[i] = settings
                .neighbors(i)
                .into_iter()
                .filter(|&j| b[j] == -1)
                .count() as i8;
        }
    }
    b
}
#[test]
fn explosion_resets_region_preserves_mines_updates_visible_boundary_clues_and_spares_opponent() {
    let mut r = Room::new(&json!({"width":10,"height":10,"mines":3})).unwrap();
    let id = r.players[0].id.clone();
    let guest = r.join("Friend").unwrap();
    r.phase = Phase::Playing;
    r.available_at = Some(now() - 1);
    r.started_at = Some(now() - 1000);
    let s = r.settings;
    let before = clues(s, &[22, 44, 99]);
    r.players[0].board = Some(before.clone());
    r.players[0].opening = Some(0);
    r.players[0].revealed = (0..s.len())
        .filter(|&i| before[i] != -1 && i != 0 && i != 23)
        .collect();
    r.players[0].flags = vec![23, 99];
    r.players[1].board = Some(clues(s, &[0, 1, 2]));
    r.players[1].revealed = vec![44];
    let other = serde_json::to_value(&r.players[1]).unwrap();
    r.act(&id, &json!({"type":"reveal","index":44})).unwrap();
    let p = &r.players[0];
    let blast = p.explosion.as_ref().unwrap();
    let b = p.board.as_ref().unwrap();
    assert_eq!((blast.x, blast.y, blast.width, blast.height), (2, 2, 6, 6));
    assert_eq!(blast.cells.len(), 36);
    assert_eq!(p.hits, 1);
    assert_eq!(r.phase, Phase::Playing);
    assert!(p.revealed.iter().all(|i| !blast.cells.contains(i)));
    assert_eq!(p.flags, vec![99]);
    assert_eq!(b.iter().filter(|&&v| v == -1).count(), 3);
    assert_eq!(blast.cells.iter().filter(|&&i| b[i] == -1).count(), 2);
    assert_ne!(b[44], -1);
    for i in 0..s.len() {
        if !blast.cells.contains(&i) {
            assert_eq!(b[i] == -1, before[i] == -1);
        }
        if b[i] != -1 {
            assert_eq!(
                b[i] as usize,
                s.neighbors(i).into_iter().filter(|&j| b[j] == -1).count()
            );
        }
    }
    let view = r.view(&id).unwrap();
    for &i in &p.revealed {
        assert_eq!(view["cells"][i], b[i]);
    }
    for &i in &blast.cells {
        assert!(view["cells"][i].is_null());
    }
    assert_eq!(serde_json::to_value(&r.players[1]).unwrap(), other);
    let expected: Vec<Option<i8>> = b
        .iter()
        .enumerate()
        .map(|(i, &value)| p.revealed.contains(&i).then_some(value))
        .collect();
    assert_eq!(
        r.view(&guest).unwrap()["players"][0]["cells"],
        json!(expected)
    );
    let next = blast.cells.iter().copied().find(|&i| b[i] == -1).unwrap();
    r.act(&id, &json!({"type":"reveal","index":next})).unwrap();
    assert_eq!(r.players[0].hits, 2);
    assert_eq!(r.phase, Phase::Playing);
}
#[test]
fn blasts_are_full_sized_at_edges_and_clamped_on_small_or_fully_mined_regions() {
    for (width, height, hit) in [
        (10, 10, 0),
        (10, 10, 9),
        (10, 10, 90),
        (10, 10, 99),
        (5, 5, 24),
        (5, 10, 0),
        (10, 5, 49),
    ] {
        let mut r = Room::new(&json!({"width":width,"height":height,"mines":1})).unwrap();
        let id = r.players[0].id.clone();
        r.phase = Phase::Playing;
        r.available_at = Some(now() - 1);
        r.players[0].board = Some(clues(r.settings, &[hit]));
        r.act(&id, &json!({"type":"reveal","index":hit})).unwrap();
        let blast = r.players[0].explosion.as_ref().unwrap();
        assert_eq!(blast.cells.len(), width.min(6) * height.min(6));
        assert!(blast.cells.contains(&hit));
        assert!(blast.cells.iter().all(|&i| i < width * height));
        assert_eq!(
            r.players[0]
                .board
                .as_ref()
                .unwrap()
                .iter()
                .filter(|&&v| v == -1)
                .count(),
            1
        );
    }
    let mut r = Room::new(&json!({"width":10,"height":10,"mines":36})).unwrap();
    let id = r.players[0].id.clone();
    r.phase = Phase::Playing;
    let mines: Vec<_> = (2..8)
        .flat_map(|y| (2..8).map(move |x| y * 10 + x))
        .collect();
    r.players[0].board = Some(clues(r.settings, &mines));
    r.act(&id, &json!({"type":"reveal","index":44})).unwrap();
    assert_eq!(r.phase, Phase::Playing);
    assert_eq!(r.players[0].hits, 1);
    assert_eq!(
        r.players[0]
            .board
            .as_ref()
            .unwrap()
            .iter()
            .filter(|&&v| v == -1)
            .count(),
        36
    );
}

#[test]
fn multiplayer_shares_one_start_deadline_after_both_ready_independent_of_openings() {
    let mut r = Room::new(&json!({"difficulty":"hard"})).unwrap();
    let host = r.players[0].id.clone();
    let guest = r.join("Guest").unwrap();
    r.act(&host, &json!({"type":"ready"})).unwrap();
    assert_eq!(r.phase, Phase::Waiting);
    assert!(r.started_at.is_none());
    assert!(r.available_at.is_none());
    r.act(&guest, &json!({"type":"ready"})).unwrap();
    let deadline = r.started_at.unwrap();
    assert_eq!(Some(deadline), r.available_at);
    assert!(deadline > now());
    assert_eq!(
        r.view(&host).unwrap()["startedAt"],
        r.view(&guest).unwrap()["startedAt"]
    );
    for id in [&host, &guest] {
        for kind in ["reveal", "flag"] {
            assert!(r.act(id, &json!({"type":kind,"index":0})).is_err());
        }
    }
    assert!(
        r.players
            .iter()
            .all(|p| p.board.is_none() && p.revealed.is_empty())
    );
    let start = now() - 1000;
    r.available_at = Some(start);
    r.started_at = Some(start);
    r.act(&host, &json!({"type":"reveal","index":0})).unwrap();
    assert_eq!(r.started_at, Some(start));
    assert!(r.players[1].board.is_none());
    r.act(&guest, &json!({"type":"reveal","index":479}))
        .unwrap();
    assert_eq!(r.started_at, Some(start));
}
