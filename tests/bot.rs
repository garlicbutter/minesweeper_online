use minefield::{
    bot::{BotMove, choose_move},
    game::{Phase, Room, Settings, Status, now},
};
use serde_json::json;

fn settings() -> Settings {
    Settings {
        width: 5,
        height: 5,
        mines: 8,
    }
}
#[test]
fn bot_deduces_safe_cells_and_mines_from_visible_clues() {
    let mut cells = vec![None; 25];
    cells[6] = Some(1);
    assert_eq!(
        choose_move(settings(), &cells, &[0]),
        Some(BotMove::Reveal(1))
    );
    cells[6] = Some(8);
    assert_eq!(choose_move(settings(), &cells, &[]), Some(BotMove::Flag(0)));
}
#[test]
fn opening_guesses_and_finished_boards_do_not_require_hidden_layouts() {
    let s = settings();
    assert_eq!(choose_move(s, &[None; 25], &[]), Some(BotMove::Reveal(12)));
    for _ in 0..50 {
        let choice = choose_move(s, &[None; 25], &[12]);
        assert!(matches!(choice, Some(BotMove::Reveal(index)) if index != 12 && index < 25));
    }
    assert_eq!(choose_move(s, &[Some(0); 25], &[]), None);
    assert_eq!(choose_move(s, &[], &[]), None);
}
#[test]
fn ai_room_waits_for_human_readiness_and_countdown_then_moves_at_a_fixed_pace() {
    let mut r = Room::new(&json!({"difficulty":"hard","bot":true})).unwrap();
    let host = r.players[0].id.clone();
    assert_eq!(r.players.len(), 2);
    assert!(r.players[1].bot && r.players[1].ready);
    assert_eq!(r.phase, Phase::Waiting);
    assert!(!r.advance_bot(now()));
    assert!(r.join("Third").is_err());
    r.act(&host, &json!({"type":"ready"})).unwrap();
    assert!(!r.advance_bot(now()));
    assert!(r.players[1].board.is_none());
    let at = now();
    r.available_at = Some(at - 1);
    assert!(r.advance_bot(at));
    assert!(r.players[0].board.is_none());
    assert!(r.players[1].board.is_some());
    let opening = r.players[1].opening.unwrap();
    assert_eq!(r.players[1].board.as_ref().unwrap()[opening], 0);
    let version = r.version;
    assert!(!r.advance_bot(at + 699));
    assert_eq!(r.version, version);
    let view = r.view(&host).unwrap();
    assert_eq!(view["players"][1]["bot"], true);
    assert_eq!(view["players"][1]["name"], "Test AI");
    assert!(
        view["cells"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v.is_null())
    );
    assert!(!view.to_string().contains(&r.players[1].id));
    r.act(&host, &json!({"type":"leave"})).unwrap();
    assert_eq!(r.phase, Phase::Finished);
    assert!(!r.advance_bot(at + 5000));
    r.act(&host, &json!({"type":"rematch"})).unwrap();
    assert!(r.players[1].ready);
    assert!(r.players[1].board.is_none());
    assert!(r.players[1].bot_next_move_at.is_none());
    assert!(!r.advance_bot(at + 6000));
    let restored: Room = serde_json::from_value(serde_json::to_value(&r).unwrap()).unwrap();
    assert!(restored.players[1].bot && restored.players[1].ready);
}
#[test]
fn bot_can_win_and_stops_after_round_completion() {
    let mut r = Room::new(&json!({"width":5,"height":5,"mines":1,"bot":true})).unwrap();
    r.phase = Phase::Playing;
    r.available_at = Some(now() - 1);
    r.started_at = Some(now() - 1000);
    let s = r.settings;
    let mut board = vec![0; 25];
    board[24] = -1;
    for i in [18, 19, 23] {
        board[i] = 1;
    }
    let bot = &mut r.players[1];
    bot.board = Some(board);
    bot.opening = Some(0);
    bot.revealed = (0..s.len()).filter(|&i| i != 24 && i != 23).collect();
    bot.flags = vec![24];
    let id = bot.id.clone();
    assert!(r.advance_bot(now()));
    assert_eq!(r.phase, Phase::Finished);
    assert_eq!(r.winner, Some(id));
    assert!(!r.advance_bot(now() + 10000));
}
#[test]
fn bot_obeys_the_same_explosion_penalty_as_a_human() {
    let mut r = Room::new(&json!({"width":5,"height":5,"mines":1,"bot":true})).unwrap();
    r.phase = Phase::Playing;
    r.available_at = Some(now() - 1);
    r.started_at = Some(now() - 1000);
    let mut board = vec![0; 25];
    board[24] = -1;
    for i in [18, 19, 23] {
        board[i] = 1;
    }
    let bot = &mut r.players[1];
    bot.board = Some(board);
    bot.opening = Some(0);
    bot.revealed = vec![6];
    let id = bot.id.clone();
    r.act(&id, &json!({"type":"reveal","index":24})).unwrap();
    assert_eq!(r.phase, Phase::Playing);
    assert_eq!(r.players[1].status, Status::Playing);
    assert_eq!(r.players[1].hits, 1);
    assert_eq!(r.players[1].explosion.as_ref().unwrap().cells.len(), 25);
}
#[test]
fn bot_settings_are_independent_and_solo_cannot_create_an_ai_room() {
    let r = Room::new(&json!({"difficulty":"easy","bot":true,"botSettings":{"difficulty":"hard"}}))
        .unwrap();
    assert_eq!(r.players[0].settings.unwrap().mines, 10);
    assert_eq!(r.players[1].settings.unwrap().mines, 99);
    assert!(Room::new(&json!({"solo":true,"bot":true})).is_err());
}
